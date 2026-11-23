import React, { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Car,
  ShoppingBag,
  BadgeEuro,
  Users,
  FileText,
  BookOpen,
  Receipt,
  Wallet,
  TrendingUp,
  Store,
  Calendar,
  Settings,
  Search,
  Plus,
  Bell,
  Menu,
  X,
  Sun,
  Moon,
  LogOut,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../context/I18nContext';
import { useTheme } from '../../context/ThemeContext';
import { apiFetch } from '../../lib/api';
import { cn } from '../../lib/utils';
import type { Language } from '../../types';
import { PWAInstallButton, OfflineIndicator } from '../ui/Primitives';

interface NavItem {
  to: string;
  labelKey: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
  { to: '/vehicles', labelKey: 'nav.vehicles', icon: <Car className="w-4 h-4" /> },
  { to: '/achats', labelKey: 'nav.purchases', icon: <ShoppingBag className="w-4 h-4" /> },
  { to: '/ventes', labelKey: 'nav.sales', icon: <BadgeEuro className="w-4 h-4" /> },
  { to: '/clients', labelKey: 'nav.clients', icon: <Users className="w-4 h-4" /> },
  { to: '/documents', labelKey: 'nav.documents', icon: <FileText className="w-4 h-4" /> },
  { to: '/livre-de-police', labelKey: 'nav.policeRegister', icon: <BookOpen className="w-4 h-4" /> },
  { to: '/facturation', labelKey: 'nav.invoicing', icon: <Receipt className="w-4 h-4" /> },
  { to: '/depenses', labelKey: 'nav.expenses', icon: <Wallet className="w-4 h-4" /> },
  { to: '/finance', labelKey: 'nav.finance', icon: <TrendingUp className="w-4 h-4" /> },
  { to: '/marketplace', labelKey: 'nav.marketplace', icon: <Store className="w-4 h-4" /> },
  { to: '/calendrier', labelKey: 'nav.calendar', icon: <Calendar className="w-4 h-4" /> },
  { to: '/parametres', labelKey: 'nav.settings', icon: <Settings className="w-4 h-4" /> },
];

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, businessProfiles, logout } = useAuth();
  const { t, lang, setLang } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{
    vehicles: Array<{ id: number; marque: string; modele: string; immatriculation: string }>;
    contacts: Array<{ id: number; first_name: string; last_name: string; company_name: string }>;
    invoices: Array<{ id: number; invoice_number: string; status: string }>;
  } | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<
    Array<{ id: number; title: string; message: string; link_url: string; is_read: number }>
  >([]);

  useEffect(() => {
    if (!user) return;
    apiFetch<{ notifications: typeof notifications }>('/api/notifications')
      .then((d) => setNotifications(d.notifications || []))
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(() => {
      apiFetch<typeof searchResults>(`/api/search?q=${encodeURIComponent(q)}`)
        .then((res) => setSearchResults(res))
        .catch(() => setSearchResults(null));
    }, 220);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const markAllRead = async () => {
    await apiFetch('/api/notifications/read-all', { method: 'POST' });
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
  };

  const handleLanguageSwitch = async (nextLang: Language) => {
    setLang(nextLang);
    if (user) {
      await apiFetch('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ language: nextLang }),
      }).catch(() => {});
    }
  };

  const handleThemeToggle = async () => {
    const next = theme === 'light' ? 'dark' : 'light';
    toggleTheme();
    if (user) {
      await apiFetch('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ theme: next }),
      }).catch(() => {});
    }
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      <div className="h-16 px-5 flex items-center justify-between border-b border-[#E7EAF0] dark:border-gray-800 shrink-0">
        <Link
          to="/"
          onClick={() => setMobileMenuOpen(false)}
          className="flex items-center gap-2.5 font-display font-bold text-lg tracking-tight text-[#151922] dark:text-white whitespace-nowrap"
        >
          <span className="w-7 h-7 rounded-md bg-[#2563EB] flex items-center justify-center text-white text-xs font-bold">
            H
          </span>
          HexaVO
        </Link>
        <button
          type="button"
          aria-label={t('common.closeMenu')}
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden p-1.5 text-[#7A8290] hover:text-[#151922]"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav aria-label={t('common.mainNav')} className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={() => setMobileMenuOpen(false)}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
                isActive
                  ? 'bg-[#2563EB]/10 text-[#2563EB] dark:bg-blue-500/15 dark:text-blue-400'
                  : 'text-[#7A8290] hover:text-[#151922] dark:hover:text-white hover:bg-[#F6F7F9] dark:hover:bg-gray-800/60'
              )
            }
          >
            {item.icon}
            <span className="truncate">{t(item.labelKey)}</span>
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-[#E7EAF0] dark:border-gray-800 text-xs text-[#7A8290] space-y-2">
        <div className="sm:hidden flex items-center border border-[#E7EAF0] dark:border-gray-700 rounded-lg overflow-hidden w-fit">
          {(['fr', 'ru', 'en'] as Language[]).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => handleLanguageSwitch(code)}
              className={cn(
                'px-2.5 py-1 font-medium uppercase transition-colors',
                lang === code
                  ? 'bg-[#2563EB] text-white'
                  : 'text-[#7A8290] hover:text-[#151922] dark:hover:text-white'
              )}
            >
              {code}
            </button>
          ))}
        </div>
        <Link
          to="/parametres"
          onClick={() => setMobileMenuOpen(false)}
          aria-label={t('set.openSettingsAria')}
          title={t('set.openSettingsAria')}
          className="flex items-center justify-between gap-2.5 p-2 -mx-2 rounded-lg hover:bg-[#F6F7F9] dark:hover:bg-gray-800/70 transition-colors group"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#2563EB]/15 text-[#2563EB] dark:text-blue-400 flex items-center justify-center font-semibold text-xs shrink-0 uppercase">
              {(user?.first_name?.[0] || 'U')}{(user?.last_name?.[0] || '')}
            </div>
            <div className="min-w-0">
              <div className="font-medium text-[#151922] dark:text-gray-200 truncate">
                {user?.first_name} {user?.last_name}
              </div>
              <div className="truncate text-[11px]">
                {businessProfiles.length > 0
                  ? `${businessProfiles[0].nom_commercial} · ${t('common.accountMixed')}`
                  : t('common.accountPersonalOnly')}
              </div>
            </div>
          </div>
          <Settings className="w-4 h-4 shrink-0 text-[#7A8290] group-hover:text-[#2563EB] dark:group-hover:text-blue-400 transition-colors" />
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-[#F6F7F9] dark:bg-[#0B0F17] text-[#151922] dark:text-gray-100">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-[#E7EAF0] dark:border-gray-800 bg-white dark:bg-[#111827] sticky top-0 h-screen no-print">
        <SidebarContent />
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-black/40" onClick={() => setMobileMenuOpen(false)} />
          <aside className="relative w-72 max-w-[85vw] bg-white dark:bg-[#111827] h-full border-r border-[#E7EAF0] dark:border-gray-800 z-10">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main Content Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-16 bg-white dark:bg-[#111827] border-b border-[#E7EAF0] dark:border-gray-800 px-4 lg:px-6 flex items-center justify-between gap-4 sticky top-0 z-30 no-print">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <button
              type="button"
              aria-label={t('common.openMenu')}
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-[#E7EAF0] dark:border-gray-700 text-[#151922] dark:text-gray-100"
            >
              <Menu className="w-5 h-5" />
            </button>

            <Link
              to="/"
              className="sm:hidden flex items-center gap-2 font-display font-bold text-base text-[#151922] dark:text-white whitespace-nowrap"
            >
              <span className="w-6 h-6 rounded-md bg-[#2563EB] flex items-center justify-center text-white text-xs font-bold">
                H
              </span>
              HexaVO
            </Link>

            <div className="hidden sm:block relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-[#7A8290] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('common.search')}
                aria-label={t('common.search')}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#E7EAF0] dark:border-gray-700 bg-[#F6F7F9] dark:bg-[#0B0F17] focus:bg-white dark:focus:bg-[#111827] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
              {searchResults && searchQuery.trim() && (
                <div className="absolute left-0 right-0 mt-1.5 rounded-xl border border-[#E7EAF0] dark:border-gray-800 bg-white dark:bg-[#111827] shadow-lg p-2 z-50 text-sm">
                  {searchResults.vehicles.length === 0 &&
                  searchResults.contacts.length === 0 &&
                  searchResults.invoices.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-[#7A8290]">{t('common.noSearchResults')}</div>
                  ) : (
                    <>
                      {searchResults.vehicles.map((v) => (
                        <button
                          key={`v-${v.id}`}
                          type="button"
                          onClick={() => {
                            setSearchQuery('');
                            navigate(`/vehicles/${v.id}`);
                          }}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-[#F6F7F9] dark:hover:bg-gray-800 flex justify-between"
                        >
                          <span className="font-medium">
                            {v.marque} {v.modele}
                          </span>
                          <span className="text-xs font-mono-num text-[#7A8290]">{v.immatriculation}</span>
                        </button>
                      ))}
                      {searchResults.contacts.map((c) => (
                        <button
                          key={`c-${c.id}`}
                          type="button"
                          onClick={() => {
                            setSearchQuery('');
                            navigate('/clients');
                          }}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-[#F6F7F9] dark:hover:bg-gray-800 flex justify-between"
                        >
                          <span>{c.company_name || `${c.first_name} ${c.last_name}`}</span>
                          <span className="text-xs text-[#7A8290]">{t('common.client')}</span>
                        </button>
                      ))}
                      {searchResults.invoices.map((i) => (
                        <button
                          key={`i-${i.id}`}
                          type="button"
                          onClick={() => {
                            setSearchQuery('');
                            navigate('/facturation');
                          }}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-[#F6F7F9] dark:hover:bg-gray-800 flex justify-between"
                        >
                          <span className="font-mono-num">{i.invoice_number}</span>
                          <span className="text-xs text-[#7A8290]">{t('common.invoice')}</span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:block">
              <PWAInstallButton />
            </div>

            {/* Quick Add */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setQuickAddOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2563EB] text-white text-xs font-medium hover:bg-blue-700 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t('common.quickAdd')}</span>
                <ChevronDown className="w-3 h-3" />
              </button>
              {quickAddOpen && (
                <div className="absolute right-0 mt-1.5 w-48 rounded-xl border border-[#E7EAF0] dark:border-gray-800 bg-white dark:bg-[#111827] shadow-lg py-1.5 z-50">
                  {[
                    { label: t('nav.vehicles'), path: '/vehicles/new' },
                    { label: t('nav.purchases'), path: '/achats?new=1' },
                    { label: t('nav.sales'), path: '/ventes?new=1' },
                    { label: t('nav.expenses'), path: '/depenses?new=1' },
                    { label: t('nav.invoicing'), path: '/facturation?new=1' },
                    { label: t('nav.clients'), path: '/clients?new=1' },
                  ].map((item) => (
                    <button
                      key={item.path}
                      type="button"
                      onClick={() => {
                        setQuickAddOpen(false);
                        navigate(item.path);
                      }}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-[#F6F7F9] dark:hover:bg-gray-800"
                    >
                      + {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Notifications */}
            <div className="relative">
              <button
                type="button"
                aria-label={t('common.notifications')}
                onClick={() => setNotifOpen((o) => !o)}
                className="p-2 rounded-lg border border-[#E7EAF0] dark:border-gray-700 text-[#7A8290] hover:text-[#151922] dark:hover:text-white relative"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#DC4545] text-white text-[10px] flex items-center justify-center font-mono-num">
                    {unreadCount}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div className="absolute right-0 mt-1.5 w-80 rounded-xl border border-[#E7EAF0] dark:border-gray-800 bg-white dark:bg-[#111827] shadow-lg p-3 z-50">
                  <div className="flex items-center justify-between pb-2 border-b border-[#E7EAF0] dark:border-gray-800">
                    <span className="text-xs font-semibold">{t('common.notifications')}</span>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={markAllRead}
                        className="text-xs text-[#2563EB] hover:underline"
                      >
                        {t('common.markAllRead')}
                      </button>
                    )}
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y divide-[#E7EAF0] dark:divide-gray-800">
                    {notifications.length === 0 ? (
                      <div className="py-6 text-center text-xs text-[#7A8290]">{t('common.noNotifications')}</div>
                    ) : (
                      notifications.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => {
                            setNotifOpen(false);
                            if (n.link_url) navigate(n.link_url);
                          }}
                          className="w-full text-left py-2.5 hover:bg-[#F6F7F9] dark:hover:bg-gray-800/50 px-2 rounded"
                        >
                          <div className="text-xs font-medium text-[#151922] dark:text-gray-100">{n.title}</div>
                          <div className="text-xs text-[#7A8290] mt-0.5">{n.message}</div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Language Switcher (desktop/tablet) */}
            <div className="hidden sm:flex items-center border border-[#E7EAF0] dark:border-gray-700 rounded-lg overflow-hidden text-xs">
              {(['fr', 'ru', 'en'] as Language[]).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => handleLanguageSwitch(code)}
                  className={cn(
                    'px-2 py-1.5 font-medium uppercase transition-colors',
                    lang === code
                      ? 'bg-[#2563EB] text-white'
                      : 'text-[#7A8290] hover:text-[#151922] dark:hover:text-white'
                  )}
                >
                  {code}
                </button>
              ))}
            </div>

            {/* Theme Toggle */}
            <button
              type="button"
              aria-label={t('common.toggleTheme')}
              onClick={handleThemeToggle}
              className="p-2 rounded-lg border border-[#E7EAF0] dark:border-gray-700 text-[#7A8290] hover:text-[#151922] dark:hover:text-white"
            >
              {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>

            {/* Logout */}
            <button
              type="button"
              aria-label={t('common.logout')}
              onClick={() => logout()}
              className="p-2 rounded-lg border border-[#E7EAF0] dark:border-gray-700 text-[#7A8290] hover:text-[#DC4545]"
              title={t('common.logout')}
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 max-w-[1440px] w-full mx-auto">{children}</main>
      </div>
      <OfflineIndicator />
    </div>
  );
};
