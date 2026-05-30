import { useEffect, useRef, useCallback, useState } from 'react';
import { useThemeStore } from '@/store/useThemeStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';

/**
 * InfiniteCanvas — iframe bridge to the standalone canvas app.
 *
 * PostMessage protocol (VF ↔ canvas):
 *   VF → iframe:
 *     {type:'studio-theme', theme:'dark'|'light'}
 *     {type:'studio-lang', lang:'zh'|'en'}
 *     {type:'vf-load-workflow', data: WorkflowDetail}
 *     {type:'vf-load-workflows', data: WorkflowSummary[]}
 *     {type:'vf-open-preset', data: {name, canvas_nodes, canvas_connections}}
 *     {type:'vf-run-task', data: {workflow_name, config}}
 *     {type:'vf-ping'}
 *
 *   iframe → VF:
 *     {type:'save-workflow', data: {name, nodes, connections}}
 *     {type:'load-workflow', data: {name}}
 *     {type:'load-workflows'}
 *     {type:'run-vf-task', data: {canvas_id, nodes, connections, model_id, width, height}}
 *     {type:'task-result', data: {task_id, status, images, ...}}
 *     {type:'canvas-ready'}
 *     {type:'canvas-updated', canvas_id}
 *     {type:'new-image', data: {url, ...}}
 *     {type:'vf-pong'}
 */

const API = '';  // same-origin

export function InfiniteCanvas() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
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
      // Ask canvas to announce readiness
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
          setStatusText('画布就绪');
          // Send pending workflow if one is waiting
          if (pendingWorkflow && !pendingSentRef.current) {
            pendingSentRef.current = true;
            const hasCanvasNodes = pendingWorkflow.canvas_nodes && pendingWorkflow.canvas_nodes.length > 0;
            if (hasCanvasNodes) {
              sendToCanvas({
                type: 'vf-load-workflow',
                data: {
                  name: pendingWorkflow.name,
                  nodes: pendingWorkflow.canvas_nodes || pendingWorkflow.nodes || [],
                  connections: pendingWorkflow.canvas_connections || pendingWorkflow.connections || [],
                }
              });
              setStatusText('已加载工作流: ' + pendingWorkflow.name);
            }
            clearPendingWorkflow();
          }
          break;

        // ── Save workflow from canvas ──
        case 'save-workflow': {
          const { name, nodes, connections } = msg.data || {};
          if (!name) break;
          setStatusText('保存工作流…');
          fetch(`${API}/api/vf/workflows/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, nodes, connections }),
          })
            .then(r => r.json())
            .then(data => {
              if (data.ok) {
                setStatusText(`✅ 已保存: ${data.name}`);
                triggerRefresh();
                // Notify canvas of success
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
                // Start polling for the result
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

        // ── Task result from canvas (already processed) ──
        case 'task-result': {
          setLastTaskResult(msg.data);
          setStatusText(`任务完成: ${msg.data?.status || 'unknown'}`);
          break;
        }

        // ── Canvas updated ──
        case 'canvas-updated':
        case 'canvas_updated':
          console.debug('[InfiniteCanvas] canvas_updated:', msg.canvas_id);
          break;

        // ── New image generated ──
        case 'new-image':
          console.debug('[InfiniteCanvas] new_image:', msg.data);
          break;

        default:
          break;
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [triggerRefresh, setLastTaskResult, setCanvasReady, sendToCanvas, pendingWorkflow, clearPendingWorkflow]);

  // Poll a pipeline task until completion
  const pollTask = useCallback((taskId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/vf/pipelines/tasks/${taskId}`);
        const task = await res.json();
        if (task.status === 'completed' || task.status === 'failed') {
          clearInterval(interval);
          setStatusText(task.status === 'completed' ? '✅ 任务完成' : '❌ 任务失败');
          // Send result back to canvas
          sendToCanvas({ type: 'vf-task-complete', data: task });
          setLastTaskResult(task);
        }
      } catch {
        // keep polling
      }
    }, 2000);
    // Safety timeout: stop after 10 minutes
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
        <span>{statusText}</span>
      </div>
      {/* Canvas iframe */}
      <iframe
        ref={iframeRef}
        src="/infinite-canvas/canvas.html"
        onLoad={handleIframeLoad}
        className="w-full flex-1 border-0 rounded-lg"
        style={{
          background: 'var(--forge-bg, #0a0e1a)',
          minHeight: '600px',
        }}
        title="无限画布"
        allow="clipboard-write"
      />
    </div>
  );
}
