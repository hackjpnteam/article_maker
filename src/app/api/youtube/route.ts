import { NextRequest, NextResponse } from 'next/server';
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

const MAX_FILE_SIZE = 24 * 1024 * 1024;
const CHUNK_DURATION = 600;

async function getAudioDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
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

  for (let i = 0; i < numChunks; i++) {
    const startTime = i * CHUNK_DURATION;
    const chunkPath = path.join(outputDir, `chunk_${i.toString().padStart(3, '0')}.mp3`);

    await execAsync(
      `ffmpeg -y -i "${inputPath}" -ss ${startTime} -t ${CHUNK_DURATION} -acodec libmp3lame -ar 16000 -ac 1 -b:a 64k "${chunkPath}"`
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

export async function POST(request: NextRequest) {
  const tempDir = path.join(os.tmpdir(), `youtube_${Date.now()}`);

  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json(
        { error: 'YouTube URLが必要です' },
        { status: 400 }
      );
    }

    // Validate YouTube URL
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)[\w-]+/;
    if (!youtubeRegex.test(url)) {
      return NextResponse.json(
        { error: '有効なYouTube URLを入力してください' },
        { status: 400 }
      );
    }

    await mkdir(tempDir, { recursive: true });
    const audioPath = path.join(tempDir, 'audio.mp3');

    // Download audio using yt-dlp
    console.log('Downloading YouTube audio...');
    try {
      await execAsync(
        `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${audioPath.replace('.mp3', '.%(ext)s')}" "${url}"`,
        { timeout: 300000 } // 5 minute timeout
      );
    } catch (downloadError) {
      console.error('yt-dlp error:', downloadError);
      return NextResponse.json(
        { error: 'YouTube動画のダウンロードに失敗しました。URLを確認してください。' },
        { status: 400 }
      );
    }

    // Find the downloaded file
    const files = await readdir(tempDir);
    const audioFile = files.find(f => f.endsWith('.mp3'));
    if (!audioFile) {
      return NextResponse.json(
        { error: '音声ファイルの取得に失敗しました' },
        { status: 500 }
      );
    }

    const finalAudioPath = path.join(tempDir, audioFile);
    const stats = await readFile(finalAudioPath);
    const fileSize = stats.length;

    console.log(`Downloaded audio: ${(fileSize / 1024 / 1024).toFixed(2)}MB`);

    let transcriptions: string[] = [];

    if (fileSize <= MAX_FILE_SIZE) {
      // Small file - process directly
      const audioBuffer = await readFile(finalAudioPath);
      const file = new File([audioBuffer], 'audio.mp3', { type: 'audio/mp3' });

      const transcription = await openai.audio.transcriptions.create({
        model: 'whisper-1',
        file: file,
        language: 'ja',
      });

      transcriptions.push(transcription.text);
    } else {
      // Large file - split and process
      console.log('Large file, splitting...');
      const duration = await getAudioDuration(finalAudioPath);
      const chunks = await splitAudio(finalAudioPath, tempDir);

      console.log(`Split into ${chunks.length} chunks`);

      for (let i = 0; i < chunks.length; i++) {
        console.log(`Processing chunk ${i + 1}/${chunks.length}...`);
        const text = await transcribeChunk(chunks[i]);
        transcriptions.push(text);
      }
    }

    const fullText = transcriptions.join('\n\n');

    return NextResponse.json({
      text: fullText,
      source: 'youtube',
    });

  } catch (error) {
    console.error('YouTube transcription error:', error);
    return NextResponse.json(
      { error: 'YouTube文字起こしに失敗しました: ' + (error as Error).message },
      { status: 500 }
    );
  } finally {
    // Cleanup
    try {
      const files = await readdir(tempDir);
      for (const file of files) {
        await unlink(path.join(tempDir, file));
      }
      await unlink(tempDir).catch(() => {});
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}
