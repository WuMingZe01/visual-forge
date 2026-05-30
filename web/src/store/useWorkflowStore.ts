import { create } from 'zustand';

/**
 * Shared workflow state between InfiniteCanvas (iframe) and WorkflowRunner.
 *
 * When the canvas iframe saves a workflow via postMessage, InfiniteCanvas.tsx
 * updates this store → WorkflowRunner re-renders with the new workflow list.
 */
export interface WorkflowSummary {
  name: string;
  source: 'preset' | 'canvas';
  description: string;
  stages: { id: string; enabled: boolean }[];
  node_count: number;
  connection_count: number;
  /** Canvas node metadata for WorkflowRunner form generation */
  canvas_nodes?: any[];
  canvas_connections?: any[];
  generator_config?: Record<string, any>;
  modified_at?: number;
}

interface WorkflowState {
  /** Full workflow list (presets + saved) */
  workflows: WorkflowSummary[];
  /** Set by InfiniteCanvas.tsx after fetching from backend */
  setWorkflows: (list: WorkflowSummary[]) => void;
  /** Incremented whenever a workflow is saved from the canvas */
  refreshTick: number;
  triggerRefresh: () => void;
  /** Latest task result from canvas execution */
  lastTaskResult: any;
  setLastTaskResult: (r: any) => void;
  /** Whether the canvas iframe reports it is loaded and ready */
  canvasReady: boolean;
  setCanvasReady: (v: boolean) => void;
  /** Whether the backend is reachable */
  backendConnected: boolean;
  setBackendConnected: (v: boolean) => void;
  /** Currently selected workflow name for cross-page navigation */
  editWorkflowName: string;
  setEditWorkflowName: (n: string) => void;
  /** Pending workflow to load into canvas on next canvas-ready */
  pendingWorkflow: any;
  setPendingWorkflow: (wf: any) => void;
  clearPendingWorkflow: () => void;
}

export const useWorkflowStore = create<WorkflowState>((set) => ({
  workflows: [],
  setWorkflows: (list) => set({ workflows: list }),
  refreshTick: 0,
  triggerRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
  lastTaskResult: null,
  setLastTaskResult: (r) => set({ lastTaskResult: r }),
  canvasReady: false,
  setCanvasReady: (v) => set({ canvasReady: v }),
  backendConnected: false,
  setBackendConnected: (v) => set({ backendConnected: v }),
  editWorkflowName: '',
  setEditWorkflowName: (n) => set({ editWorkflowName: n }),
  pendingWorkflow: null,
  setPendingWorkflow: (wf) => set({ pendingWorkflow: wf }),
  clearPendingWorkflow: () => set({ pendingWorkflow: null }),
}));
