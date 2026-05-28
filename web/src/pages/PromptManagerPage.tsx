import { useState, useEffect } from 'react';
import { FileText, Plus, Trash2, Save, Play, Settings, Wand2, Loader2 } from 'lucide-react';

interface PromptTemplate {
  id: string;
  name: string;
  category: 'tryon' | 'detail';
  systemPrompt: string;
  userPromptTemplate: string;
  llmConfig: {
    apiKey: string;
    baseUrl: string;
    model: string;
  };
  enabled: boolean;
}

interface PromptManagerState {
  templates: PromptTemplate[];
}

function genId() { return `pt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

const LS_KEY = 'vf-prompt-templates';

function loadTemplates(): PromptTemplate[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveTemplates(templates: PromptTemplate[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(templates));
}

const defaultTemplates: PromptTemplate[] = [
  {
    id: 'default-tryon',
    name: '默认试衣提示词',
    category: 'tryon',
    systemPrompt: '你是一个专业的电商服装摄影提示词工程师。根据商品信息生成英文的生图提示词，用于AI模特试衣。',
    userPromptTemplate: `基于以下商品信息生成一个专业的服装模特拍摄提示词（英文）：
- 品类: {category}
- 成分: {composition}
- 面料: {fabricIntro}
- 版型: {profileIntro}
- 设计卖点: {saleInfo}
- 领型: {collarType}
- 肩型: {shoulderType}

要求：专业时装模特摄影，柔和影棚灯光5500K，干净背景，突出{卖点}。只输出最终英文提示词。`,
    llmConfig: { apiKey: '', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    enabled: true,
  },
  {
    id: 'default-detail',
    name: '默认详情页提示词',
    category: 'detail',
    systemPrompt: '你是一个专业的电商详情页提示词工程师。根据商品信息生成用于AI图像生成的英文提示词。',
    userPromptTemplate: `基于以下商品信息生成一个电商详情页的图像生成提示词（英文）：
- 品类: {category}
- 成分: {composition}
- 面料: {fabricIntro}
- 设计卖点: {saleInfo}

要求：电商产品信息图，竖版手机端布局，{背景色}背景，清晰展示{sectionTitle}。只输出最终英文提示词。`,
    llmConfig: { apiKey: '', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    enabled: true,
  },
];

export function PromptManagerPage() {
  const [templates, setTemplates] = useState<PromptTemplate[]>(() => {
    const saved = loadTemplates();
    if (saved.length === 0) {
      saveTemplates(defaultTemplates);
      return defaultTemplates;
    }
    return saved;
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState('');

  useEffect(() => { saveTemplates(templates); }, [templates]);

  const addTemplate = () => {
    const newTpl: PromptTemplate = {
      id: genId(), name: '新提示词模板', category: 'tryon',
      systemPrompt: '', userPromptTemplate: '',
      llmConfig: { apiKey: '', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
      enabled: true,
    };
    setTemplates([...templates, newTpl]);
    setEditingId(newTpl.id);
  };

  const removeTemplate = (id: string) => {
    setTemplates(templates.filter((t) => t.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const updateTemplate = (id: string, updates: Partial<PromptTemplate>) => {
    setTemplates(templates.map((t) => t.id === id ? { ...t, ...updates } : t));
  };

  const toggleEnabled = (id: string) => {
    setTemplates(templates.map((t) => t.id === id ? { ...t, enabled: !t.enabled } : t));
  };

  const testTemplate = async (tpl: PromptTemplate) => {
    setTestingId(tpl.id);
    setTestResult('');
    try {
      const resp = await fetch(`${tpl.llmConfig.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tpl.llmConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: tpl.llmConfig.model,
          messages: [
            { role: 'system', content: tpl.systemPrompt },
            { role: 'user', content: tpl.userPromptTemplate
              .replace(/{category}/g, 'T恤').replace(/{composition}/g, '100%棉')
              .replace(/{fabricIntro}/g, '纯棉面料').replace(/{profileIntro}/g, '修身版')
              .replace(/{saleInfo}/g, '简约百搭').replace(/{collarType}/g, '圆领')
              .replace(/{shoulderType}/g, '正肩').replace(/{sectionTitle}/g, '面料展示')
              .replace(/{背景色}/g, '白色') },
          ],
          temperature: 0.7,
          max_tokens: 500,
        }),
      });
      const data = await resp.json();
      setTestResult(data.choices?.[0]?.message?.content || '无返回内容');
    } catch (e) {
      setTestResult(`测试失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setTestingId(null);
    }
  };

  const getEnabledTemplates = (category: 'tryon' | 'detail') =>
    templates.filter((t) => t.category === category && t.enabled);

  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-forge-orange to-purple-500 flex items-center justify-center">
            <Wand2 size={20} className="text-forge-bg" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-gradient-cyan tracking-wider">提示词管理</h2>
            <p className="text-xs text-forge-text2">管理预设提示词模板 + 自定义LLM接口配置</p>
          </div>
        </div>
        <button onClick={addTemplate} className="gradient-btn px-4 py-2 rounded-lg text-xs flex items-center gap-1.5">
          <Plus size={14} />新建模板
        </button>
      </div>

      {/* Enabled templates summary */}
      <div className="flex gap-3">
        <div className="glass-card p-3 flex-1 text-center">
          <p className="text-[10px] text-forge-text2/60">主图试衣模板</p>
          <p className="text-forge-cyan font-bold text-lg">{getEnabledTemplates('tryon').length}</p>
        </div>
        <div className="glass-card p-3 flex-1 text-center">
          <p className="text-[10px] text-forge-text2/60">详情页模板</p>
          <p className="text-forge-orange font-bold text-lg">{getEnabledTemplates('detail').length}</p>
        </div>
      </div>

      {templates.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <FileText size={48} className="mx-auto text-forge-text2/10 mb-4" />
          <p className="text-forge-text2 text-sm">暂无疑词模板</p>
          <button onClick={addTemplate} className="gradient-btn px-6 py-2 rounded-lg text-xs mt-4">创建第一个模板</button>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((tpl) => (
            <div key={tpl.id} className={`glass-card overflow-hidden ${tpl.enabled ? '' : 'opacity-50'}`}>
              <div className="flex items-center gap-3 p-3 cursor-pointer" onClick={() => setEditingId(editingId === tpl.id ? null : tpl.id)}>
                <div className={`w-1.5 h-1.5 rounded-full ${tpl.enabled ? 'bg-forge-green' : 'bg-forge-text2'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-forge-text font-medium truncate">{tpl.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${tpl.category === 'tryon' ? 'bg-forge-cyan/10 text-forge-cyan' : 'bg-forge-orange/10 text-forge-orange'}`}>
                      {tpl.category === 'tryon' ? '主图试衣' : '详情页'}
                    </span>
                    <span className="text-[10px] text-forge-text2">{tpl.llmConfig.model || '未配置模型'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={(e) => { e.stopPropagation(); toggleEnabled(tpl.id); }}
                    className={`px-2 py-1 rounded text-[10px] ${tpl.enabled ? 'bg-forge-green/15 text-forge-green' : 'bg-forge-surface2 text-forge-text2'}`}>
                    {tpl.enabled ? '已启用' : '已禁用'}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); removeTemplate(tpl.id); }}
                    className="p-1.5 text-forge-text2/30 hover:text-forge-red transition-colors"><Trash2 size={14} /></button>
                </div>
              </div>

              {editingId === tpl.id && (
                <div className="border-t border-forge-border/30 p-4 animate-slide-up space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-forge-text2 block mb-1">模板名称</label>
                      <input value={tpl.name} onChange={(e) => updateTemplate(tpl.id, { name: e.target.value })} className="input-field !py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="text-[10px] text-forge-text2 block mb-1">分类</label>
                      <select value={tpl.category} onChange={(e) => updateTemplate(tpl.id, { category: e.target.value as 'tryon' | 'detail' })} className="input-field !py-1.5 text-xs">
                        <option value="tryon">主图试衣</option>
                        <option value="detail">详情页</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] text-forge-text2 block mb-1">
                      <Settings size={12} className="inline mr-1" />LLM 接口配置
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <input value={tpl.llmConfig.baseUrl} onChange={(e) => updateTemplate(tpl.id, { llmConfig: { ...tpl.llmConfig, baseUrl: e.target.value } })}
                        placeholder="API Base URL" className="input-field !py-1.5 text-xs" />
                      <input value={tpl.llmConfig.model} onChange={(e) => updateTemplate(tpl.id, { llmConfig: { ...tpl.llmConfig, model: e.target.value } })}
                        placeholder="Model ID" className="input-field !py-1.5 text-xs" />
                      <input value={tpl.llmConfig.apiKey} onChange={(e) => updateTemplate(tpl.id, { llmConfig: { ...tpl.llmConfig, apiKey: e.target.value } })}
                        type="password" placeholder="API Key" className="input-field !py-1.5 text-xs" />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] text-forge-text2 block mb-1">System Prompt（LLM角色设定）</label>
                    <textarea value={tpl.systemPrompt} onChange={(e) => updateTemplate(tpl.id, { systemPrompt: e.target.value })}
                      className="textarea-field !min-h-[60px] text-xs" />
                  </div>

                  <div>
                    <label className="text-[10px] text-forge-text2 block mb-1">
                      User Prompt 模板（可用变量: {'{category}'}, {'{composition}'}, {'{fabricIntro}'}, {'{profileIntro}'}, {'{saleInfo}'}, {'{collarType}'}, {'{shoulderType}'}, {'{sectionTitle}'}, {'{背景色}'}）
                    </label>
                    <textarea value={tpl.userPromptTemplate} onChange={(e) => updateTemplate(tpl.id, { userPromptTemplate: e.target.value })}
                      className="textarea-field !min-h-[80px] text-xs font-mono" />
                  </div>

                  <div className="flex items-center gap-2">
                    <button onClick={() => testTemplate(tpl)} disabled={testingId === tpl.id}
                      className="gradient-btn px-4 py-1.5 rounded text-xs flex items-center gap-1.5 disabled:opacity-50">
                      {testingId === tpl.id ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                      {testingId === tpl.id ? '测试中...' : '测试模板'}
                    </button>
                  </div>

                  {testResult && testingId !== tpl.id && (
                    <div className="p-3 rounded bg-forge-surface2 border border-forge-border/40 text-xs text-forge-text2 whitespace-pre-wrap max-h-40 overflow-y-auto">
                      {testResult}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="glass-card p-4 text-xs text-forge-text2 space-y-2">
        <p className="font-medium text-forge-cyan">📖 使用说明</p>
        <ul className="list-disc list-inside space-y-1 text-forge-text2/70">
          <li>在「主图试衣」或「详情页」中，如果选择了款式库的款式，系统会优先使用启用模板中的提示词规则</li>
          <li>模板中的 <code className="px-1 bg-forge-surface2 rounded">{'{...}'}</code> 变量会自动替换为领猫扩展信息</li>
          <li>LLM接口配置支持 DeepSeek、OpenAI 等兼容 OpenAI API 格式的服务</li>
          <li>多个启用模板会按顺序尝试，直到成功生成优化后的提示词</li>
        </ul>
      </div>
    </div>
  );
}
