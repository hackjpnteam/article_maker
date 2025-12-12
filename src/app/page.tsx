'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import {
  Sparkles,
  Mic,
  FileText,
  Zap,
  Clock,
  Shield,
  ArrowRight,
  Check,
  Newspaper,
  PenTool,
  BookOpen,
  GraduationCap,
  Play,
} from 'lucide-react';

const features = [
  {
    icon: Mic,
    title: '音声から記事へ',
    description: '1時間以上の長時間音声も自動分割で対応。会議やインタビューを瞬時にテキスト化。',
  },
  {
    icon: Zap,
    title: 'AI記事生成',
    description: 'GPT-4が文字起こしから高品質な記事を自動生成。Forbes風からブログまで多彩なスタイル。',
  },
  {
    icon: Clock,
    title: '時間を90%削減',
    description: '従来数時間かかっていた記事作成を数分で完了。あなたの時間を大切なことに。',
  },
  {
    icon: Shield,
    title: '安全なデータ管理',
    description: 'アカウント別に記事を保存。いつでもどこでも編集・ダウンロード可能。',
  },
];

const styles = [
  { name: 'Forbes', icon: Newspaper, color: 'from-amber-500 to-orange-600', desc: 'ビジネス向け' },
  { name: 'note', icon: PenTool, color: 'from-green-500 to-emerald-600', desc: '親しみやすい' },
  { name: 'ニュース', icon: FileText, color: 'from-blue-500 to-cyan-600', desc: '客観的' },
  { name: 'ブログ', icon: BookOpen, color: 'from-purple-500 to-pink-600', desc: 'SEO重視' },
  { name: '学術', icon: GraduationCap, color: 'from-slate-500 to-gray-600', desc: '論理的' },
];

const steps = [
  { num: '01', title: '音声をアップロード', desc: 'm4a, mp3, wavに対応' },
  { num: '02', title: 'AIが文字起こし', desc: 'Whisper APIで高精度変換' },
  { num: '03', title: 'スタイルを選択', desc: '5種類+カスタム' },
  { num: '04', title: '記事を生成', desc: 'GPT-4が自動執筆' },
];

export default function LandingPage() {
  const { data: session } = useSession();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-violet-50">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-slate-800">BackNote</span>
          </div>
          <div className="flex items-center gap-4">
            {session ? (
              <Link
                href="/dashboard"
                className="px-5 py-2.5 bg-gradient-to-r from-violet-500 to-purple-600 text-white font-medium rounded-xl hover:shadow-lg hover:shadow-violet-500/25 transition-all"
              >
                ダッシュボード
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="px-4 py-2 text-slate-600 font-medium hover:text-slate-800 transition-colors"
                >
                  ログイン
                </Link>
                <Link
                  href="/login"
                  className="px-5 py-2.5 bg-gradient-to-r from-violet-500 to-purple-600 text-white font-medium rounded-xl hover:shadow-lg hover:shadow-violet-500/25 transition-all"
                >
                  無料で始める
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-violet-100 rounded-full text-violet-700 text-sm font-medium mb-6">
            <Zap className="w-4 h-4" />
            AIで記事作成を革新
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-slate-800 mb-6 leading-tight">
            音声を<span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-500 to-purple-600">プロ品質の記事</span>に<br />自動変換
          </h1>
          <p className="text-xl text-slate-600 mb-10 max-w-2xl mx-auto leading-relaxed">
            会議録音、インタビュー、ポッドキャストを<br />
            Forbes風からブログまで、様々なスタイルの記事に自動生成
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-gradient-to-r from-violet-500 to-purple-600 text-white font-semibold rounded-2xl hover:shadow-xl hover:shadow-violet-500/30 hover:scale-105 transition-all"
            >
              無料で始める
              <ArrowRight className="w-5 h-5" />
            </Link>
            <button className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white text-slate-700 font-semibold rounded-2xl border border-slate-200 hover:border-slate-300 hover:shadow-lg transition-all">
              <Play className="w-5 h-5" />
              デモを見る
            </button>
          </div>
        </div>
      </section>

      {/* Demo Preview */}
      <section className="pb-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="bg-white rounded-3xl shadow-2xl shadow-slate-200/50 border border-slate-200 overflow-hidden">
            <div className="bg-slate-100 px-4 py-3 flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-400"></div>
              <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
              <div className="w-3 h-3 rounded-full bg-green-400"></div>
              <span className="ml-4 text-sm text-slate-500">backnote.app</span>
            </div>
            <div className="p-8 bg-gradient-to-br from-slate-50 to-white">
              <div className="grid md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <div className="bg-violet-50 border-2 border-dashed border-violet-300 rounded-2xl p-8 text-center">
                    <Mic className="w-12 h-12 text-violet-500 mx-auto mb-3" />
                    <p className="text-violet-700 font-medium">音声ファイルをドロップ</p>
                    <p className="text-violet-500 text-sm">長時間OK・自動分割</p>
                  </div>
                  <div className="flex gap-2">
                    {styles.slice(0, 3).map((s) => (
                      <div key={s.name} className={`flex-1 p-3 rounded-xl bg-gradient-to-br ${s.color} text-white text-center text-sm font-medium`}>
                        {s.name}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                    <span className="text-sm text-slate-500">生成された記事</span>
                  </div>
                  <div className="space-y-2">
                    <div className="h-4 bg-slate-200 rounded w-3/4"></div>
                    <div className="h-3 bg-slate-100 rounded w-full"></div>
                    <div className="h-3 bg-slate-100 rounded w-5/6"></div>
                    <div className="h-3 bg-slate-100 rounded w-full"></div>
                    <div className="h-3 bg-slate-100 rounded w-4/5"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">
              なぜBackNoteなのか
            </h2>
            <p className="text-lg text-slate-600">記事作成の常識を変える機能</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {features.map((feature, i) => (
              <div key={i} className="p-6 rounded-2xl bg-slate-50 hover:bg-gradient-to-br hover:from-violet-50 hover:to-purple-50 transition-all group">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <feature.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-bold text-slate-800 mb-2">{feature.title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">
              4ステップで完了
            </h2>
            <p className="text-lg text-slate-600">シンプルな操作で高品質な記事を</p>
          </div>
          <div className="grid md:grid-cols-4 gap-6">
            {steps.map((step, i) => (
              <div key={i} className="relative">
                <div className="bg-white rounded-2xl p-6 border border-slate-200 hover:border-violet-300 hover:shadow-lg transition-all">
                  <span className="text-4xl font-bold text-violet-200">{step.num}</span>
                  <h3 className="text-lg font-bold text-slate-800 mt-2 mb-1">{step.title}</h3>
                  <p className="text-slate-500 text-sm">{step.desc}</p>
                </div>
                {i < 3 && (
                  <div className="hidden md:block absolute top-1/2 -right-3 transform -translate-y-1/2">
                    <ArrowRight className="w-6 h-6 text-slate-300" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Styles */}
      <section className="py-20 px-6 bg-gradient-to-br from-violet-50 to-purple-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">
              多彩な文章スタイル
            </h2>
            <p className="text-lg text-slate-600">用途に合わせた最適なトーンで</p>
          </div>
          <div className="flex flex-wrap justify-center gap-4">
            {styles.map((style, i) => (
              <div key={i} className="flex items-center gap-3 px-6 py-4 bg-white rounded-2xl border border-slate-200 hover:shadow-lg transition-all">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${style.color} flex items-center justify-center`}>
                  <style.icon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="font-bold text-slate-800">{style.name}</p>
                  <p className="text-sm text-slate-500">{style.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-gradient-to-br from-violet-500 to-purple-600 rounded-3xl p-12 text-center text-white">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              今すぐ始めよう
            </h2>
            <p className="text-lg text-violet-100 mb-8 max-w-xl mx-auto">
              アカウント登録は無料。音声をアップロードするだけで、AIがあなたの記事を書きます。
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white text-violet-600 font-semibold rounded-2xl hover:shadow-xl transition-all"
              >
                無料で始める
                <ArrowRight className="w-5 h-5" />
              </Link>
            </div>
            <div className="mt-8 flex items-center justify-center gap-6 text-violet-200 text-sm">
              <span className="flex items-center gap-2"><Check className="w-4 h-4" /> クレジットカード不要</span>
              <span className="flex items-center gap-2"><Check className="w-4 h-4" /> 即座に利用開始</span>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-slate-200">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-slate-800">BackNote</span>
          </div>
          <p className="text-slate-500 text-sm">© 2024 BackNote. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
