import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { YoutubeTranscript } from 'youtube-transcript';
import OpenAI from 'openai';
import { unlink, mkdir, readFile, readdir, rmdir, stat } from 'fs/promises';
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
    // ffprobe is usually in the same directory as ffmpeg
    const ffmpegPath = getFFmpegPath();
    return ffmpegPath.replace('ffmpeg', 'ffprobe');
  } catch {
    return 'ffprobe';
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

// Security: Sanitize string for shell command (escape special characters)
function sanitizeForShell(str: string): string {
  // Only allow alphanumeric, dash, underscore
  return str.replace(/[^a-zA-Z0-9_-]/g, '');
}

async function tryGetCaptions(videoId: string): Promise<string | null> {
  try {
    let transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'ja' });
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

async function getAudioDuration(filePath: string): Promise<number> {
  try {
    const ffprobePath = getFFprobePath();
    const { stdout } = await execAsync(
      `"${ffprobePath}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    );
    return parseFloat(stdout.trim());
  } catch (error) {
    console.error('Failed to get duration:', error);
    return 0;
  }
}

async function splitAudio(inputPath: string, outputDir: string): Promise<string[]> {
  const duration = await getAudioDuration(inputPath);
  const chunks: string[] = [];

  if (duration <= 0) {
    throw new Error('音声ファイルの長さを取得できませんでした');
  }

  const numChunks = Math.ceil(duration / CHUNK_DURATION);
  const ffmpegPath = getFFmpegPath();

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
  const file = new File([audioBuffer], path.basename(chunkPath), { type: 'audio/mp3' });

  const transcription = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file: file,
    language: 'ja',
  });

  return transcription.text;
}

async function downloadYouTubeAudio(videoId: string, outputPath: string): Promise<void> {
  console.log('Downloading audio from YouTube using yt-dlp...');

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    // Use yt-dlp to download audio (much more reliable than ytdl-core)
    const command = `yt-dlp -x --audio-format m4a --audio-quality 0 -o "${outputPath}" "${videoUrl}"`;

    console.log('Running yt-dlp...');
    const { stdout, stderr } = await execAsync(command, { timeout: 180000 });

    if (stdout) console.log('yt-dlp output:', stdout);
    if (stderr) console.log('yt-dlp stderr:', stderr);

    // Verify file exists and has content
    const fileStats = await stat(outputPath);
    console.log(`Downloaded ${(fileStats.size / 1024 / 1024).toFixed(2)}MB of audio`);

    if (fileStats.size < 1000) {
      throw new Error('Downloaded file is too small');
    }
  } catch (error) {
    console.error('Download failed:', error);
    throw new Error('音声のダウンロードに失敗しました: ' + (error as Error).message);
  }
}

async function transcribeWithWhisper(videoId: string): Promise<{ text: string; chunks?: number }> {
  const tempDir = path.join(os.tmpdir(), `youtube_${Date.now()}`);
  await mkdir(tempDir, { recursive: true });

  const audioPath = path.join(tempDir, 'audio.m4a');

  try {
    await downloadYouTubeAudio(videoId, audioPath);

    // Get file size
    const audioBuffer = await readFile(audioPath);
    const fileSize = audioBuffer.length;

    if (fileSize <= MAX_FILE_SIZE) {
      // Small file - transcribe directly
      console.log('Small file, transcribing directly...');
      const file = new File([audioBuffer], 'audio.m4a', { type: 'audio/mp4' });

      const transcription = await openai.audio.transcriptions.create({
        file: file,
        model: 'whisper-1',
        language: 'ja',
      });

      return { text: transcription.text };
    }

    // Large file - split and transcribe
    console.log(`Large file (${(fileSize / 1024 / 1024).toFixed(2)}MB), splitting...`);

    const chunks = await splitAudio(audioPath, tempDir);
    console.log(`Split into ${chunks.length} chunks`);

    const transcriptions: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      console.log(`Processing chunk ${i + 1}/${chunks.length}...`);
      const text = await transcribeChunk(chunks[i]);
      transcriptions.push(text);
    }

    const fullText = transcriptions.join('\n\n');
    return { text: fullText, chunks: chunks.length };

  } finally {
    // Cleanup temp files
    try {
      const files = await readdir(tempDir);
      for (const file of files) {
        await unlink(path.join(tempDir, file)).catch(() => {});
      }
      await rmdir(tempDir).catch(() => {});
    } catch {
      // Ignore cleanup errors
    }
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

  // Security: Sanitize videoId before using in shell commands
  const safeVideoId = sanitizeForShell(videoId);

  // Create a streaming response
  const stream = new ReadableStream({
    async start(controller) {
      try {
        console.log('Processing video:', safeVideoId);

        // Step 1: Check for captions
        sendSSE(controller, {
          type: 'progress',
          step: 'captions',
          progress: 5,
          message: '字幕を確認中...',
          detail: 'YouTubeの字幕データを取得しています',
        });

        const captionText = await tryGetCaptions(safeVideoId);

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
        const audioPath = path.join(tempDir, 'audio.m4a');

        try {
          // Download audio with progress updates
          await downloadYouTubeAudioWithProgress(safeVideoId, audioPath, controller);

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

            const file = new File([audioBuffer], 'audio.m4a', { type: 'audio/mp4' });
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

            const chunks = await splitAudio(audioPath, tempDir);
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

        } catch (whisperError) {
          console.error('Whisper transcription failed:', whisperError);
          sendSSE(controller, {
            type: 'error',
            error: '音声の文字起こしに失敗しました: ' + (whisperError as Error).message,
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

// Download with progress updates
async function downloadYouTubeAudioWithProgress(
  videoId: string,
  outputPath: string,
  controller: ReadableStreamDefaultController
): Promise<void> {
  console.log('Downloading audio from YouTube using yt-dlp...');
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  sendSSE(controller, {
    type: 'progress',
    step: 'download',
    progress: 15,
    message: '音声をダウンロード中...',
    detail: 'YouTubeから音声を取得しています',
  });

  try {
    const command = `yt-dlp -x --audio-format m4a --audio-quality 0 -o "${outputPath}" "${videoUrl}"`;
    console.log('Running yt-dlp...');

    sendSSE(controller, {
      type: 'progress',
      step: 'download',
      progress: 25,
      message: '音声をダウンロード中...',
      detail: 'ダウンロード処理中です...',
    });

    const { stdout, stderr } = await execAsync(command, { timeout: 180000 });

    if (stdout) console.log('yt-dlp output:', stdout);
    if (stderr) console.log('yt-dlp stderr:', stderr);

    const fileStats = await stat(outputPath);
    console.log(`Downloaded ${(fileStats.size / 1024 / 1024).toFixed(2)}MB of audio`);

    sendSSE(controller, {
      type: 'progress',
      step: 'download',
      progress: 45,
      message: 'ダウンロード完了!',
      detail: `${(fileStats.size / 1024 / 1024).toFixed(1)}MB の音声を取得しました`,
    });

    if (fileStats.size < 1000) {
      throw new Error('Downloaded file is too small');
    }
  } catch (error) {
    console.error('Download failed:', error);
    throw new Error('音声のダウンロードに失敗しました: ' + (error as Error).message);
  }
}

// Increase timeout for Vercel (Pro plan allows up to 300s)
export const maxDuration = 300;
