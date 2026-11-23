import React from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './context/ThemeContext';
import { I18nProvider, useI18n } from './context/I18nContext';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppErrorBoundary, Button, OfflineIndicator } from './components/ui/Primitives';
import { AppShell } from './components/layout/AppShell';
import { AuthPage } from './pages/AuthPage';
import { DashboardPage } from './pages/DashboardPage';
import { VehiclesPage } from './pages/VehiclesPage';
import { AddVehiclePage } from './pages/AddVehiclePage';
import { VehicleDetailPage } from './pages/VehicleDetailPage';
import { PurchasesPage } from './pages/PurchasesPage';
import { SalesPage } from './pages/SalesPage';
import { ClientsPage } from './pages/ClientsPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { PoliceRegisterPage } from './pages/PoliceRegisterPage';
import { InvoicingPage } from './pages/InvoicingPage';
import { FinancePage } from './pages/FinancePage';
import { MarketplacePage } from './pages/MarketplacePage';
import { MarketplaceDetailPage, MarketplaceSellerPage } from './pages/MarketplaceDetailPage';
import { CalendarPage } from './pages/CalendarPage';
import { SettingsPage } from './pages/SettingsPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const PublicMarketplaceWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { t, lang, setLang } = useI18n();
  if (user) {
    return <AppShell>{children}</AppShell>;
  }
  return (
    <div className="min-h-screen bg-[#F6F7F9] dark:bg-[#0B0F17] text-[#151922] dark:text-gray-100 flex flex-col">
      <header className="h-16 bg-white dark:bg-[#111827] border-b border-[#E7EAF0] dark:border-gray-800 px-4 lg:px-8 flex items-center justify-between gap-3 sticky top-0 z-30">
        <Link
          to="/marketplace"
          className="flex items-center gap-2.5 font-display font-bold text-lg tracking-tight text-[#151922] dark:text-white whitespace-nowrap"
        >
          <span className="w-7 h-7 rounded-md bg-[#2563EB] flex items-center justify-center text-white text-xs font-bold">
            H
          </span>
          {t('mkt.title')}
        </Link>
        <div className="flex items-center gap-2">
          <div className="flex items-center border border-[#E7EAF0] dark:border-gray-700 rounded-lg overflow-hidden text-xs">
            {(['fr', 'ru', 'en'] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                className={`px-2 py-1.5 font-medium uppercase transition-colors ${
                  lang === code ? 'bg-[#2563EB] text-white' : 'text-[#7A8290] hover:text-[#151922]'
                }`}
              >
                {code}
              </button>
            ))}
          </div>
          <Link to="/">
            <Button size="sm">{t('auth.sellerSpace')}</Button>
          </Link>
        </div>
      </header>
      <main className="flex-1 p-4 lg:p-8 max-w-[1440px] w-full mx-auto">{children}</main>
      <OfflineIndicator />
    </div>
  );
};

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F6F7F9] dark:bg-[#0B0F17] text-sm text-[#7A8290]">
        {t('common.loading')}
      </div>
    );
  }
  if (!user) {
    return <AuthPage />;
  }
  return <AppShell>{children}</AppShell>;
};

export default function App() {
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <I18nProvider>
            <ToastProvider>
              <AuthProvider>
                <BrowserRouter>
                  <Routes>
                    {/* Public Marketplace Routes */}
                    <Route
                      path="/marketplace"
                      element={
                        <PublicMarketplaceWrapper>
                          <MarketplacePage />
                        </PublicMarketplaceWrapper>
                      }
                    />
                    <Route
                      path="/marketplace/sellers/:userId"
                      element={
                        <PublicMarketplaceWrapper>
                          <MarketplaceSellerPage />
                        </PublicMarketplaceWrapper>
                      }
                    />
                    <Route
                      path="/marketplace/:slug"
                      element={
                        <PublicMarketplaceWrapper>
                          <MarketplaceDetailPage />
                        </PublicMarketplaceWrapper>
                      }
                    />

                    {/* Workspace Protected Routes */}
                    <Route
                      path="/"
                      element={
                        <ProtectedRoute>
                          <DashboardPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/vehicles"
                      element={
                        <ProtectedRoute>
                          <VehiclesPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/vehicles/new"
                      element={
                        <ProtectedRoute>
                          <AddVehiclePage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/vehicles/:id"
                      element={
                        <ProtectedRoute>
                          <VehicleDetailPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/achats"
                      element={
                        <ProtectedRoute>
                          <PurchasesPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/ventes"
                      element={
                        <ProtectedRoute>
                          <SalesPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/clients"
                      element={
                        <ProtectedRoute>
                          <ClientsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/documents"
                      element={
                        <ProtectedRoute>
                          <DocumentsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/livre-de-police"
                      element={
                        <ProtectedRoute>
                          <PoliceRegisterPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/facturation"
                      element={
                        <ProtectedRoute>
                          <InvoicingPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/depenses"
                      element={
                        <ProtectedRoute>
                          <ExpensesPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance"
                      element={
                        <ProtectedRoute>
                          <FinancePage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/calendrier"
                      element={
                        <ProtectedRoute>
                          <CalendarPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/parametres"
                      element={
                        <ProtectedRoute>
                          <SettingsPage />
                        </ProtectedRoute>
                      }
                    />

                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </BrowserRouter>
              </AuthProvider>
            </ToastProvider>
          </I18nProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}
