import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Language } from '../types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const LOCALE_MAP: Record<Language, string> = {
  fr: 'fr-FR',
  ru: 'ru-RU',
  en: 'en-GB',
};

export function formatCurrency(cents: number | null | undefined, lang: Language = 'fr'): string {
  const val = (cents ?? 0) / 100;
  return new Intl.NumberFormat(LOCALE_MAP[lang], {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: val % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(val);
}

export function formatNumber(n: number | null | undefined, lang: Language = 'fr'): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(LOCALE_MAP[lang]).format(n);
}

export function formatDate(dateStr: string | null | undefined, lang: Language = 'fr'): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr.length === 10 ? `${dateStr}T12:00:00` : dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat(LOCALE_MAP[lang], {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

export function eurosToCents(val: string | number): number {
  const num = typeof val === 'string' ? parseFloat(val.replace(',', '.')) : val;
  if (Number.isNaN(num) || num < 0) return 0;
  return Math.round(num * 100);
}

export function centsToEurosInput(cents: number | null | undefined): string {
  if (!cents) return '';
  return (cents / 100).toString();
}
