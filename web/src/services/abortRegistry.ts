const registry = new Map<string, AbortController>();

export function registerTask(taskId: string): AbortController {
  // Cancel any existing task with same ID
  abortTask(taskId);
  const ctrl = new AbortController();
  registry.set(taskId, ctrl);
  return ctrl;
}

export function abortTask(taskId: string): boolean {
  const ctrl = registry.get(taskId);
  if (ctrl) {
    ctrl.abort();
    registry.delete(taskId);
    return true;
  }
  return false;
}

export function abortAll(): number {
  let count = 0;
  for (const [, ctrl] of registry) {
    ctrl.abort();
    count++;
  }
  registry.clear();
  return count;
}

export function getSignal(taskId: string): AbortSignal | undefined {
  return registry.get(taskId)?.signal;
}

export function isTaskRunning(taskId: string): boolean {
  const ctrl = registry.get(taskId);
  return ctrl !== undefined && !ctrl.signal.aborted;
}

export function getRunningTaskIds(): string[] {
  return [...registry.entries()]
    .filter(([, ctrl]) => !ctrl.signal.aborted)
    .map(([id]) => id);
}
