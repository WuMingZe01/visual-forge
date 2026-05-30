import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Play, ChevronDown, ChevronRight, Upload, X, Image as ImageIcon,
  Loader2, CheckCircle2, AlertCircle, Download, RefreshCw, Zap,
  Settings, Trash2, Eye, Edit3, Workflow
} from 'lucide-react';
import { useWorkflowStore } from '@/store/useWorkflowStore';

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

export function WorkflowRunner() {
  const navigate = useNavigate();
  const { refreshTick, setWorkflows, setPendingWorkflow } = useWorkflowStore();

  const [workflows, setLocalWorkflows] = useState<WorkflowTemplate[]>([]);
  const [selected, setSelected] = useState<WorkflowTemplate | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  // Form parameters
  const [productImage, setProductImage] = useState('');
  const [modelImage, setModelImage] = useState('');
  const [styleRef, setStyleRef] = useState('');
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(1);
  const [modelId, setModelId] = useState('gpt-image-2-vip');
  const [width, setWidth] = useState(2448);
  const [height, setHeight] = useState(3264);
  const [useHybrid, setUseHybrid] = useState(true);

  // Task state
  const [currentTask, setCurrentTask] = useState<TaskStatus | null>(null);
  const [taskHistory, setTaskHistory] = useState<TaskStatus[]>([]);
  const pollRef = useRef<any>(null);

  // Stage progress animation
  const [activeStageIdx, setActiveStageIdx] = useState(-1);

  // Determine which form fields the workflow needs
  const workflowType = selected ? classifyWorkflow(selected) : 'generic';

  // Load workflow list
  const loadWorkflows = useCallback(() => {
    setLoading(true);
    fetch(`${API}/api/vf/workflows`)
      .then(r => r.json())
      .then(d => {
        const list = d.workflows || [];
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

  // Re-fetch when canvas saves a new workflow (refreshTick changes)
  useEffect(() => {
    if (refreshTick > 0) loadWorkflows();
  }, [refreshTick, loadWorkflows]);

  const refreshTasks = useCallback(() => {
    fetch(`${API}/api/vf/pipelines/tasks`)
      .then(r => r.json())
      .then(d => setTaskHistory(d.tasks || []))
      .catch(() => {});
  }, []);

  // Poll task status with stage tracking
  const pollTask = useCallback((taskId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/vf/pipelines/tasks/${taskId}`);
        const task = await res.json();
        setCurrentTask(task);

        // Animate stage progress
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

  // Image upload handler
  const handleImageUpload = useCallback((setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setter(reader.result as string);
    reader.readAsDataURL(file);
  }, []);

  // Run workflow
  const handleRun = useCallback(async () => {
    if (!selected) return;
    if (!productImage && !prompt) {
      setError('请上传商品图片或填写提示词');
      return;
    }
    setRunning(true);
    setError('');
    setCurrentTask(null);
    setActiveStageIdx(0);

    try {
      const body: any = {
        model_id: modelId,
        width, height,
        use_hybrid: useHybrid,
        count,
        prompt,
      };
      if (productImage) body.product_image_url = productImage;
      if (modelImage) body.model_image_url = modelImage;
      if (styleRef) body.style_ref_url = styleRef;

      const res = await fetch(`${API}/api/vf/workflows/${encodeURIComponent(selected.name)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || '运行失败');

      setCurrentTask({
        task_id: data.task_id,
        workflow_name: data.workflow_name,
        status: data.status,
        row_count: data.row_count,
        enabled_stages: data.enabled_stages,
      });
      pollTask(data.task_id);
    } catch (e: any) {
      setError(e.message);
      setRunning(false);
      setActiveStageIdx(-1);
    }
  }, [selected, productImage, modelImage, styleRef, prompt, count, modelId, width, height, useHybrid, pollTask]);

  // Navigate to canvas editor with workflow loaded
  const handleEditInCanvas = useCallback((wf: WorkflowTemplate) => {
    // Fetch full workflow detail (includes nodes/connections) and set as pending
    fetch(`${API}/api/vf/workflows/${encodeURIComponent(wf.name)}`)
      .then(r => r.json())
      .then(detail => {
        setPendingWorkflow(detail);
        navigate('/infinite-canvas');
      })
      .catch(() => {
        // Fallback: use local data if fetch fails
        setPendingWorkflow(wf);
        navigate('/infinite-canvas');
      });
  }, [navigate, setPendingWorkflow]);

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

  // Determine which input fields to show based on workflow stages
  const showProductImage = workflowType !== 'text-only';
  const showModelImage = workflowType === 'two-image' || workflowType === 'model-swap';
  const showStyleRef = workflowType === 'style-transfer';
  const showPrompt = workflowType !== 'image-only';
  const needsImages = showProductImage;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-bold text-forge-text flex items-center gap-2">
            <Zap size={20} className="text-forge-cyan" /> 工作流执行
          </h2>
          <p className="text-xs text-forge-text2 mt-0.5">选择工作流模板，上传素材，一键出图</p>
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
        {/* Left: workflow selection + parameters */}
        <div className="lg:col-span-1 space-y-3">
          {/* Workflow list */}
          <div className="glass-card p-4 space-y-3">
            <h3 className="text-sm font-semibold text-forge-text flex items-center gap-2">
              <Settings size={14} className="text-forge-cyan" /> 选择工作流
            </h3>
            {loading ? (
              <div className="text-center py-6 text-forge-text2"><Loader2 size={20} className="animate-spin mx-auto" /></div>
            ) : (
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {workflows.map(wf => (
                  <button
                    key={wf.name}
                    onClick={() => setSelected(wf)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all ${
                      selected?.name === wf.name
                        ? 'bg-forge-cyan/10 text-forge-cyan border border-forge-cyan/20'
                        : 'text-forge-text2 hover:bg-forge-surface2/50 border border-transparent'
                    }`}
                  >
                    <div className="font-medium flex items-center gap-2">
                      {wf.name}
                      {(wf.source === 'canvas' || (wf.canvas_nodes && wf.canvas_nodes.length > 0)) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleEditInCanvas(wf); }}
                          className="opacity-40 hover:opacity-100 transition-opacity"
                          title="在画布中编辑"
                        >
                          <Edit3 size={12} />
                        </button>
                      )}
                    </div>
                    <div className="text-xs opacity-60 mt-0.5 flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                        wf.source === 'preset' ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'
                      }`}>
                        {wf.source === 'preset' ? '预设' : '画布'}
                      </span>
                      {wf.stages.filter(s => s.enabled).map(s => stageLabel(s.id)).join(' → ')}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Parameter form */}
          <div className="glass-card p-4 space-y-3">
            <h3 className="text-sm font-semibold text-forge-text">输入参数</h3>

            {/* Product image */}
            {showProductImage && (
              <div>
                <label className="text-xs text-forge-text2 mb-1 block">
                  {showModelImage ? '商品白底图 *' : '商品图 *'}
                </label>
                {productImage ? (
                  <div className="relative group">
                    <img src={productImage} className="w-full h-24 object-contain rounded-lg bg-forge-surface2" alt="" />
                    <button onClick={() => setProductImage('')} className="absolute top-1 right-1 bg-black/60 rounded p-0.5 opacity-0 group-hover:opacity-100"><X size={12} /></button>
                  </div>
                ) : (
                  <label className="flex items-center justify-center gap-2 h-24 border-2 border-dashed border-forge-border rounded-lg cursor-pointer hover:border-forge-cyan/40 text-forge-text2 text-xs">
                    <Upload size={16} /> 上传商品图
                    <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload(setProductImage)} />
                  </label>
                )}
              </div>
            )}

            {/* Model/reference image */}
            {showModelImage && (
              <div>
                <label className="text-xs text-forge-text2 mb-1 block">
                  {workflowType === 'model-swap' ? '目标模特图 *' : '模特参考图'}
                </label>
                {modelImage ? (
                  <div className="relative group">
                    <img src={modelImage} className="w-full h-24 object-contain rounded-lg bg-forge-surface2" alt="" />
                    <button onClick={() => setModelImage('')} className="absolute top-1 right-1 bg-black/60 rounded p-0.5 opacity-0 group-hover:opacity-100"><X size={12} /></button>
                  </div>
                ) : (
                  <label className="flex items-center justify-center gap-2 h-20 border-2 border-dashed border-forge-border rounded-lg cursor-pointer hover:border-forge-cyan/40 text-forge-text2 text-xs">
                    <Upload size={14} /> 上传模特图
                    <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload(setModelImage)} />
                  </label>
                )}
              </div>
            )}

            {/* Style reference */}
            {showStyleRef && (
              <div>
                <label className="text-xs text-forge-text2 mb-1 block">风格参考图</label>
                {styleRef ? (
                  <div className="relative group">
                    <img src={styleRef} className="w-full h-20 object-contain rounded-lg bg-forge-surface2" alt="" />
                    <button onClick={() => setStyleRef('')} className="absolute top-1 right-1 bg-black/60 rounded p-0.5 opacity-0 group-hover:opacity-100"><X size={12} /></button>
                  </div>
                ) : (
                  <label className="flex items-center justify-center gap-2 h-16 border-2 border-dashed border-forge-border rounded-lg cursor-pointer hover:border-forge-cyan/40 text-forge-text2 text-xs">
                    <Upload size={14} /> 上传风格参考
                    <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload(setStyleRef)} />
                  </label>
                )}
              </div>
            )}

            {/* Prompt */}
            {showPrompt && (
              <div>
                <label className="text-xs text-forge-text2 mb-1 block">提示词（可选）</label>
                <textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder="留空则由 AI 自动分析生成"
                  className="w-full bg-forge-surface2 border border-forge-border rounded-lg px-3 py-2 text-sm text-forge-text resize-none h-16 focus:border-forge-cyan/40 outline-none"
                />
              </div>
            )}

            {/* Model selection */}
            <div>
              <label className="text-xs text-forge-text2 mb-1 block">生图模型</label>
              <select
                value={modelId}
                onChange={e => setModelId(e.target.value)}
                className="w-full bg-forge-surface2 border border-forge-border rounded-lg px-3 py-2 text-sm text-forge-text focus:border-forge-cyan/40 outline-none"
              >
                <option value="gpt-image-2-vip">GPT-Image-2 VIP (Grsai)</option>
                <option value="gpt-image-2">GPT-Image-2 (Grsai)</option>
                <option value="gpt-image-2-all">GPT-Image-2 ALL (Yunwu)</option>
                <option value="gpt-image-1-mini">GPT-Image-1 Mini (Yunwu)</option>
                <option value="nano-banana-pro">Nano Banana Pro</option>
              </select>
            </div>

            {/* Resolution */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-forge-text2 mb-1 block">宽度</label>
                <select value={width} onChange={e => setWidth(+e.target.value)} className="w-full bg-forge-surface2 border border-forge-border rounded-lg px-2 py-1.5 text-sm text-forge-text outline-none">
                  <option value={1024}>1024</option>
                  <option value={2048}>2048</option>
                  <option value={2448}>2448</option>
                  <option value={3264}>3264</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-forge-text2 mb-1 block">高度</label>
                <select value={height} onChange={e => setHeight(+e.target.value)} className="w-full bg-forge-surface2 border border-forge-border rounded-lg px-2 py-1.5 text-sm text-forge-text outline-none">
                  <option value={1024}>1024</option>
                  <option value={2048}>2048</option>
                  <option value={2448}>2448</option>
                  <option value={3264}>3264</option>
                </select>
              </div>
            </div>

            {/* Count */}
            <div>
              <label className="text-xs text-forge-text2 mb-1 block">生成数量</label>
              <input
                type="number" min={1} max={8} value={count}
                onChange={e => setCount(+e.target.value)}
                className="w-full bg-forge-surface2 border border-forge-border rounded-lg px-3 py-1.5 text-sm text-forge-text outline-none"
              />
            </div>

            {/* Hybrid engine */}
            <label className="flex items-center gap-2 text-sm text-forge-text2 cursor-pointer">
              <input type="checkbox" checked={useHybrid} onChange={e => setUseHybrid(e.target.checked)} className="accent-forge-cyan" />
              启用混合引擎（Grsai + Yunwu 负载均衡）
            </label>

            {/* Run button */}
            <button
              onClick={handleRun}
              disabled={running || (needsImages && !productImage && !prompt)}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-forge-cyan to-purple-500 text-forge-bg font-semibold disabled:opacity-40 flex items-center justify-center gap-2 transition-all hover:shadow-lg hover:shadow-forge-cyan/20"
            >
              {running ? (
                <><Loader2 size={16} className="animate-spin" /> 运行中…</>
              ) : (
                <><Play size={16} /> 运行工作流</>
              )}
            </button>
          </div>
        </div>

        {/* Right: execution status + results */}
        <div className="lg:col-span-2 space-y-3">
          {/* Current task status with animated progress */}
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

              {/* Stage progress with animation */}
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

              {/* Progress bar */}
              {running && (
                <div className="w-full h-1.5 bg-forge-surface2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-forge-cyan to-purple-500 rounded-full transition-all duration-1000"
                    style={{
                      width: `${Math.min(95, ((activeStageIdx + 1) / Math.max(1, currentTask.enabled_stages.length)) * 100)}%`
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

/** Classify a workflow to determine which form fields to show */
function classifyWorkflow(wf: WorkflowTemplate): string {
  const name = (wf.name || '').toLowerCase();
  const desc = (wf.description || '').toLowerCase();
  const text = name + ' ' + desc;

  if (text.includes('换背景') || text.includes('background')) return 'two-image';
  if (text.includes('换模特') || text.includes('model-swap') || text.includes('换衣')) return 'model-swap';
  if (text.includes('详情') || text.includes('detail')) return 'image-only';
  if (text.includes('姿势') || text.includes('pose')) return 'style-transfer';
  if (text.includes('批量') || text.includes('batch')) return 'two-image';
  if (text.includes('快速') || text.includes('quick')) return 'generic';

  // Check canvas node types for hints
  const nodes = wf.canvas_nodes || [];
  const hasGenerator = nodes.some((n: any) => n.type === 'generator');
  const hasPrompt = nodes.some((n: any) => n.type === 'prompt');
  const imageNodes = nodes.filter((n: any) => n.type === 'image');

  if (imageNodes.length >= 2) return 'two-image';
  if (hasGenerator && !hasPrompt) return 'image-only';
  if (hasGenerator && hasPrompt) return 'generic';

  return 'generic';
}
