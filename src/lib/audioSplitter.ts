'use client';

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

// FFmpeg instance loaded from CDN
let ffmpegInstance: any = null;
let FFmpegClass: any = null;

// Load FFmpeg from CDN using script tag (avoids bundler issues)
async function loadFFmpegFromCDN(): Promise<void> {
  if (FFmpegClass) return;

  // Check if already loaded globally
  if (typeof window !== 'undefined' && (window as any).FFmpegLoaded) {
    FFmpegClass = (window as any).FFmpegLoaded;
    return;
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.innerHTML = `
      import { FFmpeg } from 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js';
      window.FFmpegLoaded = FFmpeg;
      window.dispatchEvent(new Event('ffmpeg-loaded'));
    `;

    const handleLoad = () => {
      FFmpegClass = (window as any).FFmpegLoaded;
      window.removeEventListener('ffmpeg-loaded', handleLoad);
      resolve();
    };

    window.addEventListener('ffmpeg-loaded', handleLoad);
    document.head.appendChild(script);

    // Timeout after 30 seconds
    setTimeout(() => {
      if (!FFmpegClass) {
        reject(new Error('FFmpeg の読み込みがタイムアウトしました'));
      }
    }, 30000);
  });
}

// Create blob URL from remote URL to bypass CORS for workers
async function createBlobURL(url: string, type: string): Promise<string> {
  const response = await fetch(url);
  const blob = new Blob([await response.arrayBuffer()], { type });
  return URL.createObjectURL(blob);
}

async function loadFFmpeg(onProgress: (progress: SplitProgress) => void): Promise<any> {
  if (ffmpegInstance && ffmpegInstance.loaded) {
    return ffmpegInstance;
  }

  onProgress({
    stage: 'loading',
    progress: 0,
    message: 'FFmpegを読み込み中...',
  });

  // Load FFmpeg class from CDN
  await loadFFmpegFromCDN();

  ffmpegInstance = new FFmpegClass();

  ffmpegInstance.on('log', ({ message }: { message: string }) => {
    console.log('[FFmpeg]', message);
  });

  ffmpegInstance.on('progress', ({ progress }: { progress: number }) => {
    onProgress({
      stage: 'splitting',
      progress: Math.round(progress * 100),
      message: `音声を分割中... ${Math.round(progress * 100)}%`,
    });
  });

  // Load FFmpeg core and worker from CDN as blob URLs (bypass CORS)
  const coreBaseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  const ffmpegBaseURL = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm';

  onProgress({
    stage: 'loading',
    progress: 20,
    message: 'FFmpegコアを読み込み中...',
  });

  // Create blob URLs for all required files
  const [coreURL, wasmURL, workerURL] = await Promise.all([
    createBlobURL(`${coreBaseURL}/ffmpeg-core.js`, 'text/javascript'),
    createBlobURL(`${coreBaseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    createBlobURL(`${ffmpegBaseURL}/worker.js`, 'text/javascript'),
  ]);

  onProgress({
    stage: 'loading',
    progress: 60,
    message: 'FFmpegを初期化中...',
  });

  await ffmpegInstance.load({
    coreURL,
    wasmURL,
    classWorkerURL: workerURL,
  });

  onProgress({
    stage: 'loading',
    progress: 100,
    message: 'FFmpeg読み込み完了',
  });

  return ffmpegInstance;
}

async function getAudioDuration(ffmpeg: any, inputFileName: string): Promise<number> {
  let duration = 0;

  // Listen for duration in FFmpeg output
  const logHandler = ({ message }: { message: string }) => {
    const match = message.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
    if (match) {
      const hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const seconds = parseFloat(match[3]);
      duration = hours * 3600 + minutes * 60 + seconds;
    }
  };

  ffmpeg.on('log', logHandler);

  try {
    await ffmpeg.exec(['-i', inputFileName, '-f', 'null', '-t', '0.1', '-']);
  } catch {
    // This will "fail" but we'll get the duration from logs
  }

  return duration || 600; // Default to 10 minutes if we can't detect
}

// Helper to convert File to Uint8Array
async function fileToUint8Array(file: File): Promise<Uint8Array> {
  const arrayBuffer = await file.arrayBuffer();
  return new Uint8Array(arrayBuffer);
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
  const fileData = await fileToUint8Array(file);
  await ff.writeFile(inputFileName, fileData);

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
      '-ar', '16000',
      '-ac', '1',
      '-b:a', '64k',
      outputFileName,
    ]);

    // Read the output file
    const data = await ff.readFile(outputFileName);
    const uint8Array = new Uint8Array(data as Uint8Array);
    const blob = new Blob([uint8Array], { type: 'audio/mp3' });

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
  return file.size > MAX_CHUNK_SIZE;
}
