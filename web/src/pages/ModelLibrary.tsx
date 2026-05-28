import { useState, useRef } from 'react';
import { Users, Upload, Trash2, Edit3, X, Check, FolderUp, Search, ImagePlus, ZoomIn } from 'lucide-react';
import { useModelStore } from '@/store/useModelStore';
import type { ModelEntry } from '@/types/tryon-types';
import { saveImage, loadImage } from '@/services/imageStore';
import { ImageZoomModal } from '@/components/ImageZoomModal';

function genId() { return `model_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

async function compressPreview(file: File): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(300 / img.width, 300 / img.height, 1);
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.6));
    };
    img.onerror = () => resolve('');
    img.src = URL.createObjectURL(file);
  });
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

export function ModelLibrary() {
  const { models, addModel, updateModel, removeModel } = useModelStore();
  const [filter, setFilter] = useState<'all' | 'tops' | 'bottoms'>('all');
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '', tags: '', category: 'tops' as ModelEntry['category'] });
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceFileRef = useRef<HTMLInputElement>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [zoomSrc, setZoomSrc] = useState('');
  const [zoomTitle, setZoomTitle] = useState('');

  const filtered = models.filter((m) => {
    if (filter === 'tops' && m.category === 'bottoms') return false;
    if (filter === 'bottoms' && m.category === 'tops') return false;
    if (search && !m.name.includes(search) && !m.description.includes(search)) return false;
    return true;
  });

  const handleUpload = async (files: FileList) => {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      const previewUrl = await compressPreview(file);
      const modelId = genId();
      const cat: ModelEntry['category'] = file.name.includes('下装') || file.name.includes('下') ? 'bottoms' : file.name.includes('上装') || file.name.includes('上') ? 'tops' : 'both';
      // 原图存入 IndexedDB
      const fullDataUrl = await fileToDataUrl(file);
      await saveImage(`model_full_${modelId}`, fullDataUrl);
      addModel({
        id: modelId, name: file.name.replace(/\.[^.]+$/, ''), category: cat,
        previewUrl, originalName: file.name, size: file.size,
        description: '', tags: [], createdAt: new Date().toISOString(),
      });
    }
  };

  const handleReplaceImage = async (modelId: string, file: File) => {
    if (!file.type.startsWith('image/')) return;
    const previewUrl = await compressPreview(file);
    const fullDataUrl = await fileToDataUrl(file);
    await saveImage(`model_full_${modelId}`, fullDataUrl);
    updateModel(modelId, {
      previewUrl, originalName: file.name, size: file.size,
    });
    setReplacingId(null);
  };

  const handleZoom = async (model: ModelEntry) => {
    // 优先加载 IndexedDB 原图，没有就用缩略图
    const full = await loadImage(`model_full_${model.id}`);
    setZoomSrc(full || model.previewUrl);
    setZoomTitle(model.name);
  };

  const startEdit = (m: ModelEntry) => {
    setEditingId(m.id);
    setEditForm({ name: m.name, description: m.description, tags: m.tags.join(', '), category: m.category });
  };

  const saveEdit = () => {
    if (!editingId) return;
    updateModel(editingId, {
      name: editForm.name, description: editForm.description,
      tags: editForm.tags.split(',').map((t) => t.trim()).filter(Boolean),
      category: editForm.category,
    });
    setEditingId(null);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center"><Users size={20} className="text-forge-bg" /></div>
          <div><h2 className="font-display text-lg font-bold text-gradient-cyan tracking-wider">模特库</h2><p className="text-xs text-forge-text2">{models.length} 位模特 · 管理参考图</p></div>
        </div>
        <button onClick={() => fileRef.current?.click()} className="orange-btn px-4 py-2 rounded-lg text-sm flex items-center gap-2">
          <Upload size={14} />上传模特
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && handleUpload(e.target.files)} />
        <input ref={replaceFileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f && replacingId) handleReplaceImage(replacingId, f); }} />
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex gap-1 p-0.5 glass-card rounded-lg">
          {[{ v: 'all' as const, l: '全部' }, { v: 'tops' as const, l: '上装' }, { v: 'bottoms' as const, l: '下装' }].map((item) => (
            <button key={item.v} onClick={() => setFilter(item.v)} className={`px-3 py-1.5 rounded-md text-xs transition-all ${filter === item.v ? 'bg-forge-cyan/15 text-forge-cyan font-medium' : 'text-forge-text2 hover:text-forge-text'}`}>{item.l}</button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-forge-text2/40" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索模特..." className="input-field !pl-8 !py-1.5 text-xs w-full" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {filtered.map((m) => (
          <div key={m.id} className="glass-card overflow-hidden hover:border-forge-cyan/30 transition-all group">
            <div className="aspect-[3/4] bg-forge-surface2/50 flex items-center justify-center relative cursor-pointer" onClick={() => handleZoom(m)}>
              {m.previewUrl ? (
                <img src={m.previewUrl} alt={m.name} className="w-full h-full object-cover" />
              ) : (
                <Users size={32} className="text-forge-text2/20" />
              )}
              {/* Hover overlay with zoom icon */}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center pointer-events-none">
                <ZoomIn size={24} className="text-white opacity-0 group-hover:opacity-100 transition-all" />
              </div>
              {/* Action buttons */}
              <div className="absolute top-1 right-1 flex gap-1">
                <button onClick={(e) => { e.stopPropagation(); startEdit(m); }} className="p-1.5 rounded-full bg-forge-bg/90 text-forge-cyan hover:bg-forge-cyan hover:text-forge-bg transition-all shadow" title="编辑"><Edit3 size={12} /></button>
                <button onClick={(e) => { e.stopPropagation(); setReplacingId(m.id); replaceFileRef.current?.click(); }} className="p-1.5 rounded-full bg-forge-bg/90 text-forge-orange hover:bg-forge-orange hover:text-forge-bg transition-all shadow" title="更换图片"><ImagePlus size={12} /></button>
                <button onClick={(e) => { e.stopPropagation(); removeModel(m.id); }} className="p-1.5 rounded-full bg-forge-bg/90 text-forge-red hover:bg-forge-red hover:text-forge-bg transition-all shadow" title="删除"><Trash2 size={12} /></button>
              </div>
              <span className="absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded bg-forge-surface/80 text-forge-text2">{m.category === 'tops' ? '上装' : m.category === 'bottoms' ? '下装' : '通用'}</span>
            </div>
            <div className="p-3">
              {editingId === m.id ? (
                <div className="space-y-2">
                  <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="input-field !py-1 text-xs w-full" placeholder="名称" />
                  <input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className="input-field !py-1 text-xs w-full" placeholder="描述" />
                  <input value={editForm.tags} onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })} className="input-field !py-1 text-xs w-full" placeholder="标签(逗号分隔)" />
                  <select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value as ModelEntry['category'] })} className="input-field !py-1 text-xs w-full">
                    <option value="tops">上装</option><option value="bottoms">下装</option><option value="both">通用</option>
                  </select>
                  <div className="flex gap-1">
                    <button onClick={saveEdit} className="flex-1 px-2 py-1 rounded bg-forge-cyan/20 text-forge-cyan text-xs flex items-center justify-center gap-1"><Check size={12} />保存</button>
                    <button onClick={() => setEditingId(null)} className="flex-1 px-2 py-1 rounded bg-forge-red/10 text-forge-red text-xs flex items-center justify-center gap-1"><X size={12} />取消</button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-xs text-forge-text font-medium truncate">{m.name}</p>
                  {m.description && <p className="text-[10px] text-forge-text2/60 truncate mt-0.5">{m.description}</p>}
                  {m.tags.length > 0 && <div className="flex flex-wrap gap-1 mt-1">{m.tags.slice(0, 3).map((t) => <span key={t} className="text-[9px] px-1 py-0.5 rounded bg-forge-surface2/60 text-forge-text2/50">{t}</span>)}</div>}
                  <button onClick={(e) => { e.stopPropagation(); handleZoom(m); }} className="mt-2 text-[10px] text-forge-cyan hover:underline flex items-center gap-1"><ZoomIn size={10} />查看原图</button>
                </>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full py-12 text-center text-forge-text2/40">
            <FolderUp size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">暂无模特</p>
            <p className="text-xs mt-1">点击"上传模特"添加参考图</p>
          </div>
        )}
      </div>

      {/* Zoom Modal */}
      <ImageZoomModal open={!!zoomSrc} onClose={() => setZoomSrc('')} src={zoomSrc} title={zoomTitle} />
    </div>
  );
}
