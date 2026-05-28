import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// 启动时清理旧的超大 localStorage 数据（已迁移到 IndexedDB）
;(function cleanupStorage() {
  const KEYS_TO_CHECK = [
    'vf-task-history-v1',
    'visual-forge-store',
    'vf-lingmao-sku-cache-v1',
    'vf-local-library',
    'vf-batch-state',
  ];
  for (const key of KEYS_TO_CHECK) {
    try {
      const raw = localStorage.getItem(key);
      if (raw && raw.length > 500_000) {
        console.warn(`[cleanup] ${key} is ${(raw.length/1024).toFixed(0)}KB, clearing...`);
        localStorage.removeItem(key);
      }
    } catch {}
  }
  // 也清理可能残留的其他大键
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith('vf-')) {
        const val = localStorage.getItem(key);
        if (val && val.length > 1_000_000) {
          console.warn(`[cleanup] Large key ${key}: ${(val.length/1024).toFixed(0)}KB, clearing...`);
          localStorage.removeItem(key);
        }
      }
    }
  } catch {}
})();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
