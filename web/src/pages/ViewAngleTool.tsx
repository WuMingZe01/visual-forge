import { useState, useCallback, useRef } from 'react';
import { Camera, Upload, X, Play, Download, RefreshCw, Layers, CheckCircle2, Loader2 } from 'lucide-react';

interface AnglePreset {
  name: string;
  icon: string;
  prompt: string;
  rotation: number;
}

const ANGLE_PRESETS: AnglePreset[] = [
  { name: '正面', icon: '🧍', prompt: 'front view, facing camera, full body shot', rotation: 0 },
  { name: '侧面', icon: '🚶', prompt: 'side profile view, 90 degree angle, natural stance', rotation: 90 },
  { name: '45°左', icon: '↗️', prompt: 'three-quarter view from left, 45 degree angle', rotation: -45 },
  { name: '45°右', icon: '↖️', prompt: 'three-quarter view from right, 45 degree angle', rotation: 45 },
  { name: '背面', icon: '🔙', prompt: 'back view, looking over shoulder', rotation: 180 },
  { name: '坐姿', icon: '🪑', prompt: 'seated pose, relaxed, looking at camera', rotation: 0 },
  { name: '特写', icon: '🔍', prompt: 'close-up portrait shot, chest up, detailed facial features', rotation: 0 },
  { name: '动态', icon: '🏃', prompt: 'dynamic walking pose, mid-stride, natural movement', rotation: 0 },
];

export function ViewAngleTool() {
  const [mainImage, setMainImage] = useState<string | null>(null);
  const [selectedAngles, setSelectedAngles] = useState<Set<string>>(new Set(['正面', '侧面', '45°左']));
  const [results, setResults] = useState<Map<string, string>>(new Map());
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const toggleAngle = (name: string) => {
    setSelectedAngles(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const handleUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setMainImage(reader.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setMainImage(reader.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleGenerate = async () => {
    if (!mainImage || selectedAngles.size === 0) return;
    setGenerating(true);
    setResults(new Map());
    const newResults = new Map<string, string>();

    for (const name of selectedAngles) {
      setProgress(`生成中: ${name}`);
      const preset = ANGLE_PRESETS.find(a => a.name === name);
      if (!preset) continue;

      try {
        const resp = await fetch('/yunwu/v1/images/generations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer placeholder' },
          body: JSON.stringify({
            model: 'gpt-image-2-all',
            prompt: `Reference this image, maintain identical product and model features. ${preset.prompt}. Professional fashion e-commerce photography, studio lighting, white background, 8K, sharp details. Negative: deformation, distortion, blurry, low quality, watermark`,
            n: 1,
            size: '1024x1024',
            quality: 'hd',
            response_format: 'url',
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          const url = data?.data?.[0]?.url || '';
          if (url) {
            newResults.set(name, url);
            setResults(new Map(newResults));
          }
        }
      } catch (e) {
        console.error(`生成 ${name} 失败:`, e);
      }
    }
    setGenerating(false);
    setProgress('');
  };

  const handleDownload = async (url: string, name: string) => {
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `view_${name}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {}
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-forge-cyan to-purple-500 flex items-center justify-center">
          <Camera size={20} className="text-forge-bg" />
        </div>
        <div>
          <h2 className="font-display text-lg font-bold text-gradient-cyan tracking-wider">视角控制</h2>
          <p className="text-xs text-forge-text2">上传主图 → 选择视角 → 一键裂变多角度素材</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Upload */}
        <div className="glass-card p-4 space-y-4">
          <h3 className="font-display text-sm font-semibold text-forge-text flex items-center gap-2">
            <Upload size={14} className="text-forge-cyan" /> 上传主图
          </h3>

          <div
            ref={dropRef}
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`rounded-xl border-2 border-dashed transition-colors cursor-pointer flex flex-col items-center justify-center ${
              mainImage
                ? 'border-forge-cyan/40 bg-forge-cyan/5 p-2'
                : 'border-forge-border hover:border-forge-cyan/30 p-12'
            }`}
          >
            {mainImage ? (
              <div className="relative w-full">
                <img src={mainImage} alt="主图" className="w-full max-h-80 object-contain rounded-lg" />
                <button
                  onClick={e => { e.stopPropagation(); setMainImage(null); }}
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <>
                <Upload size={32} className="text-forge-text2/40 mb-2" />
                <span className="text-sm text-forge-text2">拖拽或点击上传主图</span>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />

          {/* Angle Presets */}
          <h3 className="font-display text-sm font-semibold text-forge-text flex items-center gap-2 mt-4">
            <Layers size={14} className="text-forge-cyan" /> 选择视角 ({selectedAngles.size})
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {ANGLE_PRESETS.map(angle => (
              <button
                key={angle.name}
                onClick={() => toggleAngle(angle.name)}
                className={`p-3 rounded-lg text-left text-sm transition-all ${
                  selectedAngles.has(angle.name)
                    ? 'bg-forge-cyan/10 border border-forge-cyan/30 text-forge-cyan'
                    : 'bg-forge-surface2 border border-forge-border text-forge-text2 hover:border-forge-cyan/20'
                }`}
              >
                <span className="mr-2">{angle.icon}</span>
                {angle.name}
                {results.has(angle.name) && <CheckCircle2 size={12} className="inline ml-1 text-green-400" />}
              </button>
            ))}
          </div>

          <button
            onClick={handleGenerate}
            disabled={!mainImage || selectedAngles.size === 0 || generating}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-forge-cyan to-purple-500 text-forge-bg font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {generating ? (
              <><Loader2 size={16} className="animate-spin" /> {progress}</>
            ) : (
              <><Play size={16} /> 生成 {selectedAngles.size} 个视角</>
            )}
          </button>
        </div>

        {/* Right: Results */}
        <div className="glass-card p-4 space-y-3">
          <h3 className="font-display text-sm font-semibold text-forge-text flex items-center gap-2">
            <Camera size={14} className="text-forge-cyan" /> 生成结果 ({results.size})
          </h3>

          {results.size === 0 ? (
            <div className="text-center py-16 text-forge-text2/50 text-sm">
              {generating ? (
                <Loader2 size={28} className="mx-auto mb-2 animate-spin" />
              ) : (
                <Camera size={28} className="mx-auto mb-2 opacity-40" />
              )}
              {generating ? '正在生成多视角...' : '选择视角后点击生成'}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {Array.from(results.entries()).map(([name, url]) => (
                <div key={name} className="relative group">
                  <img src={url} alt={name} className="w-full rounded-lg object-cover aspect-square" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <button
                      onClick={() => handleDownload(url, name)}
                      className="p-1.5 rounded-full bg-white/20 hover:bg-white/40 text-white"
                    >
                      <Download size={14} />
                    </button>
                  </div>
                  <span className="absolute bottom-1 left-1 text-xs px-1.5 py-0.5 rounded bg-black/60 text-white">
                    {name}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
