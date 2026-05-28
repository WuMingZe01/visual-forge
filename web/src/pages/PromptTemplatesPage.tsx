import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Plus, Trash2, Save, Copy, Check, Wand2, LibraryBig } from 'lucide-react';

interface PromptTemplate {
  id: string;
  name: string;
  type: 'tryon' | 'detail';
  content: string;
  createdAt: string;
}

const LS_KEY = 'vf-prompt-templates-v2';

function loadTemplates(): PromptTemplate[] { try { const r = localStorage.getItem(LS_KEY); return r ? JSON.parse(r) : []; } catch { return []; } }
function saveTemplates(t: PromptTemplate[]) { localStorage.setItem(LS_KEY, JSON.stringify(t)); }

function genId() { return `pt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

const DEFAULTS: PromptTemplate[] = [
  { id: 'builtin-tryon-1', name: '服装主图标准', type: 'tryon', content: 'Professional fashion model photography, soft diffused studio lighting 5500K, seamless white background, product clearly visible, front-facing pose showing full garment detail, clean commercial photography style', createdAt: '' },
  { id: 'builtin-tryon-2', name: '细节特写主图', type: 'tryon', content: 'Extreme close-up macro shot of fabric texture and stitching detail, shallow depth of field, soft directional lighting, showing premium material quality, professional product photography', createdAt: '' },
  { id: 'builtin-detail-1', name: '电商详情信息图', type: 'detail', content: 'E-commerce product detail infographic, vertical mobile layout, clean white background, professional typography, left-right composition with product image and feature labels, modern minimalist design', createdAt: '' },
  { id: 'builtin-detail-2', name: '材质成分展示', type: 'detail', content: 'Fabric and composition showcase infographic, zoomed product texture with callout annotations and percentage breakdowns, clean layout with iconography, e-commerce professional style', createdAt: '' },
];

export function PromptTemplatesPage() {
  const [templates, setTemplates] = useState<PromptTemplate[]>(() => {
    const saved = loadTemplates();
    return saved.length > 0 ? saved : [...DEFAULTS];
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'tryon' | 'detail'>('all');
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => { saveTemplates(templates); }, [templates]);

  const addNew = () => {
    const t: PromptTemplate = { id: genId(), name: '新模板', type: 'tryon', content: '', createdAt: new Date().toISOString() };
    setTemplates([t, ...templates]);
    setEditingId(t.id);
  };

  const remove = (id: string) => {
    setTemplates(prev => prev.filter(t => t.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const update = (id: string, updates: Partial<PromptTemplate>) => {
    setTemplates(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const copyContent = async (content: string) => {
    await navigator.clipboard.writeText(content);
    setCopied(content);
    setTimeout(() => setCopied(null), 2000);
  };

  const filtered = filter === 'all' ? templates : templates.filter(t => t.type === filter);
  const builtInIds = DEFAULTS.map(d => d.id);

  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-forge-cyan to-forge-orange flex items-center justify-center">
            <LibraryBig size={20} className="text-forge-bg" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-gradient-cyan tracking-wider">提示词模板库</h2>
            <p className="text-xs text-forge-text2">预设提示词管理 · 主图/详情页一键复用</p>
          </div>
        </div>
        <button onClick={addNew} className="gradient-btn px-4 py-2 rounded-lg text-xs flex items-center gap-1.5">
          <Plus size={14} />新建模板
        </button>
      </div>

      <div className="flex gap-2">
        {(['all', 'tryon', 'detail'] as const).map(k => (
          <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 rounded-lg text-xs transition-all ${filter === k ? 'bg-forge-cyan/15 text-forge-cyan border border-forge-cyan/30' : 'bg-forge-surface2/50 text-forge-text2 border border-forge-border/30 hover:border-forge-cyan/30'}`}>
            {k === 'all' ? '全部' : k === 'tryon' ? '主图模板' : '详情页模板'}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <FileText size={48} className="mx-auto text-forge-text2/10 mb-4" />
          <p className="text-forge-text2 text-sm">暂无模板</p>
          <button onClick={addNew} className="gradient-btn px-4 py-2 rounded-lg text-xs mt-4">创建第一个</button>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(tpl => (
            <div key={tpl.id} className="glass-card overflow-hidden border border-forge-border/40">
              <div className="flex items-center gap-3 p-3.5 cursor-pointer" onClick={() => setEditingId(editingId === tpl.id ? null : tpl.id)}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${tpl.type === 'tryon' ? 'bg-forge-cyan/10 text-forge-cyan' : 'bg-forge-orange/10 text-forge-orange'}`}>
                  <FileText size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-forge-text font-medium truncate">{tpl.name}</p>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${tpl.type === 'tryon' ? 'bg-forge-cyan/10 text-forge-cyan' : 'bg-forge-orange/10 text-forge-orange'}`}>
                      {tpl.type === 'tryon' ? '主图' : '详情页'}
                    </span>
                    {builtInIds.includes(tpl.id) && <span className="text-[9px] text-forge-text2/40">内置</span>}
                  </div>
                  <p className="text-[10px] text-forge-text2 truncate mt-0.5">{tpl.content.slice(0, 80)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={(e) => { e.stopPropagation(); copyContent(tpl.content); }} className="p-1.5 rounded text-forge-text2/40 hover:text-forge-cyan hover:bg-forge-surface2" title="复制">
                    {copied === tpl.content ? <Check size={14} className="text-forge-green" /> : <Copy size={14} />}
                  </button>
                  {!builtInIds.includes(tpl.id) && (
                    <button onClick={(e) => { e.stopPropagation(); remove(tpl.id); }} className="p-1.5 rounded text-forge-text2/30 hover:text-forge-red transition-colors"><Trash2 size={14} /></button>
                  )}
                </div>
              </div>

              {editingId === tpl.id && (
                <div className="border-t border-forge-border/30 p-4 animate-slide-up space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-forge-text2 block mb-1">模板名称</label>
                      <input value={tpl.name} onChange={e => update(tpl.id, { name: e.target.value })} className="input-field !py-1.5 text-xs"
                        disabled={builtInIds.includes(tpl.id)} />
                    </div>
                    <div>
                      <label className="text-[10px] text-forge-text2 block mb-1">分类</label>
                      <select value={tpl.type} onChange={e => update(tpl.id, { type: e.target.value as 'tryon' | 'detail' })} className="input-field !py-1.5 text-xs"
                        disabled={builtInIds.includes(tpl.id)}>
                        <option value="tryon">主图提示词</option>
                        <option value="detail">详情页提示词</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-forge-text2 block mb-1">提示词内容</label>
                    <textarea
                      value={tpl.content}
                      onChange={e => update(tpl.id, { content: e.target.value })}
                      className="textarea-field !min-h-[100px] text-xs font-mono"
                      disabled={builtInIds.includes(tpl.id)}
                      placeholder="输入英文生图提示词..."
                    />
                  </div>
                  {builtInIds.includes(tpl.id) && (
                    <p className="text-[10px] text-forge-text2/50">💡 内置模板不可编辑，点击右上角复制按钮复制后新建模板即可修改</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="glass-card p-4 text-xs text-forge-text2 space-y-2">
        <p className="font-medium text-forge-cyan">📖 使用说明</p>
        <ul className="list-disc list-inside space-y-1 text-forge-text2/70">
          <li>内置 4 个默认模板（2 个主图 + 2 个详情页），点击复制按钮即可复制到剪贴板</li>
          <li>新建模板可自定义名称和分类（主图/详情页）</li>
          <li>在主图或详情页生成时，可将此处模板作为提示词基础使用</li>
          <li>所有模板保存在浏览器本地存储中</li>
        </ul>
      </div>
    </div>
  );
}
