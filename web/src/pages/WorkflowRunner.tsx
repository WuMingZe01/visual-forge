import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Play, ChevronRight, X, Image as ImageIcon,
  Loader2, CheckCircle2, AlertCircle, RefreshCw, Zap,
  Settings, Edit3, Workflow
} from 'lucide-react';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { DynamicTemplateForm, type ExposedField } from '@/components/DynamicTemplateForm';

interface WorkflowTemplate {
  name: string;
  source: 'preset' | 'canvas';
  description: string;
  stages: { id: string; enabled: boolean }[];
  node_count: number;
  connection_count: number;
  canvas_nodes?: any[];
  canvas_connections?: any[];
  generator_config?: Record<string, any>;
  exposed_fields?: ExposedField[];
}

interface TaskStatus {
  task_id: string;
  workflow_name: string;
  status: string;
  row_count: number;
  enabled_stages: string[];
  created_at?: string;
  completed_at?: string;
  duration_seconds?: number;
  error?: string | null;
  has_result?: boolean;
  result?: any;
  current_stage?: string;
  progress_pct?: number;
}

const API = '';

/* ── Component ─────────────────────────────────────────────── */

export function WorkflowRunner() {
  const navigate = useNavigate();
  const { refreshTick, setWorkflows, setPendingWorkflow } = useWorkflowStore();

  const [workflows, setLocalWorkflows] = useState<WorkflowTemplate[]>([]);
  const [selected, setSelected] = useState<WorkflowTemplate | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<WorkflowTemplate | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  // Dynamic form data: key = field.name, value = string
  const [formData, setFormData] = useState<Record<string, string>>({});

  // Task state
  const [currentTask, setCurrentTask] = useState<TaskStatus | null>(null);
  const [taskHistory, setTaskHistory] = useState<TaskStatus[]>([]);
  const pollRef = useRef<any>(null);

  // Stage progress animation
  const [activeStageIdx, setActiveStageIdx] = useState(-1);

  // ── Load workflow list ──
  const loadWorkflows = useCallback(() => {
    setLoading(true);
    fetch(`${API}/api/vf/workflows`)
      .then(r => r.json())
      .then(d => {
        const list: WorkflowTemplate[] = d.workflows || [];
        setLocalWorkflows(list);
        setWorkflows(list);
        if (list.length > 0 && !selected) setSelected(list[0]);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [setWorkflows, selected]);

  useEffect(() => {
    loadWorkflows();
    refreshTasks();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch when canvas saves a new workflow
  useEffect(() => {
    if (refreshTick > 0) loadWorkflows();
  }, [refreshTick, loadWorkflows]);

  // ── Fetch workflow detail (exposed_fields) when selected ──
  useEffect(() => {
    if (!selected) { setSelectedDetail(null); setFormData({}); return; }
    setDetailLoading(true);
    fetch(`${API}/api/vf/workflows/${encodeURIComponent(selected.name)}`)
      .then(r => r.json())
      .then(detail => {
        setSelectedDetail(detail);
        // Initialize form defaults
        const defaults: Record<string, string> = {};
        const fields: ExposedField[] = detail.exposed_fields || [];
        fields.forEach(f => {
          defaults[f.name] = f.default ?? '';
        });
        setFormData(defaults);
      })
      .catch(() => {
        setSelectedDetail(selected);
        setFormData({});
      })
      .finally(() => setDetailLoading(false));
  }, [selected]);

  // ── Task list refresh ──
  const refreshTasks = useCallback(() => {
    fetch(`${API}/api/vf/pipelines/tasks`)
      .then(r => r.json())
      .then(d => setTaskHistory(d.tasks || []))
      .catch(() => {});
  }, []);

  // ── Poll task status ──
  const pollTask = useCallback((taskId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/vf/pipelines/tasks/${taskId}`);
        const task = await res.json();
        setCurrentTask(task);

        if (task.enabled_stages && task.status === 'running') {
          const stage = task.current_stage || '';
          const idx = task.enabled_stages.indexOf(stage);
          setActiveStageIdx(idx >= 0 ? idx : 0);
        }

        if (task.status === 'completed' || task.status === 'failed') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setRunning(false);
          setActiveStageIdx(-1);
          refreshTasks();
        }
      } catch { /* keep polling */ }
    }, 2000);
  }, [refreshTasks]);

  // ── Run workflow via new execute endpoint ──
  const handleRun = useCallback(async () => {
    if (!selected) return;

    // Validate required fields
    const fields = selectedDetail?.exposed_fields || [];
    for (const f of fields) {
      if (f.required && !formData[f.name]?.trim()) {
        setError(`请填写必填字段: ${f.label}`);
        return;
      }
    }

    setRunning(true);
    setError('');
    setCurrentTask(null);
    setActiveStageIdx(0);

    try {
      const res = await fetch(`${API}/api/vf/workflows/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id: selected.name,
          dynamic_inputs: formData,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || '运行失败');

      setCurrentTask({
        task_id: data.task_id,
        workflow_name: data.workflow_name || selected.name,
        status: data.status,
        row_count: data.row_count || 0,
        enabled_stages: data.enabled_stages || [],
      });
      pollTask(data.task_id);
    } catch (e: any) {
      setError(e.message);
      setRunning(false);
      setActiveStageIdx(-1);
    }
  }, [selected, selectedDetail, formData, pollTask]);

  // ── Navigate to canvas editor ──
  const handleEditInCanvas = useCallback((wf: WorkflowTemplate) => {
    fetch(`${API}/api/vf/workflows/${encodeURIComponent(wf.name)}`)
      .then(r => r.json())
      .then(detail => {
        setPendingWorkflow(detail);
        navigate('/infinite-canvas');
      })
      .catch(() => {
        setPendingWorkflow(wf);
        navigate('/infinite-canvas');
      });
  }, [navigate, setPendingWorkflow]);

  // ── Helpers ──
  const stageLabel = (id: string) => {
    const map: Record<string, string> = {
      prepare: '准备', analyze: 'AI分析', generate: '生图', validate: '校验', finalize: '输出',
    };
    return map[id] || id;
  };

  const statusIcon = (s: string) => {
    if (s === 'completed') return <CheckCircle2 size={14} className="text-green-400" />;
    if (s === 'failed') return <AlertCircle size={14} className="text-red-400" />;
    if (s === 'running') return <Loader2 size={14} className="animate-spin text-forge-cyan" />;
    return <span className="w-3.5 h-3.5 rounded-full bg-forge-border inline-block" />;
  };

  // ── Exposed fields from selected workflow detail ──
  const exposedFields: ExposedField[] = selectedDetail?.exposed_fields || [];

  /* ── JSX ──────────────────────────────────────────────────── */

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-bold text-forge-text flex items-center gap-2">
            <Zap size={20} className="text-forge-cyan" /> 工作流执行
          </h2>
          <p className="text-xs text-forge-text2 mt-0.5">选择工作流模板，填写参数，一键执行</p>
        </div>
        <button
          onClick={() => navigate('/infinite-canvas')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-forge-surface2 border border-forge-border text-sm text-forge-text2 hover:text-forge-cyan hover:border-forge-cyan/30 transition-all"
        >
          <Edit3 size={14} /> 打开画布编辑器
        </button>
      </div>

      {error && (
        <div className="glass-card p-3 border-red-500/30 bg-red-500/5 text-red-400 text-sm flex items-center gap-2">
          <AlertCircle size={14} /> {error}
          <button onClick={() => setError('')} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ─── Left column: workflow list ─── */}
        <div className="lg:col-span-1 space-y-3">
          <div className="glass-card p-4 space-y-3">
            <h3 className="text-sm font-semibold text-forge-text flex items-center gap-2">
              <Settings size={14} className="text-forge-cyan" /> 选择工作流
            </h3>
            {loading ? (
              <div className="text-center py-6 text-forge-text2">
                <Loader2 size={20} className="animate-spin mx-auto" />
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[calc(100vh-320px)] overflow-y-auto">
                {workflows.map(wf => {
                  const fieldCount = wf.exposed_fields?.length ?? 0;
                  const isActive = selected?.name === wf.name;
                  return (
                    <div
                      key={wf.name}
                      onClick={() => setSelected(wf)}
                      className={`w-full text-left px-3 py-3 rounded-lg text-sm cursor-pointer transition-all ${
                        isActive
                          ? 'bg-forge-cyan/10 text-forge-cyan border border-forge-cyan/20'
                          : 'text-forge-text2 hover:bg-forge-surface2/50 border border-transparent'
                      }`}
                    >
                      {/* Name row */}
                      <div className="font-medium flex items-center gap-2">
                        <Workflow size={14} className={isActive ? 'text-forge-cyan' : 'text-forge-text2/60'} />
                        <span className="flex-1 truncate">{wf.name}</span>
                        {fieldCount > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-forge-surface2 text-forge-text2 whitespace-nowrap">
                            {fieldCount} 个参数
                          </span>
                        )}
                      </div>

                      {/* Description */}
                      {wf.description && (
                        <div className="text-xs opacity-60 mt-1 line-clamp-2">{wf.description}</div>
                      )}

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleEditInCanvas(wf); }}
                          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-forge-surface2 text-forge-text2 hover:text-forge-cyan hover:bg-forge-cyan/5 transition-colors"
                        >
                          <Edit3 size={10} /> 编辑画布
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelected(wf); }}
                          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors ${
                            isActive
                              ? 'bg-forge-cyan/20 text-forge-cyan'
                              : 'bg-forge-surface2 text-forge-text2 hover:text-forge-cyan hover:bg-forge-cyan/5'
                          }`}
                        >
                          <Play size={10} /> 执行
                        </button>
                        <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] ${
                          wf.source === 'preset' ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'
                        }`}>
                          {wf.source === 'preset' ? '预设' : '画布'}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {workflows.length === 0 && !loading && (
                  <div className="text-center py-6 text-forge-text2/50 text-xs">暂无工作流</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ─── Right column: dynamic form + results ─── */}
        <div className="lg:col-span-2 space-y-3">
          {/* Dynamic form */}
          {selected && (
            <div className="glass-card p-4 space-y-3">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold text-forge-text flex items-center gap-2">
                  <ImageIcon size={14} className="text-forge-cyan" />
                  {selected.name}
                </h3>
                {selectedDetail?.description && (
                  <span className="text-xs text-forge-text2/60 max-w-xs truncate">{selectedDetail.description}</span>
                )}
              </div>

              {detailLoading ? (
                <div className="text-center py-8 text-forge-text2">
                  <Loader2 size={20} className="animate-spin mx-auto" />
                  <p className="text-xs mt-2">加载工作流参数…</p>
                </div>
              ) : (
                <>
                  <DynamicTemplateForm
                    fields={exposedFields}
                    formData={formData}
                    onChange={setFormData}
                    loading={running}
                  />

                  {/* Run button */}
                  <button
                    onClick={handleRun}
                    disabled={running}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-forge-cyan to-purple-500 text-forge-bg font-semibold disabled:opacity-40 flex items-center justify-center gap-2 transition-all hover:shadow-lg hover:shadow-forge-cyan/20"
                  >
                    {running ? (
                      <><Loader2 size={16} className="animate-spin" /> 运行中…</>
                    ) : (
                      <><Play size={16} /> 运行工作流</>
                    )}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Current task status */}
          {currentTask && (
            <div className="glass-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-forge-text flex items-center gap-2">
                  {statusIcon(currentTask.status)} {currentTask.workflow_name}
                </h3>
                <span className={`px-2 py-0.5 rounded text-xs ${
                  currentTask.status === 'completed' ? 'bg-green-500/10 text-green-400' :
                  currentTask.status === 'failed' ? 'bg-red-500/10 text-red-400' :
                  'bg-forge-cyan/10 text-forge-cyan'
                }`}>
                  {currentTask.status}
                </span>
              </div>

              {/* Stage progress */}
              {currentTask.enabled_stages && currentTask.enabled_stages.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  {currentTask.enabled_stages.map((stage, i) => {
                    const isActive = running && activeStageIdx === i;
                    const isDone = running && activeStageIdx > i;
                    const isComplete = currentTask.status === 'completed';
                    return (
                      <div key={stage} className="flex items-center gap-1">
                        <span className={`px-2 py-0.5 rounded text-xs transition-all duration-300 ${
                          isComplete ? 'bg-green-500/10 text-green-400' :
                          isActive ? 'bg-forge-cyan/20 text-forge-cyan animate-pulse scale-105' :
                          isDone ? 'bg-green-500/10 text-green-400' :
                          'bg-forge-surface2 text-forge-text2'
                        }`}>
                          {isActive && <Loader2 size={10} className="inline animate-spin mr-1" />}
                          {stageLabel(stage)}
                        </span>
                        {i < currentTask.enabled_stages.length - 1 && (
                          <ChevronRight size={12} className={`transition-colors ${
                            isDone ? 'text-green-400' : isActive ? 'text-forge-cyan' : 'text-forge-text2/40'
                          }`} />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Progress bar */}
              {running && (
                <div className="w-full h-1.5 bg-forge-surface2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-forge-cyan to-purple-500 rounded-full transition-all duration-1000"
                    style={{
                      width: `${Math.min(95, ((activeStageIdx + 1) / Math.max(1, (currentTask.enabled_stages || []).length)) * 100)}%`
                    }}
                  />
                </div>
              )}

              {currentTask.error && (
                <div className="text-red-400 text-xs bg-red-500/5 rounded p-2">{currentTask.error}</div>
              )}

              {currentTask.duration_seconds != null && (
                <div className="text-xs text-forge-text2">耗时: {currentTask.duration_seconds.toFixed(1)}s</div>
              )}

              {/* Results */}
              {currentTask.status === 'completed' && currentTask.result && (
                <div className="mt-2 space-y-2">
                  <h4 className="text-xs font-semibold text-forge-text">执行结果</h4>
                  {typeof currentTask.result === 'string' ? (
                    <img src={currentTask.result} alt="result" className="max-w-full rounded-lg border border-forge-border" />
                  ) : currentTask.result.images ? (
                    <div className="grid grid-cols-2 gap-2">
                      {currentTask.result.images.map((img: string, i: number) => (
                        <img key={i} src={img} alt={`result-${i}`} className="w-full rounded-lg border border-forge-border object-contain" />
                      ))}
                    </div>
                  ) : (
                    <pre className="text-xs text-forge-text2 bg-forge-surface2 rounded p-2 overflow-x-auto">
                      {JSON.stringify(currentTask.result, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Task history */}
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-forge-text">任务历史</h3>
              <button onClick={refreshTasks} className="text-forge-text2 hover:text-forge-cyan"><RefreshCw size={14} /></button>
            </div>
            {taskHistory.length === 0 ? (
              <div className="text-center py-12 text-forge-text2/50 text-sm">暂无任务</div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {taskHistory.map(task => (
                  <div
                    key={task.task_id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm cursor-pointer transition-all ${
                      currentTask?.task_id === task.task_id ? 'bg-forge-cyan/5 border border-forge-cyan/20' : 'hover:bg-forge-surface2/50'
                    }`}
                    onClick={() => { setCurrentTask(task); }}
                  >
                    {statusIcon(task.status)}
                    <div className="flex-1 min-w-0">
                      <div className="text-forge-text truncate">{task.workflow_name}</div>
                      <div className="text-xs text-forge-text2">{task.created_at?.slice(0, 19)}</div>
                    </div>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                      task.status === 'completed' ? 'bg-green-500/10 text-green-400' :
                      task.status === 'failed' ? 'bg-red-500/10 text-red-400' :
                      'bg-forge-surface2 text-forge-text2'
                    }`}>
                      {task.status}
                    </span>
                    {task.duration_seconds != null && (
                      <span className="text-xs text-forge-text2">{task.duration_seconds.toFixed(1)}s</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
