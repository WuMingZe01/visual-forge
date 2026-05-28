import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Layers, Eye, ChevronDown, ChevronUp, Sparkles, ArrowRight } from 'lucide-react';
import { useEcoStore } from '@/store/useEcoStore';
import type { AssembledPrompt } from '@/types/eco-types';

const MAIN_IMAGE_LABELS: Record<string, string> = {
  H1: 'H1 一眼可懂的视觉主张  ',
  H2: 'H2 核心特写 / 材质质感',
  H3: 'H3 场景匹配 / 使用场景',
  H4: 'H4 对比 / 竞品对比',
  H5: 'H5 保障 / CTA 信任背书',
};

export function StudioPage() {
  const navigate = useNavigate();
  const prompts = useEcoStore((s) => s.prompts);
  const fullPlan = useEcoStore((s) => s.fullPlan);
  const generatedResults = useEcoStore((s) => s.generatedResults);
  const styleLock = useEcoStore((s) => s.styleLock);
  const isGenerating = useEcoStore((s) => s.isGenerating);
  const addToast = useEcoStore((s) => s.addToast);

  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);

  const mainImagePrompts = prompts
    .filter((p) => p.imagePlan.isMainImage && p.imagePlan.screenId.startsWith('H'))
    .sort((a, b) => a.imagePlan.seqIndex - b.imagePlan.seqIndex);

  const togglePrompt = (screenId: string) => {
    setExpandedPrompt((prev) => (prev === screenId ? null : screenId));
  };

  const handleGenerateAllMain = () => {
    if (mainImagePrompts.length === 0) {
      addToast('warning', '暂无主图计划，请先在策略中心完成诊断');
      return;
    }
    addToast('info', `主图生成任务已启动 (${mainImagePrompts.length} 张)`);
  };

  if (!fullPlan || mainImagePrompts.length === 0) {
    return (
      <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-forge-cyan to-blue-500 flex items-center justify-center">
            <Camera size={20} className="text-forge-bg" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-gradient-cyan tracking-wider">
              主图/副图矩阵
            </h2>
            <p className="text-xs text-forge-text2">5张主图堆栈 — H1首图卖点 / H2核心特写 / H3场景匹配 / H4对比 / H5保障CTA</p>
          </div>
        </div>

        <div className="glass-card p-10 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-forge-surface2 flex items-center justify-center">
            <Camera size={28} className="text-forge-text2/40" />
          </div>
          <h3 className="text-forge-text font-medium mb-2">请先在策略中心完成诊断和计划</h3>
          <p className="text-forge-text2 text-sm mb-6 max-w-md mx-auto">
            尚未检测到完整的主图生成计划。请前往策略中心输入产品信息，系统将自动诊断并生成 5 张主图的拍摄方案。
          </p>
          <button
            onClick={() => navigate('/')}
            className="orange-btn px-6 py-2.5 rounded-lg text-sm inline-flex items-center gap-2"
          >
            前往策略中心
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-forge-cyan to-blue-500 flex items-center justify-center">
            <Camera size={20} className="text-forge-bg" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-gradient-cyan tracking-wider">
              主图/副图矩阵
            </h2>
            <p className="text-xs text-forge-text2">5张主图堆栈 — H1首图卖点 / H2核心特写 / H3场景匹配 / H4对比 / H5保障CTA</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-forge-cyan/10 border border-forge-cyan/30 text-xs text-forge-cyan">
            <div className="w-1.5 h-1.5 rounded-full bg-forge-cyan animate-pulse-glow" />
            风格锁已激活
          </div>
          <button
            onClick={handleGenerateAllMain}
            disabled={isGenerating}
            className="orange-btn px-5 py-2 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50"
          >
            <Sparkles size={16} />
            批量生成主图
          </button>
        </div>
      </div>

      <div className="glass-card p-3 flex items-center gap-4 text-xs">
        <div className="flex items-center gap-2">
          <Layers size={14} className="text-forge-cyan" />
          <span className="text-forge-text2">锁定风格</span>
          <span className="text-forge-text font-medium truncate max-w-[220px]">
            {styleLock?.config?.colorTemp} · {styleLock?.config?.backgroundSystem} · {styleLock?.config?.lightingSystem}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2 text-forge-text2">
          <span>驱动模型</span>
          <span className="px-2 py-0.5 rounded bg-forge-surface2 text-forge-cyan font-medium">
            {fullPlan.driver === 'visual' ? '视觉驱动' : fullPlan.driver === 'pain_point' ? '痛点驱动' : '情感驱动'}
          </span>
          <span className="text-forge-text2">宽幅镜头 {fullPlan.totalWide}/{fullPlan.maxWide}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {mainImagePrompts.map((item) => (
          <MainImageCard
            key={item.screenId}
            item={item}
            generatedUrls={generatedResults[item.screenId]}
            isExpanded={expandedPrompt === item.screenId}
            onTogglePrompt={() => togglePrompt(item.screenId)}
          />
        ))}
      </div>

      <div className="glass-card p-4 flex items-center justify-between">
        <div className="flex items-center gap-3 text-sm">
          <Layers size={18} className="text-forge-cyan" />
          <span className="text-forge-text2">
            主图堆栈 <span className="text-forge-cyan font-bold">{mainImagePrompts.length}</span> 张
          </span>
          <span className="text-forge-text2/50">|</span>
          <span className="text-forge-text2">
            已生成 <span className="text-forge-green font-bold">{Object.keys(generatedResults).filter((k) => k.startsWith('H')).length}</span> 张
          </span>
        </div>
        <button
          onClick={handleGenerateAllMain}
          disabled={isGenerating}
          className="gradient-btn px-6 py-2.5 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50"
        >
          <Sparkles size={16} />
          {isGenerating ? '生成中...' : '生成全部主图'}
        </button>
      </div>
    </div>
  );
}

function MainImageCard({
  item,
  generatedUrls,
  isExpanded,
  onTogglePrompt,
}: {
  item: AssembledPrompt;
  generatedUrls: string[] | undefined;
  isExpanded: boolean;
  onTogglePrompt: () => void;
}) {
  const plan = item.imagePlan;
  const hasResult = generatedUrls && generatedUrls.length > 0;
  const label = MAIN_IMAGE_LABELS[plan.screenId] || `${plan.screenId} ${plan.purpose}`;

  return (
    <div className="glass-card-hover flex flex-col animate-slide-up">
      <div className="p-3 border-b border-forge-border/30">
        <div className="flex items-start justify-between mb-1.5">
          <span className="text-xs font-bold text-forge-cyan tracking-wide">{plan.screenId}</span>
          {plan.platformOverlay && plan.screenId === 'H1' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-forge-red/15 text-forge-red font-medium flex items-center gap-1">
              <Eye size={10} />
              价格叠区
            </span>
          )}
        </div>
        <p className="text-xs text-forge-text leading-relaxed line-clamp-2">{label}</p>
      </div>

      <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] text-forge-text2 border-b border-forge-border/20">
        <span className="px-1.5 py-0.5 rounded bg-forge-surface2">角度: {plan.cameraAngleText}</span>
        <span className="text-forge-text2/40">·</span>
        <span>
          占比 {plan.productRatio}% · 留白 {plan.whitespaceRate}%
        </span>
      </div>

      <div className="p-3 flex-1 flex flex-col items-center justify-center min-h-[180px]">
        <div
          className={`w-full aspect-square rounded-lg flex items-center justify-center overflow-hidden ${
            hasResult
              ? 'border border-forge-border/30'
              : 'border-2 border-dashed border-forge-border/40 bg-forge-surface2/30'
          }`}
        >
          {hasResult ? (
            <img
              src={generatedUrls[0]}
              alt={`${plan.screenId} 生成图`}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="text-center px-2">
              <Camera size={24} className="mx-auto text-forge-text2/25 mb-1" />
              <span className="text-[10px] text-forge-text2/40">等待生成</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 mt-2 w-full">
          <div
            className="w-3 h-3 rounded-full border border-forge-border/50 flex-shrink-0"
            style={{ backgroundColor: plan.bgHex }}
            title={`背景色 ${plan.bgHex}`}
          />
          <span className="text-[10px] text-forge-text2 truncate">{plan.aspectRatio}</span>
          {plan.platformOverlay && (
            <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded font-medium ${
              plan.screenId === 'H1'
                ? 'bg-forge-red/15 text-forge-red'
                : 'bg-forge-text2/10 text-forge-text2'
            }`}>
              {plan.screenId === 'H1' ? '价格叠区 ON' : '叠区 OFF'}
            </span>
          )}
        </div>
      </div>

      <div className="border-t border-forge-border/20">
        <button
          onClick={onTogglePrompt}
          className="w-full flex items-center justify-between px-3 py-2 text-[10px] text-forge-text2 hover:text-forge-cyan transition-colors"
        >
          <span className="truncate text-left flex-1 mr-2">
            Prompt: {item.prompt.slice(0, 40)}...
          </span>
          {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        {isExpanded && (
          <div className="px-3 pb-3 animate-slide-up">
            <div className="p-2 rounded bg-forge-surface2/70 border border-forge-border/30 text-[10px] text-forge-text2 leading-relaxed whitespace-pre-wrap max-h-[160px] overflow-y-auto">
              {item.prompt}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
