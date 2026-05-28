import { Loader2, Info, X } from 'lucide-react';
import type { LLMStep } from '@/hooks/useAIPrompt';

interface ChipProps {
  label: string;
  value: string;
}

export function Chip({ label, value }: ChipProps) {
  return (
    <div className="p-1.5 rounded bg-forge-surface2/60 border border-forge-border/20">
      <p className="text-forge-text2/50">{label}</p>
      <p className="text-forge-text truncate">{value}</p>
    </div>
  );
}

interface LLMStepsProps {
  steps: LLMStep[];
}

export function LLMSteps({ steps }: LLMStepsProps) {
  if (steps.length === 0) return null;

  return (
    <div className="space-y-1.5 p-2 rounded bg-forge-surface2/50 border border-forge-border/20">
      {steps.map((s, i) => (
        <div
          key={i}
          className={`flex items-start gap-1.5 text-[10px] ${
            s.status === 'fail'
              ? 'text-forge-red'
              : s.status === 'done'
              ? 'text-forge-green'
              : 'text-forge-cyan'
          }`}
        >
          {s.status === 'running' ? (
            <Loader2 size={10} className="animate-spin mt-0.5 flex-shrink-0" />
          ) : s.status === 'done' ? (
            <Info size={10} className="mt-0.5 flex-shrink-0" />
          ) : (
            <X size={10} className="mt-0.5 flex-shrink-0" />
          )}
          <span className="flex-1">{s.step}</span>
        </div>
      ))}
    </div>
  );
}
