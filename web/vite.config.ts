import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5174,
    proxy: {
      // ---- 外部 API 代理 ----
      '/lingmao-api': {
        target: 'https://open.scm321.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/lingmao-api/, ''),
        secure: false,
        timeout: 30000,
        proxyTimeout: 30000,
      },
      '/llm-deepseek': {
        target: 'https://api.deepseek.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/llm-deepseek/, ''),
        secure: false,
        timeout: 180000,
        proxyTimeout: 180000,
      },
      '/llm-moonshot': {
        target: 'https://api.moonshot.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/llm-moonshot/, ''),
        secure: false,
        timeout: 180000,
        proxyTimeout: 180000,
      },
      '/llm-mimo': {
        target: 'https://api.xiaomimimo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/llm-mimo/, ''),
        secure: false,
        timeout: 180000,
        proxyTimeout: 180000,
      },
      '/grsai': {
        target: 'https://grsai.dakka.com.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/grsai/, ''),
        secure: false,
        timeout: 300000,
        proxyTimeout: 300000,
      },
      '/yunwu': {
        target: 'https://yunwu.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/yunwu/, ''),
        secure: false,
        timeout: 300000,
        proxyTimeout: 300000,
      },

      // ---- 无限画布 Python 后端 (localhost:3000) ----
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
      '/generate': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/output': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/assets': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
