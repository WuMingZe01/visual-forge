import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { SKUInfo } from '@/types/tryon-types';

interface StyleDropdownProps {
  styles: SKUInfo[];
  onSelect: (style: SKUInfo) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
}

export function StyleDropdown({ styles, onSelect, onClose, anchorRef }: StyleDropdownProps) {
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });

    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [anchorRef, onClose]);

  if (!pos) return null;

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-[9999] glass-card p-1 max-h-64 overflow-y-auto animate-slide-up shadow-2xl border border-forge-border/60"
      style={{ top: pos.top, left: pos.left, width: pos.width }}
    >
      {styles.length === 0 ? (
        <p className="p-3 text-[10px] text-forge-text2/50 text-center">无匹配款式</p>
      ) : (
        <div className="text-[10px]">
          <div className="grid grid-cols-[80px_1fr_1fr_60px] gap-2 px-3 py-1.5 text-forge-text2/50 border-b border-forge-border/20">
            <span>款号</span>
            <span>名称</span>
            <span>品牌</span>
            <span>分类</span>
          </div>
          {styles.map((s) => (
            <button
              key={s.skuCode}
              onClick={() => onSelect(s)}
              className="w-full grid grid-cols-[80px_1fr_1fr_60px] gap-2 px-3 py-2 text-left hover:bg-forge-surface2 transition-all border-b border-forge-border/10"
            >
              <span className="text-forge-cyan font-mono truncate">{s.skuCode}</span>
              <span className="text-forge-text truncate">{s.productName}</span>
              <span className="text-forge-text2 truncate">{s.brand || '-'}</span>
              <span className="text-forge-text2/50 truncate">{s.category || '-'}</span>
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body
  );
}
