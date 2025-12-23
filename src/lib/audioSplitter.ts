'use client';

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpeg: FFmpeg | null = null;

export type SplitProgress = {
  stage: 'loading' | 'analyzing' | 'splitting' | 'done';
  progress: number;
  message: string;
  currentChunk?: number;
  totalChunks?: number;
};

export type AudioChunk = {
  blob: Blob;
  index: number;
  startTime: number;
  duration: number;
};

const CHUNK_DURATION = 600; // 10 minutes per chunk
const MAX_CHUNK_SIZE = 24 * 1024 * 1024; // 24MB target size per chunk

async function loadFFmpeg(onProgress: (progress: SplitProgress) => void): Promise<FFmpeg> {
  if (ffmpeg && ffmpeg.loaded) {
    return ffmpeg;
  }

  ffmpeg = new FFmpeg();

  ffmpeg.on('log', ({ message }) => {
    console.log('[FFmpeg]', message);
  });

  ffmpeg.on('progress', ({ progress }) => {
    onProgress({
      stage: 'splitting',
      progress: Math.round(progress * 100),
      message: `音声を分割中... ${Math.round(progress * 100)}%`,
    });
  });

  onProgress({
    stage: 'loading',
    progress: 0,
    message: 'FFmpegを読み込み中...',
  });

  // Load FFmpeg core from CDN
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  onProgress({
    stage: 'loading',
    progress: 100,
    message: 'FFmpeg読み込み完了',
  });

  return ffmpeg;
}

async function getAudioDuration(ffmpeg: FFmpeg, inputFileName: string): Promise<number> {
  // Use ffprobe-like approach to get duration
  // FFmpeg will output duration info in stderr
  let duration = 0;

  const originalLog = ffmpeg.on('log', ({ message }) => {
    // Parse duration from FFmpeg output
    // Format: Duration: 00:05:30.00
    const match = message.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
    if (match) {
      const hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const seconds = parseFloat(match[3]);
      duration = hours * 3600 + minutes * 60 + seconds;
    }
  });

  // Run a quick probe by trying to get info
  try {
    await ffmpeg.exec(['-i', inputFileName, '-f', 'null', '-t', '0.1', '-']);
  } catch {
    // This will "fail" but we'll get the duration from logs
  }

  return duration || 600; // Default to 10 minutes if we can't detect
}

export async function splitAudioFile(
  file: File,
  onProgress: (progress: SplitProgress) => void
): Promise<AudioChunk[]> {
  const ff = await loadFFmpeg(onProgress);

  onProgress({
    stage: 'analyzing',
    progress: 0,
    message: '音声ファイルを解析中...',
  });

  // Write input file to FFmpeg virtual filesystem
  const inputFileName = 'input' + getExtension(file.name);
  await ff.writeFile(inputFileName, await fetchFile(file));

  // Get audio duration
  const duration = await getAudioDuration(ff, inputFileName);
  const numChunks = Math.ceil(duration / CHUNK_DURATION);

  onProgress({
    stage: 'analyzing',
    progress: 100,
    message: `${Math.floor(duration / 60)}分の音声を${numChunks}パートに分割します`,
  });

  const chunks: AudioChunk[] = [];

  for (let i = 0; i < numChunks; i++) {
    const startTime = i * CHUNK_DURATION;
    const chunkDuration = Math.min(CHUNK_DURATION, duration - startTime);
    const outputFileName = `chunk_${i.toString().padStart(3, '0')}.mp3`;

    onProgress({
      stage: 'splitting',
      progress: Math.round((i / numChunks) * 100),
      message: `パート ${i + 1}/${numChunks} を作成中...`,
      currentChunk: i + 1,
      totalChunks: numChunks,
    });

    // Split audio: convert to MP3 with lower bitrate to reduce size
    await ff.exec([
      '-i', inputFileName,
      '-ss', startTime.toString(),
      '-t', chunkDuration.toString(),
      '-acodec', 'libmp3lame',
      '-ar', '16000',      // 16kHz sample rate (good for speech)
      '-ac', '1',          // Mono
      '-b:a', '64k',       // 64kbps bitrate
      outputFileName,
    ]);

    // Read the output file
    const data = await ff.readFile(outputFileName);
    const blob = new Blob([data], { type: 'audio/mp3' });

    chunks.push({
      blob,
      index: i,
      startTime,
      duration: chunkDuration,
    });

    // Clean up chunk file
    await ff.deleteFile(outputFileName);
  }

  // Clean up input file
  await ff.deleteFile(inputFileName);

  onProgress({
    stage: 'done',
    progress: 100,
    message: `${numChunks}パートの分割が完了しました`,
    totalChunks: numChunks,
  });

  return chunks;
}

function getExtension(filename: string): string {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
  return ext || '.mp3';
}

export function shouldSplitFile(file: File): boolean {
  // Split if file is larger than 24MB (Whisper limit is 25MB, leave some margin)
  return file.size > MAX_CHUNK_SIZE;
}
