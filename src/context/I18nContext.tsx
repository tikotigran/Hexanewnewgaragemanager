import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Language } from '../types';
import { TRANSLATIONS } from '../i18n/translations';
import { formatCurrency, formatDate, formatNumber } from '../lib/utils';

const STORAGE_KEY = 'hexavo_lang';

function readInitialLang(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'fr' || saved === 'ru' || saved === 'en') return saved;
  } catch {
    // ignore storage errors
  }
  return 'fr';
}

interface I18nContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  money: (cents: number | null | undefined) => string;
  date: (dateStr: string | null | undefined) => string;
  num: (n: number | null | undefined) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Language>(readInitialLang);

  const setLang = (next: Language) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore storage errors
    }
  };

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
    }
  }, [lang]);

  const t = (key: string, vars?: Record<string, string | number>): string => {
    let str = TRANSLATIONS[lang][key] || TRANSLATIONS.fr[key] || key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return str;
  };

  return (
    <I18nContext.Provider
      value={{
        lang,
        setLang,
        t,
        money: (c) => formatCurrency(c, lang),
        date: (d) => formatDate(d, lang),
        num: (n) => formatNumber(n, lang),
      }}
    >
      {children}
    </I18nContext.Provider>
  );
};

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
