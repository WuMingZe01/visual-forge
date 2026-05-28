/**
 * 图片处理工具函数
 */

const MAX_IMAGE_DIM = 2000;
const JPEG_QUALITY = 0.92;
const LLM_MAX_DIM = 768;
const LLM_QUALITY = 0.65;

// 参考图专用压缩：双参考图时总 body 需控制在 ~300KB 以内，避免 API 超时
// 1024px + 85% 质量 → 单图 ~120KB，双图 ~240KB，可稳定传输
// 输出分辨率由 size/imageSize 参数控制，参考图只负责视觉信息
const REF_MAX_DIM = 1024;
const REF_QUALITY = 0.85;

export async function compressImageToBase64(
  file: File,
  maxDim: number = MAX_IMAGE_DIM,
  quality: number = JPEG_QUALITY
): Promise<string> {
  return compressImageToBase64Core(file, maxDim, quality);
}

/**
 * 专门用于 LLM 多模态输入的图片压缩 — LLM 内部都缩放到 512-768px，
 * 传大图反而拖慢上传速度，这里直接用 768px + 0.65 质量压缩。
 */
export async function compressImageForLLM(file: File): Promise<string> {
  return compressImageToBase64Core(file, LLM_MAX_DIM, LLM_QUALITY);
}

/** 参考图专用：用于发给生图 API，仅需低分辨率视觉提示 */
export async function compressImageForRef(file: File): Promise<string> {
  return compressImageToBase64Core(file, REF_MAX_DIM, REF_QUALITY);
}

async function compressImageToBase64Core(
  file: File,
  maxDim: number,
  quality: number,
  timeoutMs = 30000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`compressImage timeout after ${timeoutMs}ms (${file.name})`));
    }, timeoutMs);

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    const cleanup = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(objectUrl);
    };

    img.onload = () => {
      if (settled) return;
      settled = true;
      cleanup();

      let w = img.naturalWidth;
      let h = img.naturalHeight;

      if (w > maxDim || h > maxDim) {
        const ratio = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('FileReader failed'));
        reader.readAsDataURL(file);
        return;
      }

      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };

    img.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      // 降级：直接读文件为 data URL（适用于 SVG/WebP 等格式）
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Image load + FileReader both failed'));
      reader.readAsDataURL(file);
    };

    img.src = objectUrl;
  });
}

/**
 * 将blob URL转换为File对象
 * 支持 blob: 和 data: 两种格式；data URL 直接解析不经过网络
 */
export async function blobUrlToFile(blobUrl: string, name: string, timeoutMs = 15000): Promise<File> {
  // data URL 直接解析，不需要 fetch
  if (blobUrl.startsWith('data:')) {
    const idx = blobUrl.indexOf(',');
    const b64 = idx >= 0 ? blobUrl.slice(idx + 1) : '';
    const mimeMatch = blobUrl.match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new File([bytes], name, { type: mime });
  }

  // blob URL → fetch 转换（可能因 revoke 而挂起，加超时）
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(blobUrl, { signal: ctrl.signal });
    if (!resp.ok) throw new Error(`Failed to fetch blob: HTTP ${resp.status}`);
    const blob = await resp.blob();
    return new File([blob], name, { type: blob.type });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 带超时的 Promise — 防止 fetch/Canvas 等操作无限挂起
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = ''): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms${label ? ': ' + label : ''}`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * 验证图片文件
 * @param file 文件
 * @param maxSize 最大文件大小（字节）
 * @returns 验证结果
 */
export function validateImageFile(file: File, maxSize: number = 50 * 1024 * 1024): { valid: boolean; message?: string } {
  if (!file.type.startsWith('image/')) {
    return { valid: false, message: '请上传图片文件' };
  }
  if (file.size > maxSize) {
    return { valid: false, message: `文件大小不能超过 ${(maxSize / 1024 / 1024).toFixed(0)}MB` };
  }
  return { valid: true };
}

/**
 * 格式化文件大小
 * @param bytes 字节数
 * @returns 格式化后的字符串
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
