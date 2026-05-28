import { useState, useRef } from 'react';
import { Languages, Wand2, Copy, ImageUp, Check, Loader2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';

export function PromptWorkspace() {
  const chinesePrompt = useAppStore((s) => s.chinesePrompt);
  const englishPrompt = useAppStore((s) => s.englishPrompt);
  const setChinesePrompt = useAppStore((s) => s.setChinesePrompt);
  const setEnglishPrompt = useAppStore((s) => s.setEnglishPrompt);
  const optimizePrompt = useAppStore((s) => s.optimizePrompt);
  const addToast = useAppStore((s) => s.addToast);

  const [showUpload, setShowUpload] = useState(false);
  const [copied, setCopied] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [reverseImage, setReverseImage] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOptimize = async () => {
    if (!chinesePrompt.trim()) {
      addToast('warning', '请先输入中文提示词');
      return;
    }
    setOptimizing(true);
    try {
      await optimizePrompt();
    } finally {
      setOptimizing(false);
    }
  };

  const handleCopy = async () => {
    if (!englishPrompt.trim()) return;
    await navigator.clipboard.writeText(englishPrompt);
    setCopied(true);
    addToast('success', '已复制到剪贴板');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReverseUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setReverseImage(file);
    }
  };

  return (
    <div>
      <h3 className="section-title">提示词输入</h3>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-forge-text2 font-medium flex items-center gap-1.5">
              <Languages size={13} className="text-forge-cyan" />
              中文输入
            </label>
            <span className="text-[10px] text-forge-text2">{chinesePrompt.length} 字</span>
          </div>

          <textarea
            value={chinesePrompt}
            onChange={(e) => setChinesePrompt(e.target.value)}
            placeholder="用中文描述你想要的画面，例如：一只在霓虹城市中漫步的猫，赛博朋克风格..."
            className="textarea-field h-40"
            maxLength={2000}
          />

          <div className="flex gap-2 mt-2.5">
            <button
              onClick={handleOptimize}
              disabled={!chinesePrompt.trim() || optimizing}
              className="gradient-btn flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {optimizing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Wand2 size={14} />
              )}
              {optimizing ? '优化中...' : '优化翻译'}
            </button>
            <button
              onClick={() => setShowUpload(true)}
              className="glass-card-hover flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs text-forge-text2"
            >
              <ImageUp size={14} />
              反推提示词
            </button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-forge-text2 font-medium flex items-center gap-1.5">
              <Languages size={13} className="text-forge-orange" />
              English Prompt (优化结果)
            </label>
            <button
              onClick={handleCopy}
              disabled={!englishPrompt.trim()}
              className="text-[10px] text-forge-text2 hover:text-forge-cyan transition-colors flex items-center gap-1"
            >
              {copied ? <Check size={12} className="text-forge-green" /> : <Copy size={12} />}
              {copied ? '已复制' : '复制'}
            </button>
          </div>

          <textarea
            value={englishPrompt}
            onChange={(e) => setEnglishPrompt(e.target.value)}
            placeholder="点击左侧「优化翻译」按钮，LLM 将自动翻译为适配图像生成模型的英文 Prompt..."
            className="textarea-field h-40"
          />
        </div>
      </div>

      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowUpload(false)}>
          <div
            className="glass-card p-6 w-full max-w-md mx-4 animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-sm text-forge-cyan mb-4">上传图片反推提示词</h3>

            {reverseImage ? (
              <div className="mb-4">
                <div className="glass-card p-3 flex items-center gap-3">
                  <img
                    src={URL.createObjectURL(reverseImage)}
                    alt="preview"
                    className="w-16 h-16 rounded-lg object-cover"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-forge-text truncate">{reverseImage.name}</p>
                    <p className="text-[10px] text-forge-text2 mt-0.5">
                      {(reverseImage.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-forge-border/60 rounded-xl p-10 text-center hover:border-forge-cyan/40 transition-colors"
              >
                <ImageUp size={28} className="mx-auto text-forge-text2 mb-2" />
                <p className="text-sm text-forge-text2">点击上传参考图</p>
                <p className="text-[10px] text-forge-text2/60 mt-1">JPG / PNG / WebP，最大 10MB</p>
              </button>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleReverseUpload}
              className="hidden"
            />

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  setShowUpload(false);
                  setReverseImage(null);
                }}
                className="flex-1 glass-card-hover py-2 rounded-lg text-xs text-forge-text2"
              >
                取消
              </button>
              <button
                disabled={!reverseImage}
                onClick={() => {
                  addToast('info', '反推提示词中...（此功能需要后端支持）');
                  setShowUpload(false);
                  setReverseImage(null);
                }}
                className="flex-1 gradient-btn py-2 rounded-lg text-xs disabled:opacity-40 disabled:cursor-not-allowed"
              >
                开始反推
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
