import { NextRequest, NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';

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

    console.log('Fetching transcript for video:', videoId);

    // Try to get Japanese transcript first, then fall back to any available
    let transcript;
    try {
      transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'ja' });
    } catch {
      try {
        // Try English if Japanese not available
        transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
      } catch {
        // Try any available language
        try {
          transcript = await YoutubeTranscript.fetchTranscript(videoId);
        } catch (finalError) {
          console.error('Transcript fetch error:', finalError);
          return NextResponse.json(
            { error: 'この動画の字幕を取得できませんでした。字幕が有効な動画を選んでください。' },
            { status: 400 }
          );
        }
      }
    }

    if (!transcript || transcript.length === 0) {
      return NextResponse.json(
        { error: 'この動画には字幕がありません' },
        { status: 400 }
      );
    }

    // Combine all transcript segments
    const fullText = transcript
      .map((segment: { text: string }) => segment.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    console.log(`Transcript fetched: ${fullText.length} characters`);

    return NextResponse.json({
      text: fullText,
      source: 'youtube',
      segments: transcript.length,
    });

  } catch (error) {
    console.error('YouTube transcription error:', error);
    return NextResponse.json(
      { error: 'YouTube文字起こしに失敗しました: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
