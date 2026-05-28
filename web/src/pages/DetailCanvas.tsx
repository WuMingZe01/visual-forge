import { LayoutTemplate, Download, Play, Upload, X, Loader2, Sparkles, AlertTriangle, ImagePlus, Plus, StopCircle } from 'lucide-react';
import { useTryOnStore } from '@/store/useTryOnStore';
import { useTaskHistoryStore } from '@/store/useTaskHistoryStore';
import type { DetailSection } from '@/types/tryon-types';
import type { TaskRecord } from '@/store/useTaskHistoryStore';
import { generateTryOnImage } from '@/services/tryonApi';
import { useState, useRef } from 'react';

function genId() { return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

export function DetailCanvas() {
  const detailSections = useTryOnStore((s) => s.detailSections);
  const updateDetailSection = useTryOnStore((s) => s.updateDetailSection);
  const tryOnParams = useTryOnStore((s) => s.tryOnParams);
  const skuInfo = useTryOnStore((s) => s.skuInfo);
  const addTask = useTaskHistoryStore((s) => s.addTask);
  const updateTask = useTaskHistoryStore((s) => s.updateTask);

  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [manualImages, setManualImages] = useState<{ id: string; previewUrl: string; name: string }[]>([]);

  const handleUploadManual = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 10 * 1024 * 1024) { alert('文件最大 10MB'); return; }
    setManualImages(prev => [...prev, { id: genId(), previewUrl: URL.createObjectURL(file), name: file.name }].slice(0, 10));
  };

  const handleGenerateSingle = async (section: DetailSection) => {
    setGeneratingIds(prev => new Set(prev).add(section.id));
    updateDetailSection(section.id, { status: 'generating' });
    setErrors(prev => { const next = { ...prev }; delete next[section.id]; return next; });

    const modelId = tryOnParams.model === 'custom' ? 'gpt-image-2' : tryOnParams.model;
    const taskId = genId();
    const task: TaskRecord = {
      id: taskId, type: 'detail', skuCode: skuInfo?.skuCode || '', productName: skuInfo?.productName || '',
      modelId, provider: modelId.startsWith('nano-banana') || modelId === 'gpt-image-2-vip' ? 'grsai' : 'yunwu',
      prompt: section.templateText,
      params: { sectionTitle: section.title, sectionDesc: section.description },
      status: 'generating', progress: 0, resultUrls: [], referenceUrls: [], error: '', createdAt: new Date().toISOString(),
    };
    addTask(task);

    try {
      let ctx = '';
      if (skuInfo) ctx = `Product: ${skuInfo.productName}. ${skuInfo.composition || ''} ${skuInfo.fabricIntro?.slice(0, 60) || ''}`;
      const prompt = `E-commerce product detail infographic. ${section.title}. ${section.templateText}. ${ctx} Vertical mobile layout, 2:3 aspect ratio.`;
      const realUrl = await generateTryOnImage({ prompt, width: 2448, height: 3264, modelId });
      updateDetailSection(section.id, { generatedImageUrl: realUrl, status: 'done' });
      updateTask(taskId, { status: 'completed', progress: 100, resultUrls: [realUrl], prompt, completedAt: new Date().toISOString() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '失败';
      updateDetailSection(section.id, { status: 'idle' });
      setErrors(prev => ({ ...prev, [section.id]: msg }));
      updateTask(taskId, { status: 'failed', error: msg, completedAt: new Date().toISOString() });
    } finally {
      setGeneratingIds(prev => { const next = new Set(prev); next.delete(section.id); return next; });
    }
  };

  const [allGenerating, setAllGenerating] = useState(false);
  const allAbortRef = useRef(false);

  const handleGenerateAll = async () => {
    setAllGenerating(true);
    allAbortRef.current = false;
    const pending = detailSections.filter(s => s.status !== 'done');
    const concurrency = 3;
    let idx = 0;

    const worker = async () => {
      while (idx < pending.length && !allAbortRef.current) {
        const section = pending[idx++];
        await handleGenerateSingle(section);
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => worker()));
    setAllGenerating(false);
  };
  const doneCount = detailSections.filter(s => s.status === 'done').length;

  const handleExportLongImage = async () => {
    const doneSections = detailSections.filter(s => s.status === 'done' && s.generatedImageUrl);
    if (doneSections.length === 0) return;

    const canvasW = 1080;
    const canvasH = 1920;
    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d')!;

    // 白色背景
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasW, canvasH);

    const perH = canvasH / doneSections.length;

    try {
      const imgs = await Promise.all(
        doneSections.map((s) =>
          new Promise<{ img: HTMLImageElement; title: string }>((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve({ img, title: s.title });
            img.onerror = () => reject(new Error(`加载失败: ${s.title}`));
            img.src = s.generatedImageUrl!;
          })
        )
      );

      for (let i = 0; i < imgs.length; i++) {
        const { img, title } = imgs[i];
        const y = i * perH;
        // 居中缩放（contain 模式）
        const scale = Math.min(canvasW / img.width, perH / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        const dx = (canvasW - dw) / 2;
        const dy = y + (perH - dh) / 2;
        ctx.fillStyle = '#f5f5f5';
        ctx.fillRect(0, y, canvasW, perH);
        ctx.drawImage(img, dx, dy, dw, dh);
        // 标题
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(8, y + 8, ctx.measureText(title).width + 24, 28);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(title, 20, y + 28);
      }

      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `detail-${skuInfo?.skuCode || 'export'}-${doneSections.length}p.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('导出失败: ' + (e instanceof Error ? e.message : '图片加载失败'));
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-forge-cyan to-forge-orange flex items-center justify-center"><LayoutTemplate size={20} className="text-forge-bg" /></div>
          <div><h2 className="font-display text-lg font-bold text-gradient-cyan tracking-wider">详情页生成</h2><p className="text-xs text-forge-text2">独立生成电商详情页模块</p></div>
        </div>
        <div className="flex items-center gap-2">
          {allGenerating ? (
            <button onClick={() => { allAbortRef.current = true; setAllGenerating(false); }} className="px-4 py-2 rounded-lg text-sm flex items-center gap-2 bg-forge-red/15 text-forge-red border border-forge-red/30 hover:bg-forge-red/20"><StopCircle size={14} />终止生成</button>
          ) : (
            <button onClick={handleGenerateAll} disabled={detailSections.length === 0} className="gradient-btn px-4 py-2 rounded-lg text-sm flex items-center gap-2"><Play size={14} />一键生成全部 ({doneCount}/{detailSections.length})</button>
          )}
        </div>
      </div>

      <div className="glass-card p-4">
        <h3 className="text-xs text-forge-text2 mb-2 flex items-center gap-1.5"><ImagePlus size={13} />手动上传参考图</h3>
        <div className="flex items-center gap-3 flex-wrap">
          {manualImages.map(img => (
            <div key={img.id} className="relative inline-flex">
              <img src={img.previewUrl} alt="" className="w-16 h-20 object-cover rounded-lg border border-forge-border/40" />
              <button onClick={() => setManualImages(prev => prev.filter(i => i.id !== img.id))} className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-forge-red/80 text-white flex items-center justify-center"><X size={10} /></button>
            </div>
          ))}
          <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { const f = inp.files?.[0]; if (f) handleUploadManual(f); }; inp.click(); }} className="w-16 h-20 rounded-lg border-2 border-dashed border-forge-border/40 flex items-center justify-center hover:border-forge-cyan/40 transition-colors">
            <Plus size={16} className="text-forge-text2/40" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {detailSections.map(section => {
          const isGen = generatingIds.has(section.id) || section.status === 'generating';
          return (
            <div key={section.id} className="glass-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded bg-forge-cyan/15 text-forge-cyan text-[10px] font-bold flex items-center justify-center">{section.sortOrder + 1}</span>
                  <input value={section.title} onChange={e => updateDetailSection(section.id, { title: e.target.value })} className="input-field !py-1.5 text-sm font-medium" />
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${section.status === 'done' ? 'bg-forge-green/20 text-forge-green' : isGen ? 'bg-forge-cyan/20 text-forge-cyan' : 'bg-forge-surface2 text-forge-text2'}`}>
                  {section.status === 'done' ? '已完成' : isGen ? '生成中' : '待生成'}
                </span>
              </div>
              <p className="text-xs text-forge-text2">{section.description}</p>
              <div><label className="text-[10px] text-forge-text2/60 block mb-1">模板提示词</label><textarea value={section.templateText} onChange={e => updateDetailSection(section.id, { templateText: e.target.value })} className="textarea-field !min-h-[60px] !py-2 text-xs" rows={2} /></div>
              {errors[section.id] && <div className="p-2 rounded bg-forge-red/10 border border-forge-red/20 text-forge-red text-[10px] flex items-start gap-1"><AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />{errors[section.id]}</div>}
              <div className="flex items-center gap-2">
                <button onClick={() => handleGenerateSingle(section)} disabled={isGen} className="gradient-btn px-3 py-1.5 rounded-lg text-[10px] flex items-center gap-1 disabled:opacity-50 ml-auto">
                  {isGen ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}生成此页
                </button>
              </div>
              {section.generatedImageUrl && (
                <div className="relative group">
                  <img src={section.generatedImageUrl} alt="" className="w-full aspect-[3/4] object-cover rounded-lg border border-forge-border/30" />
                  <a href={section.generatedImageUrl} download={`detail-${section.sortOrder + 1}.png`} target="_blank" rel="noreferrer" className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"><Download size={14} /></a>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="glass-card p-4">
        <h3 className="section-title flex items-center gap-2 mb-3">预览拼接区 (9:16)</h3>
        <div className="max-w-[300px] mx-auto aspect-[9/16] border-2 border-dashed border-forge-border/40 rounded-2xl overflow-y-auto p-2 space-y-1 bg-forge-bg/50">
          {detailSections.filter(s => s.status === 'done').map(s => (
            <div key={s.id} className="relative"><span className="absolute top-1 left-1 bg-forge-cyan/80 text-forge-bg text-[10px] px-1.5 py-0.5 rounded font-bold z-10">{s.sortOrder + 1}. {s.title}</span><img src={s.generatedImageUrl} alt="" className="w-full object-cover rounded" /></div>
          ))}
          {doneCount === 0 && <div className="flex items-center justify-center h-full"><p className="text-forge-text2/30 text-xs">生成模块后将在此拼接预览</p></div>}
        </div>
        <button onClick={handleExportLongImage} disabled={doneCount === 0} className="gradient-btn w-full mt-4 px-6 py-3 rounded-lg text-sm flex items-center justify-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"><Download size={16} />导出详情长图 ({doneCount} 模块)</button>
      </div>
    </div>
  );
}
