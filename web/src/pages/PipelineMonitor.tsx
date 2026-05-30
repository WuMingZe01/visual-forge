import { useState, useEffect, useCallback } from 'react';
import { Layers, Play, Check, Loader, AlertCircle, RefreshCw } from 'lucide-react';

interface Pipeline {
  name: string;
  description: string;
  stage_count: number;
  enabled_stages: string[];
}

interface Task {
  task_id: string;
  workflow_name: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  duration_seconds: number;
  error: string | null;
  has_result: boolean;
}

export function PipelineMonitor() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [pRes, tRes] = await Promise.all([
        fetch('/api/vf/pipelines'),
        fetch('/api/vf/pipelines/tasks'),
      ]);
      const pData = await pRes.json();
      const tData = await tRes.json();
      setPipelines(pData.pipelines || []);
      setTasks(tData.tasks || []);
      setError('');
    } catch (e) {
      setError('无法连接工作流引擎');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const statusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <Check size={14} className="text-green-400" />;
      case 'running': return <Loader size={14} className="text-blue-400 animate-spin" />;
      case 'failed': return <AlertCircle size={14} className="text-red-400" />;
      case 'cancelled': return <AlertCircle size={14} className="text-yellow-400" />;
      default: return <RefreshCw size={14} className="text-forge-text2" />;
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-500/10 text-green-400 border-green-500/20';
      case 'running': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'failed': return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'pending': return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
      case 'cancelled': return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
      default: return 'bg-forge-surface text-forge-text2 border-forge-border';
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case 'completed': return '已完成';
      case 'running': return '执行中';
      case 'failed': return '失败';
      case 'pending': return '等待中';
      case 'cancelled': return '已取消';
      default: return status;
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-forge-cyan to-blue-500 flex items-center justify-center">
          <Layers size={20} className="text-forge-bg" />
        </div>
        <div>
          <h2 className="font-display text-lg font-bold text-gradient-cyan tracking-wider">工作流引擎</h2>
          <p className="text-xs text-forge-text2">Visual Forge Pipeline Engine — 6 个预设模板 · 多阶段并行执行</p>
        </div>
      </div>

      {error && (
        <div className="glass-card p-6 text-center text-red-400 border-red-500/20">
          <AlertCircle size={24} className="mx-auto mb-2" />
          {error}
        </div>
      )}

      {/* Pipeline Templates */}
      <div>
        <h3 className="font-display text-sm font-semibold text-forge-text mb-3 flex items-center gap-2">
          <Play size={14} className="text-forge-cyan" />
          可用流水线模板
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {pipelines.map((p) => (
            <div key={p.name} className="glass-card p-4 hover:border-forge-cyan/30 transition-colors">
              <div className="font-medium text-forge-text text-sm mb-1">{p.name}</div>
              <div className="text-xs text-forge-text2 mb-2 line-clamp-2">{p.description}</div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs px-2 py-0.5 rounded bg-forge-surface2 text-forge-text2">
                  {p.stage_count} 阶段
                </span>
                {p.enabled_stages.map((s) => (
                  <span key={s} className="text-xs px-1.5 py-0.5 rounded bg-forge-cyan/10 text-forge-cyan">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Task History */}
      <div>
        <h3 className="font-display text-sm font-semibold text-forge-text mb-3">
          任务记录 ({tasks.length})
        </h3>
        {tasks.length === 0 ? (
          <div className="glass-card p-8 text-center text-forge-text2/60">
            <Layers size={32} className="mx-auto mb-2 opacity-40" />
            暂无任务，提交一个流水线任务开始吧
          </div>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <div key={task.task_id} className="glass-card p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {statusIcon(task.status)}
                  <div>
                    <div className="text-sm text-forge-text">{task.workflow_name}</div>
                    <div className="text-xs text-forge-text2">
                      {task.task_id.slice(0, 8)} · {task.created_at ? new Date(task.created_at).toLocaleTimeString() : ''}
                      {task.duration_seconds > 0 && ` · ${task.duration_seconds.toFixed(1)}s`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded border ${statusColor(task.status)}`}>
                    {statusLabel(task.status)}
                  </span>
                  {task.error && (
                    <span className="text-xs text-red-400 max-w-[200px] truncate" title={task.error}>
                      {task.error}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Refresh */}
      <div className="text-center">
        <button
          onClick={fetchData}
          className="text-xs text-forge-text2 hover:text-forge-cyan transition-colors flex items-center gap-1 mx-auto"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>
    </div>
  );
}
