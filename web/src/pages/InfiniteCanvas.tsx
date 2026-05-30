import { useEffect, useRef, useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Save } from 'lucide-react';
import { useThemeStore } from '@/store/useThemeStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';

/**
 * InfiniteCanvas — iframe bridge to standalone canvas apps.
 *
 * Supports two canvases via URL param `type`:
 *   /infinite-canvas           → canvas.html      (classic node-graph editor)
 *   /infinite-canvas?type=smart → smart-canvas.html (smart layout canvas)
 *
 * PostMessage protocol (VF ↔ canvas):
 *   VF → iframe:
 *     vf-ping, vf-load-workflow, vf-load-workflows, vf-open-preset, vf-run-task,
 *     vf-request-save, studio-theme, studio-lang
 *
 *   iframe → VF:
 *     canvas-ready, vf-pong, save-workflow, load-workflow, load-workflows,
 *     run-vf-task, task-result, canvas-updated, new-image
 */

const API = '';  // same-origin

export function InfiniteCanvas() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [searchParams] = useSearchParams();
  const isSmart = searchParams.get('type') === 'smart';
  const canvasSrc = isSmart ? '/infinite-canvas/smart-canvas.html' : '/infinite-canvas/canvas.html';

  const currentTheme = useThemeStore((s) => s.current);
  const isDark = currentTheme !== 'light';

  const {
    triggerRefresh, setLastTaskResult,
    setCanvasReady, setBackendConnected,
    pendingWorkflow, clearPendingWorkflow,
  } = useWorkflowStore();

  const [statusText, setStatusText] = useState('加载中…');
  const [backendOk, setBackendOk] = useState(false);
  const pendingSentRef = useRef(false);

  // Send message to iframe safely
  const sendToCanvas = useCallback((msg: any) => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    try {
      iframe.contentWindow.postMessage(msg, '*');
    } catch { /* iframe not ready */ }
  }, []);

  // Theme sync
  const syncTheme = useCallback(() => {
    sendToCanvas({ type: 'studio-theme', theme: isDark ? 'dark' : 'light' });
  }, [isDark, sendToCanvas]);

  const handleIframeLoad = useCallback(() => {
    setTimeout(() => {
      syncTheme();
      sendToCanvas({ type: 'vf-ping' });
    }, 300);
  }, [syncTheme, sendToCanvas]);

  // Theme changes
  useEffect(() => { syncTheme(); }, [syncTheme]);

  // Backend health check on mount
  useEffect(() => {
    fetch(`${API}/api/providers`)
      .then(r => { if (r.ok) { setBackendOk(true); setBackendConnected(true); } })
      .catch(() => { setBackendOk(false); setBackendConnected(false); });
  }, [setBackendConnected]);

  // Save helper: request canvas state then POST to backend
  const handleSave = useCallback(() => {
    setStatusText('保存工作流…');
    sendToCanvas({ type: 'vf-request-save' });
  }, [sendToCanvas]);

  // Main message handler: iframe → VF
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const msg = event.data;
      if (!msg?.type) return;

      switch (msg.type) {
        // ── Canvas ready ──
        case 'canvas-ready':
        case 'vf-pong':
          setCanvasReady(true);
          setStatusText(isSmart ? '智能画布就绪' : '画布就绪');
          if (pendingWorkflow && !pendingSentRef.current) {
            pendingSentRef.current = true;
            const canvasNodes = pendingWorkflow.canvas_nodes || pendingWorkflow.nodes || [];
            const canvasConns = pendingWorkflow.canvas_connections || pendingWorkflow.connections || [];
            const hasNodes = canvasNodes.length > 0;
            if (hasNodes) {
              sendToCanvas({
                type: 'vf-load-workflow',
                data: {
                  name: pendingWorkflow.name,
                  nodes: canvasNodes,
                  connections: canvasConns,
                  exposed_mapping: pendingWorkflow.exposed_mapping || {},
                }
              });
              setStatusText('已加载工作流: ' + pendingWorkflow.name);
            } else {
              setStatusText(isSmart ? '智能画布就绪（空模板）' : '画布就绪（空模板）');
            }
            clearPendingWorkflow();
          }
          break;

        // ── Save workflow from canvas ──
        case 'save-workflow': {
          const { name, nodes, connections, exposed_mapping } = msg.data || {};
          if (!name) break;
          setStatusText('保存工作流…');
          fetch(`${API}/api/vf/workflows/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, nodes, connections, exposed_mapping }),
          })
            .then(r => r.json())
            .then(data => {
              if (data.ok) {
                setStatusText(`✅ 已保存: ${data.name}`);
                triggerRefresh();
                sendToCanvas({ type: 'vf-save-result', data: { ok: true, name: data.name } });
              } else {
                setStatusText('保存失败');
                sendToCanvas({ type: 'vf-save-result', data: { ok: false, error: JSON.stringify(data) } });
              }
            })
            .catch(e => {
              setStatusText('保存失败: ' + e.message);
              sendToCanvas({ type: 'vf-save-result', data: { ok: false, error: e.message } });
            });
          break;
        }

        // ── Load single workflow ──
        case 'load-workflow': {
          const { name } = msg.data || {};
          if (!name) break;
          fetch(`${API}/api/vf/workflows/${encodeURIComponent(name)}`)
            .then(r => r.json())
            .then(data => sendToCanvas({ type: 'vf-load-workflow', data }))
            .catch(e => console.warn('[InfiniteCanvas] load-workflow error:', e));
          break;
        }

        // ── Load all workflows ──
        case 'load-workflows': {
          fetch(`${API}/api/vf/workflows`)
            .then(r => r.json())
            .then(data => sendToCanvas({ type: 'vf-load-workflows', data: data.workflows || [] }))
            .catch(e => console.warn('[InfiniteCanvas] load-workflows error:', e));
          break;
        }

        // ── Run VF pipeline task from canvas ──
        case 'run-vf-task': {
          const payload = msg.data || {};
          setStatusText('提交流水线任务…');
          fetch(`${API}/api/vf/workflows/run-from-canvas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
            .then(r => r.json())
            .then(data => {
              if (data.task_id) {
                setStatusText(`任务已提交: ${data.task_id}`);
                sendToCanvas({ type: 'vf-task-submitted', data });
                pollTask(data.task_id);
              } else {
                setStatusText('任务提交失败');
                sendToCanvas({ type: 'vf-task-error', data: { error: JSON.stringify(data) } });
              }
            })
            .catch(e => {
              setStatusText('任务提交失败: ' + e.message);
              sendToCanvas({ type: 'vf-task-error', data: { error: e.message } });
            });
          break;
        }

        case 'task-result': {
          setLastTaskResult(msg.data);
          setStatusText(`任务完成: ${msg.data?.status || 'unknown'}`);
          break;
        }

        case 'canvas-updated':
        case 'canvas_updated':
          console.debug('[InfiniteCanvas] canvas_updated:', msg.canvas_id);
          break;

        case 'new-image':
          console.debug('[InfiniteCanvas] new_image:', msg.data);
          break;

        default:
          break;
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [triggerRefresh, setLastTaskResult, setCanvasReady, sendToCanvas, pendingWorkflow, clearPendingWorkflow, isSmart]);

  // Poll a pipeline task until completion
  const pollTask = useCallback((taskId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/vf/pipelines/tasks/${taskId}`);
        const task = await res.json();
        if (task.status === 'completed' || task.status === 'failed') {
          clearInterval(interval);
          setStatusText(task.status === 'completed' ? '✅ 任务完成' : '❌ 任务失败');
          sendToCanvas({ type: 'vf-task-complete', data: task });
          setLastTaskResult(task);
        }
      } catch {
        // keep polling
      }
    }, 2000);
    setTimeout(() => clearInterval(interval), 600_000);
  }, [sendToCanvas, setLastTaskResult]);

  return (
    <div className="w-full h-full flex flex-col" style={{ minHeight: 'calc(100vh - 2rem)' }}>
      {/* Status bar */}
      <div className="flex items-center gap-3 px-4 py-1.5 bg-[var(--forge-surface,#11162a)] border-b border-[var(--forge-border,#252d4a)] text-xs text-[var(--forge-text2,#8b90b8)] shrink-0">
        <span className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${backendOk ? 'bg-green-400' : 'bg-red-400'}`} />
          {backendOk ? '后端已连接' : '后端未连接'}
        </span>
        <span className="opacity-40">|</span>
        <span className="flex-1">{statusText}</span>
        {/* Smart-canvas save button (classic canvas has its own toolbar button) */}
        {isSmart && (
          <button
            onClick={handleSave}
            className="flex items-center gap-1 px-3 py-1 rounded-lg bg-gradient-to-r from-forge-cyan to-purple-500 text-white text-xs font-semibold hover:opacity-90 transition-opacity"
          >
            <Save size={14} /> 保存为流水线
          </button>
        )}
      </div>
      {/* Canvas iframe */}
      <iframe
        ref={iframeRef}
        src={canvasSrc}
        onLoad={handleIframeLoad}
        className="w-full flex-1 border-0 rounded-lg"
        style={{
          background: 'var(--forge-bg, #0a0e1a)',
          minHeight: '600px',
        }}
        title={isSmart ? '智能画布' : '无限画布'}
        allow="clipboard-write"
      />
    </div>
  );
}
