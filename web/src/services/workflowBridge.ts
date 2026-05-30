/**
 * Bridge: connect old try-on modules to the workflow engine.
 *
 * Old modules (StudioTryOn, PoseGenerate, DetailGenerate) call generateTryOnImage()
 * directly. This module provides a workflow-based alternative that submits
 * to the backend workflow engine via POST /api/vf/tryon/generate.
 */

export interface BridgeRequest {
  product_image_url?: string;
  model_image_url?: string;
  prompt: string;
  provider?: string;
  model_id?: string;
  ratio?: string;
  resolution?: string;
  style_ref_url?: string;
  count?: number;
  template_id?: string;
  extra_params?: Record<string, string>;
}

export interface BridgeTask {
  task_id: string;
  workflow_name: string;
  status: string;
  error?: string | null;
  result?: any;
  duration_seconds?: number;
  created_at?: string;
  completed_at?: string;
}

const API_BASE = '';

export async function submitToWorkflow(params: BridgeRequest): Promise<{ task_ids: string[]; workflow_name: string }> {
  const res = await fetch(`${API_BASE}/api/vf/tryon/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Workflow submission failed');
  return data;
}

export async function pollBridgeTask(taskId: string): Promise<BridgeTask> {
  const res = await fetch(`${API_BASE}/api/vf/pipelines/tasks/${taskId}`);
  if (!res.ok) throw new Error('Task not found');
  return res.json();
}

export async function pollBridgeTasksUntilDone(
  taskIds: string[],
  onProgress?: (completed: number, total: number) => void,
  intervalMs = 3000,
): Promise<BridgeTask[]> {
  const total = taskIds.length;
  const results: BridgeTask[] = [];
  const pending = new Set(taskIds);

  while (pending.size > 0) {
    for (const tid of [...pending]) {
      try {
        const task = await pollBridgeTask(tid);
        if (task.status === 'completed' || task.status === 'failed') {
          results.push(task);
          pending.delete(tid);
          onProgress?.(results.length, total);
        }
      } catch {
        // keep polling
      }
    }
    if (pending.size > 0) {
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }
  return results;
}

/**
 * Extract result image URLs from a completed bridge task.
 */
export function extractUrls(task: BridgeTask): string[] {
  if (!task.result) return [];
  const urls: string[] = [];
  const rr = task.result.row_results;
  if (rr) {
    for (const v of Object.values(rr) as any[]) {
      if (v?.urls) urls.push(...(v.urls as string[]));
    }
  }
  if (task.result.urls) urls.push(...(task.result.urls as string[]));
  if (task.result.images) urls.push(...(task.result.images as string[]));
  return urls;
}
