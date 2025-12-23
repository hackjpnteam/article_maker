import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

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
    const body = (await request.json()) as HandleUploadBody;

    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Validate file extension
        const ext = pathname.substring(pathname.lastIndexOf('.')).toLowerCase();
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
          throw new Error('対応していないファイル形式です。音声(mp3, m4a, wav等)または動画(mp4, mov等)ファイルをアップロードしてください。');
        }

        return {
          allowedContentTypes: [
            'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a',
            'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg', 'audio/flac',
            'audio/aac', 'audio/x-caf',
            'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/webm',
            'application/octet-stream', // Some browsers send this for audio files
          ],
          maximumSizeInBytes: 500 * 1024 * 1024, // 500MB
          tokenPayload: JSON.stringify({
            userId: session.user?.email,
          }),
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log('Upload completed:', blob.url);
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    console.error('Upload error:', error);
    const errorMessage = (error as Error).message;

    // Provide user-friendly error messages
    if (errorMessage.includes('BLOB_READ_WRITE_TOKEN') || errorMessage.includes('token')) {
      return NextResponse.json(
        { error: 'ファイルストレージが設定されていません。管理者にお問い合わせください。' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: errorMessage || 'アップロードに失敗しました。もう一度お試しください。' },
      { status: 500 }
    );
  }
}

export const maxDuration = 60;
