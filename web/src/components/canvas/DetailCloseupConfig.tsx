import { useState, useCallback } from 'react';
import {
  Layers,
  Zap,
  Grid3x3,
  Plug,
  Circle,
  Triangle,
  Smartphone,
  BadgeCheck,
  ZoomIn,
  Check,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { DETAIL_CLOSEUPS } from '@/data/constants';

const ICON_MAP: Record<string, React.ComponentType<{ size?: number | string; className?: string }>> = {
  Layers,
  Zap,
  Grid3x3,
  Plug,
  Circle,
  Triangle,
  Smartphone,
  BadgeCheck,
};

export function DetailCloseupConfig() {
  const [selectedCloseups, setSelectedCloseups] = useState<string[]>([]);
  const addToast = useAppStore((s) => s.addToast);

  const toggleCloseup = useCallback((id: string) => {
    setSelectedCloseups((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }, []);

  const handleGenerate = useCallback(() => {
    if (selectedCloseups.length === 0) {
      addToast('warning', '请至少选择一个细节特写类型');
      return;
    }
    addToast('success', '特写图生成任务已提交');
  }, [selectedCloseups, addToast]);

  return (
    <div className="glass-card p-5">
      <h3 className="section-title">细节特写</h3>

      {DETAIL_CLOSEUPS.length === 0 ? (
        <p className="text-sm text-forge-text2 py-6 text-center">暂无可用特写模板</p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {DETAIL_CLOSEUPS.map((closeup) => {
            const Icon = ICON_MAP[closeup.icon];
            const isSelected = selectedCloseups.includes(closeup.id);
            return (
              <button
                key={closeup.id}
                onClick={() => toggleCloseup(closeup.id)}
                className={`relative p-3 rounded-lg border text-left transition-all duration-200 ${
                  isSelected
                    ? 'border-forge-orange bg-forge-orange/10 orange-glow'
                    : 'border-forge-border/50 bg-forge-surface2/40 hover:border-forge-cyan/40'
                }`}
              >
                {isSelected && (
                  <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-forge-orange flex items-center justify-center">
                    <Check size={12} className="text-white" />
                  </span>
                )}
                <div className="flex items-center gap-2 mb-1">
                  {Icon && <Icon size={18} className={isSelected ? 'text-forge-orange' : 'text-forge-cyan'} />}
                  <span className="text-sm font-medium text-forge-text">{closeup.name}</span>
                </div>
                <p className="text-xs text-forge-text2 leading-relaxed">{closeup.description}</p>
              </button>
            );
          })}
        </div>
      )}

      <button
        onClick={handleGenerate}
        className="orange-btn w-full mt-5 py-3 rounded-lg flex items-center justify-center gap-2 text-sm"
      >
        <ZoomIn size={16} />
        生成特写图
      </button>
    </div>
  );
}
