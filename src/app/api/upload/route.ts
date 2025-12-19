import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { put } from '@vercel/blob';

// Security: Allowed audio/video file extensions
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
    const fileName = file.name || 'audio.m4a';
    const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase() || '.m4a';
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

    // Upload to Vercel Blob
    const blob = await put(`audio/${Date.now()}_${fileName}`, file, {
      access: 'public',
      addRandomSuffix: true,
    });

    return NextResponse.json({
      url: blob.url,
      size: file.size,
      name: fileName,
    });

  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: 'アップロードに失敗しました: ' + (error as Error).message },
      { status: 500 }
    );
  }
}

export const maxDuration = 60;
