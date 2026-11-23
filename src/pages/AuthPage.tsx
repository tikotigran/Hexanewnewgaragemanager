import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Store } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { useToast } from '../context/ToastContext';
import { apiFetch } from '../lib/api';
import type { Language } from '../types';
import { Button, Card, FieldLabel, Input } from '../components/ui/Primitives';

export const AuthPage: React.FC = () => {
  const { login, register, demoLogin } = useAuth();
  const { t, lang, setLang } = useI18n();
  const { toast } = useToast();

  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(email, password);
      toast(t('auth.loginSuccess'), 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : t('auth.loginError'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await register({
        first_name: firstName,
        last_name: lastName,
        email,
        password,
        phone,
        address,
        language: lang,
      });
      toast(t('auth.registerSuccess'), 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : t('auth.registerError'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (!resetToken) {
        const res = await apiFetch<{ message: string; devResetToken?: string }>('/api/auth/forgot-password', {
          method: 'POST',
          body: JSON.stringify({ email }),
        });
        toast(res.message, 'info');
        if (res.devResetToken) {
          setResetToken(res.devResetToken);
        }
      } else {
        await apiFetch('/api/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({ token: resetToken, newPassword }),
        });
        toast(t('auth.resetSuccess'), 'success');
        setMode('login');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F6F7F9] dark:bg-[#0B0F17] flex flex-col">
      <header className="h-16 px-6 flex items-center justify-between border-b border-[#E7EAF0] dark:border-gray-800 bg-white dark:bg-[#111827]">
        <div className="flex items-center gap-2.5 font-display font-bold text-lg text-[#151922] dark:text-white">
          <span className="w-7 h-7 rounded-md bg-[#2563EB] flex items-center justify-center text-white text-xs">
            H
          </span>
          HexaVO
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/marketplace"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#2563EB] hover:underline"
          >
            <Store className="w-4 h-4" />
            {t('auth.publicMarketplace')}
          </Link>
          <div className="flex items-center border border-[#E7EAF0] dark:border-gray-700 rounded-lg overflow-hidden text-xs">
            {(['fr', 'ru', 'en'] as Language[]).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                className={`px-2.5 py-1.5 font-medium uppercase ${
                  lang === code ? 'bg-[#2563EB] text-white' : 'text-[#7A8290]'
                }`}
              >
                {code}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-[#151922] dark:text-white font-display">{t('auth.welcome')}</h1>
            <p className="mt-2 text-sm text-[#7A8290]">{t('auth.subtitle')}</p>
          </div>

          <Card className="p-6">
            <div className="flex gap-1 p-1 rounded-lg bg-[#F6F7F9] dark:bg-[#0B0F17] mb-6">
              <button
                type="button"
                onClick={() => setMode('login')}
                className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors ${
                  mode === 'login'
                    ? 'bg-white dark:bg-[#111827] text-[#151922] dark:text-white shadow-sm'
                    : 'text-[#7A8290]'
                }`}
              >
                {t('auth.login')}
              </button>
              <button
                type="button"
                onClick={() => setMode('register')}
                className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors ${
                  mode === 'register'
                    ? 'bg-white dark:bg-[#111827] text-[#151922] dark:text-white shadow-sm'
                    : 'text-[#7A8290]'
                }`}
              >
                {t('auth.register')}
              </button>
            </div>

            {mode === 'login' && (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <FieldLabel htmlFor="login-email" required>{t('auth.email')}</FieldLabel>
                  <Input
                    id="login-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('auth.emailPlaceholder')}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="login-password" required>{t('auth.password')}</FieldLabel>
                  <Input
                    id="login-password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setMode('forgot')}
                    className="text-xs text-[#2563EB] hover:underline"
                  >
                    {t('auth.forgot')} ?
                  </button>
                </div>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? t('common.loading') : t('auth.login')}
                </Button>
                <div className="pt-3 border-t border-[#E7EAF0] dark:border-gray-800">
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    disabled={submitting}
                    onClick={async () => {
                      setSubmitting(true);
                      try {
                        await demoLogin();
                        toast(t('auth.demoSuccess'), 'success');
                      } finally {
                        setSubmitting(false);
                      }
                    }}
                  >
                    {t('auth.demoBtn')}
                  </Button>
                </div>
              </form>
            )}

            {mode === 'register' && (
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldLabel htmlFor="reg-first" required>{t('auth.firstName')}</FieldLabel>
                    <Input id="reg-first" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                  </div>
                  <div>
                    <FieldLabel htmlFor="reg-last" required>{t('auth.lastName')}</FieldLabel>
                    <Input id="reg-last" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
                  </div>
                </div>
                <div>
                  <FieldLabel htmlFor="reg-email" required>{t('auth.email')}</FieldLabel>
                  <Input id="reg-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div>
                  <FieldLabel htmlFor="reg-pass" required>{t('auth.passwordMin8')}</FieldLabel>
                  <Input
                    id="reg-pass"
                    type="password"
                    minLength={8}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldLabel htmlFor="reg-phone">{t('auth.phone')}</FieldLabel>
                    <Input id="reg-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </div>
                  <div>
                    <FieldLabel htmlFor="reg-addr">{t('auth.address')}</FieldLabel>
                    <Input id="reg-addr" value={address} onChange={(e) => setAddress(e.target.value)} />
                  </div>
                </div>
                <p className="text-xs text-[#7A8290]">{t('auth.registerHint')}</p>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? t('common.loading') : t('auth.register')}
                </Button>
              </form>
            )}

            {mode === 'forgot' && (
              <form onSubmit={handleForgot} className="space-y-4">
                <div>
                  <FieldLabel htmlFor="fg-email" required>{t('auth.accountEmail')}</FieldLabel>
                  <Input id="fg-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                {resetToken && (
                  <>
                    <div>
                      <FieldLabel htmlFor="fg-token" required>{t('auth.resetToken')}</FieldLabel>
                      <Input id="fg-token" value={resetToken} onChange={(e) => setResetToken(e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel htmlFor="fg-newpass" required>{t('auth.newPassword')}</FieldLabel>
                      <Input
                        id="fg-newpass"
                        type="password"
                        minLength={8}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                      />
                    </div>
                  </>
                )}
                <Button type="submit" className="w-full" disabled={submitting}>
                  {resetToken ? t('auth.validateNewPass') : t('auth.sendResetLink')}
                </Button>
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="w-full text-center text-xs text-[#7A8290] hover:underline"
                >
                  {t('auth.backToLogin')}
                </button>
              </form>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};
