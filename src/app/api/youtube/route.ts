import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { YoutubeTranscript } from 'youtube-transcript';
import OpenAI from 'openai';
import { unlink, mkdir, readFile, readdir, rmdir, writeFile } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MAX_FILE_SIZE = 24 * 1024 * 1024; // 24MB
const CHUNK_DURATION = 600; // 10 minutes per chunk

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
  source: string;
  chunks?: number;
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
function getFFmpegPath(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegPath = require('ffmpeg-static');
    // Check if the binary exists
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    if (fs.existsSync(ffmpegPath)) {
      console.log('ffmpeg found at:', ffmpegPath);
      return ffmpegPath;
    }
    console.error('ffmpeg binary not found at:', ffmpegPath);
    return null;
  } catch (e) {
    console.error('Failed to load ffmpeg-static:', e);
    return null;
  }
}

function getFFprobePath(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffprobePath = require('ffprobe-static').path;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    if (fs.existsSync(ffprobePath)) {
      console.log('ffprobe found at:', ffprobePath);
      return ffprobePath;
    }
    console.error('ffprobe binary not found at:', ffprobePath);
    return null;
  } catch (e) {
    console.error('Failed to load ffprobe-static:', e);
    return null;
  }
}

// Security: Strict validation of YouTube video ID to prevent command injection
function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      const videoId = match[1];
      // Security: Double-check that videoId only contains safe characters
      if (/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return videoId;
      }
    }
  }
  return null;
}

async function tryGetCaptions(videoId: string): Promise<string | null> {
  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'ja' });
    if (transcript && transcript.length > 0) {
      console.log('Got Japanese captions');
      return transcript.map((s: { text: string }) => s.text).join(' ').replace(/\s+/g, ' ').trim();
    }
  } catch {
    try {
      const transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
      if (transcript && transcript.length > 0) {
        console.log('Got English captions');
        return transcript.map((s: { text: string }) => s.text).join(' ').replace(/\s+/g, ' ').trim();
      }
    } catch {
      try {
        const transcript = await YoutubeTranscript.fetchTranscript(videoId);
        if (transcript && transcript.length > 0) {
          console.log('Got default captions');
          return transcript.map((s: { text: string }) => s.text).join(' ').replace(/\s+/g, ' ').trim();
        }
      } catch {
        console.log('No captions available');
      }
    }
  }
  return null;
}

async function getAudioDuration(filePath: string, fileSize: number): Promise<number> {
  const ffprobePath = getFFprobePath();

  if (ffprobePath) {
    try {
      const { stdout } = await execAsync(
        `"${ffprobePath}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
      );
      const duration = parseFloat(stdout.trim());
      if (duration > 0) {
        console.log(`Audio duration from ffprobe: ${Math.floor(duration / 60)}min ${Math.floor(duration % 60)}sec`);
        return duration;
      }
    } catch (error) {
      console.error('Failed to get duration with ffprobe:', error);
    }
  }

  // Fallback: estimate duration based on file size
  // Assume average bitrate of 128kbps (16KB/s) for audio
  const estimatedDuration = fileSize / (16 * 1024);
  console.log(`Estimated duration from file size (${(fileSize / 1024 / 1024).toFixed(1)}MB): ${Math.floor(estimatedDuration / 60)}min`);
  return estimatedDuration;
}

async function splitAudio(inputPath: string, outputDir: string, fileSize: number): Promise<string[]> {
  const ffmpegPath = getFFmpegPath();

  if (!ffmpegPath) {
    throw new Error('音声分割機能が利用できません。24MB以下のファイルをお試しください。');
  }

  const duration = await getAudioDuration(inputPath, fileSize);
  const chunks: string[] = [];

  if (duration <= 0) {
    throw new Error('音声ファイルの長さを取得できませんでした');
  }

  const numChunks = Math.ceil(duration / CHUNK_DURATION);

  console.log(`Video duration: ${Math.floor(duration / 60)}分${Math.floor(duration % 60)}秒, splitting into ${numChunks} chunks`);

  for (let i = 0; i < numChunks; i++) {
    const startTime = i * CHUNK_DURATION;
    const chunkPath = path.join(outputDir, `chunk_${i.toString().padStart(3, '0')}.mp3`);

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

// Download YouTube audio using ytdl-core stream (works on Vercel)
async function downloadYouTubeAudioWithYtdl(
  videoId: string,
  outputPath: string,
  controller: ReadableStreamDefaultController
): Promise<void> {
  console.log('Downloading audio from YouTube using ytdl-core stream...');
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  sendSSE(controller, {
    type: 'progress',
    step: 'download',
    progress: 15,
    message: '音声をダウンロード中...',
    detail: 'YouTubeから音声を取得しています',
  });

  try {
    // Dynamic import to avoid issues
    const ytdl = await import('@distube/ytdl-core');

    // Get video info first
    const info = await ytdl.getInfo(videoUrl);
    console.log('Video title:', info.videoDetails.title);

    sendSSE(controller, {
      type: 'progress',
      step: 'download',
      progress: 25,
      message: '音声をダウンロード中...',
      detail: `${info.videoDetails.title}`,
    });

    // Use ytdl-core's stream with proper options
    const audioStream = ytdl.default(videoUrl, {
      quality: 'highestaudio',
      filter: 'audioonly',
    });

    // Collect stream data into buffer
    const chunks: Buffer[] = [];
    let downloadedBytes = 0;
    const totalBytes = parseInt(info.formats.find(f => f.hasAudio && !f.hasVideo)?.contentLength || '0') || 10000000;

    await new Promise<void>((resolve, reject) => {
      audioStream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        downloadedBytes += chunk.length;

        // Update progress periodically
        const progress = Math.min(25 + Math.floor((downloadedBytes / totalBytes) * 20), 45);
        if (downloadedBytes % 500000 < chunk.length) { // Update every ~500KB
          sendSSE(controller, {
            type: 'progress',
            step: 'download',
            progress,
            message: '音声をダウンロード中...',
            detail: `${(downloadedBytes / 1024 / 1024).toFixed(1)}MB ダウンロード済み`,
          });
        }
      });

      audioStream.on('end', () => {
        resolve();
      });

      audioStream.on('error', (err: Error) => {
        reject(err);
      });
    });

    const buffer = Buffer.concat(chunks);
    await writeFile(outputPath, buffer);

    const fileSize = buffer.length;
    console.log(`Downloaded ${(fileSize / 1024 / 1024).toFixed(2)}MB of audio`);

    sendSSE(controller, {
      type: 'progress',
      step: 'download',
      progress: 45,
      message: 'ダウンロード完了!',
      detail: `${(fileSize / 1024 / 1024).toFixed(1)}MB の音声を取得しました`,
    });

    if (fileSize < 1000) {
      throw new Error('Downloaded file is too small');
    }
  } catch (error) {
    console.error('ytdl-core download failed:', error);
    throw new Error('音声のダウンロードに失敗しました。この動画は字幕がないため、音声からの文字起こしが必要ですが、YouTubeの制限により取得できませんでした。字幕付きの動画をお試しください。');
  }
}

export async function POST(request: NextRequest) {
  // Security: Require authentication
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json(
      { error: 'ログインが必要です' },
      { status: 401 }
    );
  }

  let requestBody: { url?: string };

  try {
    requestBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }

  const { url } = requestBody;

  if (!url || typeof url !== 'string' || url.length > 200) {
    return NextResponse.json(
      { error: 'YouTube URLが必要です' },
      { status: 400 }
    );
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return NextResponse.json(
      { error: '有効なYouTube URLを入力してください' },
      { status: 400 }
    );
  }

  // Create a streaming response
  const stream = new ReadableStream({
    async start(controller) {
      try {
        console.log('Processing video:', videoId);

        // Step 1: Check for captions
        sendSSE(controller, {
          type: 'progress',
          step: 'captions',
          progress: 5,
          message: '字幕を確認中...',
          detail: 'YouTubeの字幕データを取得しています',
        });

        const captionText = await tryGetCaptions(videoId);

        if (captionText) {
          console.log(`Captions fetched: ${captionText.length} characters`);
          sendSSE(controller, {
            type: 'progress',
            step: 'complete',
            progress: 100,
            message: '完了!',
            detail: '字幕から文字起こしを取得しました',
          });
          sendSSE(controller, {
            type: 'result',
            text: captionText,
            source: 'youtube-captions',
          });
          controller.close();
          return;
        }

        // Step 2: No captions, start audio download
        sendSSE(controller, {
          type: 'progress',
          step: 'download',
          progress: 10,
          message: '音声をダウンロード中...',
          detail: '字幕が見つからないため、音声を取得しています',
        });

        console.log('No captions, falling back to audio transcription...');

        const tempDir = path.join(os.tmpdir(), `youtube_${Date.now()}`);
        await mkdir(tempDir, { recursive: true });
        const audioPath = path.join(tempDir, 'audio.webm');

        try {
          // Download audio with ytdl-core
          await downloadYouTubeAudioWithYtdl(videoId, audioPath, controller);

          // Step 3: Prepare for transcription
          sendSSE(controller, {
            type: 'progress',
            step: 'prepare',
            progress: 50,
            message: '文字起こしの準備中...',
            detail: '音声ファイルを処理しています',
          });

          const audioBuffer = await readFile(audioPath);
          const fileSize = audioBuffer.length;

          if (fileSize <= MAX_FILE_SIZE) {
            // Small file - transcribe directly
            sendSSE(controller, {
              type: 'progress',
              step: 'transcribe',
              progress: 60,
              message: '文字起こし中...',
              detail: 'AIが音声を解析しています (これには数分かかる場合があります)',
            });

            const file = new File([new Uint8Array(audioBuffer)], 'audio.webm', { type: 'audio/webm' });
            const transcription = await openai.audio.transcriptions.create({
              file: file,
              model: 'whisper-1',
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
              source: 'youtube-whisper',
            });
          } else {
            // Large file - split and transcribe with progress
            sendSSE(controller, {
              type: 'progress',
              step: 'split',
              progress: 55,
              message: '音声を分割中...',
              detail: `大きなファイル (${(fileSize / 1024 / 1024).toFixed(1)}MB) のため分割処理しています`,
            });

            const chunks = await splitAudio(audioPath, tempDir, fileSize);
            const transcriptions: string[] = [];

            for (let i = 0; i < chunks.length; i++) {
              const chunkProgress = 60 + Math.floor((i / chunks.length) * 35);
              sendSSE(controller, {
                type: 'progress',
                step: 'transcribe',
                progress: chunkProgress,
                message: `文字起こし中... (${i + 1}/${chunks.length})`,
                detail: `パート ${i + 1} を処理しています`,
              });

              const text = await transcribeChunk(chunks[i]);
              transcriptions.push(text);
            }

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
              source: 'youtube-whisper',
              chunks: chunks.length,
            });
          }

          // Cleanup
          try {
            const files = await readdir(tempDir);
            for (const file of files) {
              await unlink(path.join(tempDir, file)).catch(() => {});
            }
            await rmdir(tempDir).catch(() => {});
          } catch {
            // Ignore cleanup errors
          }

        } catch (downloadError) {
          console.error('Download/transcription failed:', downloadError);
          sendSSE(controller, {
            type: 'error',
            error: (downloadError as Error).message,
          });
        }

        controller.close();

      } catch (error) {
        console.error('YouTube transcription error:', error);
        sendSSE(controller, {
          type: 'error',
          error: 'YouTube文字起こしに失敗しました: ' + (error as Error).message,
        });
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

// Increase timeout for Vercel (Pro plan allows up to 300s)
export const maxDuration = 300;
