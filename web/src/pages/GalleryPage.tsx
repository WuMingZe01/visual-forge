import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/useAppStore';
import { STYLE_PRESETS } from '@/data/constants';
import { formatDate, truncateText, getStatusLabel } from '@/utils/helpers';
import type { StylePreset } from '@/types';
import {
  Sparkles, Clock, Trash2, FileEdit, Search, RotateCcw,
  ChevronDown, ChevronUp, X, Image, LibraryBig,
} from 'lucide-react';

type TabId = 'styles' | 'drafts' | 'history';
type StyleCategory = 'cover' | 'infographic' | 'freeform' | 'ppt';
type StyleCategoryFilter = 'all' | StyleCategory;
type HistoryStatusFilter = 'all' | 'completed' | 'failed';

const TABS: { id: TabId; label: string }[] = [
  { id: 'styles', label: '风格库' },
  { id: 'drafts', label: '草稿箱' },
  { id: 'history', label: '历史记录' },
];

const CATEGORY_FILTERS: { value: StyleCategoryFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'cover', label: '封面' },
  { value: 'infographic', label: '信息图' },
  { value: 'freeform', label: '自由生图' },
  { value: 'ppt', label: 'PPT' },
];

const STATUS_FILTERS: { value: HistoryStatusFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' },
];

const CATEGORY_META: Record<StyleCategory, { label: string; badgeClass: string }> = {
  cover: { label: '封面', badgeClass: 'bg-forge-cyan/15 text-forge-cyan border-forge-cyan/30' },
  infographic: { label: '信息图', badgeClass: 'bg-forge-orange/15 text-forge-orange border-forge-orange/30' },
  freeform: { label: '自由生图', badgeClass: 'bg-purple-400/15 text-purple-300 border-purple-400/30' },
  ppt: { label: 'PPT', badgeClass: 'bg-forge-green/15 text-forge-green border-forge-green/30' },
};

const filterBtnClass = (active: boolean) =>
  `px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
    active ? 'bg-forge-cyan/15 text-forge-cyan border-forge-cyan/40'
    : 'bg-forge-surface2/50 text-forge-text2 border-forge-border/40 hover:border-forge-cyan/30'}`;

export function GalleryPage() {
  const [activeTab, setActiveTab] = useState<TabId>('styles');
  const [categoryFilter, setCategoryFilter] = useState<StyleCategoryFilter>('all');
  const [expandedStyleId, setExpandedStyleId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>('all');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const drafts = useAppStore((s) => s.drafts);
  const taskHistory = useAppStore((s) => s.taskHistory);
  const loadDraft = useAppStore((s) => s.loadDraft);
  const deleteDraft = useAppStore((s) => s.deleteDraft);
  const addToast = useAppStore((s) => s.addToast);
  const navigate = useNavigate();

  const filteredStyles = categoryFilter === 'all'
    ? STYLE_PRESETS : STYLE_PRESETS.filter((s) => s.category === categoryFilter);

  const filteredHistory = taskHistory.filter((t) => {
    const ms = statusFilter === 'all' || t.status === statusFilter;
    const q = searchQuery.toLowerCase();
    const mq = !q || t.chinesePrompt.toLowerCase().includes(q)
      || t.englishPrompt.toLowerCase().includes(q) || t.model.name.toLowerCase().includes(q);
    return ms && mq;
  });

  const handleLoadDraft = (draftId: string) => {
    const draft = drafts.find((d) => d.id === draftId);
    if (!draft) return;
    loadDraft(draft);
    addToast('info', `已加载草稿：${draft.name}`);
    navigate('/');
  };

  const resetExpand = () => { setExpandedStyleId(null); setExpandedTaskId(null); };

  return (
    <div className="animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-forge-cyan to-blue-500 flex items-center justify-center">
          <Sparkles size={16} className="text-forge-bg" />
        </div>
        <h1 className="font-display text-lg font-bold tracking-wider text-gradient-cyan">灵感画廊</h1>
      </div>

      <div className="flex gap-1 mb-6 border-b border-forge-border/40">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); resetExpand(); }}
            className={`relative px-5 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab.id ? 'text-forge-cyan' : 'text-forge-text2 hover:text-forge-text'}`}
          >
            {tab.label}
            {activeTab === tab.id && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-forge-cyan rounded-full" />}
          </button>
        ))}
      </div>

      {activeTab === 'styles' && (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {CATEGORY_FILTERS.map((f) => (
              <button key={f.value} onClick={() => setCategoryFilter(f.value)}
                className={filterBtnClass(categoryFilter === f.value)}>{f.label}</button>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredStyles.map((style) => (
              <StyleCard key={style.id} style={style}
                expanded={expandedStyleId === style.id}
                onToggle={() => setExpandedStyleId(expandedStyleId === style.id ? null : style.id)} />
            ))}
          </div>
        </div>
      )}

      {activeTab === 'drafts' && (
        <div className="space-y-3">
          {drafts.length === 0 ? (
            <div className="glass-card p-10 text-center">
              <LibraryBig size={40} className="mx-auto text-forge-text2/40 mb-3" />
              <p className="text-forge-text2 text-sm">暂无草稿，在主图工作台保存配置后这里会出现</p>
            </div>
          ) : drafts.map((draft) => (
            <div key={draft.id} className="glass-card-hover p-4 flex items-center gap-4">
              <div className="w-16 h-16 rounded-lg bg-forge-surface2 border border-forge-border/30 flex-shrink-0 flex items-center justify-center overflow-hidden">
                {draft.task.resultUrls.length > 0
                  ? <img src={draft.task.resultUrls[0]} alt="" className="w-full h-full object-cover" />
                  : <Image size={24} className="text-forge-text2/40" />}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-forge-text font-medium text-sm truncate">{draft.name}</h3>
                <div className="flex items-center gap-1.5 mt-1 text-forge-text2 text-xs">
                  <Clock size={12} /><span>{formatDate(draft.savedAt)}</span>
                </div>
                <p className="text-forge-text2 text-xs mt-1.5 truncate">
                  {truncateText(draft.task.chinesePrompt || draft.task.englishPrompt || '无描述', 50)}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  {draft.task.stylePreset && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-forge-cyan/10 text-forge-cyan border border-forge-cyan/20">
                      {draft.task.stylePreset.name}</span>)}
                  <span className="text-[10px] text-forge-text2">{draft.task.model.name}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => handleLoadDraft(draft.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-forge-cyan/15 text-forge-cyan text-xs font-medium hover:bg-forge-cyan/25 transition-colors">
                  <FileEdit size={13} />加载</button>
                {deleteConfirmId === draft.id ? (
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => { deleteDraft(draft.id); setDeleteConfirmId(null); addToast('info', '草稿已删除'); }}
                      className="px-2.5 py-1.5 rounded-lg bg-forge-red/20 text-forge-red text-xs font-medium hover:bg-forge-red/30 transition-colors">确认</button>
                    <button onClick={() => setDeleteConfirmId(null)} className="p-1.5 rounded-lg text-forge-text2 hover:text-forge-text transition-colors"><X size={14} /></button>
                  </div>
                ) : (
                  <button onClick={() => setDeleteConfirmId(draft.id)} className="p-1.5 rounded-lg text-forge-text2 hover:text-forge-red hover:bg-forge-red/10 transition-colors"><Trash2 size={15} /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-forge-text2" />
              <input type="text" placeholder="搜索生成历史..." value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)} className="input-field pl-9" />
            </div>
            <div className="flex gap-2">
              {STATUS_FILTERS.map((f) => (
                <button key={f.value} onClick={() => setStatusFilter(f.value)}
                  className={filterBtnClass(statusFilter === f.value)}>{f.label}</button>))}
            </div>
          </div>
          {filteredHistory.length === 0 ? (
            <div className="glass-card p-10 text-center">
              <Search size={40} className="mx-auto text-forge-text2/40 mb-3" />
              <p className="text-forge-text2 text-sm">{taskHistory.length === 0 ? '暂无生成历史' : '没有匹配的记录'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredHistory.map((task) => (
                <HistoryCard key={task.id} task={task} expanded={expandedTaskId === task.id}
                  onToggle={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
                  onRetry={() => addToast('info', '重试功能开发中...')} />))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StyleCard({ style, expanded, onToggle }: { style: StylePreset; expanded: boolean; onToggle: () => void }) {
  return (
    <div onClick={onToggle} className={`glass-card-hover p-4 cursor-pointer group ${expanded ? 'neon-glow' : ''}`}>
      <div className={`w-full h-28 rounded-lg bg-gradient-to-br ${style.colorGradient || 'from-forge-surface2 to-forge-border'} mb-3 flex items-center justify-center overflow-hidden`}>
        <div className="text-white/70 text-xs font-display tracking-wider uppercase">{style.name.slice(0, 2)}</div>
      </div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-forge-text text-sm font-medium truncate">{style.name}</h3>
        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${CATEGORY_META[style.category].badgeClass}`}>
          {CATEGORY_META[style.category].label}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {style.keywords.slice(0, 3).map((kw) => (
          <span key={kw} className="text-[10px] px-1.5 py-0.5 rounded bg-forge-surface2 text-forge-text2">{kw}</span>))}
      </div>
      {expanded && (
        <div className="mt-3 pt-3 border-t border-forge-border/30 animate-slide-up">
          <p className="text-forge-text2 text-xs leading-relaxed">{style.modifier || '自由风格，无预设修饰词'}</p>
          <div className="flex items-center gap-2 mt-2 text-[10px] text-forge-text2"><span>默认比例: {style.ratio}</span></div>
          <div className="flex items-center justify-center mt-2 text-forge-cyan"><ChevronUp size={14} /></div>
        </div>
      )}
      {!expanded && <div className="flex justify-center mt-2 text-forge-text2 opacity-0 group-hover:opacity-100 transition-opacity"><ChevronDown size={14} /></div>}
    </div>
  );
}

function HistoryCard({ task, expanded, onToggle, onRetry }: { task: import('@/types').GenerateTask; expanded: boolean; onToggle: () => void; onRetry: () => void }) {
  const completed = task.status === 'completed';
  return (
    <div onClick={onToggle} className={`glass-card-hover p-4 cursor-pointer ${expanded ? 'neon-glow' : ''}`}>
      <div className="w-full h-32 rounded-lg bg-forge-surface2 border border-forge-border/30 mb-3 flex items-center justify-center overflow-hidden">
        {completed && task.resultUrls.length > 0
          ? <img src={task.resultUrls[0]} alt="" className="w-full h-full object-cover" />
          : <Image size={28} className="text-forge-text2/30" />}
      </div>
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
          completed ? 'bg-forge-green/15 text-forge-green border border-forge-green/30'
          : 'bg-forge-red/15 text-forge-red border border-forge-red/30'}`}>{getStatusLabel(task.status)}</span>
        <span className="text-[10px] text-forge-text2">{formatDate(task.createdAt)}</span>
      </div>
      <p className="text-forge-text text-xs mb-1.5 line-clamp-2">
        {truncateText(task.chinesePrompt || task.englishPrompt, 80)}</p>
      <div className="flex items-center gap-1.5 text-[10px] text-forge-text2">
        <span className="px-1.5 py-0.5 rounded bg-forge-surface2">{task.model.name}</span>
        <span>{task.aspectPreset.ratio}</span>
      </div>
      {expanded && (
        <div className="mt-3 pt-3 border-t border-forge-border/30 animate-slide-up space-y-2" onClick={(e) => e.stopPropagation()}>
          <div className="text-forge-text2 text-xs space-y-1">
            <p><span className="text-forge-text2/60">模型：</span>{task.model.name}</p>
            <p><span className="text-forge-text2/60">尺寸：</span>{task.aspectPreset.label} ({task.resolution})</p>
            {task.stylePreset && <p><span className="text-forge-text2/60">风格：</span>{task.stylePreset.name}</p>}
            <p><span className="text-forge-text2/60">中文描述：</span>{task.chinesePrompt || '-'}</p>
            <p><span className="text-forge-text2/60">英文描述：</span>{task.englishPrompt || '-'}</p>
            {task.error && <p className="text-forge-red text-xs">错误：{task.error}</p>}
          </div>
          {task.resultUrls.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5 mt-2">
              {task.resultUrls.map((url, i) => (
                <img key={i} src={url} alt={`结果 ${i + 1}`} className="rounded-lg border border-forge-border/30 w-full h-20 object-cover" />))}
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button onClick={onRetry}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-forge-cyan/15 text-forge-cyan text-xs font-medium hover:bg-forge-cyan/25 transition-colors">
              <RotateCcw size={12} />重试</button>
            <button onClick={onToggle} className="flex items-center justify-center w-full p-1 text-forge-cyan"><ChevronUp size={16} /></button>
          </div>
        </div>
      )}
      {!expanded && <div className="flex justify-center mt-2 text-forge-text2 opacity-0 group-hover:opacity-100 transition-opacity"><ChevronDown size={14} /></div>}
    </div>
  );
}
