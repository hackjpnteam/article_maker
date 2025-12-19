import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import OpenAI from 'openai';
import { writeFile, unlink, mkdir, readFile, readdir } from 'fs/promises';
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

  const tempDir = path.join(os.tmpdir(), `transcribe_${Date.now()}`);
  let inputFilePath = '';

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'ファイルが必要です' },
        { status: 400 }
      );
    }

    // Security: Validate file type
    const ext = path.extname(file.name).toLowerCase() || '.m4a';
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json(
        { error: '対応していないファイル形式です。音声(mp3, m4a, wav等)または動画(mp4, mov等)ファイルをアップロードしてください。' },
        { status: 400 }
      );
    }

    // Security: Validate file size (max 500MB)
    const MAX_UPLOAD_SIZE = 500 * 1024 * 1024;
    if (file.size > MAX_UPLOAD_SIZE) {
      return NextResponse.json(
        { error: 'ファイルサイズが大きすぎます。最大500MBまで対応しています。' },
        { status: 400 }
      );
    }

    // 一時ディレクトリ作成
    await mkdir(tempDir, { recursive: true });

    // ファイルを一時保存 (Security: use sanitized extension)
    const buffer = Buffer.from(await file.arrayBuffer());
    const safeExt = ext.replace(/[^a-z0-9.]/gi, '');
    inputFilePath = path.join(tempDir, `input${safeExt}`);
    await writeFile(inputFilePath, buffer);

    // ファイルサイズチェック
    if (file.size <= MAX_FILE_SIZE) {
      // 小さいファイルは直接処理
      const transcription = await openai.audio.transcriptions.create({
        model: 'whisper-1',
        file: file,
        language: 'ja',
      });

      return NextResponse.json({ text: transcription.text });
    }

    // 大きいファイルは分割して処理
    console.log(`Large file detected (${(file.size / 1024 / 1024).toFixed(2)}MB), splitting...`);

    const duration = await getAudioDuration(inputFilePath);
    console.log(`Audio duration: ${Math.floor(duration / 60)}分${Math.floor(duration % 60)}秒`);

    const chunks = await splitAudio(inputFilePath, tempDir);
    console.log(`Split into ${chunks.length} chunks`);

    // 各チャンクを文字起こし
    const transcriptions: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      console.log(`Processing chunk ${i + 1}/${chunks.length}...`);
      const text = await transcribeChunk(chunks[i]);
      transcriptions.push(text);
    }

    // 結果を結合
    const fullText = transcriptions.join('\n\n');

    return NextResponse.json({
      text: fullText,
      chunks: chunks.length,
      duration: Math.floor(duration / 60)
    });

  } catch (error) {
    console.error('Transcription error:', error);
    return NextResponse.json(
      { error: '文字起こしに失敗しました: ' + (error as Error).message },
      { status: 500 }
    );
  } finally {
    // 一時ファイルをクリーンアップ
    try {
      const files = await readdir(tempDir);
      for (const file of files) {
        await unlink(path.join(tempDir, file));
      }
      await unlink(tempDir).catch(() => {});
    } catch (e) {
      // クリーンアップエラーは無視
    }
  }
}

// Increase timeout for Vercel
export const maxDuration = 300;
