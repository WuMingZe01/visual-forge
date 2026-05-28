import { useRef, useEffect } from 'react';
import { Upload, X } from 'lucide-react';
import type { ReferenceImage } from '@/types/tryon-types';
import { formatFileSize } from '@/utils/image';

function genId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

interface UploadBlockProps {
  label: string;
  icon: typeof Upload;
  img: ReferenceImage | null;
  onUp: (img: ReferenceImage) => void;
  onRm: () => void;
  maxSize: number;
}

export function UploadBlock({ label, icon: Icon, img, onUp, onRm, maxSize }: UploadBlockProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // 组件卸载或图片替换时释放 blob URL
  useEffect(() => {
    return () => {
      if (img?.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(img.previewUrl);
      }
    };
  }, [img?.id]);

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > maxSize) return;
    onUp({
      id: genId(),
      type: 'product_front',
      previewUrl: URL.createObjectURL(file),
      name: file.name,
      size: file.size,
    });
  };

  return (
    <div>
      <p className="text-xs text-forge-text2 mb-2 flex items-center gap-1.5">
        <Icon size={13} />
        {label}
      </p>
      {img ? (
        <div className="glass-card p-2 flex items-center gap-3">
          <img
            src={img.previewUrl}
            alt=""
            className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-forge-text truncate">{img.name}</p>
            <p className="text-[10px] text-forge-text2">{formatFileSize(img.size)}</p>
          </div>
          <button
            onClick={onRm}
            className="text-forge-text2/40 hover:text-forge-red p-1"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          className="w-full border-2 border-dashed border-forge-border/50 rounded-xl py-5 text-center hover:border-forge-cyan/30 transition-colors group"
        >
          <Upload
            size={20}
            className="mx-auto text-forge-text2/30 group-hover:text-forge-cyan/50 mb-1"
          />
          <p className="text-xs text-forge-text2/50">点击上传 JPG/PNG/WebP</p>
          <p className="text-[10px] text-forge-text2/30 mt-0.5">
            最大 {Math.round(maxSize / 1024 / 1024)}MB · 超过 2000px 自动压缩
          </p>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
        className="hidden"
      />
    </div>
  );
}
