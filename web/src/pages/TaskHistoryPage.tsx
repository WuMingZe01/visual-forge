import { useState, useMemo } from 'react';
import { History, Clock, CheckCircle, XCircle, AlertTriangle, Loader2, Trash2, ChevronDown, ChevronUp, Image, Cpu, FileText, Hash, Calendar, Search, Download, Archive, Layers, ZoomIn, StopCircle, Shield } from 'lucide-react';
import { useTaskHistoryStore, type TaskRecord } from '@/store/useTaskHistoryStore';
import { ImageCompareModal, type CompareImage } from '@/components/ImageCompareModal';
import { abortTask, isTaskRunning } from '@/services/abortRegistry';

type FilterStatus = 'all' | 'completed' | 'failed' | 'partial' | 'generating';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: typeof CheckCircle }> = {
  generating: { label: '生成中', color: 'text-forge-cyan', bg: 'bg-forge-cyan/10', icon: Loader2 },
  completed: { label: '已完成', color: 'text-forge-green', bg: 'bg-forge-green/10', icon: CheckCircle },
  failed: { label: '失败', color: 'text-forge-red', bg: 'bg-forge-red/10', icon: XCircle },
  partial: { label: '部分完成', color: 'text-forge-orange', bg: 'bg-forge-orange/10', icon: AlertTriangle },
};

async function downloadImage(url: string, filename: string) {
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = objUrl; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objUrl);
  } catch { window.open(url, '_blank'); }
}

/** 生成按SKU命名的下载文件名 */
function skuFilename(task: TaskRecord, index: number): string {
  const sku = task.skuCode || task.productName || 'img';
  const type = task.type === 'tryon' ? '主图' : task.type === 'detail' ? '详情' : '通用';
  return `${sku}_${type}_${index + 1}.png`.replace(/[\\/:*?"<>|]/g, '_');
}

async function downloadAll(task: TaskRecord) {
  for (let i = 0; i < task.resultUrls.length; i++) {
    await downloadImage(task.resultUrls[i], skuFilename(task, i));
  }
}

async function batchDownload(tasks: TaskRecord[]) {
  if (tasks.length === 0) return;
  for (const task of tasks) {
    for (let i = 0; i < task.resultUrls.length; i++) {
      await downloadImage(task.resultUrls[i], skuFilename(task, i));
    }
  }
}

export function TaskHistoryPage() {
  const tasks = useTaskHistoryStore((s) => s.tasks);
  const removeTask = useTaskHistoryStore((s) => s.removeTask);
  const clearHistory = useTaskHistoryStore((s) => s.clearHistory);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Image compare modal state
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareBefore, setCompareBefore] = useState('');
  const [compareBeforeLabel, setCompareBeforeLabel] = useState('参考原图');
  const [compareImages, setCompareImages] = useState<CompareImage[]>([]);
  const [compareIndex, setCompareIndex] = useState(0);

  const openCompare = (task: TaskRecord, startIndex: number) => {
    const before = task.referenceUrls?.[0] || '';
    setCompareBefore(before);
    setCompareBeforeLabel(task.type === 'tryon' ? '模特参考图' : '参考原图');
    setCompareImages(
      task.resultUrls.map((url, i) => ({
        url,
        label: `${task.skuCode || task.productName || '结果'} #${i + 1}`,
      }))
    );
    setCompareIndex(startIndex);
    setCompareOpen(true);
  };

  const filtered = tasks.filter(t => {
    if (filter !== 'all' && t.status !== filter) return false;
    if (search) { const q = search.toLowerCase(); return t.productName.toLowerCase().includes(q) || t.skuCode.toLowerCase().includes(q) || t.modelId.toLowerCase().includes(q) || t.prompt.toLowerCase().includes(q); }
    return true;
  });

  const grouped = useMemo(() => {
    const solo: TaskRecord[] = [];
    const batches: Map<string, { label: string; tasks: TaskRecord[] }> = new Map();
    for (const t of filtered) {
      if (t.batchId) {
        const existing = batches.get(t.batchId);
        if (existing) existing.tasks.push(t);
        else batches.set(t.batchId, { label: t.batchLabel || t.batchId, tasks: [t] });
      } else {
        solo.push(t);
      }
    }
    return { solo, batches };
  }, [filtered]);

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [expandedBatch, setExpandedBatch] = useState<Set<string>>(new Set());

  const handleDownloadAll = async (task: TaskRecord) => {
    setDownloadingId(task.id);
    await downloadAll(task);
    setDownloadingId(null);
  };

  const handleBatchDownload = async (tasks: TaskRecord[]) => {
    setDownloadingId('__batch__');
    await batchDownload(tasks);
    setDownloadingId(null);
  };

  const handleDownloadSingle = async (url: string, filename: string) => {
    setDownloadingId('__single__');
    await downloadImage(url, filename);
    setDownloadingId(null);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const selectedTasks = filtered.filter(t => selectedIds.has(t.id));
  const selectedUrls = selectedTasks.flatMap(t => t.resultUrls);

  return (
    <div className="max-w-5xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-forge-cyan to-forge-orange flex items-center justify-center"><History size={20} className="text-forge-bg" /></div>
          <div>
            <h2 className="font-display text-lg font-bold text-gradient-cyan tracking-wider">任务历史</h2>
            <p className="text-xs text-forge-text2">查看所有生图任务 · 点击图片可放大对比 · 链接有效期约48小时，请及时下载</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <>
              {selectedUrls.length > 0 && (
                <button onClick={() => handleBatchDownload(selectedTasks)} disabled={downloadingId !== null} className="gradient-btn px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 disabled:opacity-50">
                  {downloadingId === '__batch__' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}下载已选 ({selectedUrls.length} 张)
                </button>
              )}
              <button
                onClick={() => {
                  selectedIds.forEach((id) => removeTask(id));
                  setSelectedIds(new Set());
                }}
                className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 bg-forge-red/10 text-forge-red border border-forge-red/20 hover:bg-forge-red/20 transition-colors"
              >
                <Trash2 size={13} />删除已选 ({selectedIds.size})
              </button>
            </>
          )}
          {tasks.length > 0 && (
            <button onClick={clearHistory} className="text-xs text-forge-text2/50 hover:text-forge-red transition-colors flex items-center gap-1"><Trash2 size={12} />清空全部</button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-forge-text2/50" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索款号/名称/模型..." className="input-field !py-2 pl-9 text-xs" />
        </div>
        {(['all', 'generating', 'completed', 'partial', 'failed'] as FilterStatus[]).map(s => (
          <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${filter === s ? 'bg-forge-cyan/15 text-forge-cyan border border-forge-cyan/30' : 'bg-forge-surface2/50 text-forge-text2 border border-forge-border/40 hover:border-forge-cyan/30'}`}>
            {s === 'all' ? '全部' : STATUS_CONFIG[s]?.label || s}
          </button>
        ))}
      </div>

      {tasks.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <History size={48} className="mx-auto text-forge-text2/10 mb-4" />
          <p className="text-forge-text2 text-sm">暂无任务历史</p>
          <p className="text-forge-text2/40 text-xs mt-1">生成图像后，所有任务的入参和结果将出现在这里</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-12 text-center"><p className="text-forge-text2 text-sm">无匹配记录</p></div>
      ) : (
        <div className="space-y-4">
          {/* Batch Groups */}
          {[...grouped.batches.entries()].map(([batchId, { label, tasks: batchTasks }]) => {
            const isExpanded = expandedBatch.has(batchId);
            const batchDone = batchTasks.filter(t => t.status === 'completed').length;
            const batchTotal = batchTasks.length;
            const batchUrls = batchTasks.flatMap(t => t.resultUrls);
            return (
              <div key={batchId} className="glass-card overflow-hidden border border-forge-orange/20">
                <div className="flex items-center gap-3 p-3 cursor-pointer bg-forge-orange/5"
                  onClick={() => setExpandedBatch(prev => { const next = new Set(prev); if (next.has(batchId)) next.delete(batchId); else next.add(batchId); return next; })}>
                  <Layers size={16} className="text-forge-orange" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-forge-orange font-medium">批量生成</span>
                      <span className="text-[10px] text-forge-text2">{label}</span>
                    </div>
                    <p className="text-[10px] text-forge-text2/50">{batchDone}/{batchTotal} 张 · {batchUrls.length} 结果</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {batchUrls.length > 0 && (
                      <button onClick={(e) => { e.stopPropagation(); handleBatchDownload(batchTasks); }} disabled={downloadingId !== null} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-forge-cyan hover:bg-forge-cyan/10 transition-colors disabled:opacity-50" title="下载全部">
                        {downloadingId === '__batch__' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}下载全部
                      </button>
                    )}
                    {isExpanded ? <ChevronUp size={16} className="text-forge-orange" /> : <ChevronDown size={16} className="text-forge-text2/40" />}
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t border-forge-border/30">
                    {batchTasks.map(t => (
                      <TaskCard key={t.id} task={t} expanded={expandedId === t.id} selected={selectedIds.has(t.id)}
                        onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)}
                        onSelect={() => toggleSelect(t.id)}
                        onDelete={() => { removeTask(t.id); setSelectedIds(prev => { const n = new Set(prev); n.delete(t.id); return n; }); }}
                        onCompare={(idx) => openCompare(t, idx)}
                        downloadingId={downloadingId}
                        onDownloadAll={handleDownloadAll}
                        onDownloadSingle={handleDownloadSingle}
                        compact />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Solo Tasks */}
          {grouped.solo.map(task => (
            <TaskCard
              key={task.id} task={task}
              expanded={expandedId === task.id}
              selected={selectedIds.has(task.id)}
              onToggle={() => setExpandedId(expandedId === task.id ? null : task.id)}
              onSelect={() => toggleSelect(task.id)}
              onDelete={() => { removeTask(task.id); setSelectedIds(prev => { const next = new Set(prev); next.delete(task.id); return next; }); }}
              onCompare={(idx) => openCompare(task, idx)}
              downloadingId={downloadingId}
              onDownloadAll={handleDownloadAll}
              onDownloadSingle={handleDownloadSingle}
            />
          ))}
        </div>
      )}

      {/* Image Compare Modal */}
      <ImageCompareModal
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        beforeUrl={compareBefore}
        beforeLabel={compareBeforeLabel}
        images={compareImages}
        activeIndex={compareIndex}
        onDownload={(url) => downloadImage(url, 'vf-compare-download.png')}
      />
    </div>
  );
}

function TaskCard({ task, expanded, selected, onToggle, onSelect, onDelete, onCompare, downloadingId, onDownloadAll, onDownloadSingle, compact }: {
  task: TaskRecord; expanded: boolean; selected: boolean; onToggle: () => void; onSelect: () => void; onDelete: () => void; onCompare: (index: number) => void; downloadingId: string | null; onDownloadAll: (task: TaskRecord) => void; onDownloadSingle: (url: string, filename: string) => void; compact?: boolean;
}) {
  const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.failed;
  const StatusIcon = cfg.icon;
  const isGen = task.status === 'generating';

  return (
    <div className={`overflow-hidden border-b border-forge-border/10 last:border-b-0 ${selected ? 'border-forge-cyan/50 bg-forge-cyan/5' : compact ? '' : 'glass-card border border-forge-border/40'}`}>
      <div className={`flex items-center gap-2 ${compact ? 'px-3 py-2' : 'p-3'}`}>
        {!compact && (
          <button onClick={onSelect} className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-all ${selected ? 'bg-forge-cyan border-forge-cyan' : 'border-forge-border/60 hover:border-forge-cyan/40'}`}>
            {selected && <CheckCircle size={12} className="text-forge-bg" />}
          </button>
        )}
        <div className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer" onClick={onToggle}>
          <div className="w-12 h-12 rounded-lg bg-forge-surface2 flex items-center justify-center overflow-hidden flex-shrink-0">
            {task.resultUrls.length > 0 ? <img src={task.resultUrls[0]} alt="" className="w-full h-full object-cover" /> : <Image size={20} className="text-forge-text2/40" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${cfg.bg} ${cfg.color}`}>
                <StatusIcon size={10} className={isGen ? 'animate-spin' : ''} />{cfg.label}
              </span>
              {task.skuCode && <span className="text-[10px] text-forge-cyan font-mono">{task.skuCode}</span>}
              <span className="text-[10px] text-forge-text2">{task.modelId}</span>
            </div>
            <p className="text-xs text-forge-text truncate">{task.productName || task.prompt || '无描述'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isGen && (
            <div className="w-20 text-right"><div className="h-1.5 rounded-full bg-forge-surface2 overflow-hidden"><div className="h-full bg-gradient-to-r from-forge-cyan to-forge-orange transition-all" style={{ width: `${task.progress}%` }} /></div><p className="text-[10px] text-forge-text2 mt-1">{task.progress}%</p></div>
          )}
          {isGen && (
            <button onClick={(e) => { e.stopPropagation(); abortTask(task.id); }}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-forge-red hover:bg-forge-red/10 border border-forge-red/20 transition-colors" title="终止任务">
              <StopCircle size={12} />终止
            </button>
          )}
          {task.resultUrls.length > 0 && (
            <button onClick={(e) => { e.stopPropagation(); onDownloadAll(task); }} disabled={downloadingId !== null} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-forge-cyan hover:bg-forge-cyan/10 transition-colors disabled:opacity-50" title="下载全部结果">
              {downloadingId === task.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}下载
            </button>
          )}
          {expanded ? <ChevronUp size={16} className="text-forge-cyan" /> : <ChevronDown size={16} className="text-forge-text2/40" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-forge-border/30 p-4 animate-slide-up space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <Info icon={FileText} label="类型" value={task.type === 'tryon' ? '主图试衣' : task.type === 'detail' ? '详情页' : '通用生图'} />
            <Info icon={Cpu} label="引擎" value={task.provider} />
            <Info icon={Hash} label="模型" value={task.modelId} />
            <Info icon={Calendar} label="创建" value={fmt(task.createdAt)} />
            {task.completedAt && <Info icon={Clock} label="完成" value={fmt(task.completedAt)} />}
          </div>
          {task.prompt && (
            <div><p className="text-[10px] text-forge-text2/60 mb-1">入参 · Prompt</p>
              <pre className="p-2 rounded bg-forge-surface2 text-[10px] text-forge-text2 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto border border-forge-border/30">{task.prompt}</pre>
            </div>
          )}
          {Object.keys(task.params).length > 0 && (
            <div><p className="text-[10px] text-forge-text2/60 mb-1">入参 · 参数</p>
              <div className="flex flex-wrap gap-1.5">{Object.entries(task.params).map(([k, v]) => <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-forge-surface2 text-forge-text2">{k}: {String(v)}</span>)}</div>
            </div>
          )}
          {task.error && (
            <div><p className="text-[10px] text-forge-red/70 mb-1">错误信息</p><pre className="p-2 rounded bg-forge-red/5 border border-forge-red/20 text-[10px] text-forge-red font-mono whitespace-pre-wrap max-h-24 overflow-y-auto">{task.error}</pre></div>
          )}
          {task.validationReport && (
            <div><p className="text-[10px] text-forge-text2/60 mb-1 flex items-center gap-1"><Shield size={10} />Mimo 自动校验报告</p>
              <pre className={`p-2 rounded border text-[10px] font-mono whitespace-pre-wrap max-h-24 overflow-y-auto ${task.validationReport.includes('不通过') ? 'bg-forge-red/5 border-forge-red/20 text-forge-red' : 'bg-forge-green/5 border-forge-green/20 text-forge-green'}`}>{task.validationReport}</pre>
            </div>
          )}
          {task.resultUrls.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-forge-text2">生成结果 ({task.resultUrls.length} 张) <span className="text-forge-text2/40 text-[10px]">— 点击图片放大对比</span></p>
                <button onClick={() => onDownloadAll(task)} disabled={downloadingId !== null} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-forge-cyan border border-forge-cyan/30 hover:bg-forge-cyan/10 transition-colors disabled:opacity-50">
                  {downloadingId === task.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}下载全部
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {task.resultUrls.map((url, i) => (
                  <div key={i} className="relative group cursor-pointer" onClick={() => onCompare(i)}>
                    <img src={url} alt={`结果 ${i + 1}`} className="w-full aspect-square object-cover rounded-lg border border-forge-border/40 group-hover:border-forge-cyan/60 transition-colors" />
                    <div className="absolute inset-0 rounded-lg bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="px-2 py-1 rounded bg-forge-cyan/90 text-white text-[10px] font-medium flex items-center gap-1"><ZoomIn size={11} />对比</span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDownloadSingle(url, skuFilename(task, i)); }}
                      disabled={downloadingId !== null}
                      className="absolute top-1.5 right-1.5 p-1.5 rounded bg-black/60 text-white hover:bg-forge-cyan transition-colors disabled:opacity-50"
                      title="下载此图"
                    >
                      {downloadingId === '__single__' ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <button onClick={onDelete} className="text-[10px] text-forge-text2/40 hover:text-forge-red transition-colors flex items-center gap-1"><Trash2 size={10} />删除此记录</button>
        </div>
      )}
    </div>
  );
}

function Info({ icon: Icon, label, value }: { icon: typeof FileText; label: string; value: string }) {
  return <div className="flex items-center gap-1.5"><Icon size={12} className="text-forge-text2/50 flex-shrink-0" /><span className="text-[10px] text-forge-text2/50">{label}:</span><span className="text-[10px] text-forge-text truncate">{value || '-'}</span></div>;
}
function fmt(iso: string): string { try { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; } catch { return '-'; } }
