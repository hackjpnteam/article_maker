import { NextRequest, NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';
import play from 'play-dl';
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

const MAX_FILE_SIZE = 24 * 1024 * 1024; // 24MB
const CHUNK_DURATION = 600; // 10 minutes per chunk

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

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
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
  console.log('Downloading audio from YouTube...');

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    // Get video info using play-dl
    const videoInfo = await play.video_info(videoUrl);
    console.log('Video info retrieved:', videoInfo.video_details.title);

    // Get audio stream
    const stream = await play.stream(videoUrl, { quality: 140 }); // 140 = m4a audio

    console.log('Stream type:', stream.type);

    const chunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        stream.stream.destroy();
        reject(new Error('Download timeout'));
      }, 180000); // 3 minute timeout

      stream.stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.stream.on('end', () => {
        clearTimeout(timeout);
        resolve();
      });
      stream.stream.on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    if (chunks.length === 0) {
      throw new Error('No data received');
    }

    const audioBuffer = Buffer.concat(chunks);
    console.log(`Downloaded ${(audioBuffer.length / 1024 / 1024).toFixed(2)}MB of audio`);

    if (audioBuffer.length < 1000) {
      throw new Error('Downloaded file is too small');
    }

    await writeFile(outputPath, audioBuffer);
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
  try {
    const { url } = await request.json();

    if (!url) {
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

    console.log('Processing video:', videoId);

    // First, try to get captions (fast and free)
    const captionText = await tryGetCaptions(videoId);

    if (captionText) {
      console.log(`Captions fetched: ${captionText.length} characters`);
      return NextResponse.json({
        text: captionText,
        source: 'youtube-captions',
      });
    }

    // No captions available, fall back to audio transcription
    console.log('No captions, falling back to audio transcription...');

    try {
      const result = await transcribeWithWhisper(videoId);
      console.log(`Whisper transcription: ${result.text.length} characters`);

      return NextResponse.json({
        text: result.text,
        source: 'youtube-whisper',
        chunks: result.chunks,
      });
    } catch (whisperError) {
      console.error('Whisper transcription failed:', whisperError);
      return NextResponse.json(
        { error: '音声の文字起こしに失敗しました: ' + (whisperError as Error).message },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('YouTube transcription error:', error);
    return NextResponse.json(
      { error: 'YouTube文字起こしに失敗しました: ' + (error as Error).message },
      { status: 500 }
    );
  }
}

// Increase timeout for Vercel (Pro plan allows up to 300s)
export const maxDuration = 300;
