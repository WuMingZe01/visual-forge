import { X, ZoomIn, ZoomOut, RotateCw, Download } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';

interface ImageZoomModalProps {
  open: boolean;
  onClose: () => void;
  src: string;
  alt?: string;
  title?: string;
}

export function ImageZoomModal({ open, onClose, src, alt, title }: ImageZoomModalProps) {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    if (open) {
      setScale(1);
      setRotation(0);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '+' || e.key === '=') setScale((s) => Math.min(s + 0.25, 5));
      if (e.key === '-') setScale((s) => Math.max(s - 0.25, 0.25));
      if (e.key === '0') setScale(1);
      if (e.key === 'r') setRotation((r) => (r + 90) % 360);
    };
    if (open) window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const handleDownload = useCallback(() => {
    const a = document.createElement('a');
    a.href = src;
    a.download = title || 'image.png';
    a.click();
  }, [src, title]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      {/* Toolbar */}
      <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
        <button onClick={() => setScale((s) => Math.max(s - 0.25, 0.25))} className="p-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition" title="缩小 (-)"><ZoomOut size={18} /></button>
        <span className="text-white text-xs min-w-[40px] text-center">{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.min(s + 0.25, 5))} className="p-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition" title="放大 (+)"><ZoomIn size={18} /></button>
        <button onClick={() => setScale(1)} className="p-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition text-xs" title="重置 (0)">1:1</button>
        <button onClick={() => setRotation((r) => (r + 90) % 360)} className="p-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition" title="旋转 (R)"><RotateCw size={18} /></button>
        <button onClick={handleDownload} className="p-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition" title="下载"><Download size={18} /></button>
        <button onClick={onClose} className="p-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition" title="关闭 (Esc)"><X size={18} /></button>
      </div>

      {/* Title */}
      {title && (
        <div className="absolute top-4 left-4 text-white text-sm bg-black/40 px-3 py-1.5 rounded-lg z-10">
          {title}
        </div>
      )}

      {/* Image */}
      <div
        className="max-w-[90vw] max-h-[90vh] flex items-center justify-center cursor-grab active:cursor-grabbing"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={alt || ''}
          className="max-w-full max-h-full object-contain transition-transform duration-200"
          style={{ transform: `scale(${scale}) rotate(${rotation}deg)` }}
          draggable={false}
        />
      </div>

      {/* Keyboard hints */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/30 text-[10px] flex gap-3">
        <span>+/- 缩放</span><span>0 重置</span><span>R 旋转</span><span>Esc 关闭</span>
      </div>
    </div>
  );
}
