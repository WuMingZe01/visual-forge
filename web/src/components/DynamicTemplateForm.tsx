import { useState, useEffect } from 'react';
import { Upload, X, Search, User, Layout, Package } from 'lucide-react';
import { useModelStore } from '@/store/useModelStore';
import { useTemplateStore } from '@/store/useTemplateStore';

/* ── Types ─────────────────────────────────────────── */

export interface ExposedField {
  name: string;
  label: string;
  type: 'image' | 'text' | 'select' | 'number' | 'model_picker' | 'template_picker' | 'sku_lookup';
  required: boolean;
  default: string | null;
  options: string[];
  placeholder: string;
}

export interface DynamicTemplateFormProps {
  fields: ExposedField[];
  formData: Record<string, string>;
  onChange: (data: Record<string, string>) => void;
  loading?: boolean;
}

/* ── Component ─────────────────────────────────────── */

export function DynamicTemplateForm({ fields, formData, onChange, loading }: DynamicTemplateFormProps) {
  const models = useModelStore((s) => s.models);
  const templates = useTemplateStore((s) => s.templates);

  // SKU lookup state
  const [skuCode, setSkuCode] = useState('');
  const [skuLoading, setSkuLoading] = useState(false);
  const [skuResult, setSkuResult] = useState<Record<string, string> | null>(null);

  const update = (name: string, value: string) => {
    onChange({ ...formData, [name]: value });
  };

  const handleImageUpload = (fieldName: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => update(fieldName, reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSkuLookup = async () => {
    if (!skuCode.trim()) return;
    setSkuLoading(true);
    try {
      const res = await fetch(`/api/lingmao/style/${encodeURIComponent(skuCode.trim())}`);
      if (res.ok) {
        const data = await res.json();
        setSkuResult(data);
        // Auto-fill product info into form data
        const updates: Record<string, string> = {};
        if (data.styleName) updates['product_name'] = data.styleName;
        if (data.productImage) updates['product_image'] = data.productImage;
        onChange({ ...formData, ...updates });
      } else {
        setSkuResult({ error: '未找到该款号' });
      }
    } catch {
      setSkuResult({ error: '查询失败' });
    } finally {
      setSkuLoading(false);
    }
  };

  const renderField = (field: ExposedField) => {
    const value = formData[field.name] ?? '';

    // ── Image ──
    if (field.type === 'image') {
      return (
        <div key={field.name}>
          <label className="text-xs text-forge-text2 mb-1 block">
            {field.label} {field.required && <span className="text-red-400">*</span>}
          </label>
          {value && (value.startsWith('data:') || value.startsWith('http')) ? (
            <div className="relative group">
              <img src={value} className="w-full h-24 object-contain rounded-lg bg-forge-surface2" alt="" />
              <button
                onClick={() => update(field.name, '')}
                className="absolute top-1 right-1 bg-black/60 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="flex items-center justify-center gap-2 h-20 border-2 border-dashed border-forge-border rounded-lg cursor-pointer hover:border-forge-cyan/40 text-forge-text2 text-xs transition-colors">
                <Upload size={14} /> 上传图片
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload(field.name)} disabled={loading} />
              </label>
              <input
                type="text"
                value={value}
                onChange={e => update(field.name, e.target.value)}
                placeholder={field.placeholder || '或输入图片 URL'}
                className="w-full bg-forge-surface2 border border-forge-border rounded-lg px-3 py-1.5 text-sm text-forge-text focus:border-forge-cyan/40 outline-none"
                disabled={loading}
              />
            </div>
          )}
        </div>
      );
    }

    // ── Model Picker (from 模特库) ──
    if (field.type === 'model_picker') {
      const selectedModel = models.find(m => m.previewUrl === value || m.id === value);
      return (
        <div key={field.name}>
          <label className="text-xs text-forge-text2 mb-1 block">
            <User size={12} className="inline mr-1" />{field.label} {field.required && <span className="text-red-400">*</span>}
            <span className="text-forge-text2/50 ml-1">({models.length} 个模特)</span>
          </label>
          <select
            value={value}
            onChange={e => update(field.name, e.target.value)}
            className="w-full bg-forge-surface2 border border-forge-border rounded-lg px-3 py-2 text-sm text-forge-text focus:border-forge-cyan/40 outline-none"
            disabled={loading}
          >
            <option value="">-- 选择模特 --</option>
            {models.map(m => (
              <option key={m.id} value={m.previewUrl}>{m.name} ({m.category})</option>
            ))}
          </select>
          {selectedModel?.previewUrl && (
            <img src={selectedModel.previewUrl} alt={selectedModel.name} className="mt-1 w-full h-16 object-contain rounded bg-forge-surface2" />
          )}
        </div>
      );
    }

    // ── Template Picker (from 模板库) ──
    if (field.type === 'template_picker') {
      const filteredTemplates = templates.filter(t => {
        if (field.options && field.options.length > 0) {
          return field.options.includes(t.type);
        }
        return true;
      });
      const selectedTemplate = templates.find(t => t.id === value);
      return (
        <div key={field.name}>
          <label className="text-xs text-forge-text2 mb-1 block">
            <Layout size={12} className="inline mr-1" />{field.label} {field.required && <span className="text-red-400">*</span>}
            <span className="text-forge-text2/50 ml-1">({filteredTemplates.length} 个模板)</span>
          </label>
          <select
            value={value}
            onChange={e => {
              update(field.name, e.target.value);
              // Auto-fill template prompt
              const tpl = templates.find(t => t.id === e.target.value);
              if (tpl?.promptTemplate) {
                update('user_prompt', tpl.promptTemplate.replace('{sku}', formData['product_name'] || ''));
              }
              // Auto-fill first reference image
              if (tpl?.refImages?.[0]?.dataUrl) {
                update('template_ref_image', tpl.refImages[0].dataUrl);
              }
            }}
            className="w-full bg-forge-surface2 border border-forge-border rounded-lg px-3 py-2 text-sm text-forge-text focus:border-forge-cyan/40 outline-none"
            disabled={loading}
          >
            <option value="">-- 选择模板 --</option>
            {filteredTemplates.map(t => (
              <option key={t.id} value={t.id}>{t.name} ({t.type})</option>
            ))}
          </select>
          {selectedTemplate && (
            <div className="mt-1 text-xs text-forge-text2 bg-forge-surface2 rounded p-2">
              <div className="text-forge-text truncate">{selectedTemplate.description}</div>
              <div className="text-forge-text2/50 mt-0.5">{selectedTemplate.refImages?.length || 0} 张参考图</div>
            </div>
          )}
        </div>
      );
    }

    // ── SKU Lookup (领猫款式查询) ──
    if (field.type === 'sku_lookup') {
      return (
        <div key={field.name}>
          <label className="text-xs text-forge-text2 mb-1 block">
            <Package size={12} className="inline mr-1" />{field.label} {field.required && <span className="text-red-400">*</span>}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={skuCode}
              onChange={e => setSkuCode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSkuLookup()}
              placeholder="输入款号，回车查询"
              className="flex-1 bg-forge-surface2 border border-forge-border rounded-lg px-3 py-2 text-sm text-forge-text focus:border-forge-cyan/40 outline-none"
              disabled={loading || skuLoading}
            />
            <button
              onClick={handleSkuLookup}
              disabled={loading || skuLoading || !skuCode.trim()}
              className="flex items-center gap-1 px-3 py-2 rounded-lg bg-forge-cyan/10 text-forge-cyan text-xs hover:bg-forge-cyan/20 disabled:opacity-40 transition-colors"
            >
              <Search size={14} /> {skuLoading ? '查询中...' : '查询'}
            </button>
          </div>
          {skuResult && !skuResult.error && (
            <div className="mt-1 text-xs text-green-400 bg-green-500/5 rounded p-2">
              已加载: {skuResult.styleName || skuCode}
            </div>
          )}
          {skuResult?.error && (
            <div className="mt-1 text-xs text-red-400 bg-red-500/5 rounded p-2">{skuResult.error}</div>
          )}
        </div>
      );
    }

    // ── Select ──
    if (field.type === 'select') {
      return (
        <div key={field.name}>
          <label className="text-xs text-forge-text2 mb-1 block">
            {field.label} {field.required && <span className="text-red-400">*</span>}
          </label>
          <select
            value={value}
            onChange={e => update(field.name, e.target.value)}
            className="w-full bg-forge-surface2 border border-forge-border rounded-lg px-3 py-2 text-sm text-forge-text focus:border-forge-cyan/40 outline-none"
            disabled={loading}
          >
            {!field.required && <option value="">-- 请选择 --</option>}
            {field.options.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      );
    }

    // ── Number ──
    if (field.type === 'number') {
      return (
        <div key={field.name}>
          <label className="text-xs text-forge-text2 mb-1 block">
            {field.label} {field.required && <span className="text-red-400">*</span>}
          </label>
          <input
            type="number"
            value={value}
            onChange={e => update(field.name, e.target.value)}
            placeholder={field.placeholder || field.default || `请输入${field.label}`}
            className="w-full bg-forge-surface2 border border-forge-border rounded-lg px-3 py-2 text-sm text-forge-text focus:border-forge-cyan/40 outline-none"
            disabled={loading}
          />
        </div>
      );
    }

    // ── Default: Text / Textarea ──
    return (
      <div key={field.name}>
        <label className="text-xs text-forge-text2 mb-1 block">
          {field.label} {field.required && <span className="text-red-400">*</span>}
        </label>
        <textarea
          value={value}
          onChange={e => update(field.name, e.target.value)}
          placeholder={field.placeholder || `请输入${field.label}`}
          className="w-full bg-forge-surface2 border border-forge-border rounded-lg px-3 py-2 text-sm text-forge-text resize-none h-16 focus:border-forge-cyan/40 outline-none"
          disabled={loading}
        />
      </div>
    );
  };

  if (fields.length === 0) {
    return (
      <div className="text-center py-12 text-forge-text2/50 text-sm">
        该工作流没有可配置的参数
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {fields.map(field => (
        <div key={field.name} className={(field.type === 'text' || field.type === 'sku_lookup') ? 'md:col-span-2' : ''}>
          {renderField(field)}
        </div>
      ))}
    </div>
  );
}
