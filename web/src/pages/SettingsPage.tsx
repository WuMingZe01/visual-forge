import { useState, useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { testConnection } from '@/services/api';
import { saveLingmaoConfig } from '@/services/lingmao';
import { getStoredModelConfig, saveModelConfig, toggleModelEnabled } from '@/services/tryonApi';
import { AI_MODELS_FOR_TRYON } from '@/types/tryon-types';
import type { SystemConfig } from '@/types';
import { useLlmStore } from '@/store/useLlmStore';
import type { LlmConfig } from '@/store/useLlmStore';
import { testLlmConnection } from '@/services/llmService';
import { Settings, Key, Eye, EyeOff, Server, Cloud, Save, Loader2, Activity, Link, Cpu, Trash2, Wand2, FileText, Plus, Brain, Eye as EyeIcon, RotateCcw } from 'lucide-react';
import { loadAiPrompts, saveAiPrompts, resetAiPrompts, type AiPromptSet } from '@/services/promptTemplates';

function MaskedInput({ label, value, onChange, id }: { label: string; value: string; onChange: (v: string) => void; id: string }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-forge-text2 mb-1.5">{label}</label>
      <div className="relative">
        <input id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} className="input-field pr-10" placeholder="••••••••" />
        <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-forge-text2 hover:text-forge-text transition-colors">{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
      </div>
    </div>
  );
}

function loadDefaultPrompts(): { tryon: string; detail: string } { try { const r = localStorage.getItem('vf-default-prompts'); return r ? JSON.parse(r) : { tryon: '', detail: '' }; } catch { return { tryon: '', detail: '' }; } }
function saveDefaultPrompts(p: { tryon: string; detail: string }) { localStorage.setItem('vf-default-prompts', JSON.stringify(p)); }

function genId() { return `llm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

export function SettingsPage() {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const addToast = useAppStore((s) => s.addToast);
  const [form, setForm] = useState<SystemConfig>({ ...config });
  const [testing, setTesting] = useState(false);

  const [lingmaoBaseUrl, setLingmaoBaseUrl] = useState('/lingmao-api');
  const [lingmaoStylePath, setLingmaoStylePath] = useState('/v1/product/getproducts');
  const [lingmaoAppId, setLingmaoAppId] = useState('761ad99e-b21a-4aa1-98ea-3ac6c488e272');
  const [lingmaoAppSecret, setLingmaoAppSecret] = useState('7e2fd398-8078-44eb-9d55-4de6f9fd6e06');

  const [customModelId, setCustomModelId] = useState('');
  const [customModelName, setCustomModelName] = useState('');
  const [savedModels, setSavedModels] = useState<{ id: string; name: string }[]>(() => (getStoredModelConfig().customModels || []));
  const [disabledModelIds, setDisabledModelIds] = useState<string[]>(() => (getStoredModelConfig().disabledModelIds || []));
  const [defaultPrompts, setDefaultPrompts] = useState(loadDefaultPrompts);

  const [aiPrompts, setAiPrompts] = useState<AiPromptSet>(loadAiPrompts);
  const [aiPromptEditKey, setAiPromptEditKey] = useState<keyof AiPromptSet>('analyzeBoth');

  const promptLabels: { key: keyof AiPromptSet; label: string; desc: string }[] = [
    { key: 'analyzeModel', label: '多模态 — 仅模特图反推', desc: '分析模特图提取不变特征' },
    { key: 'analyzeBoth', label: '多模态 — 模特图+白底图双图分析', desc: '同时分析模特特征 + 服装细节（可选细节图）' },
    { key: 'analyzeProduct', label: '多模态 — 仅白底图分析', desc: '款式管理中反推提示词时使用（可选细节图）' },
    { key: 'batchAnalyzeRefs', label: '多模态 — 批量参考图反推', desc: '模板库中2-4张参考图一次分析，每张生成预设提示词' },
    { key: 'assembleTryon', label: 'DeepSeek — 主图提示词整合', desc: '将不变特征+商品资料合并为生图提示词' },
    { key: 'assemblePose', label: 'DeepSeek — 姿势裂变整合', desc: '为同一商品生成N个不同姿势的提示词' },
    { key: 'assembleDetail', label: 'DeepSeek — 详情页整合', desc: '生成详情页各模块的生图提示词' },
  ];

  const handleSaveAiPrompts = () => {
    saveAiPrompts(aiPrompts);
    addToast('success', 'AI 提示词已保存');
  };

  const handleResetAiPrompts = () => {
    const defaults = resetAiPrompts();
    setAiPrompts(defaults);
    addToast('success', 'AI 提示词已恢复默认');
  };
  const handleToggleImageModel = (modelId: string, enabled: boolean) => {
    toggleModelEnabled(modelId, enabled);
    refreshDisabledModels();
  };

  const refreshDisabledModels = () => setDisabledModelIds(getStoredModelConfig().disabledModelIds || []);

  const llmConfigs = useLlmStore((s) => s.configs);
  const updateLlmConfig = useLlmStore((s) => s.updateConfig);
  const toggleLlm = useLlmStore((s) => s.toggleEnabled);
  const addLlmConfig = useLlmStore((s) => s.addConfig);
  const removeLlmConfig = useLlmStore((s) => s.removeConfig);

  const [newLlmBaseUrl, setNewLlmBaseUrl] = useState('');
  const [newLlmModel, setNewLlmModel] = useState('');
  const [newLlmKey, setNewLlmKey] = useState('');
  const [newLlmName, setNewLlmName] = useState('');
  const [newLlmType, setNewLlmType] = useState<'text' | 'vision'>('vision');

  const visionModels = llmConfigs.filter((c) => c.type === 'vision');
  const textModels = llmConfigs.filter((c) => c.type === 'text');

  useEffect(() => { setForm({ ...config }); }, [config]);

  // 未保存修改时浏览器关闭/刷新拦截
  const dirty = JSON.stringify(form) !== JSON.stringify(config);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const handleSave = () => { updateConfig(form); addToast('success', '配置已保存'); };
  const handleTestConnection = async () => {
    setTesting(true); addToast('info', '正在测试连接...');
    const result = await testConnection(form).finally(() => setTesting(false));
    addToast(result.ok ? 'success' : 'error', result.message);
  };
  const handleSaveLingmao = () => { saveLingmaoConfig({ baseUrl: lingmaoBaseUrl, stylePath: lingmaoStylePath, appId: lingmaoAppId, appSecret: lingmaoAppSecret }); addToast('success', '领猫配置已保存'); };
  const handleSavePrompts = () => { saveDefaultPrompts(defaultPrompts); addToast('success', '默认提示词已保存'); };
  const update = (key: keyof SystemConfig, value: string | string[]) => setForm(prev => ({ ...prev, [key]: value }));

  const handleAddLlm = () => {
    if (!newLlmBaseUrl.trim() || !newLlmModel.trim()) { addToast('warning', '请填写 Base URL 和 Model ID'); return; }
    addLlmConfig({
      id: genId(), name: newLlmName || newLlmModel, provider: 'custom',
      apiKey: newLlmKey, baseUrl: newLlmBaseUrl.trim(), model: newLlmModel.trim(),
      type: newLlmType, enabled: true, maxTokens: 1048576,
    });
    setNewLlmBaseUrl(''); setNewLlmModel(''); setNewLlmKey(''); setNewLlmName('');
    addToast('success', 'LLM 模型已添加');
  };

  return (
    <div className="animate-fade-in space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-gradient-to-br from-forge-cyan to-forge-orange flex items-center justify-center"><Settings size={20} className="text-forge-bg" /></div><h1 className="font-display text-lg font-bold tracking-wider text-gradient-cyan">系统设置</h1></div>

      {/* LLM Config */}
      <div className="glass-card p-6 border border-forge-cyan/20">
        <div className="flex items-center gap-2.5 mb-2"><Brain size={16} className="text-forge-cyan" /><h2 className="section-title !mb-0">AI 大语言模型配置</h2></div>
        <p className="text-xs text-forge-text2 mb-5">配置两类模型：<span className="text-purple-300 font-medium">多模态（识别图片）</span>、<span className="text-forge-cyan font-medium">文本（整合提示词）</span>。主图「AI 智能生成」依赖此配置。</p>

        <div className="mb-5 p-4 rounded-xl bg-purple-500/5 border border-purple-400/20">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><EyeIcon size={14} className="text-purple-400" /><h3 className="text-forge-text text-sm font-medium">多模态模型（理解图片 → 提取特征）</h3></div>
            <span className="text-[10px] text-forge-text2/60">{visionModels.filter(c => c.enabled).length}/{visionModels.length} 启用</span>
          </div>
          {visionModels.length === 0 && <p className="text-[10px] text-forge-text2/50 py-2">暂无，请在下方添加</p>}
          {visionModels.map((c) => (<LlmCard key={c.id} cfg={c} onUpdate={updateLlmConfig} onToggle={toggleLlm} onRemove={removeLlmConfig} addToast={addToast} />))}
        </div>

        <div className="mb-5 p-4 rounded-xl bg-forge-cyan/5 border border-forge-cyan/20">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><FileText size={14} className="text-forge-cyan" /><h3 className="text-forge-text text-sm font-medium">文本模型（整合提示词 → 输出 Prompt）</h3></div>
            <span className="text-[10px] text-forge-text2/60">{textModels.filter(c => c.enabled).length}/{textModels.length} 启用</span>
          </div>
          {textModels.length === 0 && <p className="text-[10px] text-forge-text2/50 py-2">暂无，请在下方添加</p>}
          {textModels.map((c) => (<LlmCard key={c.id} cfg={c} onUpdate={updateLlmConfig} onToggle={toggleLlm} onRemove={removeLlmConfig} addToast={addToast} />))}
        </div>

        <div className="p-4 rounded-xl bg-forge-surface2/30 border border-dashed border-forge-border/40">
          <h4 className="text-xs text-forge-text2 font-medium mb-3 flex items-center gap-1.5"><Plus size={12} />添加新的 LLM 接口</h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-2">
            <select value={newLlmType} onChange={e => setNewLlmType(e.target.value as 'text' | 'vision')} className="input-field !py-1.5 text-xs">
              <option value="vision">多模态</option>
              <option value="text">文本</option>
            </select>
            <input value={newLlmName} onChange={e => setNewLlmName(e.target.value)} placeholder="显示名称" className="input-field !py-1.5 text-xs" />
            <input value={newLlmBaseUrl} onChange={e => setNewLlmBaseUrl(e.target.value)} placeholder="Base URL" className="input-field !py-1.5 text-xs" />
            <input value={newLlmModel} onChange={e => setNewLlmModel(e.target.value)} placeholder="Model ID" className="input-field !py-1.5 text-xs" />
            <input value={newLlmKey} onChange={e => setNewLlmKey(e.target.value)} type="password" placeholder="API Key" className="input-field !py-1.5 text-xs" />
            <button onClick={handleAddLlm} className="gradient-btn px-3 py-1.5 rounded-lg text-xs flex items-center justify-center gap-1"><Plus size={12} />添加</button>
          </div>
          <p className="text-[10px] text-forge-text2/40">支持 OpenAI 兼容接口。通过 Vite 代理自动处理跨域。</p>
        </div>
      </div>

      {/* API Keys */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-2.5 mb-5"><div className="w-7 h-7 rounded-lg bg-forge-cyan/10 border border-forge-cyan/20 flex items-center justify-center"><Key size={14} className="text-forge-cyan" /></div><h2 className="section-title !mb-0">生图引擎 API 配置</h2></div>
        <p className="text-[10px] text-forge-text2/50 mb-4">每个引擎支持最多 3 个 KEY，批量生图时自动轮询分配，实现安全并发。</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Yunwu */}
          <div className="space-y-4 p-4 rounded-xl bg-forge-surface2/40 border border-forge-border/30">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2"><Server size={14} className="text-forge-cyan" /><h3 className="text-forge-text text-sm font-medium">Yunwu 引擎</h3></div>
              <span className="text-[10px] text-forge-text2/50">{form.yunwuApiKeys.filter(k => k.trim()).length}/3 KEY</span>
            </div>
            <div><label className="block text-xs text-forge-text2 mb-1.5">Base URL</label><input type="text" value={form.yunwuBaseUrl} onChange={(e) => update('yunwuBaseUrl', e.target.value)} className="input-field" /></div>
            {form.yunwuApiKeys.map((key, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <MaskedInput id={`yunwu-key-${i}`} label={`KEY ${i + 1}`} value={key} onChange={(v) => { const arr = [...form.yunwuApiKeys]; arr[i] = v; update('yunwuApiKeys', arr as any); }} />
                {form.yunwuApiKeys.length > 1 && (
                  <button onClick={() => { const arr = form.yunwuApiKeys.filter((_, j) => j !== i); update('yunwuApiKeys', arr as any); }} className="p-1 text-forge-text2/30 hover:text-forge-red flex-shrink-0 mt-5"><Trash2 size={12} /></button>
                )}
              </div>
            ))}
            {form.yunwuApiKeys.filter(k => k.trim()).length < 5 && (
              <button onClick={() => { const arr = [...form.yunwuApiKeys, '']; update('yunwuApiKeys', arr as any); }} className="text-[10px] text-forge-cyan hover:underline flex items-center gap-1"><Plus size={10} />添加 KEY</button>
            )}
          </div>

          {/* Grsai */}
          <div className="space-y-4 p-4 rounded-xl bg-forge-surface2/40 border border-forge-border/30">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2"><Cloud size={14} className="text-forge-orange" /><h3 className="text-forge-text text-sm font-medium">Grsai 引擎</h3></div>
              <span className="text-[10px] text-forge-text2/50">{form.grsaiApiKeys.filter(k => k.trim()).length}/3 KEY</span>
            </div>
            <div><label className="block text-xs text-forge-text2 mb-1.5">API URL</label><input type="text" value={form.grsaiApiUrl} onChange={(e) => update('grsaiApiUrl', e.target.value)} className="input-field" /></div>
            {form.grsaiApiKeys.map((key, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <MaskedInput id={`grsai-key-${i}`} label={`KEY ${i + 1}`} value={key} onChange={(v) => { const arr = [...form.grsaiApiKeys]; arr[i] = v; update('grsaiApiKeys', arr as any); }} />
                {form.grsaiApiKeys.length > 1 && (
                  <button onClick={() => { const arr = form.grsaiApiKeys.filter((_, j) => j !== i); update('grsaiApiKeys', arr as any); }} className="p-1 text-forge-text2/30 hover:text-forge-red flex-shrink-0 mt-5"><Trash2 size={12} /></button>
                )}
              </div>
            ))}
            {form.grsaiApiKeys.filter(k => k.trim()).length < 3 && (
              <button onClick={() => { const arr = [...form.grsaiApiKeys, '']; update('grsaiApiKeys', arr as any); }} className="text-[10px] text-forge-orange hover:underline flex items-center gap-1"><Plus size={10} />添加 KEY</button>
            )}
          </div>
        </div>
        <div className="mt-4 p-4 rounded-xl bg-forge-surface2/40 border border-forge-border/30">
          <div className="flex items-center gap-2 mb-3"><Cloud size={14} className="text-forge-cyan" /><h3 className="text-forge-text text-sm font-medium">OSS 配置 (可选)</h3></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="block text-xs text-forge-text2 mb-1.5">Access Key ID</label><input type="text" value={form.ossAccessKeyId} onChange={(e) => update('ossAccessKeyId', e.target.value)} className="input-field" /></div>
            <MaskedInput id="oss-secret" label="Access Key Secret" value={form.ossAccessKeySecret} onChange={(v) => update('ossAccessKeySecret', v)} />
            <div><label className="block text-xs text-forge-text2 mb-1.5">Endpoint</label><input type="text" value={form.ossEndpoint} onChange={(e) => update('ossEndpoint', e.target.value)} className="input-field" /></div>
            <div><label className="block text-xs text-forge-text2 mb-1.5">Bucket</label><input type="text" value={form.ossBucket} onChange={(e) => update('ossBucket', e.target.value)} className="input-field" /></div>
          </div>
        </div>
      </div>

      {/* Default Prompts */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-2.5 mb-5"><FileText size={16} className="text-forge-cyan" /><h2 className="section-title !mb-0">默认提示词设置</h2></div>
        <div className="space-y-4">
          <div><label className="text-xs text-forge-text2 block mb-1.5 font-medium">主图默认提示词</label><textarea value={defaultPrompts.tryon} onChange={e => setDefaultPrompts(prev => ({ ...prev, tryon: e.target.value }))} className="textarea-field !min-h-[80px] text-xs" /></div>
          <div><label className="text-xs text-forge-text2 block mb-1.5 font-medium">详情页默认提示词</label><textarea value={defaultPrompts.detail} onChange={e => setDefaultPrompts(prev => ({ ...prev, detail: e.target.value }))} className="textarea-field !min-h-[80px] text-xs" /></div>
          <button onClick={handleSavePrompts} className="gradient-btn px-4 py-2 rounded-lg text-xs flex items-center gap-2"><Save size={14} />保存</button>
        </div>
      </div>

      {/* AI System Prompts */}
      <div className="glass-card p-6 border border-purple-500/20">
        <div className="flex items-center gap-2.5 mb-2"><Brain size={16} className="text-purple-400" /><h2 className="section-title !mb-0">AI 提示词管理</h2></div>
        <p className="text-xs text-forge-text2 mb-4">管理多模态模型 / DeepSeek 的系统提示词（System Prompt）。修改后影响所有页面的 AI 分析质量。</p>

        <div className="flex items-center gap-2 mb-3">
          <select value={aiPromptEditKey} onChange={(e) => setAiPromptEditKey(e.target.value as keyof AiPromptSet)} className="input-field !py-1.5 text-xs !w-auto">
            {promptLabels.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <span className="text-[10px] text-forge-text2/50">切换查看/编辑不同场景的提示词</span>
        </div>

        <textarea
          value={aiPrompts[aiPromptEditKey]}
          onChange={(e) => setAiPrompts(prev => ({ ...prev, [aiPromptEditKey]: e.target.value }))}
          className="textarea-field !min-h-[200px] text-xs font-mono"
        />

        <div className="flex items-center gap-2 mt-3">
          <button onClick={handleSaveAiPrompts} className="gradient-btn px-4 py-2 rounded-lg text-xs flex items-center gap-2"><Save size={14} />保存提示词</button>
          <button onClick={handleResetAiPrompts} className="px-4 py-2 rounded-lg text-xs bg-forge-surface2 border border-forge-border/40 text-forge-text2 hover:text-forge-text flex items-center gap-2 transition-colors"><RotateCcw size={12} />恢复默认</button>
        </div>
      </div>

      {/* Lingmao + Custom Models */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-2.5 mb-5"><Link size={16} className="text-forge-orange" /><h2 className="section-title !mb-0">领猫 SCM 配置</h2></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className="block text-xs text-forge-text2 mb-1.5">Base URL</label><input type="text" value={lingmaoBaseUrl} onChange={e => setLingmaoBaseUrl(e.target.value)} className="input-field" /></div>
          <div><label className="block text-xs text-forge-text2 mb-1.5">款式查询路径</label><input type="text" value={lingmaoStylePath} onChange={e => setLingmaoStylePath(e.target.value)} className="input-field" /></div>
          <div><label className="block text-xs text-forge-text2 mb-1.5">App ID</label><input type="text" value={lingmaoAppId} onChange={e => setLingmaoAppId(e.target.value)} className="input-field" /></div>
          <MaskedInput id="lingmao-secret" label="App Secret" value={lingmaoAppSecret} onChange={v => setLingmaoAppSecret(v)} />
        </div>
        <button onClick={handleSaveLingmao} className="orange-btn mt-4 px-5 py-2.5 rounded-lg text-sm flex items-center gap-2"><Save size={14} />保存领猫配置</button>

        <div className="mt-6 pt-5 border-t border-forge-border/30">
          <div className="flex items-center gap-2.5 mb-3"><Cloud size={14} className="text-forge-green" /><h3 className="text-forge-text text-sm font-medium">阿里云 OSS 配置</h3></div>
          <p className="text-[10px] text-forge-text2/50 mb-3">用于存储生成图片，配置后可在任务历史中获取长期有效的图片链接</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="block text-xs text-forge-text2 mb-1.5">Access Key ID</label><input type="text" value={form.ossAccessKeyId || ''} onChange={e => update('ossAccessKeyId', e.target.value)} className="input-field" placeholder="LTAI5t8MsnWzzExkhjLJsJLN" /></div>
            <MaskedInput id="oss-secret" label="Access Key Secret" value={form.ossAccessKeySecret || ''} onChange={v => update('ossAccessKeySecret', v)} />
            <div><label className="block text-xs text-forge-text2 mb-1.5">Endpoint</label><input type="text" value={form.ossEndpoint || ''} onChange={e => update('ossEndpoint', e.target.value)} className="input-field" placeholder="oss-cn-beijing.aliyuncs.com" /></div>
            <div><label className="block text-xs text-forge-text2 mb-1.5">Bucket</label><input type="text" value={form.ossBucket || ''} onChange={e => update('ossBucket', e.target.value)} className="input-field" placeholder="hermes-grsai" /></div>
          </div>
        </div>

        <div className="mt-6 pt-5 border-t border-forge-border/30">
          <div className="flex items-center gap-2 mb-3"><Cpu size={14} className="text-forge-cyan" /><h3 className="text-forge-text text-sm font-medium">自定义 AI 图像模型</h3></div>
          <div className="flex gap-2 mb-3">
            <input value={customModelName} onChange={e => setCustomModelName(e.target.value)} placeholder="显示名称" className="input-field !py-1.5 text-xs flex-1" />
            <input value={customModelId} onChange={e => setCustomModelId(e.target.value)} placeholder="模型 ID" className="input-field !py-1.5 text-xs flex-1" />
            <button onClick={() => { if (!customModelId.trim() || !customModelName.trim()) return; const next = [...savedModels, { id: customModelId.trim(), name: customModelName.trim() }]; setSavedModels(next); saveModelConfig({ customModels: next }); setCustomModelId(''); setCustomModelName(''); }} className="gradient-btn px-4 py-1.5 rounded-lg text-xs">添加</button>
          </div>
          {savedModels.length > 0 && (<div className="space-y-1">{savedModels.map((m, i) => (<div key={m.id} className="flex items-center justify-between p-2 rounded bg-forge-surface2/30 text-xs"><span><span className="text-forge-cyan font-medium">{m.name}</span><span className="text-forge-text2 ml-2">({m.id})</span></span><button onClick={() => { const next = savedModels.filter((_, j) => j !== i); setSavedModels(next); saveModelConfig({ customModels: next }); }} className="text-forge-text2/40 hover:text-forge-red"><Trash2 size={12} /></button></div>))}</div>)}
        </div>

        <div className="mt-6 pt-5 border-t border-forge-border/30">
          <div className="flex items-center gap-2 mb-1"><Cpu size={14} className="text-forge-orange" /><h3 className="text-forge-text text-sm font-medium">图像模型管理</h3></div>
          <p className="text-[10px] text-forge-text2/50 mb-3">关闭不常用的模型，主图和批量工单中不再显示。Grsai 负载高时可临时关闭 VIP 模型。</p>
          <div className="space-y-1">
            {AI_MODELS_FOR_TRYON.map((m) => {
              const enabled = !disabledModelIds.includes(m.id);
              return (
                <div key={m.id} className={`flex items-center justify-between p-2.5 rounded-lg border transition-all ${enabled ? 'border-forge-border/30 bg-forge-surface2/30' : 'border-forge-border/20 bg-forge-surface2/10 opacity-50'}`}>
                  <div className="flex items-center gap-2.5">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${enabled ? 'bg-forge-green' : 'bg-forge-text2/40'}`} />
                    <div>
                      <span className="text-xs text-forge-text font-medium">{m.name}</span>
                      <span className="text-[10px] text-forge-text2 ml-2">{m.desc}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleToggleImageModel(m.id, !enabled)}
                    className={`px-3 py-1 rounded text-[10px] font-medium transition-all ${
                      enabled
                        ? 'bg-forge-green/15 text-forge-green border border-forge-green/25 hover:bg-forge-green/20'
                        : 'bg-forge-surface2 text-forge-text2 border border-forge-border/30 hover:bg-forge-surface2/60'
                    }`}
                  >
                    {enabled ? '启用中' : '已禁用'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {dirty && (
        <div className="p-2 mb-3 rounded-lg bg-forge-orange/10 border border-forge-orange/30 text-xs text-forge-orange flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-forge-orange animate-pulse" />
          有未保存的修改，切换页面或刷新将丢失
        </div>
      )}
      <div className="flex items-center gap-3">
        <button onClick={handleTestConnection} disabled={testing} className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-forge-surface2 border border-forge-border/40 text-forge-text2 text-sm hover:border-forge-cyan/30 hover:text-forge-text transition-all disabled:opacity-50">{testing ? <Loader2 size={15} className="animate-spin" /> : <Activity size={15} />}{testing ? '测试中...' : '测试连接'}</button>
        <button onClick={handleSave} className={`gradient-btn flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm ${dirty ? 'animate-pulse' : ''}`}><Save size={15} />{dirty ? '保存全部配置 (有修改)' : '保存全部配置'}</button>
      </div>
    </div>
  );
}

function LlmCard({ cfg, onUpdate, onToggle, onRemove, addToast }: {
  cfg: LlmConfig;
  onUpdate: (id: string, u: Partial<LlmConfig>) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  addToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const handleTest = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setTesting(true);
    setTestResult(null);
    const result = await testLlmConnection(cfg).finally(() => setTesting(false));
    setTestResult(result.message);
    addToast(result.ok ? 'success' : 'error', result.ok ? `${cfg.name} 连接正常` : `${cfg.name}: ${result.message.slice(0, 80)}`);
  };

  return (
    <div className={`rounded-lg border mb-2 transition-all ${cfg.enabled ? 'border-forge-border/30 bg-forge-surface2/30' : 'border-forge-border/20 bg-forge-surface2/10 opacity-60'}`}>
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.enabled ? 'bg-forge-green' : 'bg-forge-text2'}`} />
        <span className="text-xs text-forge-text font-medium truncate flex-1">{cfg.name}</span>
        <span className="text-[10px] text-forge-text2/50 font-mono">{cfg.model}</span>
        <button onClick={handleTest} disabled={testing} className={`px-2 py-0.5 rounded text-[10px] font-medium flex-shrink-0 flex items-center gap-1 border border-forge-border/30 hover:border-forge-cyan/30 transition-colors ${testing ? 'opacity-50' : ''}`}>
          {testing ? <Loader2 size={9} className="animate-spin" /> : <Activity size={9} />}{testing ? '' : '测试'}
        </button>
        <button onClick={(e) => { e.stopPropagation(); onToggle(cfg.id); }} className={`px-2 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${cfg.enabled ? 'bg-forge-green/15 text-forge-green border border-forge-green/25' : 'bg-forge-surface2 text-forge-text2 border border-forge-border/30'}`}>
          {cfg.enabled ? '启用中' : '未启用'}
        </button>
        <button onClick={(e) => { e.stopPropagation(); onRemove(cfg.id); }} className="p-1 text-forge-text2/30 hover:text-forge-red"><Trash2 size={11} /></button>
      </div>
      {testResult && <div className={`mx-3 mb-1 px-2 py-1 rounded text-[10px] ${testResult.startsWith('连接成功') ? 'bg-forge-green/10 text-forge-green' : 'bg-forge-red/10 text-forge-red'}`}>{testResult}</div>}
      {expanded && (
        <div className="px-3 pb-3 grid grid-cols-1 md:grid-cols-4 gap-2 pt-1 border-t border-forge-border/20">
          <div><label className="text-[9px] text-forge-text2 block mb-0.5">API Base URL</label><input value={cfg.baseUrl} onChange={e => onUpdate(cfg.id, { baseUrl: e.target.value })} className="input-field !py-1 text-[10px]" /></div>
          <div><label className="text-[9px] text-forge-text2 block mb-0.5">Model ID</label><input value={cfg.model} onChange={e => onUpdate(cfg.id, { model: e.target.value })} className="input-field !py-1 text-[10px]" /></div>
          <div><label className="text-[9px] text-forge-text2 block mb-0.5">API Key</label><input type="password" value={cfg.apiKey} onChange={e => onUpdate(cfg.id, { apiKey: e.target.value })} className="input-field !py-1 text-[10px]" /></div>
          <div><label className="text-[9px] text-forge-text2 block mb-0.5">Max Tokens</label><input type="number" value={cfg.maxTokens} onChange={e => onUpdate(cfg.id, { maxTokens: Number(e.target.value) || 1048576 })} className="input-field !py-1 text-[10px]" /></div>
        </div>
      )}
    </div>
  );
}
