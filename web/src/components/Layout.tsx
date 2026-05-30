import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Package, Shirt, LayoutTemplate, Settings, Menu, X, Image, History, PaintBucket, LibraryBig, Layers, Users, BookTemplate, Shuffle, ImageIcon, PenTool, Zap } from 'lucide-react';
import { useThemeStore, THEMES } from '@/store/useThemeStore';

const navItems = [
  { to: '/', label: '主图生成', icon: Shirt },
  { to: '/workflow', label: '工作流执行', icon: Zap },
  { to: '/batch', label: '批量工单', icon: Layers },
  { to: '/pose', label: '姿势裂变', icon: Shuffle },
  { to: '/detail-gen', label: '详情页', icon: LayoutTemplate },
  { to: '/models', label: '模特库', icon: Users },
  { to: '/templates', label: '模板库', icon: BookTemplate },
  { to: '/styles', label: '款式管理', icon: Package },
  { to: '/whitebg', label: '白底图工具', icon: ImageIcon },
  { to: '/infinite-canvas', label: '无限画布', icon: PenTool },
  { to: '/history', label: '任务历史', icon: History },
  { to: '/settings', label: '系统设置', icon: Settings },
];

function ThemeSwitcher() {
  const current = useThemeStore((s) => s.current);
  const setTheme = useThemeStore((s) => s.setTheme);
  const [open, setOpen] = useState(false);

  return (
    <div className="relative px-3 pb-2">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-forge-text2 hover:text-forge-cyan hover:bg-forge-surface2/50 transition-all">
        <PaintBucket size={14} />
        <span>{THEMES.find(t => t.id === current)?.name || '赛博暗蓝'}</span>
      </button>
      {open && (
        <div className="absolute left-3 bottom-full mb-1 w-52 glass-card p-1.5 animate-slide-up z-50 shadow-xl">
          {THEMES.map((theme) => (
            <button key={theme.id} onClick={() => { setTheme(theme.id); setOpen(false); }} className={`w-full text-left px-3 py-2.5 rounded-lg text-xs transition-all flex items-center gap-3 ${current === theme.id ? 'bg-forge-cyan/10 text-forge-cyan border border-forge-cyan/20' : 'text-forge-text2 hover:bg-forge-surface2/50'}`}>
              <span className="w-4 h-4 rounded-full flex-shrink-0 bg-gradient-to-br shadow-sm" style={{ backgroundImage: `linear-gradient(135deg, ${theme.vars['--forge-cyan']}, ${theme.vars['--forge-orange']})` }} />
              <span className="flex-1">{theme.name}</span>
              <span className="text-forge-text2/40 text-[10px]">{theme.description.slice(-4)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <aside className="hidden lg:flex flex-col w-56 flex-shrink-0 bg-forge-surface border-r border-forge-border/40">
        <div className="p-5 border-b border-forge-border/30">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-forge-cyan to-forge-orange flex items-center justify-center shadow-lg shadow-forge-cyan/10"><Package size={18} className="text-forge-bg" /></div>
            <div><h1 className="font-display text-sm font-bold tracking-wider text-gradient-cyan">Visual Forge</h1><p className="text-[10px] text-forge-text2 tracking-wide">电商视觉工作台</p></div>
          </div>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-1">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} onClick={() => setMobileOpen(false)} className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 font-medium ${isActive ? 'bg-forge-surface2 text-forge-cyan shadow-[0_0_10px_rgba(0,229,255,0.1)]' : 'text-forge-text2 hover:text-forge-text hover:bg-forge-surface2/50'}`}>
              <item.icon size={18} />{item.label}
            </NavLink>
          ))}
        </nav>
        <ThemeSwitcher />
      </aside>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)}>
          <div className="absolute left-0 top-0 h-full w-64 bg-forge-surface border-r border-forge-border/40 p-4 animate-slide-up overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6"><div className="flex items-center gap-2"><Package size={20} className="text-forge-cyan" /><span className="font-display text-sm font-bold text-gradient-cyan">Visual Forge</span></div><button onClick={() => setMobileOpen(false)} className="text-forge-text2 hover:text-forge-text"><X size={20} /></button></div>
            <nav className="space-y-1">
              {navItems.map((item) => (
                <NavLink key={item.to} to={item.to} onClick={() => setMobileOpen(false)} className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${isActive ? 'bg-forge-surface2 text-forge-cyan' : 'text-forge-text2 hover:text-forge-text'}`}><item.icon size={18} />{item.label}</NavLink>
              ))}
            </nav>
            <div className="mt-4 pt-4 border-t border-forge-border/30"><ThemeSwitcher /></div>
          </div>
        </div>
      )}

      <div className="flex flex-col flex-1 min-w-0">
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-forge-surface border-b border-forge-border/30">
          <button onClick={() => setMobileOpen(true)} className="text-forge-text2 hover:text-forge-text"><Menu size={22} /></button>
          <div className="flex items-center gap-2"><Package size={18} className="text-forge-cyan" /><span className="font-display text-xs font-bold text-gradient-cyan">Visual Forge</span></div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
