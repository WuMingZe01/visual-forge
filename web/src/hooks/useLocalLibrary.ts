/**
 * 本地款式库Hook
 */
import { useMemo, useCallback } from 'react';
import type { SKUInfo } from '@/types/tryon-types';

const LS_LIBRARY = 'vf-local-library';

export function getLocalLibrary(): SKUInfo[] {
  try {
    const raw = localStorage.getItem(LS_LIBRARY);
    return raw ? (JSON.parse(raw) as SKUInfo[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalLibrary(library: SKUInfo[]) {
  try {
    localStorage.setItem(LS_LIBRARY, JSON.stringify(library));
  } catch (e) {
    console.error('保存款式库失败:', e);
  }
}

export function useLocalLibrary() {
  const library = useMemo<SKUInfo[]>(() => getLocalLibrary(), []);

  const addStyles = useCallback((styles: SKUInfo[]) => {
    const current = getLocalLibrary();
    const existingCodes = new Set(current.map((s) => s.skuCode));
    const newStyles = styles.filter((s) => !existingCodes.has(s.skuCode));
    const updated = [...current, ...newStyles];
    saveLocalLibrary(updated);
    return { added: newStyles.length, total: updated.length };
  }, []);

  const removeStyle = useCallback((skuCode: string) => {
    const current = getLocalLibrary();
    const updated = current.filter((s) => s.skuCode !== skuCode);
    saveLocalLibrary(updated);
  }, []);

  const clearLibrary = useCallback(() => {
    saveLocalLibrary([]);
  }, []);

  const findByCode = useCallback((skuCode: string): SKUInfo | undefined => {
    return getLocalLibrary().find((s) => s.skuCode === skuCode);
  }, []);

  const searchStyles = useCallback((query: string): SKUInfo[] => {
    const q = query.trim().toLowerCase();
    if (!q) return getLocalLibrary().slice(0, 50);
    return getLocalLibrary()
      .filter(
        (s) =>
          s.productName.toLowerCase().includes(q) || s.skuCode.toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, []);

  return {
    library,
    addStyles,
    removeStyle,
    clearLibrary,
    findByCode,
    searchStyles,
  };
}
