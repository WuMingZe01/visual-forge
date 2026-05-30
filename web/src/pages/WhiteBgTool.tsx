import { useState, useRef, useCallback } from 'react';
import { Upload, X, Download, Play, Trash2, Loader2, CheckCircle2, ImageIcon, FolderDown } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';

interface ProcessItem {
  id: string;
  file: File;
  previewUrl: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
  resultUrl: string;
  error: string;
}

function genId() { return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

/** 客户端 Canvas 白底处理：检测主体边缘，替换背景为纯白 */
async function processWhiteBg(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { data } = imageData;

      // 采样四角获取背景色参考
      const corners = [
        [0, 0], [canvas.width - 1, 0],
        [0, canvas.height - 1], [canvas.width - 1, canvas.height - 1],
      ];
      const bgSamples: [number, number, number][] = [];
      for (const [x, y] of corners) {
        const idx = (y * canvas.width + x) * 4;
        bgSamples.push([data[idx], data[idx + 1], data[idx + 2]]);
      }
      const avgBg = bgSamples.reduce(
        (acc, [r, g, b]) => [acc[0] + r / bgSamples.length, acc[1] + g / bgSamples.length, acc[2] + b / bgSamples.length],
        [0, 0, 0]
      );

      // 颜色距离阈值（宽松匹配，覆盖阴影/渐变）
      const threshold = 80;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const dist = Math.sqrt(
          (r - avgBg[0]) ** 2 + (g - avgBg[1]) ** 2 + (b - avgBg[2]) ** 2
        );
        if (dist < threshold) {
          data[i] = 255;
          data[i + 1] = 255;
          data[i + 2] = 255;
        }
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片加载失败')); };
    img.src = url;
  });
}

export function WhiteBgTool() {
  const addToast = useAppStore((s) => s.addToast);
  const [items, setItems] = useState<ProcessItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const abortRef = useRef(false);

  const handleUpload = useCallback((files: FileList | null) => {
    if (!files) return;
    const newItems: ProcessItem[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      if (file.size > 100 * 1024 * 1024) { addToast('warning', `${file.name} 超过100MB，已跳过`); continue; }
      newItems.push({
        id: genId(), file, previewUrl: URL.createObjectURL(file),
        status: 'pending', resultUrl: '', error: '',
      });
    }
    setItems((prev) => [...prev, ...newItems]);
  }, [addToast]);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => {
      const item = prev.find(i => i.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      if (item?.resultUrl) URL.revokeObjectURL(item.resultUrl);
      return prev.filter(i => i.id !== id);
    });
  }, []);

  const clearAll = useCallback(() => {
    if (isRunning) return;
    items.forEach(i => {
      if (i.previewUrl) URL.revokeObjectURL(i.previewUrl);
      if (i.resultUrl) URL.revokeObjectURL(i.resultUrl);
    });
    setItems([]);
  }, [items, isRunning]);

  const handleRun = async () => {
    const pending = items.filter(i => i.status !== 'done');
    if (pending.length === 0) { addToast('warning', '没有待处理的图片'); return; }

    setIsRunning(true);
    abortRef.current = false;
    let processed = 0;

    for (const item of pending) {
      if (abortRef.current) break;
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: 'processing' as const } : i)));

      try {
        const resultUrl = await processWhiteBg(item.file);
        if (abortRef.current) break;
        setItems((prev) => prev.map((i) =>
          i.id === item.id ? { ...i, status: 'done' as const, resultUrl } : i
        ));
        processed++;
      } catch (e) {
        setItems((prev) => prev.map((i) =>
          i.id === item.id ? { ...i, status: 'failed' as const, error: String(e).slice(0, 100) } : i
        ));
      }
    }

    setIsRunning(false);
    if (!abortRef.current) {
      addToast('success', `处理完成: ${processed}/${pending.length} 张`);
    }
  };

  const handleDownloadSingle = (item: ProcessItem) => {
    const a = document.createElement('a');
    a.href = item.resultUrl;
    a.download = item.file.name.replace(/\.[^.]+$/, '') + '_白底.png';
    a.click();
  };

  const handleDownloadAll = () => {
    const doneItems = items.filter(i => i.status === 'done' && i.resultUrl);
    if (doneItems.length === 0) { addToast('warning', '没有可下载的结果'); return; }
    doneItems.forEach((item, idx) => {
      setTimeout(() => handleDownloadSingle(item), idx * 200);
    });
    addToast('success', `正在下载 ${doneItems.length} 张白底图...`);
  };

  const stop = () => {
    abortRef.current = true;
    setItems((prev) => prev.map((i) =>
      i.status === 'processing' ? { ...i, status: 'pending' as const } : i
    ));
    setIsRunning(false);
  };

  const doneCount = items.filter(i => i.status === 'done').length;
  const processingCount = items.filter(i => i.status === 'processing').length;
  const totalCount = items.length;

  return (
    <div className="max-w-6xl mx-auto space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-400 to-forge-cyan flex items-center justify-center">
            <ImageIcon size={20} className="text-forge-bg" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-gradient-cyan tracking-wider">白底图工具</h2>
            <p className="text-xs text-forge-text2">上传平铺商品图 → 自动抠图 → 标准白底输出</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {doneCount > 0 && (
            <button onClick={handleDownloadAll} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-forge-green hover:text-forge-cyan border border-forge-green/30 rounded-lg transition-colors">
              <Download size={13} />下载全部({doneCount})
            </button>
          )}
          <button onClick={clearAll} disabled={isRunning || totalCount === 0} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-forge-red/60 hover:text-forge-red border border-forge-red/20 rounded-lg transition-colors disabled:opacity-30">
            <Trash2 size={13} />清空
          </button>
          {isRunning ? (
            <button onClick={stop} className="px-4 py-2 rounded-lg text-sm flex items-center gap-2 bg-forge-red/15 text-forge-red border border-forge-red/30 hover:bg-forge-red/20">
              <Loader2 size={14} className="animate-spin" />终止 ({processingCount})
            </button>
          ) : (
            <button onClick={handleRun} disabled={items.filter(i => i.status !== 'done').length === 0} className="orange-btn px-4 py-2 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50">
              <Play size={14} />开始处理 ({items.filter(i => i.status !== 'done').length})
            </button>
          )}
        </div>
      </div>

      {/* Progress */}
      {isRunning && (
        <div className="glass-card p-3 border border-forge-cyan/30">
          <div className="flex items-center gap-2 text-xs text-forge-cyan">
            <Loader2 size={13} className="animate-spin" />
            <span>正在处理 {doneCount}/{totalCount} 张图片...</span>
          </div>
          <div className="w-full h-1 rounded-full bg-forge-surface2 mt-2 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-green-400 to-forge-cyan transition-all duration-500"
              style={{ width: `${totalCount > 0 ? (doneCount / totalCount) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      {/* Upload Area */}
      <div className="glass-card p-6">
        <label className="block border-2 border-dashed border-forge-border/50 rounded-2xl py-10 text-center hover:border-forge-cyan/30 transition-colors cursor-pointer group">
          <FolderDown size={32} className="mx-auto text-forge-text2/25 group-hover:text-forge-cyan/40 mb-2" />
          <p className="text-sm text-forge-text2/50">拖拽或点击上传平铺商品图</p>
          <p className="text-[10px] text-forge-text2/30 mt-1">支持 JPG/PNG/WebP，最大 100MB/张，可批量上传</p>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => handleUpload(e.target.files)}
            className="hidden"
          />
        </label>
      </div>

      {/* Results Grid */}
      {totalCount > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {items.map((item) => (
            <div key={item.id} className={`glass-card overflow-hidden border transition-all ${
              item.status === 'done' ? 'border-forge-green/30' :
              item.status === 'failed' ? 'border-forge-red/30' :
              item.status === 'processing' ? 'border-forge-cyan/30' :
              'border-forge-border/20'
            }`}>
              {/* Image */}
              <div className="aspect-square bg-forge-surface2/50 flex items-center justify-center relative group">
                {item.status === 'done' && item.resultUrl ? (
                  <img src={item.resultUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <img src={item.previewUrl} alt="" className={`w-full h-full object-cover ${item.status === 'processing' ? 'opacity-50' : ''}`} />
                )}
                {item.status === 'processing' && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                    <Loader2 size={24} className="animate-spin text-forge-cyan" />
                  </div>
                )}
                {item.status === 'done' && (
                  <button onClick={() => handleDownloadSingle(item)}
                    className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-forge-cyan"
                    title="下载">
                    <Download size={14} />
                  </button>
                )}
              </div>
              {/* Info */}
              <div className="p-2">
                <p className="text-[10px] text-forge-text2 truncate" title={item.file.name}>{item.file.name}</p>
                <div className="flex items-center gap-1 mt-1">
                  {item.status === 'pending' && <span className="text-[9px] text-forge-text2/40">待处理</span>}
                  {item.status === 'processing' && <span className="text-[9px] text-forge-cyan">处理中...</span>}
                  {item.status === 'done' && (
                    <span className="text-[9px] text-forge-green flex items-center gap-0.5"><CheckCircle2 size={8} />完成</span>
                  )}
                  {item.status === 'failed' && (
                    <span className="text-[9px] text-forge-red" title={item.error}>失败</span>
                  )}
                  {item.status !== 'processing' && (
                    <button onClick={() => removeItem(item.id)} disabled={isRunning}
                      className="ml-auto text-forge-text2/20 hover:text-forge-red disabled:opacity-20">
                      <X size={10} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
