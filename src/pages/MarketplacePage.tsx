import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Car, Heart, Plus, Search, Store } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { translateValue } from '../i18n/translations';
import { useToast } from '../context/ToastContext';
import { eurosToCents } from '../lib/utils';
import type { MarketplaceListing, Vehicle } from '../types';
import {
  Button,
  Card,
  EmptyState,
  FieldLabel,
  Input,
  Modal,
  Select,
  StatusLabel,
  TableSkeleton,
  Textarea,
} from '../components/ui/Primitives';

const GUEST_ANON_ID = `guest-${Math.random().toString(36).slice(2, 10)}`;

export const MarketplacePage: React.FC = () => {
  const { user } = useAuth();
  const { t, money, num } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState<'catalog' | 'mine'>('catalog');
  const [search, setSearch] = useState('');
  const [marque, setMarque] = useState('');
  const [energie, setEnergie] = useState('');
  const [sellerType, setSellerType] = useState('');
  const [maxPriceEuros, setMaxPriceEuros] = useState('');
  const [minYear, setMinYear] = useState('');
  const [sort, setSort] = useState('recent');

  // Publish modal (authenticated owner)
  const [publishOpen, setPublishOpen] = useState(false);
  const [vehId, setVehId] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [priceEuros, setPriceEuros] = useState('');
  const [city, setCity] = useState('Paris');
  const [region, setRegion] = useState('Île-de-France');
  const [publishing, setPublishing] = useState(false);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (tab === 'mine' && user) p.set('mine', '1');
    if (search) p.set('search', search);
    if (marque) p.set('marque', marque);
    if (energie) p.set('energie', energie);
    if (sellerType) p.set('seller_type', sellerType);
    if (maxPriceEuros) p.set('max_price_cents', String(eurosToCents(maxPriceEuros)));
    if (minYear) p.set('min_year', minYear);
    if (sort) p.set('sort', sort);
    return p.toString();
  }, [tab, user, search, marque, energie, sellerType, maxPriceEuros, minYear, sort]);

  const { data, isLoading } = useQuery({
    queryKey: ['marketplace-listings', queryString],
    queryFn: () => apiFetch<{ listings: MarketplaceListing[] }>(`/api/marketplace/listings?${queryString}`),
  });

  const { data: favData } = useQuery({
    queryKey: ['marketplace-favorites', user?.id ?? GUEST_ANON_ID],
    queryFn: () =>
      apiFetch<{ favoriteListingIds: number[] }>(
        `/api/marketplace/favorites${user ? '' : `?anon_id=${GUEST_ANON_ID}`}`
      ),
  });

  const { data: myVehicles } = useQuery({
    queryKey: ['vehicles-for-marketplace'],
    enabled: Boolean(user && publishOpen),
    queryFn: () => apiFetch<{ vehicles: Vehicle[] }>('/api/vehicles?limit=100'),
  });

  const favorites = new Set(favData?.favoriteListingIds || []);
  const listings = data?.listings || [];

  const toggleFavorite = async (e: React.MouseEvent, listingId: number) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await apiFetch('/api/marketplace/favorites/toggle', {
        method: 'POST',
        body: JSON.stringify({ listing_id: listingId, anon_id: user ? undefined : GUEST_ANON_ID }),
      });
      qc.invalidateQueries({ queryKey: ['marketplace-favorites'] });
    } catch {
      toast(t('mkt.favError'), 'error');
    }
  };

  const handleStatusChange = async (listingId: number, status: string) => {
    await apiFetch(`/api/marketplace/listings/${listingId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    toast(t('mkt.statusToast'), 'success');
    qc.invalidateQueries({ queryKey: ['marketplace-listings'] });
  };

  const handleSelectVehicle = (id: string) => {
    setVehId(id);
    const v = myVehicles?.vehicles.find((x) => x.id === Number(id));
    if (v) {
      setTitle(`${v.marque} ${v.modele} ${v.version || ''}`.trim());
      if (v.prix_vente_prevu_cents) setPriceEuros(String(v.prix_vente_prevu_cents / 100));
    }
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehId || publishing) return;
    setPublishing(true);
    try {
      await apiFetch('/api/marketplace/listings', {
        method: 'POST',
        body: JSON.stringify({
          vehicle_id: Number(vehId),
          title,
          description: desc,
          price_cents: eurosToCents(priceEuros),
          location_city: city,
          location_region: region,
          status: 'publie',
        }),
      });
      toast(t('mkt.publishedToast'), 'success');
      setPublishOpen(false);
      qc.invalidateQueries({ queryKey: ['marketplace-listings'] });
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#151922] dark:text-white font-display">{t('mkt.title')}</h1>
          <p className="text-sm text-[#7A8290] mt-0.5">{t('mkt.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {user && (
            <>
              <div className="flex border border-[#E7EAF0] dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-[#111827] text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setTab('catalog')}
                  className={`px-3 py-2 whitespace-nowrap ${
                    tab === 'catalog' ? 'bg-[#2563EB] text-white' : 'text-[#7A8290]'
                  }`}
                >
                  {t('mkt.publicCatalog')}
                </button>
                <button
                  type="button"
                  onClick={() => setTab('mine')}
                  className={`px-3 py-2 whitespace-nowrap ${
                    tab === 'mine' ? 'bg-[#2563EB] text-white' : 'text-[#7A8290]'
                  }`}
                >
                  {t('mkt.myListings')}
                </button>
              </div>
              <Button onClick={() => setPublishOpen(true)}>
                <Plus className="w-4 h-4" />
                {t('mkt.publishBtn')}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <Card className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="relative lg:col-span-2">
          <Search className="w-4 h-4 text-[#7A8290] absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('mkt.searchPlaceholder')}
            className="pl-9"
          />
        </div>
        <Select value={marque} onChange={(e) => setMarque(e.target.value)}>
          <option value="">{t('mkt.allBrands')}</option>
          <option value="Peugeot">Peugeot</option>
          <option value="Renault">Renault</option>
          <option value="Volkswagen">Volkswagen</option>
          <option value="BMW">BMW</option>
          <option value="Audi">Audi</option>
          <option value="Mercedes-Benz">Mercedes-Benz</option>
          <option value="Citroën">Citroën</option>
        </Select>
        <Select value={energie} onChange={(e) => setEnergie(e.target.value)}>
          <option value="">{t('mkt.allFuels')}</option>
          <option value="Essence">{t('fuel.Essence')}</option>
          <option value="Diesel">{t('fuel.Diesel')}</option>
          <option value="Hybride">{t('fuel.Hybride')}</option>
          <option value="Électrique">{t('fuel.Électrique')}</option>
        </Select>
        <Select value={sellerType} onChange={(e) => setSellerType(e.target.value)}>
          <option value="">{t('mkt.allSellers')}</option>
          <option value="professionnel">{t('mkt.sellersPro')}</option>
          <option value="particulier">{t('mkt.sellersPrivate')}</option>
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="recent">{t('mkt.sortRecent')}</option>
          <option value="price_asc">{t('mkt.sortPriceAsc')}</option>
          <option value="price_desc">{t('mkt.sortPriceDesc')}</option>
          <option value="km_asc">{t('mkt.sortKmAsc')}</option>
        </Select>
        <Input
          type="number"
          value={maxPriceEuros}
          onChange={(e) => setMaxPriceEuros(e.target.value)}
          placeholder={t('mkt.maxBudget')}
        />
        <Input
          type="number"
          value={minYear}
          onChange={(e) => setMinYear(e.target.value)}
          placeholder={t('mkt.minYear')}
        />
      </Card>

      {isLoading ? (
        <Card><TableSkeleton rows={4} /></Card>
      ) : listings.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Store className="w-10 h-10" />}
            title={t('mkt.emptyTitle')}
            description={t('mkt.emptyDesc')}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {listings.map((item) => {
            const isFav = favorites.has(item.id);
            return (
              <Card key={item.id} className="overflow-hidden flex flex-col">
                <Link to={`/marketplace/${item.slug}`} className="relative block aspect-[4/3] bg-[#F0F2F6] dark:bg-gray-800">
                  {item.primary_photo_url ? (
                    <img
                      src={item.primary_photo_url}
                      alt={item.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[#7A8290]">
                      <Car className="w-10 h-10" />
                    </div>
                  )}
                  <button
                    type="button"
                    aria-label={isFav ? t('mkt.favRemove') : t('mkt.favAdd')}
                    onClick={(e) => toggleFavorite(e, item.id)}
                    className="absolute top-3 right-3 p-2 rounded-full bg-white/90 dark:bg-gray-900/90 text-[#151922] dark:text-white shadow-sm hover:scale-105 transition-transform"
                  >
                    <Heart className={`w-4 h-4 ${isFav ? 'fill-[#DC4545] text-[#DC4545]' : ''}`} />
                  </button>
                </Link>

                <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        to={`/marketplace/${item.slug}`}
                        className="font-semibold text-base text-[#151922] dark:text-white hover:text-[#2563EB] line-clamp-1"
                      >
                        {item.title}
                      </Link>
                      <span className="font-mono-num font-bold text-base text-[#151922] dark:text-white whitespace-nowrap">
                        {money(item.price_cents)}
                      </span>
                    </div>

                    <div className="text-xs text-[#7A8290] mt-1">
                      {item.annee || '—'} · {num(item.kilometrage)} {t('common.kmUnit')} ·{' '}
                      {translateValue(t, 'fuel', item.energie)} · {translateValue(t, 'gear', item.boite_vitesses)}
                    </div>
                    <div className="text-xs text-[#7A8290] mt-1">
                      {item.location_city} ({item.location_region}) ·{' '}
                      {item.seller_type === 'professionnel'
                        ? item.business_profile_name || t('party.professionnel')
                        : t('party.particulier')}
                    </div>
                  </div>

                  {tab === 'mine' && user && (
                    <div className="pt-3 border-t border-[#E7EAF0] dark:border-gray-800 flex items-center justify-between gap-2 text-xs">
                      <StatusLabel
                        tone={item.status === 'publie' ? 'green' : item.status === 'vendu' ? 'blue' : 'neutral'}
                        label={translateValue(t, 'mktStatus', item.status)}
                      />
                      <div className="flex gap-2">
                        {item.status !== 'publie' && item.status !== 'vendu' && (
                          <Button size="sm" variant="secondary" onClick={() => handleStatusChange(item.id, 'publie')}>
                            {t('mkt.publishAction')}
                          </Button>
                        )}
                        {item.status === 'publie' && (
                          <Button size="sm" variant="ghost" onClick={() => handleStatusChange(item.id, 'suspendu')}>
                            {t('mkt.suspendAction')}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={publishOpen} onClose={() => setPublishOpen(false)} title={t('mkt.publishModalTitle')}>
        <form onSubmit={handlePublish} className="space-y-4">
          <div>
            <FieldLabel required>{t('mkt.vehicleToPublish')}</FieldLabel>
            <Select required value={vehId} onChange={(e) => handleSelectVehicle(e.target.value)}>
              <option value="">{t('purch.selectVehicle')}</option>
              {(myVehicles?.vehicles || [])
                .filter((v) => v.status !== 'vendu')
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.marque} {v.modele} ({v.immatriculation || t('common.noPlate')}) —{' '}
                    {v.legal_context === 'professional' ? t('common.professionalShort') : t('common.personalShort')}
                  </option>
                ))}
            </Select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel required>{t('vehDetail.adTitle')}</FieldLabel>
              <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <FieldLabel required>{t('vehDetail.adPrice')}</FieldLabel>
              <Input type="number" step="1" required value={priceEuros} onChange={(e) => setPriceEuros(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel required>{t('vehDetail.adCity')}</FieldLabel>
              <Input required value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div>
              <FieldLabel required>{t('vehDetail.adRegion')}</FieldLabel>
              <Input required value={region} onChange={(e) => setRegion(e.target.value)} />
            </div>
          </div>
          <div>
            <FieldLabel>{t('vehDetail.adDesc')}</FieldLabel>
            <Textarea
              rows={3}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setPublishOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={publishing}>
              {publishing ? t('mkt.publishing') : t('mkt.publishSubmit')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
