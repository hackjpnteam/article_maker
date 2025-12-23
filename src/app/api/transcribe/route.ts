import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { del } from '@vercel/blob';
import OpenAI from 'openai';
import { writeFile, unlink, mkdir, readFile, readdir, rmdir } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MAX_FILE_SIZE = 24 * 1024 * 1024; // 24MB (余裕を持たせる)
const CHUNK_DURATION = 600; // 10分ごとに分割

type ProgressData = {
  type: 'progress';
  step: string;
  progress: number;
  message: string;
  detail?: string;
};

type ResultData = {
  type: 'result';
  text: string;
  chunks?: number;
  duration?: number;
};

type ErrorData = {
  type: 'error';
  error: string;
};

type SSEData = ProgressData | ResultData | ErrorData;

// Helper to send SSE events
function sendSSE(controller: ReadableStreamDefaultController, data: SSEData) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
}

// Get ffmpeg path (use ffmpeg-static on Vercel, system ffmpeg locally)
function getFFmpegPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('ffmpeg-static');
  } catch {
    return 'ffmpeg';
  }
}

function getFFprobePath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('ffprobe-static').path;
  } catch {
    return 'ffprobe';
  }
}

async function getAudioDuration(filePath: string, fileSize: number): Promise<number> {
  try {
    const ffprobePath = getFFprobePath();
    const { stdout } = await execAsync(
      `"${ffprobePath}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    );
    const duration = parseFloat(stdout.trim());
    if (duration > 0) return duration;
  } catch (error) {
    console.error('Failed to get duration with ffprobe:', error);
  }

  // Fallback: estimate duration based on file size
  // Assume average bitrate of 128kbps (16KB/s) for audio
  const estimatedDuration = fileSize / (16 * 1024);
  console.log(`Estimated duration from file size: ${Math.floor(estimatedDuration / 60)}min`);
  return estimatedDuration;
}

async function splitAudio(
  inputPath: string,
  outputDir: string,
  controller: ReadableStreamDefaultController,
  fileSize: number
): Promise<string[]> {
  const duration = await getAudioDuration(inputPath, fileSize);
  const chunks: string[] = [];

  const numChunks = Math.ceil(duration / CHUNK_DURATION);
  const ffmpegPath = getFFmpegPath();

  console.log(`Audio duration: ${Math.floor(duration / 60)}分${Math.floor(duration % 60)}秒, splitting into ${numChunks} chunks`);

  for (let i = 0; i < numChunks; i++) {
    const startTime = i * CHUNK_DURATION;
    const chunkPath = path.join(outputDir, `chunk_${i.toString().padStart(3, '0')}.mp3`);

    sendSSE(controller, {
      type: 'progress',
      step: 'split',
      progress: 30 + Math.floor((i / numChunks) * 20),
      message: `音声を分割中... (${i + 1}/${numChunks})`,
      detail: `パート ${i + 1} を準備しています`,
    });

    await execAsync(
      `"${ffmpegPath}" -y -i "${inputPath}" -ss ${startTime} -t ${CHUNK_DURATION} -acodec libmp3lame -ar 16000 -ac 1 -b:a 64k "${chunkPath}"`
    );

    chunks.push(chunkPath);
  }

  return chunks;
}

async function transcribeChunk(chunkPath: string): Promise<string> {
  const audioBuffer = await readFile(chunkPath);
  const file = new File([new Uint8Array(audioBuffer)], path.basename(chunkPath), { type: 'audio/mp3' });

  const transcription = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file: file,
    language: 'ja',
  });

  return transcription.text;
}

// Security: Allowed audio/video file extensions (video files will have audio extracted)
const ALLOWED_EXTENSIONS = ['.mp3', '.m4a', '.wav', '.webm', '.ogg', '.flac', '.aac', '.caf', '.mp4', '.mov', '.avi', '.mkv', '.m4v'];

export async function POST(request: NextRequest) {
  // Security: Require authentication
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json(
      { error: 'ログインが必要です' },
      { status: 401 }
    );
  }

  let fileBuffer: Buffer;
  let fileName: string;
  let fileSize: number;
  let ext: string;
  let blobUrlToDelete: string | null = null;

  // Check content type to determine if it's JSON (blob URL) or FormData (file upload)
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    // Handle blob URL
    const body = await request.json();
    const { blobUrl, name, size } = body;
    blobUrlToDelete = blobUrl; // Save for cleanup after processing

    if (!blobUrl || typeof blobUrl !== 'string') {
      return NextResponse.json(
        { error: 'Blob URLが必要です' },
        { status: 400 }
      );
    }

    // Security: Validate blob URL is from Vercel
    if (!blobUrl.includes('.vercel-storage.com') && !blobUrl.includes('.public.blob.vercel-storage.com')) {
      return NextResponse.json(
        { error: '無効なBlob URLです' },
        { status: 400 }
      );
    }

    fileName = name || 'audio.m4a';
    fileSize = size || 0;
    ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase() || '.m4a';

    // Download from blob
    const response = await fetch(blobUrl);
    if (!response.ok) {
      return NextResponse.json(
        { error: 'ファイルのダウンロードに失敗しました' },
        { status: 400 }
      );
    }
    fileBuffer = Buffer.from(await response.arrayBuffer());
    fileSize = fileBuffer.length;

  } else {
    // Handle direct file upload (for small files < 4MB)
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { error: 'ファイルが必要です' },
        { status: 400 }
      );
    }

    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'ファイルが必要です' },
        { status: 400 }
      );
    }

    fileName = file.name;
    fileSize = file.size;
    ext = path.extname(fileName).toLowerCase() || '.m4a';
    fileBuffer = Buffer.from(await file.arrayBuffer());
  }

  // Security: Validate file type
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return NextResponse.json(
      { error: '対応していないファイル形式です。音声(mp3, m4a, wav等)または動画(mp4, mov等)ファイルをアップロードしてください。' },
      { status: 400 }
    );
  }

  // Security: Validate file size (max 500MB)
  const MAX_UPLOAD_SIZE = 500 * 1024 * 1024;
  if (fileSize > MAX_UPLOAD_SIZE) {
    return NextResponse.json(
      { error: 'ファイルサイズが大きすぎます。最大500MBまで対応しています。' },
      { status: 400 }
    );
  }

  // Create a streaming response
  const stream = new ReadableStream({
    async start(controller) {
      const tempDir = path.join(os.tmpdir(), `transcribe_${Date.now()}`);
      let inputFilePath = '';

      try {
        // Step 1: Uploading
        sendSSE(controller, {
          type: 'progress',
          step: 'upload',
          progress: 10,
          message: 'ファイルを処理中...',
          detail: `${fileName} (${(fileSize / 1024 / 1024).toFixed(1)}MB)`,
        });

        // 一時ディレクトリ作成
        await mkdir(tempDir, { recursive: true });

        // ファイルを一時保存 (Security: use sanitized extension)
        const safeExt = ext.replace(/[^a-z0-9.]/gi, '');
        inputFilePath = path.join(tempDir, `input${safeExt}`);
        await writeFile(inputFilePath, fileBuffer);

        sendSSE(controller, {
          type: 'progress',
          step: 'prepare',
          progress: 20,
          message: '文字起こしの準備中...',
          detail: '音声ファイルを解析しています',
        });

        // ファイルサイズチェック
        if (fileSize <= MAX_FILE_SIZE) {
          // 小さいファイルは直接処理
          sendSSE(controller, {
            type: 'progress',
            step: 'transcribe',
            progress: 40,
            message: '文字起こし中...',
            detail: 'AIが音声を解析しています (これには数分かかる場合があります)',
          });

          const audioFile = new File([new Uint8Array(fileBuffer)], fileName, { type: `audio/${ext.slice(1)}` });
          const transcription = await openai.audio.transcriptions.create({
            model: 'whisper-1',
            file: audioFile,
            language: 'ja',
          });

          sendSSE(controller, {
            type: 'progress',
            step: 'complete',
            progress: 100,
            message: '完了!',
            detail: '文字起こしが完了しました',
          });

          sendSSE(controller, {
            type: 'result',
            text: transcription.text,
          });

        } else {
          // 大きいファイルは分割して処理
          console.log(`Large file detected (${(fileSize / 1024 / 1024).toFixed(2)}MB), splitting...`);

          sendSSE(controller, {
            type: 'progress',
            step: 'analyze',
            progress: 25,
            message: '音声を解析中...',
            detail: `大きなファイル (${(fileSize / 1024 / 1024).toFixed(1)}MB) のため分割処理します`,
          });

          const duration = await getAudioDuration(inputFilePath, fileSize);
          const durationMinutes = Math.floor(duration / 60);
          console.log(`Audio duration: ${durationMinutes}分${Math.floor(duration % 60)}秒`);

          const chunks = await splitAudio(inputFilePath, tempDir, controller, fileSize);
          console.log(`Split into ${chunks.length} chunks`);

          // 各チャンクを文字起こし
          const transcriptions: string[] = [];
          for (let i = 0; i < chunks.length; i++) {
            const chunkProgress = 50 + Math.floor((i / chunks.length) * 45);
            sendSSE(controller, {
              type: 'progress',
              step: 'transcribe',
              progress: chunkProgress,
              message: `文字起こし中... (${i + 1}/${chunks.length})`,
              detail: `パート ${i + 1} を処理しています`,
            });

            console.log(`Processing chunk ${i + 1}/${chunks.length}...`);
            const text = await transcribeChunk(chunks[i]);
            transcriptions.push(text);
          }

          // 結果を結合
          const fullText = transcriptions.join('\n\n');

          sendSSE(controller, {
            type: 'progress',
            step: 'complete',
            progress: 100,
            message: '完了!',
            detail: `${chunks.length}パートの文字起こしが完了しました`,
          });

          sendSSE(controller, {
            type: 'result',
            text: fullText,
            chunks: chunks.length,
            duration: durationMinutes,
          });
        }

        // Cleanup temp files
        try {
          const files = await readdir(tempDir);
          for (const f of files) {
            await unlink(path.join(tempDir, f)).catch(() => {});
          }
          await rmdir(tempDir).catch(() => {});
        } catch {
          // Ignore cleanup errors
        }

        // Delete blob from Vercel storage
        if (blobUrlToDelete) {
          try {
            await del(blobUrlToDelete);
            console.log('Deleted blob:', blobUrlToDelete);
          } catch (e) {
            console.error('Failed to delete blob:', e);
          }
        }

        controller.close();

      } catch (error) {
        console.error('Transcription error:', error);
        sendSSE(controller, {
          type: 'error',
          error: '文字起こしに失敗しました: ' + (error as Error).message,
        });

        // Cleanup on error
        try {
          const files = await readdir(tempDir);
          for (const f of files) {
            await unlink(path.join(tempDir, f)).catch(() => {});
          }
          await rmdir(tempDir).catch(() => {});
        } catch {
          // Ignore cleanup errors
        }

        // Delete blob even on error
        if (blobUrlToDelete) {
          try {
            await del(blobUrlToDelete);
            console.log('Deleted blob after error:', blobUrlToDelete);
          } catch (e) {
            console.error('Failed to delete blob:', e);
          }
        }

        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

// Increase timeout for Vercel
export const maxDuration = 300;
