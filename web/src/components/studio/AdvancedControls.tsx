import { Ban, SlidersHorizontal } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';

export function AdvancedControls() {
  const negativePrompt = useAppStore((s) => s.negativePrompt);
  const styleStrength = useAppStore((s) => s.styleStrength);
  const setNegativePrompt = useAppStore((s) => s.setNegativePrompt);
  const setStyleStrength = useAppStore((s) => s.setStyleStrength);

  return (
    <div>
      <h3 className="section-title">高级设置</h3>

      <div className="space-y-4">
        <div>
          <label className="flex items-center gap-1.5 text-xs text-forge-text2 font-medium mb-2">
            <Ban size={13} />
            负面提示词
          </label>
          <input
            type="text"
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
            placeholder="不希望出现的内容，例如：blurry, ugly, low quality..."
            className="input-field"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="flex items-center gap-1.5 text-xs text-forge-text2 font-medium">
              <SlidersHorizontal size={13} />
              风格强度
            </label>
            <span className="text-xs font-display font-bold text-forge-cyan">{styleStrength}%</span>
          </div>

          <input
            type="range"
            min={0}
            max={100}
            value={styleStrength}
            onChange={(e) => setStyleStrength(Number(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none bg-forge-surface2 cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-4
              [&::-webkit-slider-thumb]:h-4
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-forge-cyan
              [&::-webkit-slider-thumb]:cursor-pointer
              [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(0,229,255,0.4)]
              [&::-moz-range-thumb]:w-4
              [&::-moz-range-thumb]:h-4
              [&::-moz-range-thumb]:rounded-full
              [&::-moz-range-thumb]:border-0
              [&::-moz-range-thumb]:bg-forge-cyan
              [&::-moz-range-thumb]:cursor-pointer
              [&::-moz-range-thumb]:shadow-[0_0_10px_rgba(0,229,255,0.4)]"
          />

          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-forge-text2/60">原始</span>
            <span className="text-[10px] text-forge-text2/60">强风格</span>
          </div>
        </div>
      </div>
    </div>
  );
}
