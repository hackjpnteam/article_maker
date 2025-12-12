import { NextRequest, NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';
import ytdl from '@distube/ytdl-core';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
    // Try Japanese first
    let transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'ja' });
    if (transcript && transcript.length > 0) {
      console.log('Got Japanese captions');
      return transcript.map((s: { text: string }) => s.text).join(' ').replace(/\s+/g, ' ').trim();
    }
  } catch {
    // Try English
    try {
      const transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
      if (transcript && transcript.length > 0) {
        console.log('Got English captions');
        return transcript.map((s: { text: string }) => s.text).join(' ').replace(/\s+/g, ' ').trim();
      }
    } catch {
      // Try any language
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

async function transcribeWithWhisper(videoId: string): Promise<string> {
  console.log('Downloading audio from YouTube...');

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Get audio stream
  const info = await ytdl.getInfo(videoUrl);
  const audioFormat = ytdl.chooseFormat(info.formats, { quality: 'lowestaudio' });

  if (!audioFormat) {
    throw new Error('No audio format available');
  }

  console.log('Audio format:', audioFormat.mimeType, 'bitrate:', audioFormat.audioBitrate);

  // Download audio to buffer
  const chunks: Buffer[] = [];
  const stream = ytdl(videoUrl, { format: audioFormat });

  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve());
    stream.on('error', (err: Error) => reject(err));
  });

  const audioBuffer = Buffer.concat(chunks);
  console.log(`Downloaded ${(audioBuffer.length / 1024 / 1024).toFixed(2)}MB of audio`);

  // Check file size (Whisper limit is 25MB)
  if (audioBuffer.length > 25 * 1024 * 1024) {
    throw new Error('動画が長すぎます。25MB以下の動画を選んでください。');
  }

  // Create a File object for OpenAI
  const audioFile = new File([audioBuffer], 'audio.webm', {
    type: audioFormat.mimeType || 'audio/webm'
  });

  console.log('Transcribing with Whisper...');
  const transcription = await openai.audio.transcriptions.create({
    file: audioFile,
    model: 'whisper-1',
    language: 'ja',
  });

  return transcription.text;
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
      const transcribedText = await transcribeWithWhisper(videoId);
      console.log(`Whisper transcription: ${transcribedText.length} characters`);

      return NextResponse.json({
        text: transcribedText,
        source: 'youtube-whisper',
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

// Increase timeout for Vercel
export const maxDuration = 60;
