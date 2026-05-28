import { useCallback } from 'react';
import {
  Sparkles, Target, Plus, Trash2, Wand2,
  Palette, Sun, Eye, Settings, ListChecks,
} from 'lucide-react';
import type {
  ProductInputData, StyleLockConfig,
} from '@/types/eco-types';
import { CAMERA_ANGLES } from '@/services/ecoprompt/camera';
import { useEcoStore } from '@/store/useEcoStore';

const DRIVER_LABELS: Record<string, string> = {
  visual: '视觉驱动型',
  pain_point: '痛点驱动型',
  emotional: '情感价值驱动型',
};

const DRIVER_BAR_COLORS: Record<string, { bar: string; text: string }> = {
  visual: { bar: 'bg-forge-cyan', text: 'text-forge-cyan' },
  pain_point: { bar: 'bg-forge-orange', text: 'text-forge-orange' },
  emotional: { bar: 'bg-purple-500', text: 'text-purple-400' },
};

const TEMP_OPTIONS = [
  { value: 'warm' as const, label: '暖调 warm' },
  { value: 'cool' as const, label: '冷调 cool' },
  { value: 'neutral' as const, label: '中性 neutral' },
];

const ROLE_LABELS: Record<string, string> = {
  background: '背景',
  text_primary: '主文字',
  accent: '强调',
  secondary: '次要',
};

const ANGLE_COLORS: Record<string, string> = {
  front34: 'bg-forge-cyan',
  overhead: 'bg-blue-500',
  side90: 'bg-forge-green',
  rear45: 'bg-forge-yellow',
  lowAngle: 'bg-forge-orange',
  macro: 'bg-purple-500',
};

export function StrategyCenter() {
  const productInput = useEcoStore((s) => s.productInput);
  const setProductInput = useEcoStore((s) => s.setProductInput);
  const addSellingPoint = useEcoStore((s) => s.addSellingPoint);
  const removeSellingPoint = useEcoStore((s) => s.removeSellingPoint);
  const driverResult = useEcoStore((s) => s.driverResult);
  const styleLock = useEcoStore((s) => s.styleLock);
  const styleLockConfig = useEcoStore((s) => s.styleLockConfig);
  const setStyleLockConfig = useEcoStore((s) => s.setStyleLockConfig);
  const fullPlan = useEcoStore((s) => s.fullPlan);
  const runDiagnosis = useEcoStore((s) => s.runDiagnosis);
  const runStyleLock = useEcoStore((s) => s.runStyleLock);
  const runFullPlan = useEcoStore((s) => s.runFullPlan);
  const addToast = useEcoStore((s) => s.addToast);

  const handleDiagnose = useCallback(() => {
    if (!productInput.category.trim()) {
      addToast('warning', '请先填写产品品类');
      return;
    }
    runDiagnosis();
    addToast('success', `诊断完成：${DRIVER_LABELS[driverResult?.driver ?? 'visual']}`);
  }, [productInput.category, runDiagnosis, addToast, driverResult]);

  const handleGenerateLockText = useCallback(() => {
    runStyleLock();
    addToast('success', '风格锁文本已生成');
  }, [runStyleLock, addToast]);

  const handleGenerateFullPlan = useCallback(() => {
    if (!productInput.category.trim()) {
      addToast('warning', '请先填写产品信息');
      return;
    }
    runFullPlan();
    addToast('success', `完整计划已生成`);
  }, [productInput.category, runFullPlan, addToast]);

  const updateLockField = (field: keyof StyleLockConfig, value: string) => {
    setStyleLockConfig({ [field]: value });
  };

  const updatePaletteColor = (index: number, hex: string) => {
    const nextPalette = styleLockConfig.palette.map((c, i) => (i === index ? { ...c, hex } : c));
    setStyleLockConfig({ palette: nextPalette });
  };

  const updateSellingPoint = (index: number, val: string) => {
    const next = [...productInput.sellingPoints];
    next[index] = val;
    setProductInput({ sellingPoints: next });
  };

  const handleAddSellingPoint = () => {
    addSellingPoint('');
  };

  const maxSignal = driverResult
    ? Math.max(driverResult.signals.visual, driverResult.signals.painPoint, driverResult.signals.emotional) || 1
    : 1;

  const angleDefMap = new Map(CAMERA_ANGLES.map((a) => [a.id, a]));

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-forge-cyan to-blue-500 flex items-center justify-center">
          <Sparkles size={20} className="text-forge-bg" />
        </div>
        <div>
          <h2 className="font-display text-lg font-bold text-gradient-cyan tracking-wider">
            策略控制中心
          </h2>
          <p className="text-xs text-forge-text2">转化诊断 + 风格锁定 + 图片计划</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[45fr_55fr] gap-6">
        {/* ========== LEFT COLUMN ========== */}
        <div className="space-y-5">
          {/* Product Input */}
          <div className="glass-card p-5">
            <h3 className="section-title flex items-center gap-2">
              <Target size={14} />
              产品信息
            </h3>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-forge-text2 mb-1 block">品类</label>
                <input
                  className="input-field"
                  value={productInput.category}
                  onChange={(e) => setProductInput({ category: e.target.value })}
                  placeholder="例如：美妆、3C数码、家居..."
                />
              </div>

              <div>
                <label className="text-xs text-forge-text2 mb-1 block">卖点</label>
                <div className="space-y-1.5">
                  {productInput.sellingPoints.map((sp, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <input
                        className="input-field flex-1"
                        value={sp}
                        onChange={(e) => updateSellingPoint(i, e.target.value)}
                        placeholder={`卖点 ${i + 1}`}
                      />
                      <button
                        onClick={() => removeSellingPoint(i)}
                        className="p-2 text-forge-text2/50 hover:text-forge-red transition-colors flex-shrink-0"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleAddSellingPoint}
                  className="mt-2 flex items-center gap-1.5 text-xs text-forge-cyan hover:text-forge-cyan/80 transition-colors"
                >
                  <Plus size={14} />
                  添加卖点
                </button>
              </div>

              <div>
                <label className="text-xs text-forge-text2 mb-1 block">目标受众</label>
                <input
                  className="input-field"
                  value={productInput.targetAudience}
                  onChange={(e) => setProductInput({ targetAudience: e.target.value })}
                  placeholder="例如：25-35岁都市女性..."
                />
              </div>

              <div>
                <label className="text-xs text-forge-text2 mb-1 block">证明资产</label>
                <textarea
                  className="textarea-field"
                  rows={3}
                  value={productInput.proofAssets}
                  onChange={(e) => setProductInput({ proofAssets: e.target.value })}
                  placeholder="专利、检测报告、明星代言、销量数据..."
                />
              </div>
            </div>
          </div>

          {/* Driver Diagnosis */}
          <div className="glass-card p-5">
            <h3 className="section-title flex items-center gap-2">
              <Eye size={14} />
              转化驱动诊断
            </h3>

            <button onClick={handleDiagnose} className="gradient-btn w-full py-2.5 rounded-lg text-sm flex items-center justify-center gap-2">
              <Wand2 size={16} />
              点击诊断
            </button>

            {driverResult && (
              <div className="mt-4 space-y-3 animate-fade-in">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-forge-text2">信号强度</span>
                  <span className="text-xs text-forge-cyan font-bold">
                    {(driverResult.confidence * 100).toFixed(0)}% 置信度
                  </span>
                </div>

                {(['visual', 'pain_point', 'emotional'] as const).map((key) => {
                  const colors = DRIVER_BAR_COLORS[key];
                  const signalVal = key === 'pain_point' ? driverResult.signals.painPoint : driverResult.signals.visual;
                  const emotionalVal = key === 'emotional' ? driverResult.signals.emotional : signalVal;
                  const val = key === 'emotional' ? driverResult.signals.emotional : signalVal;
                  const pct = Math.round((val / maxSignal) * 100);
                  const isWinner = driverResult.driver === key;
                  return (
                    <div key={key} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className={isWinner ? colors.text : 'text-forge-text2'}>
                          {DRIVER_LABELS[key]}
                        </span>
                        <span className={isWinner ? colors.text : 'text-forge-text2'}>
                          {pct}%
                        </span>
                      </div>
                      <div className="h-2 bg-forge-surface2 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${colors.bar} ${isWinner ? 'neon-glow' : ''}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}

                <div className={`mt-3 p-3 rounded-lg border ${driverResult.driver === 'visual' ? 'border-forge-cyan/40 neon-glow' : driverResult.driver === 'pain_point' ? 'border-forge-orange/40 orange-glow' : 'border-purple-500/40'} bg-forge-surface2/40`}>
                  <span className={`text-sm font-bold ${DRIVER_BAR_COLORS[driverResult.driver].text}`}>
                    🏆 {DRIVER_LABELS[driverResult.driver]}
                  </span>
                  <span className="text-xs text-forge-text2 ml-2">为最优转化驱动策略</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ========== RIGHT COLUMN ========== */}
        <div className="space-y-5">
          {/* Style Lock Editor */}
          <div className="glass-card p-5">
            <h3 className="section-title flex items-center gap-2">
              <Palette size={14} />
              风格锁定编辑器
            </h3>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-forge-text2 mb-1.5 block">色板 Palette</label>
                <div className="space-y-1.5">
                  {styleLockConfig.palette.map((c, i) => (
                    <div key={c.role} className="flex items-center gap-2">
                      <span className="text-xs text-forge-text2 w-12 flex-shrink-0">
                        {ROLE_LABELS[c.role]}
                      </span>
                      <input
                        type="color"
                        value={c.hex}
                        onChange={(e) => updatePaletteColor(i, e.target.value)}
                        className="w-8 h-8 rounded border border-forge-border/60 bg-forge-surface2 cursor-pointer flex-shrink-0"
                      />
                      <input
                        className="input-field flex-1 !py-2 font-mono text-xs"
                        value={c.hex}
                        onChange={(e) => updatePaletteColor(i, e.target.value)}
                        placeholder="#FFFFFF"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-forge-text2 mb-1.5 block flex items-center gap-1.5">
                  <Sun size={13} />
                  色温 ColorTemp
                </label>
                <div className="flex gap-3">
                  {TEMP_OPTIONS.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="colorTemp"
                        value={opt.value}
                        checked={styleLockConfig.colorTemp === opt.value}
                        onChange={() => updateLockField('colorTemp', opt.value)}
                        className="accent-forge-cyan"
                      />
                      <span className="text-xs text-forge-text2">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-forge-text2 mb-1 block">标题字体 headingFont</label>
                  <input
                    className="input-field"
                    value={styleLockConfig.headingFont}
                    onChange={(e) => updateLockField('headingFont', e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-forge-text2 mb-1 block">正文字体 bodyFont</label>
                  <input
                    className="input-field"
                    value={styleLockConfig.bodyFont}
                    onChange={(e) => updateLockField('bodyFont', e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-forge-text2 mb-1 block">背景系统 backgroundSystem</label>
                  <textarea
                    className="textarea-field !min-h-[60px]"
                    rows={2}
                    value={styleLockConfig.backgroundSystem}
                    onChange={(e) => updateLockField('backgroundSystem', e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-forge-text2 mb-1 block">光照系统 lightingSystem</label>
                  <textarea
                    className="textarea-field !min-h-[60px]"
                    rows={2}
                    value={styleLockConfig.lightingSystem}
                    onChange={(e) => updateLockField('lightingSystem', e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-forge-text2 mb-1 block">布局系统 layoutSystem</label>
                <textarea
                  className="textarea-field !min-h-[60px]"
                  rows={2}
                  value={styleLockConfig.layoutSystem}
                  onChange={(e) => updateLockField('layoutSystem', e.target.value)}
                />
              </div>

              <div>
                <label className="text-xs text-forge-text2 mb-1 block">图标系统 iconSystem</label>
                <input
                  className="input-field"
                  value={styleLockConfig.iconSystem}
                  onChange={(e) => updateLockField('iconSystem', e.target.value)}
                />
              </div>

              <div>
                <label className="text-xs text-forge-text2 mb-1 block">产品规则 productRules</label>
                <textarea
                  className="textarea-field"
                  rows={2}
                  value={styleLockConfig.productRules}
                  onChange={(e) => updateLockField('productRules', e.target.value)}
                />
              </div>

              <div>
                <label className="text-xs text-forge-text2 mb-1 block">禁用漂移项 noDrift</label>
                <textarea
                  className="textarea-field"
                  rows={2}
                  value={styleLockConfig.noDrift}
                  onChange={(e) => updateLockField('noDrift', e.target.value)}
                />
              </div>

              <button
                onClick={handleGenerateLockText}
                className="gradient-btn w-full py-2.5 rounded-lg text-sm flex items-center justify-center gap-2"
              >
                <Settings size={16} />
                生成风格锁文本
              </button>

              {styleLock?.lockText && (
                <pre className="mt-2 p-3 rounded-lg bg-forge-surface2 text-xs text-forge-text2 font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto border border-forge-border/40 animate-fade-in">
                  {styleLock.lockText}
                </pre>
              )}

              <button
                onClick={handleGenerateFullPlan}
                className="orange-btn w-full py-2.5 rounded-lg text-sm flex items-center justify-center gap-2"
              >
                <Sparkles size={16} />
                一键生成完整计划
              </button>
            </div>
          </div>

          {/* Image Plan Table */}
          {fullPlan && (
            <div className="glass-card p-5 animate-fade-in">
              <h3 className="section-title flex items-center gap-2">
                <ListChecks size={14} />
                图片计划
              </h3>

              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-forge-text2">全景镜头</span>
                  <span className={`text-sm font-bold ${fullPlan.totalWide > fullPlan.maxWide ? 'text-forge-red' : 'text-forge-green'}`}>
                    {fullPlan.totalWide}/{fullPlan.items.length}
                  </span>
                  <span className="text-xs text-forge-text2">(上限 {fullPlan.maxWide})</span>
                </div>

                <div className="flex h-2 rounded-full overflow-hidden w-32">
                  {Object.entries(fullPlan.angleDistribution).map(([angleId, count]) => {
                    const pct = (count / fullPlan.items.length) * 100;
                    return (
                      <div
                        key={angleId}
                        className={`h-full ${ANGLE_COLORS[angleId] || 'bg-forge-border'}`}
                        style={{ width: `${pct}%` }}
                        title={`${angleDefMap.get(angleId as never)?.label ?? angleId}: ${count}`}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-forge-border/40 text-forge-text2">
                      <th className="text-left py-1.5 pr-2 font-medium">编号</th>
                      <th className="text-left py-1.5 pr-2 font-medium">用途</th>
                      <th className="text-center py-1.5 px-1 font-medium w-10">背景</th>
                      <th className="text-left py-1.5 pr-2 font-medium">角度</th>
                      <th className="text-right py-1.5 px-1 font-medium w-12">占比</th>
                      <th className="text-right py-1.5 px-1 font-medium w-12">留白</th>
                      <th className="text-left py-1.5 pl-2 font-medium">模板</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fullPlan.items.map((item) => {
                      const angle = angleDefMap.get(item.cameraAngleId);
                      return (
                        <tr
                          key={item.screenId}
                          className="border-b border-forge-border/20 hover:bg-forge-surface2/40 transition-colors"
                        >
                          <td className="py-1.5 pr-2">
                            <span className={`font-mono font-bold ${item.isMainImage ? 'text-forge-cyan' : 'text-forge-yellow'}`}>
                              {item.screenId}
                            </span>
                          </td>
                          <td className="py-1.5 pr-2 text-forge-text truncate max-w-[120px]">
                            {item.purpose}
                          </td>
                          <td className="py-1.5 px-1 text-center">
                            <span
                              className="inline-block w-4 h-4 rounded border border-forge-border/60"
                              style={{ backgroundColor: item.bgHex }}
                            />
                          </td>
                          <td className="py-1.5 pr-2 text-forge-text2">
                            {angle?.label ?? item.cameraAngleId}
                          </td>
                          <td className="py-1.5 px-1 text-right text-forge-text2">
                            {item.productRatio}%
                          </td>
                          <td className="py-1.5 px-1 text-right text-forge-text2">
                            {item.whitespaceRate}%
                          </td>
                          <td className="py-1.5 pl-2 text-forge-text2 font-mono text-[10px]">
                            {item.templateId}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
