import { useState, useRef, type DragEvent } from 'react';
import { Upload, X, Package, User } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { formatFileSize } from '@/utils/helpers';
import type { ReferenceImage } from '@/types';

type TabKey = 'product' | 'model';

const TABS: { key: TabKey; label: string; icon: typeof Package }[] = [
  { key: 'product', label: '商品白底图', icon: Package },
  { key: 'model', label: '模特参考图', icon: User },
];

function generateRefId(): string {
  return `ref_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

interface DropZoneProps {
  images: ReferenceImage[];
  onAdd: (image: ReferenceImage) => void;
  onRemove: (id: string) => void;
  maxCount: number;
}

function DropZone({ images, onAdd, onRemove, maxCount }: DropZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = (file: File) => {
    if (file.size > 10 * 1024 * 1024) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return;

    const reader = new FileReader();
    reader.onload = () => {
      const ref: ReferenceImage = {
        id: generateRefId(),
        type: 'reference',
        previewUrl: reader.result as string,
        name: file.name,
        size: file.size,
      };
      onAdd(ref);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (images.length >= maxCount) break;
      processFile(file);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      if (images.length >= maxCount) break;
      processFile(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (images.length === 0) {
    return (
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
          dragOver
            ? 'border-forge-cyan/60 bg-forge-cyan/5'
            : 'border-forge-border/50 hover:border-forge-border/80'
        }`}
      >
        <Upload size={24} className="mx-auto text-forge-text2/60 mb-2" />
        <p className="text-xs text-forge-text2">拖拽或点击上传</p>
        <p className="text-[10px] text-forge-text2/50 mt-1">JPG / PNG / WebP，≤10MB</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>
    );
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-3 mb-3 cursor-pointer transition-all ${
          dragOver
            ? 'border-forge-cyan/60 bg-forge-cyan/5'
            : 'border-forge-border/50 hover:border-forge-border/80'
        }`}
      >
        <div className="flex items-center justify-center gap-1 text-xs text-forge-text2">
          <Upload size={12} />
          拖拽或点击继续添加
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      <div className="grid grid-cols-3 gap-2 max-h-56 overflow-y-auto">
        {images.map((img) => (
          <div key={img.id} className="glass-card p-1.5 group relative">
            <button
              onClick={() => onRemove(img.id)}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-forge-red flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
            >
              <X size={11} className="text-white" />
            </button>
            <div className="aspect-square rounded-md overflow-hidden bg-forge-surface2 mb-1.5">
              <img src={img.previewUrl} alt={img.name} className="w-full h-full object-cover" />
            </div>
            <p className="text-[10px] text-forge-text2 truncate">{img.name}</p>
            <p className="text-[9px] text-forge-text2/60">{formatFileSize(img.size)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ReferencePanel() {
  const [activeTab, setActiveTab] = useState<TabKey>('product');
  const productImages = useAppStore((s) => s.productImages);
  const modelImages = useAppStore((s) => s.modelImages);
  const addProductImage = useAppStore((s) => s.addProductImage);
  const removeProductImage = useAppStore((s) => s.removeProductImage);
  const addModelImage = useAppStore((s) => s.addModelImage);
  const removeModelImage = useAppStore((s) => s.removeModelImage);

  const images = activeTab === 'product' ? productImages : modelImages;
  const maxCount = 5;

  const handleAdd = (image: ReferenceImage) => {
    const typedImage: ReferenceImage = { ...image, type: activeTab };
    if (activeTab === 'product') {
      if (productImages.length >= maxCount) return;
      addProductImage(typedImage);
    } else {
      if (modelImages.length >= maxCount) return;
      addModelImage(typedImage);
    }
  };

  const handleRemove = (id: string) => {
    if (activeTab === 'product') {
      removeProductImage(id);
    } else {
      removeModelImage(id);
    }
  };

  return (
    <div>
      <h3 className="section-title">参考图片</h3>

      <div className="flex gap-1 mb-3 bg-forge-surface2/30 rounded-lg p-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          const count = tab.key === 'product' ? productImages.length : modelImages.length;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-all ${
                isActive
                  ? 'bg-forge-surface glass-card text-forge-cyan'
                  : 'text-forge-text2 hover:text-forge-text'
              }`}
            >
              <Icon size={13} />
              {tab.label}
              {count > 0 && (
                <span className={`text-[10px] px-1 rounded ${isActive ? 'bg-forge-cyan/20 text-forge-cyan' : 'bg-forge-surface2 text-forge-text2'}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <DropZone
        images={images}
        onAdd={handleAdd}
        onRemove={handleRemove}
        maxCount={maxCount}
      />
    </div>
  );
}
