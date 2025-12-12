import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { v4 as uuidv4 } from 'uuid';
import { Article } from '@/lib/types';

// GET: 記事一覧取得
export async function GET() {
  try {
    const { db } = await connectToDatabase();
    const articles = await db
      .collection<Article>('articles')
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    return NextResponse.json(articles);
  } catch (error) {
    console.error('Get articles error:', error);
    return NextResponse.json(
      { error: '記事の取得に失敗しました' },
      { status: 500 }
    );
  }
}

// POST: 新規記事保存
export async function POST(request: NextRequest) {
  try {
    const { title, content, originalText, style, targetLength } = await request.json();

    const { db } = await connectToDatabase();
    const now = new Date().toISOString();

    const newArticle: Article = {
      id: uuidv4(),
      title,
      content,
      originalText,
      style,
      targetLength,
      createdAt: now,
      updatedAt: now,
    };

    await db.collection('articles').insertOne(newArticle);

    return NextResponse.json(newArticle);
  } catch (error) {
    console.error('Save article error:', error);
    return NextResponse.json(
      { error: '記事の保存に失敗しました' },
      { status: 500 }
    );
  }
}
