import { useState, useRef, useCallback, useEffect } from 'react';
import { BookTemplate, Plus, Trash2, Edit3, X, Check, ImageIcon, FolderUp, Upload, ZoomIn, Wand2, Loader2 } from 'lucide-react';
import { useTemplateStore } from '@/store/useTemplateStore';
import { useAppStore } from '@/store/useAppStore';
import { useLlmStore } from '@/store/useLlmStore';
import type { TemplateEntry, TemplateRefImage } from '@/types/tryon-types';
import { ImageZoomModal } from '@/components/ImageZoomModal';
import { saveImage, loadImage } from '@/services/imageStore';
import { analyzeSingleRefImage, analyzeSingleDetailRefImage } from '@/services/llmService';

function genId() { return `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

function compressThumb(file: File): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(200 / img.width, 200 / img.height, 1);
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.55));
    };
    img.onerror = () => resolve('');
    img.src = URL.createObjectURL(file);
  });
}

/** Save full-resolution image (1024px) to IndexedDB for later viewing */
async function saveFullRes(file: File): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1024 / img.width, 1024 / img.height, 1);
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve('');
    img.src = URL.createObjectURL(file);
  });
}

const TYPE_LABELS: Record<TemplateEntry['type'], string> = { main: '主图模板', pose: '姿势裂变', detail: '详情页' };
const TYPE_ICONS: Record<TemplateEntry['type'], string> = { main: '📷', pose: '🕺', detail: '📋' };

export function TemplateLibrary() {
  const { templates, addTemplate, updateTemplate, removeTemplate } = useTemplateStore();
  const addToast = useAppStore((s) => s.addToast);
  const getVisionModel = useLlmStore((s) => s.getVisionModel);
  const [tab, setTab] = useState<TemplateEntry['type']>('main');
  const [garmentTab, setGarmentTab] = useState<TemplateEntry['garmentCategory']>('tops');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', promptTemplate: '' });
  const [uploadedRefs, setUploadedRefs] = useState<TemplateRefImage[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const refsRef = useRef<TemplateRefImage[]>([]);  // always reflects latest uploadedRefs
  useEffect(() => { refsRef.current = uploadedRefs; }, [uploadedRefs]);
  const [zoomSrc, setZoomSrc] = useState('');
  const [zoomTitle, setZoomTitle] = useState('');

  const filtered = templates.filter((t) => t.type === tab && t.garmentCategory === garmentTab);

  const resetForm = () => {
    setForm({ name: '', description: '', promptTemplate: '' });
    setUploadedRefs([]);
    setEditingId(null);
  };

  const closeForm = () => {
    // Revoke blob URLs before closing
    uploadedRefs.forEach(ref => {
      if (ref.dataUrl && ref.dataUrl.startsWith('blob:')) {
        URL.revokeObjectURL(ref.dataUrl);
      }
    });
    setShowAdd(false);
    setEditingId(null);
    setForm({ name: '', description: '', promptTemplate: '' });
    setUploadedRefs([]);
  };

  const handleSave = () => {
    if (!form.name.trim()) { addToast('warning', '请输入模板名称'); return; }
    const now = new Date().toISOString();
    const refsToSave = [...uploadedRefs];
    if (editingId) {
      updateTemplate(editingId, {
        name: form.name, description: form.description, promptTemplate: form.promptTemplate,
        updatedAt: now,
        refImages: refsToSave,
      });
    } else {
      addTemplate({
        id: genId(), name: form.name, type: tab, garmentCategory: garmentTab,
        description: form.description, promptTemplate: form.promptTemplate,
        refImages: refsToSave,
        createdAt: now, updatedAt: now,
      });
    }
    resetForm();
    closeForm();
    // Auto-trigger batch reverse prompt for templates with reference images
    const refsWithoutPrompt = refsToSave.filter(r => !r.prompt);
    if (refsWithoutPrompt.length > 0) {
      addToast('info', `自动为 ${refsWithoutPrompt.length} 张参考图生成预设提示词...`);
      setTimeout(() => batchAnalyzeRefPrompts(refsWithoutPrompt), 300);
    }
  };

  const startEdit = (t: TemplateEntry) => {
    setEditingId(t.id);
    setForm({ name: t.name, description: t.description, promptTemplate: t.promptTemplate });
    setUploadedRefs([...t.refImages]);
  };

  const handleRefUpload = async (files: FileList) => {
    const fileArr = Array.from(files);
    if (fileArr.length === 0) return;
    const invalidFiles = fileArr.filter(f => !f.type.startsWith('image/'));
    if (invalidFiles.length > 0) {
      addToast('warning', `${invalidFiles.length} 个非图片文件已跳过`);
    }
    const validFiles = fileArr.filter(f => f.type.startsWith('image/'));
    if (validFiles.length === 0) return;

    const newRefs: TemplateRefImage[] = [];
    for (const file of validFiles) {
      const dataUrl = await compressThumb(file);
      const refId = genId();
      // Save full-resolution version to IndexedDB
      saveFullRes(file).then((fullB64) => {
        if (fullB64) saveImage(`tpl_ref_${refId}`, fullB64);
      });
      newRefs.push({ id: refId, name: file.name, size: file.size, dataUrl });
    }
    setUploadedRefs((prev) => [...prev, ...newRefs]);
    addToast('success', `已添加 ${newRefs.length} 张参考图`);
  };

  /** Batch reverse-analyze: chunk 3 images per call, model sees all → can differentiate */
  const [batchAnalyzing, setBatchAnalyzing] = useState(false);
  const batchAnalyzeRefPrompts = useCallback(async (refsOverride?: TemplateRefImage[]) => {
    const visionModel = getVisionModel();
    if (!visionModel) { addToast('warning', '请先在系统设置中启用多模态模型'); return; }

    const refs = refsOverride || refsRef.current;
    if (refs.length === 0) { addToast('warning', '请先上传参考图'); return; }

    setBatchAnalyzing(true);
    const analyzeFn = tab === 'detail' ? analyzeSingleDetailRefImage : analyzeSingleRefImage;
    let ok = 0;

    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i];
      const full = await loadImage(`tpl_ref_${ref.id}`);
      const b64 = full || ref.dataUrl;
      console.log(`[TemplateLib] 反推第 ${i + 1}/${refs.length} 张, id=${ref.id}, name=${ref.name}, full=${!!full}, b64Len=${b64.length}`);

      try {
        const prompt = await analyzeFn(visionModel, b64);
        console.log(`[TemplateLib] 第 ${i + 1} 张完成, promptLen=${prompt?.length || 0}, first80=${prompt?.slice(0, 80)}`);
        if (prompt) {
          ok++;
        }
        setUploadedRefs(prev => prev.map(r => r.id === ref.id && prompt ? { ...r, prompt } : r));
        addToast('info', `${i + 1}/${refs.length} 完成`);
      } catch (e) {
        console.error(`[TemplateLib] ref ${i + 1} failed:`, e);
        addToast('error', `${i + 1}/${refs.length} 失败: ${e instanceof Error ? e.message.slice(0, 120) : '网络错误'}`);
      }
    }

    if (ok > 0) {
      addToast('success', `批量反推完成: ${ok}/${refs.length} 张`);
    } else {
      addToast('error', '所有批次均失败，请检查多模态模型配置');
    }
    setBatchAnalyzing(false);
  }, [tab, getVisionModel, addToast]);

  const removeRef = (id: string) => {
    setUploadedRefs((prev) => prev.filter((r) => r.id !== id));
  };

  const updateRefPrompt = (id: string, prompt: string) => {
    setUploadedRefs((prev) => prev.map((r) => r.id === id ? { ...r, prompt } : r));
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-teal-500 flex items-center justify-center"><BookTemplate size={20} className="text-forge-bg" /></div>
          <div><h2 className="font-display text-lg font-bold text-gradient-cyan tracking-wider">模板库</h2><p className="text-xs text-forge-text2">{templates.length} 个模板</p></div>
        </div>
        <button onClick={() => { setShowAdd(true); setEditingId(null); resetForm(); }} className="orange-btn px-4 py-2 rounded-lg text-sm flex items-center gap-2"><Plus size={14} />新增模板</button>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex gap-1 p-0.5 glass-card rounded-lg">
          {(Object.entries(TYPE_LABELS) as [TemplateEntry['type'], string][]).map(([k, v]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-md text-xs transition-all ${tab === k ? 'bg-forge-cyan/15 text-forge-cyan font-medium' : 'text-forge-text2 hover:text-forge-text'}`}>{TYPE_ICONS[k]} {v}</button>
          ))}
        </div>
        <div className="flex gap-1 p-0.5 glass-card rounded-lg">
          <button onClick={() => setGarmentTab('tops')} className={`px-3 py-1.5 rounded-md text-xs transition-all ${garmentTab === 'tops' ? 'bg-forge-orange/15 text-forge-orange font-medium' : 'text-forge-text2 hover:text-forge-text'}`}>上装</button>
          <button onClick={() => setGarmentTab('bottoms')} className={`px-3 py-1.5 rounded-md text-xs transition-all ${garmentTab === 'bottoms' ? 'bg-forge-orange/15 text-forge-orange font-medium' : 'text-forge-text2 hover:text-forge-text'}`}>下装</button>
        </div>
      </div>

      {/* Add/Edit Form */}
      {(showAdd || editingId) && (
        <div className="glass-card p-4 border border-forge-cyan/30 animate-slide-up space-y-3">
          <h3 className="text-sm text-forge-cyan font-medium">{editingId ? '编辑模板' : `新增${garmentTab==='tops'?'上装':'下装'}${TYPE_LABELS[tab]}`}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="模板名称" className="input-field !py-1.5 text-xs" />
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="模板描述" className="input-field !py-1.5 text-xs" />
          </div>
          <textarea value={form.promptTemplate} onChange={(e) => setForm({ ...form, promptTemplate: e.target.value })} placeholder="生图提示词模板（支持 {sku} 变量）" className="input-field !py-2 text-xs w-full min-h-[80px]" />

          {/* Reference Images Upload */}
          <div>
            <label className="text-xs text-forge-text2 mb-2 block">
              参考图 ({uploadedRefs.length} 张)
              {tab !== 'main' && <span className="text-forge-orange ml-1">— 1:1对应生成</span>}
            </label>
            <div className="grid grid-cols-1 gap-3 mb-2">
              {uploadedRefs.map((ref, idx) => (
                <div key={ref.id} className="flex gap-3 items-start p-2 rounded-lg border border-forge-border/20 bg-forge-surface1/30 group">
                  <div className="relative flex-shrink-0">
                    <img src={ref.dataUrl} alt={ref.name} className="w-16 h-20 object-cover rounded border border-forge-border/30 cursor-pointer hover:border-forge-cyan/50 transition-colors" onClick={async (e) => { e.stopPropagation(); const full = await loadImage(`tpl_ref_${ref.id}`); setZoomSrc(full || ref.dataUrl); setZoomTitle(ref.name); }} title="点击放大" />
                    <span className="absolute bottom-0 left-0 right-0 text-[8px] text-center bg-black/50 text-white rounded-b py-0.5">#{idx+1}</span>
                    <button onClick={() => removeRef(ref.id)} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-forge-red/80 text-white hidden group-hover:flex items-center justify-center"><X size={8} /></button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-forge-text2/70 truncate mb-1" title={ref.name}>{ref.name}</p>
                    <textarea
                      value={ref.prompt || ''}
                      onChange={(e) => updateRefPrompt(ref.id, e.target.value)}
                      placeholder="图片预设提示词（AI批量反推后自动填充，也可手动编辑）"
                      className="input-field !py-1 text-[10px] w-full resize-none"
                      rows={2}
                    />
                    {ref.prompt && (
                      <p className="text-[8px] text-forge-text2/40 mt-0.5 text-right">{ref.prompt.length} 字</p>
                    )}
                  </div>
                </div>
              ))}
              <button onClick={() => fileRef.current?.click()} className="w-full min-h-[64px] border-2 border-dashed border-forge-border/40 rounded-lg flex items-center justify-center gap-2 hover:border-forge-cyan/30 transition-colors group">
                <Upload size={14} className="text-forge-text2/30 group-hover:text-forge-cyan/40" />
                <span className="text-[10px] text-forge-text2/30">上传更多参考图</span>
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && handleRefUpload(e.target.files)} />
            {tab === 'main' && uploadedRefs.length > 0 && <p className="text-[10px] text-forge-green">主图模板参考图为可选</p>}
            {tab !== 'main' && uploadedRefs.length > 0 && <p className="text-[10px] text-forge-green">✅ 生图时这 {uploadedRefs.length} 张参考图将 1:1 生成</p>}
          </div>

          <div className="flex gap-2">
            <button onClick={handleSave} className="px-4 py-1.5 rounded-lg bg-forge-cyan/20 text-forge-cyan text-xs flex items-center gap-1"><Check size={12} />保存</button>
            {uploadedRefs.length > 0 && (
              <button onClick={() => batchAnalyzeRefPrompts()} disabled={batchAnalyzing}
                className="px-4 py-1.5 rounded-lg bg-purple-500/15 text-purple-300 border border-purple-400/30 text-xs flex items-center gap-1 disabled:opacity-50">
                {batchAnalyzing ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                {batchAnalyzing ? '反推中...' : '批量反推'}
              </button>
            )}
            <button onClick={closeForm} className="px-4 py-1.5 rounded-lg bg-forge-red/10 text-forge-red text-xs flex items-center gap-1"><X size={12} />取消</button>
          </div>
        </div>
      )}

      {/* Template Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((t) => (
          <div key={t.id} className="glass-card p-4 hover:border-forge-cyan/30 transition-all">
            <div className="flex items-start justify-between mb-2">
              <div>
                <h3 className="text-sm text-forge-text font-medium">{t.name}</h3>
                <p className="text-[10px] text-forge-text2/60 mt-0.5">{t.description}</p>
              </div>
              <div className="flex gap-1">
                <button onClick={() => startEdit(t)} className="p-1.5 rounded text-forge-text2/40 hover:text-forge-cyan"><Edit3 size={12} /></button>
                <button onClick={() => { if (confirm('确认删除此模板？')) removeTemplate(t.id); }} className="p-1.5 rounded text-forge-text2/40 hover:text-forge-red"><Trash2 size={12} /></button>
              </div>
            </div>

            {/* Ref image thumbnails */}
            {t.refImages.length > 0 && (
              <div className="flex gap-1 mb-2 overflow-x-auto pb-1">
                {t.refImages.slice(0, 8).map((ref, idx) => (
                  <img key={ref.id} src={ref.dataUrl} alt={ref.name} className="w-10 h-12 object-cover rounded border border-forge-border/20 flex-shrink-0 cursor-pointer hover:border-forge-cyan/50" title={`#${idx+1}: ${ref.name} — 点击放大`} onClick={() => { setZoomSrc(ref.dataUrl); setZoomTitle(`${t.name} #${idx+1}`); }} />
                ))}
                {t.refImages.length > 8 && <span className="text-[10px] text-forge-text2/40 self-end pb-1">+{t.refImages.length - 8}</span>}
              </div>
            )}

            <div className="text-[10px] text-forge-text2/50 mb-2 flex items-center gap-2 flex-wrap">
              <span className="px-1.5 py-0.5 rounded bg-forge-surface2">{TYPE_ICONS[t.type]} {TYPE_LABELS[t.type]}</span>
              <span className="px-1.5 py-0.5 rounded bg-forge-surface2">{t.garmentCategory === 'tops' ? '上装' : '下装'}</span>
              <span className="flex items-center gap-1"><ImageIcon size={10} />{t.refImages.length} 参考图</span>
            </div>

            <p className="text-[10px] text-forge-text2/70 bg-forge-surface2/50 p-2 rounded line-clamp-2 font-mono">{t.promptTemplate || '(无提示词模板)'}</p>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full py-12 text-center text-forge-text2/40">
            <FolderUp size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">暂无{garmentTab==='tops'?'上装':'下装'}{TYPE_LABELS[tab]}</p>
            <p className="text-xs mt-1">点击"新增模板"上传参考图并创建</p>
          </div>
        )}
      </div>

      <ImageZoomModal open={!!zoomSrc} onClose={() => setZoomSrc('')} src={zoomSrc} title={zoomTitle} />
    </div>
  );
}
