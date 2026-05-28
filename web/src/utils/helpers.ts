export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function truncateText(text: string, maxLen = 60): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

export function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function getResolutionMultiplier(res: string): number {
  return res === '2K' ? 2 : res === '4K' ? 4 : 1;
}

export function getModelProviderLabel(provider: string): string {
  return provider === 'yunwu' ? 'Yunwu' : 'Grsai';
}

export function getStatusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: '等待中',
    optimizing: '优化中',
    generating: '生成中',
    completed: '已完成',
    failed: '失败',
  };
  return map[status] || status;
}
