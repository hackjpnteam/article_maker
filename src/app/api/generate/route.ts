import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const STYLE_PROMPTS: Record<string, string> = {
  forbes: `あなたはForbes JAPANの編集者です。以下の特徴を持つ記事を書いてください：
- キャッチーで印象的な見出し
- ビジネスパーソン向けの洗練された文体
- 数字やデータを効果的に使用
- 引用を効果的に配置
- 見出し（##）で構造化
- 読者の興味を引くリード文`,

  note: `あなたはnoteの人気ライターです。以下の特徴を持つ記事を書いてください：
- 親しみやすく読みやすい文体
- 個人的な視点や感想を交える
- 段落は短めに
- 読者に語りかけるような口調`,

  news: `あなたはニュース記者です。以下の特徴を持つ記事を書いてください：
- 客観的で簡潔な文体
- 5W1Hを明確に
- 重要な情報から順に記載（逆ピラミッド構造）
- 事実に基づいた記述`,

  blog: `あなたはプロブロガーです。以下の特徴を持つ記事を書いてください：
- SEOを意識した見出し構成
- 読者の悩みに寄り添う内容
- 具体例を多用
- 箇条書きを効果的に使用`,

  academic: `あなたは学術ライターです。以下の特徴を持つ記事を書いてください：
- 論理的で体系的な構成
- 専門用語の適切な説明
- 根拠を明示した記述
- 客観的な分析`,

  legal: `あなたは法律文書の専門家です。以下の特徴を持つ訴訟用文書を作成してください：
- 法的に正確で明確な文体
- 時系列に沿った事実の整理
- 「原告」「被告」「請求の趣旨」「請求の原因」などの法的構成
- 証拠に基づいた主張
- 論理的な因果関係の説明
- 損害額や請求内容の具体的な記載
- 法的根拠（民法、商法等）への言及
- 裁判所への提出を想定した形式`,

  minutes: `あなたはプロフェッショナルな会議議事録作成の専門家です。以下のフォーマットと特徴で正式な議事録を作成してください：

【議事録フォーマット】
# 会議議事録

## 会議概要
- **会議名**: （会議の名称を推測して記載）
- **日時**: （言及があれば記載、なければ「記載なし」）
- **場所**: （言及があれば記載、なければ「記載なし」）
- **出席者**: （発言者から推測して記載）
- **議事録作成者**: BackNote AI

## 議題
1. （主要な議題を箇条書きで列挙）

## 議事内容
### 議題1: （議題名）
- **発言者**: （発言内容の要約）
- **議論のポイント**:
- **結論/合意事項**:

### 議題2: （議題名）
...

## 決定事項
| No. | 決定内容 | 担当者 | 期限 |
|-----|----------|--------|------|
| 1   |          |        |      |

## アクションアイテム（TODO）
| No. | タスク内容 | 担当者 | 期限 | 優先度 |
|-----|------------|--------|------|--------|
| 1   |            |        |      |        |

## 次回会議
- **予定日時**: （言及があれば記載）
- **議題（予定）**:

## 備考
（その他特記事項）

---

【作成上の注意】
- 発言は要約し、重要なポイントを漏れなく記載
- 決定事項とアクションアイテムは明確に区別
- 曖昧な表現を避け、具体的に記載
- 担当者が不明な場合は「要確認」と記載
- 数字や固有名詞は正確に記載`,
};

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
    const { text, style, targetLength, customPrompt } = await request.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: '文字起こしテキストが必要です' },
        { status: 400 }
      );
    }

    // Security: Validate input lengths
    if (text.length > 500000) {
      return NextResponse.json(
        { error: 'テキストが長すぎます（最大50万文字）' },
        { status: 400 }
      );
    }

    if (customPrompt && customPrompt.length > 5000) {
      return NextResponse.json(
        { error: 'カスタムプロンプトが長すぎます（最大5000文字）' },
        { status: 400 }
      );
    }

    const stylePrompt = customPrompt || STYLE_PROMPTS[style] || STYLE_PROMPTS.forbes;

    const systemPrompt = `${stylePrompt}

重要な指示：
- 目標文字数: 約${targetLength}文字
- 文字数が足りない場合は、内容を適切に肉付けしてください
- 元の内容の本質は変えずに、補足説明や文脈を追加してください
- Markdown形式で出力してください`;

    const userPrompt = `以下の文字起こしテキストを元に、記事を作成してください。

【文字起こしテキスト】
${text}

【要件】
- 約${targetLength}文字の記事にしてください
- 内容が薄い場合は、適切に肉付けしてください
- 読みやすく構造化してください`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 4000,
      temperature: 0.7,
    });

    const article = completion.choices[0]?.message?.content || '';

    // タイトルを抽出（最初の#見出し）
    const titleMatch = article.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : '無題の記事';

    return NextResponse.json({
      title,
      content: article,
      characterCount: article.length,
    });
  } catch (error) {
    console.error('Generation error:', error);
    return NextResponse.json(
      { error: '記事生成に失敗しました' },
      { status: 500 }
    );
  }
}

// Increase timeout for long article generation
export const maxDuration = 60;
