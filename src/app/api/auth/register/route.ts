import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { connectToDatabase } from '@/lib/mongodb';

export async function POST(request: NextRequest) {
  try {
    const { name, email, password } = await request.json();

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: '全ての項目を入力してください' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'パスワードは6文字以上にしてください' },
        { status: 400 }
      );
    }

    const { db } = await connectToDatabase();

    const existingUser = await db.collection('users').findOne({ email });
    if (existingUser) {
      return NextResponse.json(
        { error: 'このメールアドレスは既に登録されています' },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const result = await db.collection('users').insertOne({
      name,
      email,
      password: hashedPassword,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({
      id: result.insertedId.toString(),
      name,
      email,
    });
  } catch (error) {
    console.error('Register error:', error);
    return NextResponse.json(
      { error: '登録に失敗しました' },
      { status: 500 }
    );
  }
}
