import { useState, useRef, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Loader2, Database, Grid3x3, RefreshCw, ArrowRight, Download, Trash2, ClipboardList, ChevronDown, ChevronUp, Circle, Camera, Wand2, Upload, X, Image, Pencil, Check, RotateCcw, Plus } from 'lucide-react';
import { useTryOnStore } from '@/store/useTryOnStore';
import { useLlmStore } from '@/store/useLlmStore';
import { useAppStore } from '@/store/useAppStore';
import type { SKUInfo } from '@/types/tryon-types';
import { queryStyleByCode, queryStyleList } from '@/services/lingmao';
import { analyzeProductWithInfo, analyzeDetailImage } from '@/services/llmService';
import { compressImageForLLM, blobUrlToFile } from '@/utils/image';
import { saveImage, loadImage, deleteImage } from '@/services/imageStore';
import { LazyImage } from '@/components/LazyImage';

const LS_KEY = 'vf-local-library';
const MAX_FILE_SIZE = 50 * 1024 * 1024;

function getDb(): SKUInfo[] { try { const r = localStorage.getItem(LS_KEY); return r ? JSON.parse(r) : []; } catch { return []; } }

/** Save to localStorage, stripping base64 images (too large for 5MB limit). Images live in IndexedDB only. */
function saveDb(list: SKUInfo[]) {
  const capped = list.slice(0, 200);
  const stripped = capped.map(s => {
    const { frontImageBase64, backImageBase64, logoImageBase64, ...rest } = s as SKUInfo & { frontImageBase64?: string; backImageBase64?: string; logoImageBase64?: string };
    const flags: Record<string, unknown> = {};
    if (frontImageBase64) flags._hasFront = true;
    if (backImageBase64) flags._hasBack = true;
    if (logoImageBase64) flags._hasDetails = true; // 迁移：旧 logo → detail_0
    const sf = s as unknown as Record<string, unknown>;
    if (sf._hasDetails) flags._hasDetails = true;
    if (sf._detailCount) flags._detailCount = sf._detailCount;
    if (sf._hasFront) flags._hasFront = true;
    if (sf._hasBack) flags._hasBack = true;
    return { ...rest, ...flags };
  });
  try { localStorage.setItem(LS_KEY, JSON.stringify(capped)); } catch (e) { console.error('saveDb failed:', e); }
}

/** Merge db (from localStorage/metadata) with current library (has _hasFront etc flags). */
function mergeLibrary(dbFromLs: SKUInfo[], currentLib: SKUInfo[]): SKUInfo[] {
  const flagMap = new Map(currentLib.map(s => {
    const f = s as unknown as Record<string, unknown>;
    return [s.skuCode, {
      hasFront: !!f._hasFront, hasBack: !!f._hasBack,
      hasDetails: !!(f._hasDetails || f._hasLogo),
      detailCount: (f._detailCount as number) || (f._hasLogo ? 1 : 0),
    }];
  }));
  return dbFromLs.map(s => {
    const saved = flagMap.get(s.skuCode);
    const f = s as unknown as Record<string, unknown>;
    if (saved?.hasFront) f._hasFront = true;
    if (saved?.hasBack) f._hasBack = true;
    if (saved?.hasDetails) { f._hasDetails = true; f._detailCount = saved.detailCount; }
    return s;
  });
}

function genId() { return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

function DetailCard({ item, onClose }: { item: SKUInfo; onClose: () => void }) {
  const sections: { title: string; rows: { label: string; value?: string | number | null }[] }[] = [
    { title: '基础标识', rows: [
      { label: '款式编号', value: item.skuCode }, { label: '名称', value: item.productName },
      { label: '品牌', value: item.brand }, { label: '年份/季节', value: [item.year, item.season].filter(Boolean).join(' / ') },
      { label: '分类', value: item.category }, { label: '性别', value: item.gender },
    ]},
    { title: '规格', rows: [
      { label: '成分', value: item.composition }, { label: '面料克重', value: item.fabricWeight ? `${item.fabricWeight}g` : '' },
      { label: '面料类别', value: item.fabricCategory }, { label: '厚薄/弹性', value: item.thicknessElastic },
    ]},
    { title: '面料与版型', rows: [
      { label: '面料介绍', value: item.fabricIntro }, { label: '版型介绍', value: item.profileIntro },
      { label: '肩型', value: item.shoulderType }, { label: '领型', value: item.collarType },
      { label: '设计卖点', value: item.saleInfo },
    ]},
  ];
  return (
    <div className="glass-card p-4 animate-slide-up">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-forge-text font-medium text-sm">{item.productName}</h3>
        <button onClick={onClose} className="text-forge-text2/40 hover:text-forge-text text-xs">收起</button>
      </div>
      <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
        {sections.map(sec => {
          const filled = sec.rows.filter(r => r.value && String(r.value).trim());
          if (filled.length === 0) return null;
          return (
            <div key={sec.title}>
              <p className="text-[10px] text-forge-cyan/70 mb-1 font-medium">{sec.title}</p>
              <div className="grid grid-cols-2 gap-x-3">{filled.map(r => <Row key={r.label} label={r.label} value={r.value} />)}</div>
            </div>
          );
        })}
        <Section title="尺码与颜色">
          <div className="flex flex-wrap gap-1 mb-1">{item.sizes.map(s => <span key={s} className="px-2 py-0.5 text-[10px] rounded border border-forge-border/50 text-forge-text2">{s}</span>)}</div>
          <div className="flex flex-wrap gap-2 mt-1">{item.colors.map(c => <span key={c} className="inline-flex items-center gap-1 text-xs text-forge-text2"><Circle size={10} fill="#888" stroke="#333" />{c}</span>)}</div>
        </Section>
        {item.reversePrompt && (
          <Section title="AI 反推提示词">
            <p className="text-xs text-forge-text2 col-span-2 whitespace-pre-wrap">{item.reversePrompt}</p>
            {item.reversePromptGeneratedAt && <p className="text-[10px] text-forge-text2/40 col-span-2 mt-1">生成: {new Date(item.reversePromptGeneratedAt).toLocaleString('zh-CN')}</p>}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (<div><p className="text-[10px] text-forge-cyan/70 mb-1 font-medium">{title}</p><div className="grid grid-cols-2 gap-x-3">{children}</div></div>);
}
function Row({ label, value }: { label: string; value?: string | number | null }) {
  return <div className="flex items-baseline gap-2 py-0.5"><span className="text-[10px] text-forge-text2/50 w-16 flex-shrink-0">{label}</span><span className="text-[11px] text-forge-text truncate">{value ?? '-'}</span></div>;
}
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = reject; reader.readAsDataURL(file);
  });
}

/** 生成 200px 缩略图 (JPEG 55%) ≈ 5-10KB */
function fileToThumb(file: File): Promise<string> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      const scale = Math.min(200 / img.width, 200 / img.height, 1);
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.55));
    };
    img.onerror = () => resolve('');
    img.src = URL.createObjectURL(file);
  });
}

/** IndexedDB key helpers — 缩略图 / 原图 */
const imgKey = (skuCode: string, type: string) => `style_${skuCode}_${type}`;
const thumbKey = (skuCode: string, type: string) => `style_${skuCode}_${type}_thumb`;

export function StyleManage() {
  const nav = useNavigate();
  const { setSkuInfo } = useTryOnStore();
  const getVisionModel = useLlmStore((s) => s.getVisionModel);
  const addToast = useAppStore((s) => s.addToast);
  const [tab, setTab] = useState<'batch' | 'library'>('batch');
  const [batch, setBatch] = useState('');
  const [batchCodes, setBatchCodes] = useState<string[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchDone, setBatchDone] = useState(0);
  const [batchFail, setBatchFail] = useState(0);
  const [library, setLibrary] = useState<SKUInfo[]>(getDb);
  const [syncLoading, setSyncLoading] = useState(false);
  const [expandedSku, setExpandedSku] = useState<string | null>(null);
  // Import progress
  const [importRunning, setImportRunning] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  // Batch reverse prompt progress
  const [batchRpRunning, setBatchRpRunning] = useState(false);
  const [batchRpProgress, setBatchRpProgress] = useState({ current: 0, total: 0, currentSku: '' });
  // Edit fields
  const [editingSkuCode, setEditingSkuCode] = useState<string | null>(null);
  const [editSkuValue, setEditSkuValue] = useState('');

  const removeFromLib = async (skuCode: string) => {
    if (!confirm(`确认删除款式 ${skuCode}？将同时清除所有关联图片。`)) return;
    const origDb = getDb();
    const item = origDb.find(s => s.skuCode === skuCode);
    const detailCount = (item as unknown as Record<string, unknown>)?._detailCount as number || 0;
    const db = origDb.filter(s => s.skuCode !== skuCode);
    saveDb(db);
    setLibrary(prev => prev.filter(s => s.skuCode !== skuCode));
    // Clean up all IndexedDB images
    const cleanupKeys: string[] = [];
    for (const t of ['front', 'back']) { cleanupKeys.push(imgKey(skuCode, t), thumbKey(skuCode, t)); }
    cleanupKeys.push(imgKey(skuCode, 'logo'), thumbKey(skuCode, 'logo')); // old logo key
    for (let i = 0; i < detailCount; i++) { cleanupKeys.push(imgKey(skuCode, `detail_${i}`), thumbKey(skuCode, `detail_${i}`)); }
    await Promise.all(cleanupKeys.map(k => deleteImage(k)));
    addToast('success', `已删除 ${skuCode}`);
  };
  const goStudio = (item: SKUInfo) => { setSkuInfo(item); nav('/'); };

  const parseBatch = (raw: string) => { setBatchCodes(raw.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)); };

  const runBatch = async () => {
    if (batchCodes.length === 0) return;
    setBatchRunning(true); setBatchDone(0); setBatchFail(0);
    const db = getDb();
    for (let i = 0; i < batchCodes.length; i++) {
      const code = batchCodes[i];
      try {
        const r = await queryStyleByCode([code]);
        if (r.skuInfo) {
          const idx = db.findIndex(s => s.skuCode === r.skuInfo!.skuCode);
          if (idx >= 0) {
            // Overwrite existing with fresh Lingmao data, preserving images
            const prev = db[idx];
            const pf = prev as unknown as Record<string, unknown>;
            const merged: SKUInfo & Record<string, unknown> = { ...r.skuInfo, reversePrompt: prev.reversePrompt, reversePromptGeneratedAt: prev.reversePromptGeneratedAt };
            if (pf._hasFront) merged._hasFront = true;
            if (pf._hasBack) merged._hasBack = true;
            if (pf._hasDetails || pf._hasLogo) { merged._hasDetails = true; merged._detailCount = pf._detailCount || 1; }
            db[idx] = merged as SKUInfo;
          } else {
            db.unshift(r.skuInfo);
          }
          setBatchDone(p => p + 1);
        } else { setBatchFail(p => p + 1); }
      } catch { setBatchFail(p => p + 1); }
    }
    saveDb(db); setLibrary(prev => mergeLibrary(db, prev)); setBatchRunning(false);
    // Auto-trigger reverse prompt after batch Lingmao import
    const itemsNeedRp = db.filter(s => (s as unknown as Record<string, boolean>)._hasFront && !s.reversePrompt);
    if (itemsNeedRp.length > 0) {
      addToast('info', `自动为 ${itemsNeedRp.length} 个款式生成反推提示词...`);
      // Delay slightly to let UI update, then trigger
      setTimeout(() => batchGenerateReversePrompts(), 500);
    }
  };

  // Refresh single SKU from Lingmao (overwrite)
  const refreshFromLingmao = async (skuCode: string) => {
    addToast('info', `正在从领猫刷新 ${skuCode}...`);
    try {
      const r = await queryStyleByCode([skuCode]);
      if (r.skuInfo) {
        const db = getDb();
        const idx = db.findIndex(s => s.skuCode === skuCode);
        if (idx >= 0) {
          const prev = db[idx];
          const prevFlags = prev as unknown as Record<string, boolean>;
          const merged = { ...r.skuInfo, reversePrompt: prev.reversePrompt, reversePromptGeneratedAt: prev.reversePromptGeneratedAt };
          if (prevFlags._hasFront) (merged as unknown as Record<string, boolean>)._hasFront = true;
          if (prevFlags._hasBack) (merged as unknown as Record<string, boolean>)._hasBack = true;
          if (prevFlags._hasDetails || prevFlags._hasLogo) { (merged as unknown as Record<string, unknown>)._hasDetails = true; (merged as unknown as Record<string, unknown>)._detailCount = prevFlags._detailCount || 1; }
          db[idx] = merged;
          saveDb(db); setLibrary(prev1 => mergeLibrary(db, prev1));
        }
        addToast('success', `${skuCode} 已刷新`);
      } else {
        addToast('warning', `${skuCode} 在领猫中未找到`);
      }
    } catch { addToast('error', '刷新失败'); }
  };

  // Checkbox selection
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());
  const toggleSelect = (skuCode: string) => {
    setSelectedSkus(prev => { const next = new Set(prev); if (next.has(skuCode)) next.delete(skuCode); else next.add(skuCode); return next; });
  };
  const selectAll = () => {
    if (selectedSkus.size === library.length) { setSelectedSkus(new Set()); }
    else { setSelectedSkus(new Set(library.map(s => s.skuCode))); }
  };

  // 批量反推（选中）
  const batchReverseSelected = async () => {
    const hasFront = (s: SKUInfo) => !!(s as unknown as Record<string, boolean>)._hasFront;
    const targets = selectedSkus.size > 0
      ? library.filter(s => selectedSkus.has(s.skuCode) && hasFront(s))
      : library.filter(s => hasFront(s));
    if (targets.length === 0) { addToast('warning', '选中的款号没有白底图'); return; }

    const visionModel = getVisionModel();
    if (!visionModel) { addToast('warning', '请先启用多模态模型'); return; }

    setBatchRpRunning(true);
    setBatchRpProgress({ current: 0, total: targets.length, currentSku: '' });
    const db = getDb();
    let ok = 0; let fail = 0;
    for (let idx = 0; idx < targets.length; idx++) {
      const item = targets[idx];
      setBatchRpProgress({ current: idx + 1, total: targets.length, currentSku: item.skuCode });
      try {
        const frontB64 = await loadImage(imgKey(item.skuCode, 'front'));
        if (!frontB64) { fail++; continue; }

        const f = item as unknown as Record<string, unknown>;
        const detailCount = (f._detailCount as number) || (f._hasLogo ? 1 : 0);
        const detailB64s: (string | undefined)[] = [];
        for (let i = 0; i < detailCount; i++) detailB64s.push(await loadImage(imgKey(item.skuCode, `detail_${i}`)));
        if (f._hasLogo && detailCount <= 1) detailB64s.push(await loadImage(imgKey(item.skuCode, 'logo')));

        const lingmaoParts: string[] = [];
        if (item.productName) lingmaoParts.push(`商品名称：${item.productName}`);
        if (item.composition) lingmaoParts.push(`材质成分：${item.composition}`);
        if (item.fabricIntro) lingmaoParts.push(`面料描述：${item.fabricIntro}`);
        if (item.fabricCategory) lingmaoParts.push(`面料类别：${item.fabricCategory}`);
        if (item.profileIntro) lingmaoParts.push(`版型描述：${item.profileIntro}`);
        if (item.saleInfo) lingmaoParts.push(`卖点：${item.saleInfo}`);

        const mainAnalysis = await analyzeProductWithInfo(visionModel, frontB64, lingmaoParts.join('\n'));
        const parts = ['【白底图视觉特征 — AI 多模态识别】', mainAnalysis];

        for (let i = 0; i < detailB64s.length; i++) {
          if (detailB64s[i]) {
            const dr = await analyzeDetailImage(visionModel, detailB64s[i]!);
            if (dr) {
              if (i === 0 && parts.length === 2) parts.push('', '【细节图分析】');
              parts.push(`细节图${i + 1}: ${dr}`);
            }
          }
        }
        if (lingmaoParts.length > 0) parts.push('', '【领猫商品资料】', ...lingmaoParts);

        const prompt = parts.join('\n');
        const now = new Date().toISOString();
        const dbi = db.findIndex(s => s.skuCode === item.skuCode);
        if (dbi >= 0) { db[dbi].reversePrompt = prompt; db[dbi].reversePromptGeneratedAt = now; }
        // 即时更新 state，和单款反推一致（不依赖 mergeLibrary）
        setLibrary(prev => prev.map(s => s.skuCode === item.skuCode ? { ...s, reversePrompt: prompt, reversePromptGeneratedAt: now } : s));
        ok++;
      } catch (e) { console.warn(`[StyleManage] ${item.skuCode} 反推失败:`, e); fail++; }
    }
    saveDb(db);
    setBatchRpRunning(false);
    addToast('success', `完成 ${ok}${fail > 0 ? ` · 失败 ${fail}` : ''} / ${targets.length}`);
  };

  // Rename SKU code
  const startRename = (skuCode: string) => { setEditingSkuCode(skuCode); setEditSkuValue(skuCode); };
  const confirmRename = () => {
    if (!editingSkuCode || !editSkuValue.trim() || editSkuValue === editingSkuCode) { setEditingSkuCode(null); return; }
    const db = getDb();
    const idx = db.findIndex(s => s.skuCode === editingSkuCode);
    if (idx >= 0) {
      // Rename IndexedDB keys (thumb + full), including all detail images
      const item = db.find(s => s.skuCode === editingSkuCode);
      const detailCount = (item as unknown as Record<string, unknown>)?._detailCount as number || 0;
      const types = ['front', 'back'];
      for (let i = 0; i < detailCount; i++) types.push(`detail_${i}`);
      types.forEach(async (type) => {
        const [oldFull, oldThumb] = await Promise.all([
          loadImage(imgKey(editingSkuCode!, type)),
          loadImage(thumbKey(editingSkuCode!, type)),
        ]);
        if (oldFull) { await saveImage(imgKey(editSkuValue, type), oldFull); await deleteImage(imgKey(editingSkuCode!, type)); }
        if (oldThumb) { await saveImage(thumbKey(editSkuValue, type), oldThumb); await deleteImage(thumbKey(editingSkuCode!, type)); }
      });
      db[idx].skuCode = editSkuValue.trim();
      saveDb(db); setLibrary(prev => mergeLibrary(db, prev));
      addToast('success', `款号已改为 ${editSkuValue}`);
    }
    setEditingSkuCode(null);
  };

  const syncFromLingmao = async () => {
    setSyncLoading(true);
    try {
      const r = await queryStyleList(1, 50);
      if (r.items.length > 0) {
        const db = getDb();
        // Preserve image flags and reverse prompts
        const flagMap = new Map(library.map(s => {
          const f = s as unknown as Record<string, unknown>;
          return [s.skuCode, {
            hasFront: !!f._hasFront, hasBack: !!f._hasBack,
            hasDetails: !!(f._hasDetails || f._hasLogo), detailCount: (f._detailCount as number) || 0,
            rp: s.reversePrompt, rpAt: s.reversePromptGeneratedAt,
          }];
        }));
        for (const item of r.items) {
          const i = db.findIndex(s => s.skuCode === item.skuCode);
          const saved = flagMap.get(item.skuCode);
          const merged = { ...item, reversePrompt: saved?.rp, reversePromptGeneratedAt: saved?.rpAt } as SKUInfo & Record<string, unknown>;
          if (saved?.hasFront) merged._hasFront = true;
          if (saved?.hasBack) merged._hasBack = true;
          if (saved?.hasDetails) { merged._hasDetails = true; merged._detailCount = saved.detailCount; }
          if (i >= 0) { db[i] = merged as SKUInfo; } else { db.unshift(merged as SKUInfo); }
        }
        saveDb(db);
        setLibrary(prev => mergeLibrary(db, prev));
        addToast('success', `同步完成: ${r.items.length} 条`);
      }
    } catch { addToast('error', '领猫同步失败'); }
    setSyncLoading(false);
  };

  const uploadImageForSku = async (skuCode: string, file: File, type: 'front' | 'back' | 'detail') => {
    if (!file.type.startsWith('image/')) { addToast('warning', '请选择图片文件'); return; }
    if (file.size > MAX_FILE_SIZE) { addToast('warning', '单文件最大 50MB'); return; }
    const db = getDb();
    const idx = db.findIndex(s => s.skuCode === skuCode);
    if (idx < 0) { addToast('warning', '款号不存在'); return; }

    // 细节图自动分配 index
    const storeType = type === 'detail'
      ? `detail_${((db[idx] as unknown as Record<string, unknown>)._detailCount as number) || 0}`
      : type;

    const [thumb, full] = await Promise.all([fileToThumb(file), fileToBase64(file)]);
    await Promise.all([saveImage(thumbKey(skuCode, storeType), thumb), saveImage(imgKey(skuCode, storeType), full)]);

    const flags = db[idx] as unknown as Record<string, boolean>;
    if (type === 'front') { flags._hasFront = true; }
    else if (type === 'back') { flags._hasBack = true; }
    else {
      flags._hasDetails = true;
      const f = db[idx] as unknown as Record<string, unknown>;
      f._detailCount = ((f._detailCount as number) || 0) + 1;
    }
    db[idx].reversePrompt = undefined; db[idx].reversePromptGeneratedAt = undefined;
    saveDb(db); setLibrary(prev => mergeLibrary(db, prev));
    addToast('success', `${type === 'front' ? '正面' : type === 'back' ? '反面' : '细节'}图已上传`);
  };

  const removeImageForSku = async (skuCode: string, type: string) => {
    await Promise.all([deleteImage(imgKey(skuCode, type)), deleteImage(thumbKey(skuCode, type))]);
    const db = getDb();
    const idx = db.findIndex(s => s.skuCode === skuCode);
    if (idx >= 0) {
      const flags = db[idx] as unknown as Record<string, boolean>;
      if (type === 'front') { flags._hasFront = false; }
      else if (type === 'back') { flags._hasBack = false; }
      else if (type.startsWith('detail_')) {
        // 删除一张细节图后，后面的索引前移（重整 IndexedDB keys）
        const delIdx = parseInt(type.split('_')[1], 10);
        const f = db[idx] as unknown as Record<string, unknown>;
        const count = (f._detailCount as number) || 0;
        for (let i = delIdx + 1; i < count; i++) {
          const [oldFull, oldThumb] = await Promise.all([
            loadImage(imgKey(skuCode, `detail_${i}`)),
            loadImage(thumbKey(skuCode, `detail_${i}`)),
          ]);
          if (oldFull) await saveImage(imgKey(skuCode, `detail_${i - 1}`), oldFull);
          if (oldThumb) await saveImage(thumbKey(skuCode, `detail_${i - 1}`), oldThumb);
          await Promise.all([deleteImage(imgKey(skuCode, `detail_${i}`)), deleteImage(thumbKey(skuCode, `detail_${i}`))]);
        }
        f._detailCount = Math.max(0, count - 1);
        if (f._detailCount === 0) flags._hasDetails = false;
      }
      saveDb(db); setLibrary(prev => mergeLibrary(db, prev));
    }
  };

  const generateReversePrompt = async (skuCode: string) => {
    const visionModel = getVisionModel();
    if (!visionModel) { addToast('warning', '请先启用多模态模型'); return; }
    const item = library.find(s => s.skuCode === skuCode);
    const flags = item as unknown as Record<string, unknown> | undefined;
    if (!flags?._hasFront) { addToast('warning', '请先上传正面白底图'); return; }

    // 加载主图 + 全部细节图
    const detailCount = (flags?._detailCount as number) || (flags?._hasLogo ? 1 : 0);
    const detailKeys = [];
    for (let i = 0; i < detailCount; i++) detailKeys.push(`detail_${i}`);
    // 兼容旧 logo key
    if (flags?._hasLogo && detailCount === 0) detailKeys.push('logo');

    const [frontB64, ...detailB64s] = await Promise.all([
      loadImage(imgKey(skuCode, 'front')),
      ...detailKeys.map(k => loadImage(imgKey(skuCode, k))),
    ]);
    if (!frontB64) { addToast('warning', '图片加载失败'); return; }

    addToast('info', `MiMo 分析 ${skuCode}${detailKeys.length ? ` + ${detailKeys.length}张细节图` : ''}...`);
    try {
      // 构建领猫文本信息
      const lingmaoParts: string[] = [];
      if (item!.productName) lingmaoParts.push(`商品名称：${item!.productName}`);
      if (item!.brand) lingmaoParts.push(`品牌：${item!.brand}`);
      if (item!.category) lingmaoParts.push(`品类：${item!.category}`);
      if (item!.composition) lingmaoParts.push(`材质成分：${item!.composition}`);
      if (item!.fabricIntro) lingmaoParts.push(`面料描述：${item!.fabricIntro}`);
      if (item!.fabricCategory) lingmaoParts.push(`面料类别：${item!.fabricCategory}`);
      if (item!.profileIntro) lingmaoParts.push(`版型描述：${item!.profileIntro}`);
      if (item!.collarType) lingmaoParts.push(`领型：${item!.collarType}`);
      if (item!.shoulderType) lingmaoParts.push(`肩型：${item!.shoulderType}`);
      if (item!.sleeveType) lingmaoParts.push(`袖型：${item!.sleeveType}`);
      if (item!.hemDesign) lingmaoParts.push(`下摆设计：${item!.hemDesign}`);
      if (item!.thicknessElastic) lingmaoParts.push(`厚薄/弹性：${item!.thicknessElastic}`);
      if (item!.saleInfo) lingmaoParts.push(`卖点：${item!.saleInfo}`);
      if (item!.processDesc) lingmaoParts.push(`工艺：${item!.processDesc}`);

      // 主图分析
      const mainAnalysis = await analyzeProductWithInfo(visionModel, frontB64, lingmaoParts.join('\n'));
      const parts = ['【白底图视觉特征 — AI 多模态识别】', mainAnalysis];

      // 逐张分析细节图
      if (detailKeys.length > 0) {
        parts.push('', '【细节图分析】');
        for (let i = 0; i < detailKeys.length; i++) {
          if (detailB64s[i]) {
            addToast('info', `分析细节图 ${i + 1}/${detailKeys.length}...`);
            const detailResult = await analyzeDetailImage(visionModel, detailB64s[i]!);
            if (detailResult) parts.push(`细节图${i + 1}: ${detailResult}`);
          }
        }
      }

      // 领猫资料
      if (lingmaoParts.length > 0) {
        parts.push('', '【领猫商品资料】', ...lingmaoParts);
      }

      const prompt = parts.join('\n');
      const db = getDb();
      const idx = db.findIndex(s => s.skuCode === skuCode);
      if (idx >= 0) { db[idx].reversePrompt = prompt; db[idx].reversePromptGeneratedAt = new Date().toISOString(); saveDb(db); }
      setLibrary(prev => prev.map(s => s.skuCode === skuCode ? { ...s, reversePrompt: prompt, reversePromptGeneratedAt: new Date().toISOString() } : s));
      addToast('success', `${skuCode} 已生成（主图 + ${detailKeys.length} 细节）`);
    } catch (e) { addToast('error', `反推失败: ${e instanceof Error ? e.message : String(e)}`); }
  };

  const batchGenerateReversePrompts = async () => {
    const visionModel = getVisionModel();
    if (!visionModel) { addToast('warning', '请先启用多模态模型'); return; }
    const db = getDb();
    const itemsWithImages = db.filter(s => (s as unknown as Record<string, boolean>)._hasFront);
    if (itemsWithImages.length === 0) { addToast('warning', '没有已上传白底图的款式'); return; }

    setBatchRpRunning(true);
    setBatchRpProgress({ current: 0, total: itemsWithImages.length, currentSku: '' });
    let ok = 0; let fail = 0;
    for (let idx = 0; idx < itemsWithImages.length; idx++) {
      const item = itemsWithImages[idx];
      setBatchRpProgress({ current: idx + 1, total: itemsWithImages.length, currentSku: item.skuCode });
      try {
        const frontB64 = await loadImage(imgKey(item.skuCode, 'front'));
        if (!frontB64) { fail++; continue; }
        const prompt = await analyzeProductWithInfo(visionModel, frontB64, '', undefined);
        const parts = ['【白底图视觉特征 — AI 多模态识别】', prompt];
        if (item.productName) { parts.push('', '【领猫商品资料】', `商品名称：${item.productName}`); if (item.composition) parts.push(`材质成分：${item.composition}`); if (item.fabricIntro) parts.push(`面料描述：${item.fabricIntro}`); if (item.saleInfo) parts.push(`卖点：${item.saleInfo}`); }
        const rp = parts.join('\n');
        const now = new Date().toISOString();
        const dbi = db.findIndex(s => s.skuCode === item.skuCode);
        if (dbi >= 0) { db[dbi].reversePrompt = rp; db[dbi].reversePromptGeneratedAt = now; }
        // 即时更新 state
        setLibrary(prev => prev.map(s => s.skuCode === item.skuCode ? { ...s, reversePrompt: rp, reversePromptGeneratedAt: now } : s));
        ok++;
      } catch (e) { console.warn(`[StyleManage] ${item.skuCode} 反推失败:`, e); fail++; }
    }
    saveDb(db);
    setBatchRpRunning(false);
    addToast('success', `完成 ${ok}${fail > 0 ? ` · 失败 ${fail}` : ''} / ${itemsWithImages.length}`);
  };

  // Folder import with progress tracking
  const handleFolderImport = async (files: FileList) => {
    setImportRunning(true);
    setImportProgress('正在解析文件名...');
    // Yield to allow React to render
    await new Promise(r => setTimeout(r, 50));

    const fileArray = Array.from(files);
    const parsed: Map<string, { front?: File; back?: File; details: File[] }> = new Map();
    const ensureEntry = (code: string) => { if (!parsed.has(code)) parsed.set(code, { details: [] }); return parsed.get(code)!; };

    // 第一遍：从正/反面匹配中提取款号
    const frontBackCodes = new Set<string>();
    for (const file of fileArray) {
      const nameNoExt = file.name.replace(/\.[^.]+$/, '');
      const fm = nameNoExt.match(/^(.+?)[-_]?(?:白底)?(?:正面|正面图)$/);
      const bm = nameNoExt.match(/^(.+?)[-_]?(?:白底)?(?:反面|反面图)$/);
      if (fm) frontBackCodes.add(fm[1].trim());
      if (bm) frontBackCodes.add(bm[1].trim());
    }

    // 第二遍：分类所有文件（正/反面精确匹配，其余以已知款号开头 → 细节图）
    for (const file of fileArray) {
      const nameNoExt = file.name.replace(/\.[^.]+$/, '');
      const fm = nameNoExt.match(/^(.+?)[-_]?(?:白底)?(?:正面|正面图)$/);
      const bm = nameNoExt.match(/^(.+?)[-_]?(?:白底)?(?:反面|反面图)$/);
      if (fm) { ensureEntry(fm[1].trim()).front = file; continue; }
      if (bm) { ensureEntry(bm[1].trim()).back = file; continue; }
      // 宽泛匹配：文件名以已知款号开头 → 细节图（如 "BM26A238CM_正面细节.png", "款号_印花.png"）
      for (const code of frontBackCodes) {
        if (nameNoExt === code || nameNoExt.startsWith(code + '_') || nameNoExt.startsWith(code + '-')) {
          ensureEntry(code).details.push(file);
          break;
        }
      }
    }

    if (parsed.size === 0) { addToast('warning', '未识别到符合命名规则的文件'); setImportRunning(false); return; }

    const totalDetailFiles = Array.from(parsed.values()).reduce((s, e) => s + e.details.length, 0);
    setImportProgress(`识别到 ${parsed.size} 个款号 (${totalDetailFiles} 张细节图)，开始上传...`);
    await new Promise(r => setTimeout(r, 50));

    const db = getDb();
    let uploaded = 0; let processed = 0;
    const totalFiles = Array.from(parsed.values()).reduce((sum, imgs) => sum + (imgs.front ? 1 : 0) + (imgs.back ? 1 : 0) + imgs.details.length, 0);
    let fileDone = 0;

    for (const [skuCode, imgs] of parsed) {
      processed++;
      setImportProgress(`上传 ${processed}/${parsed.size} 款 (${fileDone}/${totalFiles} 张图)...`);
      await new Promise(r => setTimeout(r, 10));

      try {
        const saveImg = async (file: File, type: string) => {
          const [thumb, full] = await Promise.all([fileToThumb(file), fileToBase64(file)]);
          await Promise.all([saveImage(thumbKey(skuCode, type), thumb), saveImage(imgKey(skuCode, type), full)]);
        };
        if (imgs.front) {
          await Promise.race([
            saveImg(imgs.front, 'front'),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('上传超时')), 45000)),
          ]);
          let idx = db.findIndex(s => s.skuCode === skuCode);
          if (idx < 0) { const empty: SKUInfo = { skuCode, productName: '', unit: '', gender: '', listDate: '', brand: '', year: '', season: '', band: '', category: '', designGroup: '', designer: '', supplierName: '', supplierCode: '', goodCode: '', oriBrand: '', series: '', profile: '', srcUrl: '', createTime: '', degree: '', customer: '', sizes: [], colors: [], skuList: [], price: 0, costPrice: 0, retailPrice: 0, standardRule: '', safeLevel: '', composition: '', processDesc: '', fabricWeight: '', hasQualityReport: '', fabricIntro: '', profileIntro: '', fabricCategory: '', shoulderType: '', collarType: '', sleeveType: '', hemDesign: '', thicknessElastic: '', packaging: '', hangTag: '', desiccantStorage: '', sachetLabel: '', saleInfo: '', washInfo: '', remark: '', imgUrls: [], sizeGuide: null, fetchedAt: new Date().toISOString() }; (empty as unknown as Record<string, boolean>)._hasFront = true; db.unshift(empty); }
          else { db[idx].frontImageBase64 = undefined; (db[idx] as unknown as Record<string, boolean>)._hasFront = true; db[idx].reversePrompt = undefined; db[idx].reversePromptGeneratedAt = undefined; }
          uploaded++; fileDone++;
        }
        if (imgs.back) { await saveImg(imgs.back, 'back'); const idx = db.findIndex(s => s.skuCode === skuCode); if (idx >= 0) { db[idx].backImageBase64 = undefined; (db[idx] as unknown as Record<string, boolean>)._hasBack = true; } fileDone++; }
        // 细节图：按顺序编号 detail_0, detail_1, ...
        for (let di = 0; di < imgs.details.length; di++) {
          await saveImg(imgs.details[di], `detail_${di}`);
          const idx = db.findIndex(s => s.skuCode === skuCode);
          if (idx >= 0) {
            const f = db[idx] as unknown as Record<string, unknown>;
            f._hasDetails = true;
            f._detailCount = Math.max((f._detailCount as number) || 0, di + 1);
          }
          fileDone++; uploaded++;
        }
        if (processed % 3 === 0) { saveDb(db); setLibrary(prev => mergeLibrary(db, prev)); }
      } catch (e) {
        console.warn(`[StyleManage] ${skuCode} 上传失败:`, e);
        addToast('error', `${skuCode}: ${e instanceof Error ? e.message : '上传失败'}`);
      }
    }
    saveDb(db); setLibrary(prev => mergeLibrary(db, prev));

    // Auto-fetch Lingmao with timeout
    setImportProgress(`上传完成 (${uploaded}张)，拉取领猫资料...`);
    await new Promise(r => setTimeout(r, 50));

    let lingmaoOk = 0;
    for (const code of parsed.keys()) {
      setImportProgress(`领猫 ${lingmaoOk + 1}/${parsed.size} (已上传${uploaded}张图)...`);
      await new Promise(r => setTimeout(r, 10));
      try {
        const r = await Promise.race([
          queryStyleByCode([code]),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
        ]);
        if (r && r.skuInfo) {
          const currentDb = getDb();
          const idx = currentDb.findIndex(s => s.skuCode === code);
          if (idx >= 0) {
            const existing = currentDb[idx];
            const existingFlags = existing as unknown as Record<string, boolean>;
            const merged = { ...r.skuInfo, reversePrompt: existing.reversePrompt, reversePromptGeneratedAt: existing.reversePromptGeneratedAt };
            if (existingFlags._hasFront) (merged as unknown as Record<string, boolean>)._hasFront = true;
            if (existingFlags._hasBack) (merged as unknown as Record<string, boolean>)._hasBack = true;
            if (existingFlags._hasDetails || existingFlags._hasLogo) (merged as unknown as Record<string, boolean>)._hasDetails = true;
            if (existingFlags._detailCount) (merged as unknown as Record<string, unknown>)._detailCount = existingFlags._detailCount;
            currentDb[idx] = merged;
          }
          saveDb(currentDb); setLibrary(prev => mergeLibrary(currentDb, prev));
          lingmaoOk++;
        }
      } catch { /* timeout or network error, skip */ }
    }
    setImportProgress('');
    setImportRunning(false);
    const detailCount = Array.from(parsed.values()).reduce((s, e) => s + e.details.length, 0);
    addToast('success', `导入完成: ${parsed.size} 款 · ${uploaded} 张图 (${detailCount} 细节) · ${lingmaoOk} 领猫匹配`);
    // Auto-trigger reverse prompt for SKUs with images but no prompt yet
    const needRp = getDb().filter(s => (s as unknown as Record<string, boolean>)._hasFront && !s.reversePrompt);
    if (needRp.length > 0) {
      setTimeout(() => batchGenerateReversePrompts(), 500);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-forge-cyan to-blue-500 flex items-center justify-center"><Package size={20} className="text-forge-bg" /></div>
        <div><h2 className="font-display text-lg font-bold text-gradient-cyan tracking-wider">款式管理</h2><p className="text-xs text-forge-text2">白底图上传 → AI反推提示词 → 对接领猫 SCM</p></div>
      </div>

      <div className="flex gap-1 p-1 glass-card rounded-xl">
        {([['batch', '批量导入', ClipboardList], ['library', '款式库管理', Database]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm transition-all ${tab === k ? 'bg-forge-surface2 text-forge-cyan shadow-[0_0_10px_rgba(0,229,255,0.1)]' : 'text-forge-text2 hover:text-forge-text'}`}><Icon size={16} />{label}</button>
        ))}
      </div>

      {tab === 'batch' && (
        <div className="space-y-4">
          <div className="glass-card p-4">
            <h3 className="section-title mb-3">批量导入款号</h3>
            <textarea value={batch} onChange={e => { setBatch(e.target.value); parseBatch(e.target.value); }} placeholder="从 Excel 复制款号列粘贴到此处，每行一个款号。已存在的款号将覆盖更新。" className="textarea-field h-48" />
            {batchCodes.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-forge-text2 mb-2">已识别 <span className="text-forge-cyan font-bold">{batchCodes.length}</span> 个款号</p>
                <div className="flex flex-wrap gap-1.5">{batchCodes.map(c => <span key={c} className="px-2 py-0.5 text-[10px] rounded bg-forge-surface2 text-forge-text2 font-mono border border-forge-border/30">{c}</span>)}</div>
              </div>
            )}
            <button onClick={runBatch} disabled={batchCodes.length === 0 || batchRunning} className="orange-btn w-full mt-4 py-3 rounded-lg text-sm flex items-center justify-center gap-2 disabled:opacity-50">
              {batchRunning ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              {batchRunning ? `正在拉取 ${batchDone + batchFail}/${batchCodes.length}...` : '一键拉取（覆盖已有）'}
            </button>
            {(batchDone > 0 || batchFail > 0) && (
              <div className="mt-3 p-3 rounded-lg bg-forge-surface2/50 text-xs text-forge-text2 flex items-center gap-4">
                <span className="text-forge-green">成功 {batchDone} 个</span>
                {batchFail > 0 && <span className="text-forge-red">失败 {batchFail} 个</span>}
              </div>
            )}
          </div>

          {/* Folder import */}
          <div className="glass-card p-4">
            <h3 className="section-title mb-3 flex items-center gap-2"><Image size={14} />导入白底图</h3>
            <p className="text-[10px] text-forge-text2/50 mb-3">命名格式：<span className="text-forge-cyan font-mono">款号_正面.png</span> / <span className="text-forge-cyan font-mono">款号_反面.png</span> · 已存在的款号将覆盖图片</p>
            {importRunning ? (
              <div className="flex items-center gap-3 p-4 rounded-xl bg-forge-surface2/50 border border-forge-cyan/20">
                <Loader2 size={20} className="animate-spin text-forge-cyan" />
                <span className="text-sm text-forge-cyan">{importProgress}</span>
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; (inp as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true; inp.setAttribute('directory', ''); inp.setAttribute('multiple', ''); inp.onchange = () => { if (inp.files && inp.files.length > 0) handleFolderImport(inp.files); }; inp.click(); }} className="flex-1 border-2 border-dashed border-forge-border/50 rounded-xl py-5 text-center hover:border-forge-cyan/30 transition-colors group">
                  <Upload size={20} className="mx-auto text-forge-text2/30 group-hover:text-forge-cyan/50 mb-1" /><p className="text-xs text-forge-text2/50">选择白底图文件夹导入</p><p className="text-[10px] text-forge-text2/30 mt-0.5">自动按款号匹配 · 覆盖已有</p>
                </button>
                <button onClick={batchGenerateReversePrompts} className="flex-1 border-2 border-dashed border-purple-500/30 rounded-xl py-5 text-center hover:border-purple-400/50 transition-colors group">
                  <Wand2 size={20} className="mx-auto text-purple-400/30 group-hover:text-purple-400/60 mb-1" /><p className="text-xs text-purple-300/60">批量 AI 反推提示词</p><p className="text-[10px] text-purple-300/30 mt-0.5">AI 多模态 · 覆盖已有</p>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'library' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="section-title">本地款式库（{library.length}）</h3>
              {library.length > 0 && (
                <button onClick={selectAll} className="text-[10px] text-forge-text2 hover:text-forge-cyan">
                  {selectedSkus.size === library.length ? '取消全选' : `全选${selectedSkus.size > 0 ? ` (${selectedSkus.size})` : ''}`}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {selectedSkus.size > 0 && (
                <>
                  <span className="text-[10px] text-forge-cyan">已选 {selectedSkus.size} 个</span>
                  <button onClick={() => { navigator.clipboard.writeText([...selectedSkus].join('\n')); addToast('success', `已复制 ${selectedSkus.size} 个款号`); }} className="text-[10px] text-forge-text2 hover:text-forge-cyan border border-forge-border/40 rounded px-1.5 py-0.5">复制款号</button>
                </>
              )}
              <button onClick={batchReverseSelected} className="text-xs text-purple-300 hover:text-purple-200 flex items-center gap-1.5 transition-colors">
                <Wand2 size={13} />{selectedSkus.size > 0 ? `反推选中(${selectedSkus.size})` : '批量反推'}
              </button>
              <button onClick={syncFromLingmao} disabled={syncLoading} className="text-xs text-forge-text2 hover:text-forge-cyan flex items-center gap-1.5 transition-colors">
                {syncLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}{syncLoading ? '同步中...' : '从领猫同步'}
              </button>
            </div>
          </div>
          {/* 批量反推进度条 */}
          {batchRpRunning && (
            <div className="glass-card p-3 border border-purple-500/30 animate-slide-up">
              <div className="flex items-center gap-3">
                <Loader2 size={16} className="animate-spin text-purple-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-purple-300">AI 反推 {batchRpProgress.current}/{batchRpProgress.total}</span>
                    <span className="text-[10px] text-forge-text2/60 font-mono">{batchRpProgress.currentSku}</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-forge-surface2 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-purple-500 to-forge-cyan rounded-full transition-all duration-300" style={{ width: `${(batchRpProgress.current / batchRpProgress.total) * 100}%` }} />
                  </div>
                </div>
              </div>
            </div>
          )}
          {library.length === 0 ? (
            <div className="glass-card p-12 text-center"><Grid3x3 size={48} className="mx-auto text-forge-text2/10 mb-4" /><p className="text-forge-text2 text-sm">暂无本地款式</p><p className="text-forge-text2/40 text-xs mt-1">通过「批量导入」拉取领猫款式到本地库</p></div>
          ) : (
            <div className="space-y-3">
              {library.map(item => (
                <div key={item.skuCode}>
                  <div className="glass-card-hover p-3.5 group cursor-pointer" onClick={() => setExpandedSku(expandedSku === item.skuCode ? null : item.skuCode)}>
                    <div className="flex items-start gap-3">
                      {/* Checkbox */}
                      <div className="flex-shrink-0 pt-0.5" onClick={e => e.stopPropagation()}>
                        <button onClick={() => toggleSelect(item.skuCode)} className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${selectedSkus.has(item.skuCode) ? 'bg-forge-cyan border-forge-cyan' : 'border-forge-border/60 hover:border-forge-cyan/40'}`}>
                          {selectedSkus.has(item.skuCode) && <Check size={10} className="text-forge-bg" />}
                        </button>
                      </div>
                      {/* Thumbnail — 从 IndexedDB 按需加载缩略图，不占内存 */}
                      <LazyImage
                        thumbKey={thumbKey(item.skuCode, 'front')}
                        fullKey={(item as unknown as Record<string, boolean>)._hasFront ? imgKey(item.skuCode, 'front') : undefined}
                        className="flex-shrink-0 w-14 h-16 rounded-lg border border-forge-border/30"
                        showSpinner={(item as unknown as Record<string, boolean>)._hasFront === true}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {editingSkuCode === item.skuCode ? (
                            <span className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                              <input value={editSkuValue} onChange={e => setEditSkuValue(e.target.value)} className="input-field !py-1 text-xs w-32 font-mono" autoFocus onKeyDown={e => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') setEditingSkuCode(null); }} />
                              <button onClick={confirmRename} className="text-forge-green"><Check size={14} /></button>
                              <button onClick={() => setEditingSkuCode(null)} className="text-forge-red"><X size={14} /></button>
                            </span>
                          ) : (
                            <p className="text-sm font-medium text-forge-text truncate">{item.productName || item.skuCode}</p>
                          )}
                          {expandedSku === item.skuCode ? <ChevronUp size={14} className="text-forge-cyan flex-shrink-0" /> : <ChevronDown size={14} className="text-forge-text2/30 flex-shrink-0" />}
                          {item.reversePrompt && <span title="有反推提示词"><Wand2 size={12} className="text-purple-400 flex-shrink-0" /></span>}
                        </div>
                        <p className="text-xs text-forge-cyan font-mono mt-0.5">{item.skuCode}</p>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {item.brand && <span className="text-[10px] px-1.5 py-0.5 rounded bg-forge-cyan/10 text-forge-cyan border border-forge-cyan/20">{item.brand}</span>}
                          {item.season && <span className="text-[10px] px-1.5 py-0.5 rounded bg-forge-orange/10 text-forge-orange border border-forge-orange/20">{item.season}</span>}
                          <span className="text-[10px] text-forge-text2/50">{item.category}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                        <button onClick={(e) => { e.stopPropagation(); startRename(item.skuCode); }} className="text-forge-text2/20 hover:text-forge-cyan transition-colors p-1 opacity-0 group-hover:opacity-100" title="改款号"><Pencil size={12} /></button>
                        <button onClick={(e) => { e.stopPropagation(); refreshFromLingmao(item.skuCode); }} className="text-forge-text2/20 hover:text-forge-green transition-colors p-1 opacity-0 group-hover:opacity-100" title="从领猫刷新"><RotateCcw size={12} /></button>
                        <button onClick={(e) => { e.stopPropagation(); removeFromLib(item.skuCode); }} className="text-forge-text2/20 hover:text-forge-red transition-colors p-1 opacity-0 group-hover:opacity-100"><Trash2 size={14} /></button>
                        <button onClick={(e) => { e.stopPropagation(); goStudio(item); }} className="gradient-btn px-3 py-1.5 rounded text-[11px] flex items-center gap-1 flex-shrink-0">进入试衣<ArrowRight size={11} /></button>
                      </div>
                    </div>
                  </div>
                  {expandedSku === item.skuCode && (
                    <div className="mt-1 space-y-2">
                      <DetailCard item={item} onClose={() => setExpandedSku(null)} />
                      <div className="glass-card p-3 animate-slide-up">
                        <h4 className="text-xs text-forge-text2 mb-2 flex items-center gap-1.5"><Camera size={12} />白底图管理</h4>
                        {/* 正/反面白底图 */}
                        <div className="flex gap-3 flex-wrap mb-3">
                          {(['front', 'back'] as const).map(type => {
                            const flags = item as unknown as Record<string, boolean>;
                            const hasImg = type === 'front' ? flags._hasFront : flags._hasBack;
                            return (
                              <div key={type} className="flex flex-col items-center gap-1">
                                <span className="text-[10px] text-forge-text2/60">{type === 'front' ? '正面白底图' : '反面白底图'}</span>
                                {hasImg ? (
                                  <div className="relative">
                                    <LazyImage
                                      thumbKey={thumbKey(item.skuCode, type)}
                                      fullKey={imgKey(item.skuCode, type)}
                                      className="w-20 h-24 rounded-lg border border-forge-border/30"
                                    />
                                    <button onClick={() => removeImageForSku(item.skuCode, type)} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-forge-red/80 text-white flex items-center justify-center"><X size={8} /></button>
                                  </div>
                                ) : (
                                  <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { const f = inp.files?.[0]; if (f) uploadImageForSku(item.skuCode, f, type); }; inp.click(); }} className="w-20 h-24 rounded-lg border-2 border-dashed border-forge-border/40 flex flex-col items-center justify-center hover:border-forge-cyan/30 transition-colors"><Upload size={14} className="text-forge-text2/30" /><span className="text-[9px] text-forge-text2/40 mt-0.5">上传</span></button>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* 细节图（Logo/印花/面料/局部裁剪等） */}
                        {(() => {
                          const f = item as unknown as Record<string, unknown>;
                          const detailCount = (f._detailCount as number) || (f._hasLogo ? 1 : 0);
                          const hasDetails = !!(f._hasDetails || f._hasLogo);
                          return (
                            <div>
                              <h5 className="text-[10px] text-forge-text2/60 mb-2">
                                细节图 ({detailCount} 张)
                                <span className="text-forge-text2/40 ml-1">— Logo、印花、面料、局部裁剪等</span>
                              </h5>
                              <div className="flex gap-2 flex-wrap">
                                {hasDetails && Array.from({ length: detailCount }, (_, i) => (
                                  <div key={`detail_${i}`} className="flex flex-col items-center gap-1">
                                    <span className="text-[9px] text-forge-text2/40">#{i + 1}</span>
                                    <div className="relative">
                                      <LazyImage
                                        thumbKey={thumbKey(item.skuCode, `detail_${i}`)}
                                        fullKey={imgKey(item.skuCode, `detail_${i}`)}
                                        className="w-16 h-20 rounded-lg border border-forge-border/30"
                                      />
                                      <button onClick={() => removeImageForSku(item.skuCode, `detail_${i}`)} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-forge-red/80 text-white flex items-center justify-center"><X size={8} /></button>
                                    </div>
                                  </div>
                                ))}
                                <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true; inp.onchange = () => { if (inp.files) { for (let i = 0; i < inp.files.length; i++) uploadImageForSku(item.skuCode, inp.files[i], 'detail'); } }; inp.click(); }} className="w-16 h-20 rounded-lg border-2 border-dashed border-forge-border/40 flex flex-col items-center justify-center hover:border-forge-cyan/30 transition-colors">
                                  <Plus size={14} className="text-forge-text2/30" />
                                </button>
                              </div>
                            </div>
                          );
                        })()}

                        <button onClick={() => generateReversePrompt(item.skuCode)} disabled={!(item as unknown as Record<string, boolean>)._hasFront}
                          className="mt-3 px-3 py-1.5 rounded-lg text-xs bg-purple-500/15 text-purple-300 border border-purple-400/30 hover:bg-purple-500/25 transition-all flex items-center gap-1.5 disabled:opacity-30">
                          <Wand2 size={12} />{item.reversePrompt ? '重新生成反推提示词' : 'AI 反推提示词'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
