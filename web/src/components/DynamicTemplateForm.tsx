import { Upload, X } from 'lucide-react';

/* ── Types ─────────────────────────────────────────── */

export interface ExposedField {
  name: string;
  label: string;
  type: 'image' | 'text' | 'select' | 'number';
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
        <div key={field.name} className={field.type === 'text' ? 'md:col-span-2' : ''}>
          {renderField(field)}
        </div>
      ))}
    </div>
  );
}
