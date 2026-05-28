import { Monitor, Smartphone, Tablet } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { ASPECT_PRESETS, RESOLUTION_SCALES } from '@/data/constants';

const ratioIcons: Record<string, typeof Monitor> = {
  '1:1': Monitor,
  '3:4': Smartphone,
  '4:3': Monitor,
  '9:16': Smartphone,
  '16:9': Tablet,
  '2:3': Smartphone,
};

export function AspectRatioPanel() {
  const selectedAspect = useAppStore((s) => s.selectedAspect);
  const selectedResolution = useAppStore((s) => s.selectedResolution);
  const setAspect = useAppStore((s) => s.setAspect);
  const setResolution = useAppStore((s) => s.setResolution);

  const multiplier = RESOLUTION_SCALES.find((r) => r.value === selectedResolution)?.multiplier ?? 1;
  const computedWidth = selectedAspect.width * multiplier;
  const computedHeight = selectedAspect.height * multiplier;

  return (
    <div>
      <h3 className="section-title">画面比例</h3>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {ASPECT_PRESETS.map((preset) => {
          const Icon = ratioIcons[preset.ratio] || Monitor;
          const isSelected = selectedAspect.id === preset.id;
          return (
            <button
              key={preset.id}
              onClick={() => setAspect(preset)}
              className={`glass-card p-3 text-center transition-all duration-200 ${
                isSelected
                  ? 'neon-glow border-forge-cyan/70 bg-forge-cyan/5'
                  : 'hover:border-forge-border/70 hover:bg-forge-surface2/30'
              }`}
            >
              <Icon size={18} className={`mx-auto mb-1.5 ${isSelected ? 'text-forge-cyan' : 'text-forge-text2'}`} />
              <p className={`text-xs font-bold font-display ${isSelected ? 'text-forge-cyan' : 'text-forge-text'}`}>
                {preset.ratio}
              </p>
              <p className="text-[10px] text-forge-text2 mt-0.5 truncate">{preset.scene[0]}</p>
            </button>
          );
        })}
      </div>

      <div className="mb-3">
        <p className="text-xs text-forge-text2 mb-2 font-medium">分辨率</p>
        <div className="flex gap-2">
          {RESOLUTION_SCALES.map((scale) => {
            const isActive = selectedResolution === scale.value;
            return (
              <button
                key={scale.value}
                onClick={() => setResolution(scale.value)}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-forge-cyan/15 text-forge-cyan border border-forge-cyan/40'
                    : 'glass-card hover:border-forge-border/70 text-forge-text2'
                }`}
              >
                {scale.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="glass-card p-3 flex items-center justify-between">
        <span className="text-xs text-forge-text2">计算尺寸</span>
        <span className="text-xs font-display font-bold text-forge-cyan">
          {computedWidth} × {computedHeight} px
        </span>
      </div>
    </div>
  );
}
