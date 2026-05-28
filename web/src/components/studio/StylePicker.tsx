import { useRef } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { STYLE_PRESETS } from '@/data/constants';
import type { StylePreset } from '@/types';

const CATEGORY_ORDER = ['cover', 'infographic', 'freeform', 'ppt'] as const;

const CATEGORY_LABELS: Record<string, string> = {
  cover: '封面图',
  infographic: '信息图',
  freeform: '自由生图',
  ppt: 'PPT 截图',
};

function groupByCategory(presets: StylePreset[]) {
  const groups: Record<string, StylePreset[]> = {};
  for (const cat of CATEGORY_ORDER) {
    groups[cat] = presets.filter((p) => p.category === cat);
  }
  return groups;
}

export function StylePicker() {
  const selectedStyle = useAppStore((s) => s.selectedStyle);
  const setStyle = useAppStore((s) => s.setStyle);
  const scrollRef = useRef<HTMLDivElement>(null);

  const grouped = groupByCategory(STYLE_PRESETS);

  const scroll = (dir: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const amount = dir === 'left' ? -280 : 280;
    scrollRef.current.scrollBy({ left: amount, behavior: 'smooth' });
  };

  return (
    <div>
      <h3 className="section-title">风格选择</h3>

      {CATEGORY_ORDER.map((category) => {
        const items = grouped[category];
        if (!items || items.length === 0) return null;

        return (
          <div key={category} className="mb-4">
            <p className="text-[11px] text-forge-text2 font-medium uppercase tracking-wider mb-2">
              {CATEGORY_LABELS[category] || category}
            </p>

            <div className="relative group">
              <button
                onClick={() => scroll('left')}
                className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-forge-surface/90 border border-forge-border/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:border-forge-cyan/50"
              >
                <ChevronLeft size={14} className="text-forge-text2" />
              </button>

              <div
                ref={scrollRef}
                className="flex gap-2 overflow-x-auto scrollbar-none pb-1"
              >
                {items.map((style) => {
                  const isSelected = selectedStyle?.id === style.id;
                  return (
                    <button
                      key={style.id}
                      onClick={() => setStyle(isSelected ? null : style)}
                      className={`flex-shrink-0 w-[130px] glass-card overflow-hidden transition-all duration-200 ${
                        isSelected
                          ? 'neon-glow border-forge-cyan/70 bg-forge-cyan/5'
                          : 'hover:border-forge-border/70'
                      }`}
                    >
                      <div className={`h-1.5 w-full bg-gradient-to-r ${style.colorGradient || 'from-forge-cyan to-forge-purple'}`} />
                      <div className="p-2.5">
                        <p className={`text-[11px] font-medium text-left truncate ${isSelected ? 'text-forge-cyan' : 'text-forge-text'}`}>
                          {style.name}
                        </p>
                        <span className={`inline-block mt-1 text-[9px] px-1.5 py-0.5 rounded ${
                          isSelected
                            ? 'bg-forge-cyan/15 text-forge-cyan'
                            : 'bg-forge-surface2 text-forge-text2'
                        }`}>
                          {CATEGORY_LABELS[style.category] || style.category}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => scroll('right')}
                className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-forge-surface/90 border border-forge-border/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:border-forge-cyan/50"
              >
                <ChevronRight size={14} className="text-forge-text2" />
              </button>
            </div>
          </div>
        );
      })}

      {selectedStyle && (
        <button
          onClick={() => setStyle(null)}
          className="mt-2 text-xs text-forge-text2 hover:text-forge-red transition-colors flex items-center gap-1"
        >
          <X size={12} />
          清除风格选择
        </button>
      )}
    </div>
  );
}
