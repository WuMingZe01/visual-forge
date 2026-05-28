import { useState, useRef, useEffect } from 'react';
import { Cpu, ChevronDown } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { AI_MODELS } from '@/data/constants';

export function ModelSelector() {
  const selectedModel = useAppStore((s) => s.selectedModel);
  const setModel = useAppStore((s) => s.setModel);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const providerColor = (p: string) => (p === 'yunwu' ? 'bg-forge-cyan' : 'bg-forge-orange');
  const providerLabel = (p: string) => (p === 'yunwu' ? 'Yunwu' : 'Grsai');

  return (
    <div className="relative" ref={ref}>
      <h3 className="section-title">AI 模型</h3>

      <button
        onClick={() => setOpen(!open)}
        className="w-full glass-card-hover p-4 text-left cursor-pointer"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-forge-surface2 flex items-center justify-center">
              <Cpu size={20} className="text-forge-cyan" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-forge-text text-sm">{selectedModel.name}</span>
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${selectedModel.provider === 'yunwu' ? 'bg-forge-cyan/15 text-forge-cyan' : 'bg-forge-orange/15 text-forge-orange'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${providerColor(selectedModel.provider)}`} />
                  {providerLabel(selectedModel.provider)}
                </span>
              </div>
              {selectedModel.recommendedFor && selectedModel.recommendedFor.length > 0 && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  {selectedModel.recommendedFor.map((tag) => (
                    <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-forge-surface2 text-forge-text2">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <ChevronDown size={18} className={`text-forge-text2 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-full glass-card p-1.5 animate-fade-in max-h-72 overflow-y-auto">
          {AI_MODELS.map((model) => (
            <button
              key={model.id}
              onClick={() => {
                setModel(model);
                setOpen(false);
              }}
              className={`w-full text-left p-3 rounded-lg transition-all duration-150 flex items-center gap-3 ${
                selectedModel.id === model.id
                  ? 'bg-forge-cyan/10 border border-forge-cyan/30'
                  : 'hover:bg-forge-surface2/70 border border-transparent'
              }`}
            >
              <div className="w-8 h-8 rounded-lg bg-forge-surface2 flex items-center justify-center flex-shrink-0">
                <Cpu size={15} className={selectedModel.id === model.id ? 'text-forge-cyan' : 'text-forge-text2'} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`font-medium text-sm truncate ${selectedModel.id === model.id ? 'text-forge-cyan' : 'text-forge-text'}`}>
                    {model.name}
                  </span>
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${model.provider === 'yunwu' ? 'bg-forge-cyan/15 text-forge-cyan' : 'bg-forge-orange/15 text-forge-orange'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${providerColor(model.provider)}`} />
                    {providerLabel(model.provider)}
                  </span>
                </div>
                {model.recommendedFor && model.recommendedFor.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {model.recommendedFor.map((tag) => (
                      <span key={tag} className="text-[10px] px-1 py-0.5 rounded bg-forge-surface2/80 text-forge-text2">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
