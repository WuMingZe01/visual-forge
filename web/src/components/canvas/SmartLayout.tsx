import { useState, useCallback, useMemo } from 'react';
import {
  LayoutGrid,
  MoveDiagonal,
  BookOpen,
  Rows3,
  ImagePlus,
  Image as ImageIcon,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { LAYOUT_TEMPLATES } from '@/data/constants';

const ICON_MAP: Record<string, React.ComponentType<{ size?: number | string; className?: string }>> = {
  LayoutGrid,
  MoveDiagonal,
  BookOpen,
  Rows3,
};

export function SmartLayout() {
  const [selectedLayout, setSelectedLayout] = useState<string>('');
  const addToast = useAppStore((s) => s.addToast);
  const taskHistory = useAppStore((s) => s.taskHistory);

  const completedAssets = useMemo(
    () => taskHistory.filter((t) => t.status === 'completed' && t.resultUrls.length > 0),
    [taskHistory]
  );

  const handleGenerate = useCallback(() => {
    if (!selectedLayout) {
      addToast('warning', '请先选择一个排版模板');
      return;
    }
    addToast('success', '详情长图生成任务已提交');
  }, [selectedLayout, addToast]);

  return (
    <div className="glass-card p-5">
      <h3 className="section-title">智能排版</h3>

      <div className="grid grid-cols-2 gap-2.5 mb-4">
        {LAYOUT_TEMPLATES.map((template) => {
          const Icon = ICON_MAP[template.icon];
          const isSelected = selectedLayout === template.id;
          return (
            <button
              key={template.id}
              onClick={() => setSelectedLayout(template.id)}
              className={`p-3 rounded-lg border text-left transition-all duration-200 ${
                isSelected
                  ? 'border-forge-orange bg-forge-orange/10 orange-glow'
                  : 'border-forge-border/50 bg-forge-surface2/40 hover:border-forge-cyan/40'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                {Icon && <Icon size={18} className={isSelected ? 'text-forge-orange' : 'text-forge-cyan'} />}
                <span className="text-sm font-medium text-forge-text">{template.name}</span>
              </div>
              <p className="text-xs text-forge-text2 leading-relaxed">{template.description}</p>
            </button>
          );
        })}
      </div>

      <div className="flex gap-4">
        <div className="w-24 flex-shrink-0">
          <div className="flex items-center gap-1.5 mb-2">
            <ImageIcon size={14} className="text-forge-cyan" />
            <span className="text-xs text-forge-text2">已生成素材</span>
          </div>
          <span className="text-lg font-display font-bold text-forge-cyan">{completedAssets.length}</span>

          <div className="mt-2 space-y-1.5">
            {completedAssets.length === 0 ? (
              <p className="text-[10px] text-forge-text2/60">暂无素材</p>
            ) : (
              completedAssets.slice(0, 4).map((asset) => (
                <div
                  key={asset.id}
                  className="w-full aspect-square rounded-md bg-forge-surface2 border border-forge-border/40 flex items-center justify-center overflow-hidden"
                >
                  <img
                    src={asset.resultUrls[0]}
                    alt=""
                    className="w-full h-full object-cover opacity-60"
                  />
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex-1">
          <div className="h-48 rounded-lg border-2 border-dashed border-forge-border/60 flex items-center justify-center p-4">
            <p className="text-xs text-forge-text2/60 text-center leading-relaxed">
              将生成的场景图、卖点图、特写图拖入此区域进行排版
            </p>
          </div>
        </div>
      </div>

      <button
        onClick={handleGenerate}
        className="orange-btn w-full mt-5 py-3 rounded-lg flex items-center justify-center gap-2 text-sm"
      >
        <ImagePlus size={16} />
        生成详情长图
      </button>
    </div>
  );
}
