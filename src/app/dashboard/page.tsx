'use client';

import { useState, useRef, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Article } from '@/lib/types';
import {
  Mic,
  FileText,
  Sparkles,
  Save,
  Download,
  Trash2,
  Edit3,
  Clock,
  Upload,
  Wand2,
  BookOpen,
  Newspaper,
  PenTool,
  GraduationCap,
  Settings2,
  X,
  Check,
  Loader2,
  FileAudio,
  Plus,
  History,
  LogOut,
  User,
  Shield,
  Youtube,
} from 'lucide-react';

const STYLES = [
  { id: 'forbes', name: 'Forbes風', description: 'ビジネス向け洗練文体', icon: Newspaper, color: 'from-amber-500 to-orange-600' },
  { id: 'note', name: 'note', description: '親しみやすい文体', icon: PenTool, color: 'from-green-500 to-emerald-600' },
  { id: 'news', name: 'ニュース', description: '客観的で簡潔', icon: FileText, color: 'from-blue-500 to-cyan-600' },
  { id: 'blog', name: 'ブログ', description: 'SEO・具体例重視', icon: BookOpen, color: 'from-purple-500 to-pink-600' },
  { id: 'academic', name: '学術', description: '論理的・体系的', icon: GraduationCap, color: 'from-slate-500 to-gray-600' },
  { id: 'legal', name: '訴状・法律', description: '訴訟用文書作成', icon: Shield, color: 'from-red-500 to-rose-600' },
  { id: 'custom', name: 'カスタム', description: '独自プロンプト', icon: Settings2, color: 'from-gray-500 to-slate-600' },
];

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'create' | 'history'>('create');
  const [inputType, setInputType] = useState<'audio' | 'youtube' | 'text'>('audio');
  const [file, setFile] = useState<File | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [transcription, setTranscription] = useState('');
  const [style, setStyle] = useState('forbes');
  const [customPrompt, setCustomPrompt] = useState('');
  const [targetLength, setTargetLength] = useState(2500);
  const [generatedArticle, setGeneratedArticle] = useState('');
  const [articleTitle, setArticleTitle] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeStatus, setTranscribeStatus] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [articles, setArticles] = useState<Article[]>([]);
  const [editingArticle, setEditingArticle] = useState<Article | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/');
    }
  }, [status, router]);

  useEffect(() => {
    if (session) {
      fetchArticles();
    }
  }, [session]);

  const fetchArticles = async () => {
    try {
      const res = await fetch('/api/articles');
      const data = await res.json();
      setArticles(data);
    } catch (error) {
      console.error('Failed to fetch articles:', error);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  };

  const handleTranscribe = async () => {
    if (!file) return;

    setIsTranscribing(true);
    const fileSizeMB = file.size / 1024 / 1024;

    if (fileSizeMB > 24) {
      setTranscribeStatus(`大きなファイル (${fileSizeMB.toFixed(1)}MB) を分割処理中...`);
    } else {
      setTranscribeStatus('文字起こし中...');
    }

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (data.error) {
        alert(data.error);
      } else {
        setTranscription(data.text);
        if (data.chunks && data.chunks > 1) {
          setTranscribeStatus(`${data.duration}分の音声を${data.chunks}分割で処理完了`);
        }
      }
    } catch (error) {
      alert('文字起こしに失敗しました');
      console.error(error);
    } finally {
      setIsTranscribing(false);
      setTimeout(() => setTranscribeStatus(''), 3000);
    }
  };

  const handleYoutubeTranscribe = async () => {
    if (!youtubeUrl) return;

    setIsTranscribing(true);
    setTranscribeStatus('YouTube動画をダウンロード中...');

    try {
      const res = await fetch('/api/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: youtubeUrl }),
      });

      const data = await res.json();
      if (data.error) {
        alert(data.error);
      } else {
        setTranscription(data.text);
        setTranscribeStatus('YouTube文字起こし完了');
      }
    } catch (error) {
      alert('YouTube文字起こしに失敗しました');
      console.error(error);
    } finally {
      setIsTranscribing(false);
      setTimeout(() => setTranscribeStatus(''), 3000);
    }
  };

  const handleGenerate = async () => {
    if (!transcription) {
      alert('文字起こしテキストを入力してください');
      return;
    }

    setIsGenerating(true);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: transcription,
          style,
          targetLength,
          customPrompt: style === 'custom' ? customPrompt : undefined,
        }),
      });

      const data = await res.json();
      if (data.error) {
        alert(data.error);
      } else {
        setArticleTitle(data.title);
        setGeneratedArticle(data.content);
      }
    } catch (error) {
      alert('記事生成に失敗しました');
      console.error(error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!generatedArticle) return;

    try {
      const res = await fetch('/api/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: articleTitle,
          content: generatedArticle,
          originalText: transcription,
          style,
          targetLength,
        }),
      });

      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
        fetchArticles();
      }
    } catch (error) {
      alert('保存に失敗しました');
      console.error(error);
    }
  };

  const handleUpdate = async () => {
    if (!editingArticle) return;

    try {
      const res = await fetch(`/api/articles/${editingArticle.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editingArticle.title,
          content: editingArticle.content,
        }),
      });

      if (res.ok) {
        setEditingArticle(null);
        fetchArticles();
      }
    } catch (error) {
      alert('更新に失敗しました');
      console.error(error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('この記事を削除しますか？')) return;

    try {
      const res = await fetch(`/api/articles/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchArticles();
      }
    } catch (error) {
      alert('削除に失敗しました');
      console.error(error);
    }
  };

  const handleDownload = (article: Article) => {
    const blob = new Blob([article.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${article.title}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectedStyle = STYLES.find(s => s.id === style);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-violet-500 mx-auto mb-4" />
          <p className="text-slate-500">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-xl shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-800">BackNote</h1>
                <p className="text-xs text-slate-500">音声から記事を自動生成</p>
              </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex bg-slate-100 rounded-xl p-1">
              <button
                onClick={() => setActiveTab('create')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'create'
                    ? 'bg-white text-slate-800 shadow-md'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Plus className="w-4 h-4" />
                新規作成
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'history'
                    ? 'bg-white text-slate-800 shadow-md'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <History className="w-4 h-4" />
                履歴
                {articles.length > 0 && (
                  <span className="ml-1 px-2 py-0.5 rounded-full bg-violet-100 text-violet-600 text-xs">
                    {articles.length}
                  </span>
                )}
              </button>
            </div>

            {/* User Menu */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 rounded-xl">
                <User className="w-4 h-4 text-slate-500" />
                <span className="text-sm font-medium text-slate-700">{session.user?.name}</span>
              </div>
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all"
              >
                <LogOut className="w-4 h-4" />
                ログアウト
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {activeTab === 'create' ? (
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
            {/* Left Panel - Input */}
            <div className="xl:col-span-2 space-y-5">
              {/* Input Type Toggle */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <div className="flex gap-2 mb-5">
                  <button
                    onClick={() => setInputType('audio')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      inputType === 'audio'
                        ? 'bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-lg shadow-violet-500/25'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    <Mic className="w-4 h-4" />
                    音声
                  </button>
                  <button
                    onClick={() => setInputType('youtube')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      inputType === 'youtube'
                        ? 'bg-gradient-to-r from-red-500 to-red-600 text-white shadow-lg shadow-red-500/25'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    <Youtube className="w-4 h-4" />
                    YouTube
                  </button>
                  <button
                    onClick={() => setInputType('text')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      inputType === 'text'
                        ? 'bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-lg shadow-violet-500/25'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    <FileText className="w-4 h-4" />
                    テキスト
                  </button>
                </div>

                {inputType === 'audio' && (
                  <div>
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                        file
                          ? 'border-violet-400 bg-violet-50'
                          : 'border-slate-300 hover:border-violet-400 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="audio/*"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                      {file ? (
                        <div className="space-y-2">
                          <div className="w-12 h-12 mx-auto rounded-full bg-violet-100 flex items-center justify-center">
                            <FileAudio className="w-6 h-6 text-violet-600" />
                          </div>
                          <p className="text-slate-800 font-medium">{file.name}</p>
                          <p className="text-slate-500 text-sm">
                            {(file.size / 1024 / 1024).toFixed(2)} MB
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="w-12 h-12 mx-auto rounded-full bg-slate-100 flex items-center justify-center">
                            <Upload className="w-6 h-6 text-slate-400" />
                          </div>
                          <p className="text-slate-600">クリックしてファイルを選択</p>
                          <p className="text-slate-400 text-sm">m4a, mp3, wav（長時間OK・自動分割）</p>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={handleTranscribe}
                      disabled={!file || isTranscribing}
                      className="w-full mt-4 py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40"
                    >
                      {isTranscribing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {transcribeStatus || '文字起こし中...'}
                        </>
                      ) : (
                        <>
                          <Mic className="w-4 h-4" />
                          文字起こし開始
                        </>
                      )}
                    </button>
                    {transcribeStatus && !isTranscribing && (
                      <p className="text-center text-sm text-emerald-600 mt-2">{transcribeStatus}</p>
                    )}
                  </div>
                )}

                {inputType === 'youtube' && (
                  <div>
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 p-4 bg-red-50 rounded-xl border border-red-200">
                        <Youtube className="w-6 h-6 text-red-500" />
                        <span className="text-sm text-red-700">YouTube動画から文字起こし</span>
                      </div>
                      <input
                        type="text"
                        value={youtubeUrl}
                        onChange={(e) => setYoutubeUrl(e.target.value)}
                        placeholder="https://www.youtube.com/watch?v=..."
                        className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-300"
                      />
                    </div>
                    <button
                      onClick={handleYoutubeTranscribe}
                      disabled={!youtubeUrl || isTranscribing}
                      className="w-full mt-4 py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed bg-gradient-to-r from-red-500 to-red-600 text-white shadow-lg shadow-red-500/25 hover:shadow-red-500/40"
                    >
                      {isTranscribing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {transcribeStatus || '処理中...'}
                        </>
                      ) : (
                        <>
                          <Youtube className="w-4 h-4" />
                          YouTube文字起こし
                        </>
                      )}
                    </button>
                    {transcribeStatus && !isTranscribing && (
                      <p className="text-center text-sm text-red-600 mt-2">{transcribeStatus}</p>
                    )}
                  </div>
                )}
              </div>

              {/* Transcription Text */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-slate-700">
                    文字起こしテキスト
                  </label>
                  <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">
                    {transcription.length.toLocaleString()} 文字
                  </span>
                </div>
                <textarea
                  value={transcription}
                  onChange={(e) => setTranscription(e.target.value)}
                  placeholder="文字起こし結果、または直接テキストを入力..."
                  className="w-full h-40 p-4 bg-slate-50 border border-slate-200 rounded-xl resize-none text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-300"
                />
              </div>

              {/* Style Selection */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <h3 className="text-sm font-medium text-slate-700 mb-4">文章スタイル</h3>
                <div className="grid grid-cols-2 gap-2">
                  {STYLES.map((s) => {
                    const Icon = s.icon;
                    return (
                      <button
                        key={s.id}
                        onClick={() => setStyle(s.id)}
                        className={`p-3 text-left rounded-xl border transition-all ${
                          style === s.id
                            ? 'border-violet-400 bg-violet-50'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <div className={`w-6 h-6 rounded-lg bg-gradient-to-br ${s.color} flex items-center justify-center`}>
                            <Icon className="w-3 h-3 text-white" />
                          </div>
                          <span className="font-medium text-sm text-slate-800">{s.name}</span>
                        </div>
                        <p className="text-xs text-slate-500">{s.description}</p>
                      </button>
                    );
                  })}
                </div>

                {style === 'custom' && (
                  <div className="mt-4">
                    <textarea
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      placeholder="例: あなたは〇〇の専門家です。読者に向けて..."
                      className="w-full h-20 p-3 bg-slate-50 border border-slate-200 rounded-xl resize-none text-slate-700 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                    />
                  </div>
                )}

                {/* Target Length */}
                <div className="mt-5">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-slate-700">目標文字数</label>
                    <span className="text-sm font-bold text-violet-600">{targetLength.toLocaleString()}字</span>
                  </div>
                  <input
                    type="range"
                    min="500"
                    max="10000"
                    step="500"
                    value={targetLength}
                    onChange={(e) => setTargetLength(Number(e.target.value))}
                    className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-500 [&::-webkit-slider-thumb]:shadow-lg"
                  />
                  <div className="flex justify-between text-xs text-slate-400 mt-1">
                    <span>500</span>
                    <span>10,000</span>
                  </div>
                </div>

                <button
                  onClick={handleGenerate}
                  disabled={!transcription || isGenerating}
                  className="w-full mt-5 py-4 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 hover:scale-[1.02]"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      記事を生成中...
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-5 h-5" />
                      記事を生成
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Right Panel - Output */}
            <div className="xl:col-span-3">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 h-full">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-slate-800">生成された記事</h3>
                    {generatedArticle && selectedStyle && (
                      <span className={`px-2 py-1 rounded-lg text-xs font-medium bg-gradient-to-r ${selectedStyle.color} text-white`}>
                        {selectedStyle.name}
                      </span>
                    )}
                  </div>
                  {generatedArticle && (
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-slate-500 bg-slate-100 px-3 py-1 rounded-lg">
                        {generatedArticle.length.toLocaleString()}字
                      </span>
                      <button
                        onClick={handleSave}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm transition-all ${
                          saveSuccess
                            ? 'bg-emerald-500 text-white'
                            : 'bg-gradient-to-r from-emerald-500 to-green-600 text-white hover:shadow-lg hover:shadow-emerald-500/25'
                        }`}
                      >
                        {saveSuccess ? (
                          <>
                            <Check className="w-4 h-4" />
                            保存完了
                          </>
                        ) : (
                          <>
                            <Save className="w-4 h-4" />
                            保存
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>

                {generatedArticle && (
                  <input
                    type="text"
                    value={articleTitle}
                    onChange={(e) => setArticleTitle(e.target.value)}
                    className="w-full mb-4 p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                    placeholder="タイトル"
                  />
                )}

                <textarea
                  value={generatedArticle}
                  onChange={(e) => setGeneratedArticle(e.target.value)}
                  placeholder="ここに生成された記事が表示されます..."
                  className="w-full h-[calc(100vh-400px)] p-4 bg-slate-50 border border-slate-200 rounded-xl resize-none text-slate-700 placeholder-slate-400 font-mono text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                />
              </div>
            </div>
          </div>
        ) : (
          /* History Tab */
          <div className="space-y-4">
            {editingArticle ? (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                    <Edit3 className="w-5 h-5 text-violet-500" />
                    記事を編集
                  </h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditingArticle(null)}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-slate-100 text-slate-600 hover:bg-slate-200"
                    >
                      <X className="w-4 h-4" />
                      キャンセル
                    </button>
                    <button
                      onClick={handleUpdate}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-gradient-to-r from-violet-500 to-purple-600 text-white"
                    >
                      <Check className="w-4 h-4" />
                      保存
                    </button>
                  </div>
                </div>
                <input
                  type="text"
                  value={editingArticle.title}
                  onChange={(e) =>
                    setEditingArticle({ ...editingArticle, title: e.target.value })
                  }
                  className="w-full mb-4 p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                />
                <textarea
                  value={editingArticle.content}
                  onChange={(e) =>
                    setEditingArticle({ ...editingArticle, content: e.target.value })
                  }
                  className="w-full h-[60vh] p-4 bg-slate-50 border border-slate-200 rounded-xl resize-none text-slate-700 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                />
              </div>
            ) : articles.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-16 text-center">
                <div className="w-16 h-16 mx-auto rounded-full bg-slate-100 flex items-center justify-center mb-4">
                  <FileText className="w-8 h-8 text-slate-400" />
                </div>
                <p className="text-slate-600 text-lg">保存された記事はありません</p>
                <p className="text-slate-400 text-sm mt-2">新規作成から記事を生成してください</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {articles.map((article) => {
                  const articleStyle = STYLES.find((s) => s.id === article.style);
                  const Icon = articleStyle?.icon || FileText;
                  return (
                    <div
                      key={article.id}
                      className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 hover:border-slate-300 hover:shadow-md transition-all group"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${articleStyle?.color || 'from-slate-500 to-gray-600'} flex items-center justify-center`}>
                              <Icon className="w-4 h-4 text-white" />
                            </div>
                            <h3 className="font-semibold text-slate-800 group-hover:text-violet-600 transition-colors">
                              {article.title}
                            </h3>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-slate-500">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {new Date(article.createdAt).toLocaleDateString('ja-JP')}
                            </span>
                            <span>{article.content.length.toLocaleString()}字</span>
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-xs">
                              {articleStyle?.name || article.style}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setEditingArticle(article)}
                            className="p-2 rounded-lg bg-slate-100 text-slate-500 hover:text-violet-600 hover:bg-violet-50 transition-all"
                            title="編集"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDownload(article)}
                            className="p-2 rounded-lg bg-slate-100 text-slate-500 hover:text-violet-600 hover:bg-violet-50 transition-all"
                            title="ダウンロード"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(article.id)}
                            className="p-2 rounded-lg bg-slate-100 text-slate-500 hover:text-red-500 hover:bg-red-50 transition-all"
                            title="削除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <p className="text-slate-500 text-sm mt-3 line-clamp-2 leading-relaxed">
                        {article.content.replace(/^#.*\n/, '').substring(0, 150)}...
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
