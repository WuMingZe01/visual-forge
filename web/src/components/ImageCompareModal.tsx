import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Download, ChevronLeft, ChevronRight, MoveHorizontal } from 'lucide-react';

export interface CompareImage {
  url: string;
  label: string;
}

interface ImageCompareModalProps {
  open: boolean;
  onClose: () => void;
  beforeUrl: string;
  beforeLabel?: string;
  images: CompareImage[];
  activeIndex?: number;
  onDownload?: (url: string) => void;
}

export function ImageCompareModal({
  open,
  onClose,
  beforeUrl,
  beforeLabel = '参考原图',
  images,
  activeIndex = 0,
  onDownload,
}: ImageCompareModalProps) {
  const [index, setIndex] = useState(activeIndex);
  const [sliderPos, setSliderPos] = useState(50);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIndex(activeIndex);
  }, [activeIndex, open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) setIndex(index - 1);
      if (e.key === 'ArrowRight' && index < images.length - 1) setIndex(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, index, images.length, onClose]);

  const current = images[index];

  const calcPercent = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return 50;
    return Math.max(2, Math.min(98, ((clientX - rect.left) / rect.width) * 100));
  }, []);

  const onMouseDown = useCallback(() => setDragging(true), []);
  const onTouchStart = useCallback(() => setDragging(true), []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      setSliderPos(calcPercent(clientX));
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove);
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [dragging, calcPercent]);

  if (!open || !current) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
          <span className="text-sm text-white/80 font-medium">
            {current.label}
          </span>
          <span className="text-xs text-white/40">
            {index + 1} / {images.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {onDownload && (
            <button
              onClick={() => onDownload(current.url)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 text-xs transition-colors"
            >
              <Download size={14} /> 下载
            </button>
          )}
        </div>
      </div>

      {/* Compare area */}
      <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
        <div
          ref={containerRef}
          className="relative w-full h-full max-w-[90vw] max-h-[85vh] select-none rounded-xl overflow-hidden bg-[#1a1a1a]"
          style={{ cursor: dragging ? 'ew-resize' : 'default' }}
        >
          {/* Before image (reference) - full width base */}
          <img
            src={beforeUrl}
            alt="参考原图"
            className="absolute inset-0 w-full h-full object-contain"
            draggable={false}
          />
          {/* Before label */}
          <div className="absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-black/60 text-white/80 text-xs font-medium backdrop-blur-sm pointer-events-none z-20">
            {beforeLabel}
          </div>

          {/* After image (generated) - clip-path reveal from left */}
          <img
            src={current.url}
            alt={current.label}
            className="absolute inset-0 w-full h-full object-contain"
            style={{
              clipPath: `inset(0 ${100 - sliderPos}% 0 0)`,
            }}
            draggable={false}
          />
          {/* After label */}
          <div
            className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-forge-cyan/80 text-white text-xs font-medium backdrop-blur-sm pointer-events-none z-20"
            style={{ opacity: sliderPos > 15 ? 1 : 0 }}
          >
            生成结果
          </div>

          {/* Divider line */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_8px_rgba(0,0,0,0.5)] cursor-ew-resize z-10"
            style={{ left: `${sliderPos}%` }}
            onMouseDown={onMouseDown}
            onTouchStart={onTouchStart}
          >
            {/* Drag handle */}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-white shadow-lg flex items-center justify-center cursor-ew-resize"
              onMouseDown={onMouseDown}
              onTouchStart={onTouchStart}
            >
              <MoveHorizontal size={14} className="text-gray-700" />
            </div>
          </div>

          {/* Position indicator */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/60 text-white/60 text-[10px] backdrop-blur-sm pointer-events-none z-20">
            拖拽中间滑块对比 · {Math.round(sliderPos)}%
          </div>
        </div>
      </div>

      {/* Navigation arrows */}
      {images.length > 1 && (
        <>
          {index > 0 && (
            <button
              onClick={() => setIndex(index - 1)}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors z-20"
            >
              <ChevronLeft size={28} />
            </button>
          )}
          {index < images.length - 1 && (
            <button
              onClick={() => setIndex(index + 1)}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors z-20"
            >
              <ChevronRight size={28} />
            </button>
          )}
        </>
      )}

      {/* Thumbnails */}
      {images.length > 1 && (
        <div className="flex items-center justify-center gap-2 py-3 border-t border-white/10 overflow-x-auto">
          {images.map((img, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              className={`flex-shrink-0 w-12 h-16 rounded-lg overflow-hidden border-2 transition-all ${
                i === index
                  ? 'border-forge-cyan shadow-[0_0_8px_rgba(0,200,255,0.3)]'
                  : 'border-white/10 hover:border-white/30 opacity-60 hover:opacity-100'
              }`}
            >
              <img
                src={img.url}
                alt={img.label}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
