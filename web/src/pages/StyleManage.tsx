import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Loader2, Database, Grid3x3, RefreshCw, ArrowRight, Download, Trash2, ClipboardList, ChevronDown, ChevronUp, Circle } from 'lucide-react';
import { useTryOnStore } from '@/store/useTryOnStore';
import { useAppStore } from '@/store/useAppStore';
import type { SKUInfo } from '@/types/tryon-types';
import { queryStyleByCode, queryStyleList } from '@/services/lingmao';

const LS_KEY = 'vf-local-library';

function getDb(): SKUInfo[] { try { const r = localStorage.getItem(LS_KEY); return r ? JSON.parse(r) : []; } catch { return []; } }
function saveDb(list: SKUInfo[]) { const capped = list.slice(0, 200); localStorage.setItem(LS_KEY, JSON.stringify(capped)); }

function DetailCard({ item, onClose }: { item: SKUInfo; onClose: () => void }) {
  const sections: { title: string; rows: { label: string; value?: string | number | null }[] }[] = [
    {
      title: '📋 基础标识', rows: [
        { label: '款式编号', value: item.skuCode }, { label: '名称', value: item.productName },
        { label: '单位', value: item.unit }, { label: '性别', value: item.gender },
        { label: '上市日期', value: item.listDate }, { label: '品牌', value: item.brand },
        { label: '年份/季节', value: [item.year, item.season].filter(Boolean).join(' / ') },
        { label: '波段', value: item.band }, { label: '分类', value: item.category },
        { label: '设计组', value: item.designGroup }, { label: '设计师', value: item.designer },
        { label: '供应商', value: item.supplierName }, { label: '系列', value: item.series },
        { label: '廓形', value: item.profile },
      ]
    },
    {
      title: '📐 规格与合规', rows: [
        { label: '执行标准', value: item.standardRule }, { label: '安全类别', value: item.safeLevel },
        { label: '成分', value: item.composition }, { label: '工艺要求', value: item.processDesc },
        { label: '面料克重', value: item.fabricWeight ? `${item.fabricWeight}g` : '' },
        { label: '质检报告', value: item.hasQualityReport }, { label: '面料类别', value: item.fabricCategory },
        { label: '厚薄/弹性', value: item.thicknessElastic },
      ]
    },
    {
      title: '🧵 面料与版型', rows: [
        { label: '面料介绍', value: item.fabricIntro }, { label: '版型介绍', value: item.profileIntro },
        { label: '肩型', value: item.shoulderType }, { label: '领型', value: item.collarType },
        { label: '袖型', value: item.sleeveType }, { label: '下摆设计', value: item.hemDesign },
        { label: '设计卖点', value: item.saleInfo },
      ]
    },
    {
      title: '📦 包装与物流', rows: [
        { label: '外包装', value: item.packaging }, { label: '吊牌/硫酸纸', value: item.hangTag },
        { label: '干燥剂/收纳', value: item.desiccantStorage }, { label: '香片/水洗标', value: item.sachetLabel },
      ]
    },
    {
      title: '📝 其他信息', rows: [
        { label: '洗涤说明', value: item.washInfo }, { label: '备注', value: item.remark },
      ]
    },
  ];

  return (
    <div className="glass-card p-4 animate-slide-up">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-forge-text font-medium text-sm">{item.productName}</h3>
        <button onClick={onClose} className="text-forge-text2/40 hover:text-forge-text text-xs">收起 ▲</button>
      </div>
      <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
        {sections.map(sec => {
          const filled = sec.rows.filter(r => r.value && String(r.value).trim());
          if (filled.length === 0) return null;
          return (
            <div key={sec.title}>
              <p className="text-[10px] text-forge-cyan/70 mb-1 font-medium">{sec.title}</p>
              <div className="grid grid-cols-2 gap-x-3">
                {filled.map(r => <Row key={r.label} label={r.label} value={r.value} />)}
              </div>
            </div>
          );
        })}
        <Section title="📏 尺码与颜色">
          <div className="flex flex-wrap gap-1 mb-1">{item.sizes.map(s => <span key={s} className="px-2 py-0.5 text-[10px] rounded border border-forge-border/50 text-forge-text2">{s}</span>)}</div>
          <div className="flex flex-wrap gap-2 mt-1">{item.colors.map(c => <span key={c} className="inline-flex items-center gap-1 text-xs text-forge-text2"><Circle size={10} fill="#888" stroke="#333" />{c}</span>)}</div>
        </Section>
        {item.imgUrls.length > 0 && (
          <Section title="🖼️ 款式图片">
            <div className="flex gap-2 overflow-x-auto pb-1">{item.imgUrls.map((url, i) => <img key={i} src={url} alt={`图${i + 1}`} className="w-28 h-36 object-cover rounded-lg border border-forge-border/30 flex-shrink-0" />)}</div>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] text-forge-cyan/70 mb-1 font-medium">{title}</p>
      <div className="grid grid-cols-2 gap-x-3">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | number | null }) {
  return <div className="flex items-baseline gap-2 py-0.5"><span className="text-[10px] text-forge-text2/50 w-16 flex-shrink-0">{label}</span><span className="text-[11px] text-forge-text truncate">{value ?? '-'}</span></div>;
}

export function StyleManage() {
  const nav = useNavigate();
  const { setSkuInfo } = useTryOnStore();
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

  const removeFromLib = (skuCode: string) => { const db = getDb().filter(s => s.skuCode !== skuCode); saveDb(db); setLibrary(db); };
  const goStudio = (item: SKUInfo) => { setSkuInfo(item); nav('/'); };

  const parseBatch = (raw: string) => { setBatchCodes(raw.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)); };

  const runBatch = async () => {
    if (batchCodes.length === 0) return;
    setBatchRunning(true); setBatchDone(0); setBatchFail(0);
    const db = getDb();
    for (const code of batchCodes) {
      try {
        const r = await queryStyleByCode([code]);
        if (r.skuInfo) { const idx = db.findIndex(s => s.skuCode === r.skuInfo!.skuCode); if (idx >= 0) db[idx] = r.skuInfo; else db.unshift(r.skuInfo); setBatchDone(p => p + 1); }
        else { setBatchFail(p => p + 1); }
      } catch { setBatchFail(p => p + 1); }
    }
    saveDb(db); setLibrary(db); setBatchRunning(false);
  };

  const syncFromLingmao = async () => {
    setSyncLoading(true);
    try {
      const r = await queryStyleList(1, 50);
      if (r.items.length > 0) { const db = getDb(); for (const item of r.items) { const i = db.findIndex(s => s.skuCode === item.skuCode); if (i >= 0) db[i] = item; else db.unshift(item); } saveDb(db); setLibrary(db); }
    } catch { addToast('error', '领猫同步失败，请检查网络或配置'); }
    setSyncLoading(false);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-forge-cyan to-blue-500 flex items-center justify-center"><Package size={20} className="text-forge-bg" /></div>
        <div><h2 className="font-display text-lg font-bold text-gradient-cyan tracking-wider">款式管理</h2><p className="text-xs text-forge-text2">批量导入 + 本地款式库 · 对接领猫 SCM</p></div>
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
            <textarea value={batch} onChange={e => { setBatch(e.target.value); parseBatch(e.target.value); }} placeholder="从 Excel 复制款号列粘贴到此处，每行一个款号" className="textarea-field h-48" />
            {batchCodes.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-forge-text2 mb-2">已识别 <span className="text-forge-cyan font-bold">{batchCodes.length}</span> 个款号</p>
                <div className="flex flex-wrap gap-1.5">{batchCodes.map(c => <span key={c} className="px-2 py-0.5 text-[10px] rounded bg-forge-surface2 text-forge-text2 font-mono border border-forge-border/30">{c}</span>)}</div>
              </div>
            )}
            <button onClick={runBatch} disabled={batchCodes.length === 0 || batchRunning} className="orange-btn w-full mt-4 py-3 rounded-lg text-sm flex items-center justify-center gap-2 disabled:opacity-50">
              {batchRunning ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              {batchRunning ? `正在拉取 ${batchDone + batchFail}/${batchCodes.length}...` : '一键拉取全部'}
            </button>
            {(batchDone > 0 || batchFail > 0) && (
              <div className="mt-3 p-3 rounded-lg bg-forge-surface2/50 text-xs text-forge-text2 flex items-center gap-4">
                <span className="text-forge-green">✓ 成功 {batchDone} 个</span>
                {batchFail > 0 && <span className="text-forge-red">✗ 失败 {batchFail} 个</span>}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'library' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="section-title">本地款式库（{library.length}）</h3>
            <button onClick={syncFromLingmao} disabled={syncLoading} className="text-xs text-forge-text2 hover:text-forge-cyan flex items-center gap-1.5 transition-colors">
              {syncLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              {syncLoading ? '同步中...' : '从领猫同步'}
            </button>
          </div>
          {library.length === 0 ? (
            <div className="glass-card p-12 text-center">
              <Grid3x3 size={48} className="mx-auto text-forge-text2/10 mb-4" />
              <p className="text-forge-text2 text-sm">暂无本地款式</p>
              <p className="text-forge-text2/40 text-xs mt-1">通过「批量导入」拉取领猫款式到本地库，可在主图试衣中复用</p>
            </div>
          ) : (
            <div className="space-y-3">
              {library.map(item => (
                <div key={item.skuCode}>
                  <div className="glass-card-hover p-3.5 group cursor-pointer" onClick={() => setExpandedSku(expandedSku === item.skuCode ? null : item.skuCode)}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-forge-text truncate">{item.productName}</p>
                          {expandedSku === item.skuCode ? <ChevronUp size={14} className="text-forge-cyan flex-shrink-0" /> : <ChevronDown size={14} className="text-forge-text2/30 flex-shrink-0" />}
                        </div>
                        <p className="text-xs text-forge-cyan font-mono mt-0.5">{item.skuCode}</p>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {item.brand && <span className="text-[10px] px-1.5 py-0.5 rounded bg-forge-cyan/10 text-forge-cyan border border-forge-cyan/20">{item.brand}</span>}
                          {item.season && <span className="text-[10px] px-1.5 py-0.5 rounded bg-forge-orange/10 text-forge-orange border border-forge-orange/20">{item.season}</span>}
                          <span className="text-[10px] text-forge-text2/50">{item.category}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <button onClick={(e) => { e.stopPropagation(); removeFromLib(item.skuCode); }} className="text-forge-text2/20 hover:text-forge-red transition-colors p-1 opacity-0 group-hover:opacity-100"><Trash2 size={14} /></button>
                        <button onClick={(e) => { e.stopPropagation(); goStudio(item); }} className="gradient-btn px-3 py-1.5 rounded text-[11px] flex items-center gap-1 flex-shrink-0">进入试衣<ArrowRight size={11} /></button>
                      </div>
                    </div>
                  </div>
                  {expandedSku === item.skuCode && <div className="mt-1"><DetailCard item={item} onClose={() => setExpandedSku(null)} /></div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
