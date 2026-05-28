import { useState, useCallback } from 'react';
import { Plus, Trash2, Lightbulb, Sparkles } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { STYLE_PRESETS } from '@/data/constants';

interface SellingPointItem {
  id: string;
  text: string;
}

let spCounter = 0;
function nextSpId(): string {
  spCounter += 1;
  return `sp_${Date.now()}_${spCounter}`;
}

const INFOGRAPHIC_STYLES = STYLE_PRESETS.filter((s) => s.category === 'infographic');

export function InfographicConfig() {
  const [sellingPoints, setSellingPoints] = useState<SellingPointItem[]>([
    { id: nextSpId(), text: '' },
    { id: nextSpId(), text: '' },
    { id: nextSpId(), text: '' },
  ]);
  const [selectedInfographicStyle, setSelectedInfographicStyle] = useState<string>(
    INFOGRAPHIC_STYLES[0]?.id ?? ''
  );
  const addToast = useAppStore((s) => s.addToast);

  const updatePoint = useCallback((id: string, text: string) => {
    setSellingPoints((prev) => prev.map((p) => (p.id === id ? { ...p, text } : p)));
  }, []);

  const removePoint = useCallback((id: string) => {
    setSellingPoints((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const addPoint = useCallback(() => {
    setSellingPoints((prev) => [...prev, { id: nextSpId(), text: '' }]);
  }, []);

  const handleGenerate = useCallback(() => {
    const filled = sellingPoints.filter((p) => p.text.trim().length > 0);
    if (filled.length === 0) {
      addToast('warning', '请至少填写一个卖点描述');
      return;
    }
    addToast('success', '信息图生成任务已提交');
  }, [sellingPoints, addToast]);

  return (
    <div className="glass-card p-5">
      <h3 className="section-title">卖点可视化</h3>

      <div className="space-y-2 mb-4">
        {sellingPoints.map((point, index) => (
          <div key={point.id} className="flex items-center gap-2">
            <span className="text-xs text-forge-text2 w-5 flex-shrink-0">{index + 1}.</span>
            <input
              type="text"
              value={point.text}
              onChange={(e) => updatePoint(point.id, e.target.value)}
              placeholder={`卖点 ${index + 1}`}
              className="input-field flex-1 text-sm py-2"
            />
            <button
              onClick={() => removePoint(point.id)}
              className="flex-shrink-0 p-1.5 rounded-md text-forge-text2 hover:text-forge-red hover:bg-forge-red/10 transition-colors"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={addPoint}
        className="w-full py-2 rounded-lg border border-dashed border-forge-border/60 text-forge-text2 hover:text-forge-cyan hover:border-forge-cyan/50 transition-colors flex items-center justify-center gap-1.5 text-sm"
      >
        <Plus size={14} />
        添加卖点
      </button>

      <div className="mt-5 pt-4 border-t border-forge-border/30">
        <div className="flex items-center gap-1.5 mb-3">
          <Lightbulb size={14} className="text-forge-orange" />
          <span className="text-xs font-medium text-forge-text">信息图风格</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {INFOGRAPHIC_STYLES.map((style) => (
            <button
              key={style.id}
              onClick={() => setSelectedInfographicStyle(style.id)}
              className={`p-2.5 rounded-lg border text-center transition-all duration-200 ${
                selectedInfographicStyle === style.id
                  ? 'border-forge-orange bg-forge-orange/10 orange-glow'
                  : 'border-forge-border/50 bg-forge-surface2/40 hover:border-forge-cyan/40'
              }`}
            >
              <span className="text-xs font-medium text-forge-text block truncate">{style.name}</span>
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={handleGenerate}
        className="orange-btn w-full mt-5 py-3 rounded-lg flex items-center justify-center gap-2 text-sm"
      >
        <Sparkles size={16} />
        生成信息图
      </button>
    </div>
  );
}
