import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { BusinessProfile, Language, User } from '../types';
import { apiFetch, setInMemoryAuthToken } from '../lib/api';
import { useI18n } from './I18nContext';
import { useTheme } from './ThemeContext';

interface AuthContextValue {
  user: User | null;
  businessProfiles: BusinessProfile[];
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  demoLogin: () => Promise<void>;
  register: (payload: {
    first_name: string;
    last_name: string;
    email: string;
    password: string;
    phone?: string;
    address?: string;
    language?: Language;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [businessProfiles, setBusinessProfiles] = useState<BusinessProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const { setLang } = useI18n();
  const { setTheme } = useTheme();

  const applyUserPreferences = useCallback(
    (u: User | null) => {
      if (!u) return;
      if (u.language === 'fr' || u.language === 'ru' || u.language === 'en') {
        setLang(u.language);
      }
      if (u.theme === 'dark' || u.theme === 'light') {
        setTheme(u.theme);
      }
    },
    [setLang, setTheme]
  );

  const refreshMe = useCallback(async () => {
    try {
      const data = await apiFetch<{ user: User; businessProfiles: BusinessProfile[] }>('/api/auth/me');
      setUser(data.user);
      setBusinessProfiles(data.businessProfiles || []);
      applyUserPreferences(data.user);
    } catch {
      setUser(null);
      setBusinessProfiles([]);
    } finally {
      setLoading(false);
    }
  }, [applyUserPreferences]);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  const login = async (email: string, password: string) => {
    const data = await apiFetch<{ user: User; token: string; businessProfiles: BusinessProfile[] }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }
    );
    setInMemoryAuthToken(data.token);
    setUser(data.user);
    setBusinessProfiles(data.businessProfiles || []);
    applyUserPreferences(data.user);
  };

  const demoLogin = async () => {
    const data = await apiFetch<{ user: User; token: string; businessProfiles: BusinessProfile[] }>(
      '/api/auth/demo-login',
      { method: 'POST' }
    );
    setInMemoryAuthToken(data.token);
    let preferredLang: Language | null = null;
    try {
      const saved = localStorage.getItem('hexavo_lang');
      if (saved === 'fr' || saved === 'ru' || saved === 'en') preferredLang = saved;
    } catch {
      // ignore
    }
    if (preferredLang && preferredLang !== data.user.language) {
      data.user.language = preferredLang;
      apiFetch('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ language: preferredLang }),
      }).catch(() => {});
    }
    setUser(data.user);
    setBusinessProfiles(data.businessProfiles || []);
    applyUserPreferences(data.user);
  };

  const register = async (payload: {
    first_name: string;
    last_name: string;
    email: string;
    password: string;
    phone?: string;
    address?: string;
    language?: Language;
  }) => {
    const data = await apiFetch<{ user: User; token: string; businessProfiles: BusinessProfile[] }>(
      '/api/auth/register',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    setInMemoryAuthToken(data.token);
    setUser(data.user);
    setBusinessProfiles(data.businessProfiles || []);
    applyUserPreferences(data.user);
  };

  const logout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setInMemoryAuthToken(null);
      setUser(null);
      setBusinessProfiles([]);
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, businessProfiles, loading, login, demoLogin, register, logout, refreshMe }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
