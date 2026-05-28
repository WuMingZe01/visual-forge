import { useState, useCallback } from 'react';
import {
  Monitor,
  Tent,
  Camera,
  Gem,
  Coffee,
  Umbrella,
  Building2,
  LayoutGrid,
  Wand2,
  Check,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { SCENARIO_TEMPLATES } from '@/data/constants';

const ICON_MAP: Record<string, React.ComponentType<{ size?: number | string; className?: string }>> = {
  Monitor,
  Tent,
  Camera,
  Gem,
  Coffee,
  Umbrella,
  Building2,
  LayoutGrid,
};

export function ScenarioExtension() {
  const [selectedScenarios, setSelectedScenarios] = useState<string[]>([]);
  const [customScenario, setCustomScenario] = useState('');
  const addToast = useAppStore((s) => s.addToast);

  const toggleScenario = useCallback((id: string) => {
    setSelectedScenarios((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }, []);

  const handleGenerate = useCallback(() => {
    if (selectedScenarios.length === 0 && !customScenario.trim()) {
      addToast('warning', '请至少选择一个场景模板或输入自定义场景描述');
      return;
    }
    addToast('success', '场景图生成任务已提交');
  }, [selectedScenarios, customScenario, addToast]);

  return (
    <div className="glass-card p-5">
      <h3 className="section-title">场景化延展</h3>

      <div className="grid grid-cols-2 gap-2.5">
        {SCENARIO_TEMPLATES.map((template) => {
          const Icon = ICON_MAP[template.icon];
          const isSelected = selectedScenarios.includes(template.id);
          return (
            <button
              key={template.id}
              onClick={() => toggleScenario(template.id)}
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
                <span className="text-sm font-medium text-forge-text">{template.name}</span>
              </div>
              <p className="text-xs text-forge-text2 leading-relaxed">{template.description}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-4">
        <input
          type="text"
          value={customScenario}
          onChange={(e) => setCustomScenario(e.target.value)}
          placeholder="输入自定义场景描述（可选）..."
          className="input-field text-sm"
        />
      </div>

      <button
        onClick={handleGenerate}
        className="orange-btn w-full mt-4 py-3 rounded-lg flex items-center justify-center gap-2 text-sm"
      >
        <Wand2 size={16} />
        一键生成场景图
      </button>
    </div>
  );
}
