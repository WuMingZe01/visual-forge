import { useState, useRef } from 'react';
import { BookTemplate, Plus, Trash2, Edit3, X, Check, ImageIcon, FolderUp, Upload, ZoomIn } from 'lucide-react';
import { useTemplateStore } from '@/store/useTemplateStore';
import type { TemplateEntry, TemplateRefImage } from '@/types/tryon-types';
import { ImageZoomModal } from '@/components/ImageZoomModal';

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

const TYPE_LABELS: Record<TemplateEntry['type'], string> = { main: '主图模板', pose: '姿势裂变', detail: '详情页' };
const TYPE_ICONS: Record<TemplateEntry['type'], string> = { main: '📷', pose: '🕺', detail: '📋' };

export function TemplateLibrary() {
  const { templates, addTemplate, updateTemplate, removeTemplate } = useTemplateStore();
  const [tab, setTab] = useState<TemplateEntry['type']>('main');
  const [garmentTab, setGarmentTab] = useState<TemplateEntry['garmentCategory']>('tops');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', promptTemplate: '' });
  const [uploadedRefs, setUploadedRefs] = useState<TemplateRefImage[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [zoomSrc, setZoomSrc] = useState('');
  const [zoomTitle, setZoomTitle] = useState('');

  const filtered = templates.filter((t) => t.type === tab && t.garmentCategory === garmentTab);

  const resetForm = () => {
    setForm({ name: '', description: '', promptTemplate: '' });
    setUploadedRefs([]);
    setShowAdd(false);
    setEditingId(null);
  };

  const handleSave = () => {
    if (!form.name.trim()) return;
    const now = new Date().toISOString();
    if (editingId) {
      updateTemplate(editingId, {
        name: form.name, description: form.description, promptTemplate: form.promptTemplate,
        updatedAt: now,
        ...(uploadedRefs.length > 0 ? { refImages: uploadedRefs } : {}),
      });
    } else {
      addTemplate({
        id: genId(), name: form.name, type: tab, garmentCategory: garmentTab,
        description: form.description, promptTemplate: form.promptTemplate,
        refImages: uploadedRefs,
        createdAt: now, updatedAt: now,
      });
    }
    resetForm();
  };

  const startEdit = (t: TemplateEntry) => {
    setEditingId(t.id);
    setForm({ name: t.name, description: t.description, promptTemplate: t.promptTemplate });
    setUploadedRefs([...t.refImages]);
  };

  const handleRefUpload = async (files: FileList) => {
    const newRefs: TemplateRefImage[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      const dataUrl = await compressThumb(file);
      newRefs.push({
        id: genId(), name: file.name, size: file.size, dataUrl,
      });
    }
    setUploadedRefs((prev) => [...prev, ...newRefs]);
  };

  const removeRef = (id: string) => {
    setUploadedRefs((prev) => prev.filter((r) => r.id !== id));
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
            <div className="flex flex-wrap gap-2 mb-2">
              {uploadedRefs.map((ref, idx) => (
                <div key={ref.id} className="relative group">
                  <img src={ref.dataUrl} alt={ref.name} className="w-16 h-20 object-cover rounded border border-forge-border/30 cursor-pointer hover:border-forge-cyan/50 transition-colors" onClick={(e) => { e.stopPropagation(); setZoomSrc(ref.dataUrl); setZoomTitle(ref.name); }} title="点击放大" />
                  <span className="absolute bottom-0 left-0 right-0 text-[8px] text-center bg-black/50 text-white rounded-b py-0.5">#{idx+1}</span>
                  <button onClick={() => removeRef(ref.id)} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-forge-red/80 text-white hidden group-hover:flex items-center justify-center"><X size={8} /></button>
                </div>
              ))}
              <button onClick={() => fileRef.current?.click()} className="w-16 h-20 border-2 border-dashed border-forge-border/40 rounded flex flex-col items-center justify-center hover:border-forge-cyan/30 transition-colors group">
                <Upload size={14} className="text-forge-text2/30 group-hover:text-forge-cyan/40" />
                <span className="text-[9px] text-forge-text2/30 mt-0.5">上传</span>
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && handleRefUpload(e.target.files)} />
            {tab === 'main' && uploadedRefs.length > 0 && <p className="text-[10px] text-forge-green">主图模板参考图为可选</p>}
            {tab !== 'main' && uploadedRefs.length > 0 && <p className="text-[10px] text-forge-green">✅ 生图时这 {uploadedRefs.length} 张参考图将 1:1 生成</p>}
          </div>

          <div className="flex gap-2">
            <button onClick={handleSave} className="px-4 py-1.5 rounded-lg bg-forge-cyan/20 text-forge-cyan text-xs flex items-center gap-1"><Check size={12} />保存</button>
            <button onClick={resetForm} className="px-4 py-1.5 rounded-lg bg-forge-red/10 text-forge-red text-xs flex items-center gap-1"><X size={12} />取消</button>
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
                <button onClick={() => removeTemplate(t.id)} className="p-1.5 rounded text-forge-text2/40 hover:text-forge-red"><Trash2 size={12} /></button>
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
