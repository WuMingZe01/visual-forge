import { useState } from 'react';
import { Sparkles, Image as ImageIcon, Loader2, BookOpen, LibraryBig, Trash2, RotateCcw, Clock, Search } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { useTaskHistoryStore } from '@/store/useTaskHistoryStore';
import type { TaskRecord } from '@/store/useTaskHistoryStore';
import { ModelSelector } from '@/components/studio/ModelSelector';
import { StylePicker } from '@/components/studio/StylePicker';
import { PromptWorkspace } from '@/components/studio/PromptWorkspace';
import { AspectRatioPanel } from '@/components/studio/AspectRatioPanel';
import { AdvancedControls } from '@/components/studio/AdvancedControls';
import { ReferencePanel } from '@/components/studio/ReferencePanel';
import { generateImage } from '@/services/api';
import { STYLE_PRESETS } from '@/data/constants';
import { formatDate, truncateText } from '@/utils/helpers';
import type { GenerateTask, StylePreset } from '@/types';

type TabId = 'studio' | 'styles' | 'history';

export function GeneralStudio() {
  const [tab, setTab] = useState<TabId>('studio');
  const { chinesePrompt, englishPrompt, addToast, addToQueue, updateTaskStatus, updateTaskProgress, taskQueue } = useAppStore();
  const { tasks, addTask, updateTask } = useTaskHistoryStore();
  const [isGenerating, setIsGenerating] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleGenerate = async () => {
    const task = addToQueue();
    if (!task) { addToast('warning', '请先输入提示词'); return; }
    setIsGenerating(true);
    updateTaskStatus(task.id, 'generating');
    const t: TaskRecord = { id: task.id, type: 'general', skuCode: '', productName: task.chinesePrompt || task.englishPrompt, modelId: task.model.id, provider: task.model.provider, prompt: task.englishPrompt || task.chinesePrompt, params: { aspect: task.aspectPreset.label, resolution: task.resolution, style: task.stylePreset?.name || '' }, status: 'generating', progress: 0, resultUrls: [], referenceUrls: [], error: '', createdAt: new Date().toISOString() };
    addTask(t);
    try {
      updateTaskProgress(task.id, 10);
      const urls = await generateImage(useAppStore.getState().config, task);
      updateTaskProgress(task.id, 100);
      updateTaskStatus(task.id, 'completed', urls);
      updateTask(task.id, { status: 'completed', progress: 100, resultUrls: urls, completedAt: new Date().toISOString() });
      addToast('success', '生成成功！');
    } catch (error) {
      const msg = error instanceof Error ? error.message : '未知错误';
      updateTaskStatus(task.id, 'failed', undefined, msg);
      updateTask(task.id, { status: 'failed', error: msg, completedAt: new Date().toISOString() });
      addToast('error', `生成失败: ${msg}`);
    } finally { setIsGenerating(false); }
  };

  const tabs: { id: TabId; label: string; icon: typeof Sparkles }[] = [
    { id: 'studio', label: '自由生图', icon: Sparkles },
    { id: 'styles', label: '风格库', icon: BookOpen },
    { id: 'history', label: '历史记录', icon: LibraryBig },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-forge-cyan to-forge-orange flex items-center justify-center"><Sparkles size={20} className="text-forge-bg" /></div>
        <div><h2 className="font-display text-lg font-bold text-gradient-cyan tracking-wider">通用生图</h2><p className="text-xs text-forge-text2">自由提示词 + 风格库 + 历史记录</p></div>
      </div>

      <div className="flex gap-1 p-1 glass-card rounded-xl">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm transition-all ${tab === t.id ? 'bg-forge-surface2 text-forge-cyan shadow-[0_0_10px_rgba(0,229,255,0.1)]' : 'text-forge-text2 hover:text-forge-text'}`}>
            <t.icon size={16} />{t.label}
          </button>
        ))}
      </div>

      {tab === 'studio' && (
        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
          <div className="space-y-4">
            <ModelSelector /><StylePicker /><AspectRatioPanel /><PromptWorkspace /><AdvancedControls /><ReferencePanel />
            <button onClick={handleGenerate} disabled={isGenerating || (!chinesePrompt.trim() && !englishPrompt.trim())} className="orange-btn w-full py-3 rounded-lg text-sm flex items-center justify-center gap-2 disabled:opacity-50">
              {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {isGenerating ? '生成中...' : '开始生成'}
            </button>
          </div>
          <div className="glass-card p-4">
            <h3 className="section-title mb-3">生成结果</h3>
            {taskQueue.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16"><ImageIcon size={40} className="text-forge-text2/15 mb-3" /><p className="text-forge-text2 text-sm">还没有生成任务</p></div>
            ) : (
              <div className="space-y-3">
                {taskQueue.map(task => (
                  <div key={task.id} className="glass-card-hover border border-forge-border/40 p-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-lg bg-forge-surface2 flex items-center justify-center overflow-hidden flex-shrink-0">
                        {task.status === 'completed' && task.resultUrls.length > 0 ? <img src={task.resultUrls[0]} alt="" className="w-full h-full object-cover" /> : <ImageIcon size={20} className="text-forge-text2/30" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${task.status === 'completed' ? 'bg-forge-green/10 text-forge-green' : task.status === 'failed' ? 'bg-forge-red/10 text-forge-red' : 'bg-forge-cyan/10 text-forge-cyan'}`}>
                            {task.status === 'completed' ? '已完成' : task.status === 'failed' ? '失败' : task.status === 'generating' ? '生成中' : '等待中'}
                          </span>
                          <span className="text-[10px] text-forge-text2">{task.model.name}</span>
                        </div>
                        <p className="text-xs text-forge-text truncate mt-1">{task.chinesePrompt || task.englishPrompt || '无描述'}</p>
                      </div>
                    </div>
                    {task.status === 'completed' && task.resultUrls.length > 0 && (
                      <div className="mt-3 grid grid-cols-2 gap-2">{task.resultUrls.map((url, i) => <img key={i} src={url} alt="" className="w-full aspect-square object-cover rounded-lg border border-forge-border/30" />)}</div>
                    )}
                    {task.status === 'failed' && task.error && <p className="mt-2 text-[10px] text-forge-red">{task.error}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'styles' && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {STYLE_PRESETS.map(s => (
            <div key={s.id} className="glass-card p-3 group cursor-pointer hover:border-forge-cyan/30 transition-all">
              <div className={`h-20 rounded-lg mb-2 bg-gradient-to-br ${s.colorGradient || 'from-forge-surface2 to-forge-border'} flex items-center justify-center`}>
                <span className="text-white/40 text-xs uppercase tracking-widest font-display">{s.name.slice(0, 2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-forge-text font-medium truncate">{s.name}</p>
                <span className="text-[9px] px-1 py-0.5 rounded bg-forge-surface2 text-forge-text2">{s.category === 'cover' ? '封面' : s.category === 'infographic' ? '信息图' : s.category === 'freeform' ? '自由' : 'PPT'}</span>
              </div>
              <p className="text-[10px] text-forge-text2/60 mt-1 line-clamp-2">{s.modifier || s.keywords.join(', ')}</p>
            </div>
          ))}
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-forge-text2/50" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索历史..." className="input-field !py-2 pl-9 text-xs max-w-xs" />
          </div>
          {tasks.filter(t => t.type === 'general').length === 0 ? (
            <div className="glass-card p-10 text-center"><p className="text-forge-text2 text-sm">暂无通用生图历史</p></div>
          ) : (
            tasks.filter(t => t.type === 'general').filter(t => {
              if (!search) return true;
              const q = search.toLowerCase();
              return t.productName.toLowerCase().includes(q) || t.modelId.toLowerCase().includes(q) || t.prompt.toLowerCase().includes(q);
            }).map(task => (
              <div key={task.id} className="glass-card-hover p-3 cursor-pointer" onClick={() => setExpandedId(expandedId === task.id ? null : task.id)}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded bg-forge-surface2 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {task.resultUrls.length > 0 ? <img src={task.resultUrls[0]} alt="" className="w-full h-full object-cover" /> : <ImageIcon size={16} className="text-forge-text2/30" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-forge-text truncate">{task.productName || task.prompt || '无描述'}</p>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-forge-text2">
                      <span>{task.modelId}</span><span>·</span><span>{formatDate(task.createdAt)}</span>
                      <span className={`ml-auto px-1 py-0.5 rounded ${task.status === 'completed' ? 'bg-forge-green/10 text-forge-green' : 'bg-forge-red/10 text-forge-red'}`}>
                        {task.status === 'completed' ? '成功' : '失败'}
                      </span>
                    </div>
                  </div>
                </div>
                {expandedId === task.id && (
                  <div className="mt-2 pt-2 border-t border-forge-border/30 animate-slide-up space-y-2">
                    {task.prompt && <pre className="p-2 rounded bg-forge-surface2 text-[10px] text-forge-text2 whitespace-pre-wrap max-h-24 overflow-y-auto">{task.prompt}</pre>}
                    {task.resultUrls.length > 0 && <div className="grid grid-cols-2 gap-1.5">{task.resultUrls.map((url, i) => <img key={i} src={url} alt="" className="w-full aspect-square object-cover rounded border border-forge-border/30" />)}</div>}
                    {task.error && <p className="text-[10px] text-forge-red">{task.error}</p>}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
