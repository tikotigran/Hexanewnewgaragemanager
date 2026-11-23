import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Car, Flag, Heart, MapPin, Send, ShieldCheck, UserCheck } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { translateValue } from '../i18n/translations';
import { useToast } from '../context/ToastContext';
import type { MarketplaceListing, VehiclePhoto } from '../types';
import {
  Button,
  Card,
  FieldLabel,
  Input,
  Modal,
  TableSkeleton,
  Textarea,
} from '../components/ui/Primitives';

interface ListingDetailResponse {
  listing: MarketplaceListing & {
    portes?: number | null;
    puissance_fiscale?: number | null;
    co2?: number | null;
    business_siret?: string;
    business_address?: string;
    seller_user_id: number;
  };
  photos: VehiclePhoto[];
}

export const MarketplaceDetailPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const { t, lang, money, num } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState<string | null>(null);
  const [senderName, setSenderName] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [senderPhone, setSenderPhone] = useState('');
  const [message, setMessage] = useState(() => t('mkt.defaultMessage'));
  const [honeypot, setHoneypot] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);

  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState(() => t('mkt.reportDefaultReason'));
  const [reportDetails, setReportDetails] = useState('');

  useEffect(() => {
    setMessage(t('mkt.defaultMessage'));
    setReportReason(t('mkt.reportDefaultReason'));
  }, [lang]);

  const { data, isLoading } = useQuery({
    queryKey: ['marketplace-detail', slug],
    queryFn: () => apiFetch<ListingDetailResponse>(`/api/marketplace/listings/${slug}`),
  });

  const { data: favData } = useQuery({
    queryKey: ['marketplace-favorites', user?.id ?? 'guest'],
    queryFn: () => apiFetch<{ favoriteListingIds: number[] }>('/api/marketplace/favorites?anon_id=guest'),
  });

  if (isLoading) return <Card><TableSkeleton rows={6} /></Card>;
  if (!data?.listing) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-[#7A8290]">{t('mkt.notFound')}</p>
        <Link to="/marketplace" className="text-sm text-[#2563EB] hover:underline mt-2 inline-block">
          {t('mkt.backToCatalog')}
        </Link>
      </Card>
    );
  }

  const { listing, photos } = data;
  const activePhoto = selectedPhotoUrl || photos[0]?.url || listing.primary_photo_url;
  const isFav = (favData?.favoriteListingIds || []).includes(listing.id);

  const handleToggleFav = async () => {
    await apiFetch('/api/marketplace/favorites/toggle', {
      method: 'POST',
      body: JSON.stringify({ listing_id: listing.id, anon_id: 'guest' }),
    });
    qc.invalidateQueries({ queryKey: ['marketplace-favorites'] });
  };

  const handleSendContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sendingMsg) return;
    setSendingMsg(true);
    try {
      await apiFetch(`/api/marketplace/listings/${listing.id}/contact`, {
        method: 'POST',
        body: JSON.stringify({
          sender_name: senderName,
          sender_email: senderEmail,
          sender_phone: senderPhone,
          message,
          honeypot,
        }),
      });
      toast(t('mkt.msgSentToast'), 'success');
      setMessage('');
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setSendingMsg(false);
    }
  };

  const handleReport = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch(`/api/marketplace/listings/${listing.id}/report`, {
      method: 'POST',
      body: JSON.stringify({ reason: reportReason, details: reportDetails }),
    });
    toast(t('mkt.reportToast'), 'info');
    setReportOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link to="/marketplace" className="inline-flex items-center gap-2 text-sm text-[#7A8290] hover:text-[#151922] dark:hover:text-white">
          <ArrowLeft className="w-4 h-4" />
          {t('mkt.backToListings')}
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={handleToggleFav}>
            <Heart className={`w-4 h-4 ${isFav ? 'fill-[#DC4545] text-[#DC4545]' : ''}`} />
            {isFav ? t('mkt.savedFav') : t('mkt.favorites')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setReportOpen(true)}>
            <Flag className="w-4 h-4" />
            {t('mkt.report')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Photos + Specs */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="overflow-hidden">
            <div className="aspect-[16/10] bg-[#F0F2F6] dark:bg-gray-800">
              {activePhoto ? (
                <img src={activePhoto} alt={listing.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[#7A8290]">
                  <Car className="w-14 h-14" />
                </div>
              )}
            </div>
            {photos.length > 1 && (
              <div className="p-3 flex gap-2 overflow-x-auto border-t border-[#E7EAF0] dark:border-gray-800">
                {photos.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPhotoUrl(p.url)}
                    className={`w-20 h-14 rounded-md overflow-hidden border-2 shrink-0 ${
                      activePhoto === p.url ? 'border-[#2563EB]' : 'border-transparent'
                    }`}
                  >
                    <img src={p.url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold font-display text-[#151922] dark:text-white">{listing.title}</h1>
                <div className="text-sm text-[#7A8290] mt-1 flex items-center gap-1.5">
                  <MapPin className="w-4 h-4" />
                  {listing.location_city} · {listing.location_region}
                </div>
              </div>
              <div className="text-2xl font-bold font-mono-num text-[#2563EB]">{money(listing.price_cents)}</div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4 border-y border-[#E7EAF0] dark:border-gray-800 text-sm">
              <div>
                <div className="text-xs text-[#7A8290]">{t('veh.annee')}</div>
                <div className="font-medium font-mono-num">{listing.annee || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-[#7A8290]">{t('veh.km')}</div>
                <div className="font-medium font-mono-num">{num(listing.kilometrage)} {t('common.kmUnit')}</div>
              </div>
              <div>
                <div className="text-xs text-[#7A8290]">{t('vehForm.energie')}</div>
                <div className="font-medium">{translateValue(t, 'fuel', listing.energie)}</div>
              </div>
              <div>
                <div className="text-xs text-[#7A8290]">{t('vehForm.boite')}</div>
                <div className="font-medium">{translateValue(t, 'gear', listing.boite_vitesses)}</div>
              </div>
              <div>
                <div className="text-xs text-[#7A8290]">{t('vehForm.couleur')}</div>
                <div className="font-medium">{listing.couleur || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-[#7A8290]">{t('vehForm.puissanceFiscale')}</div>
                <div className="font-medium font-mono-num">
                  {listing.puissance_fiscale ? `${listing.puissance_fiscale} ${t('common.cvUnit')}` : '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-[#7A8290]">{t('vehForm.co2')}</div>
                <div className="font-medium font-mono-num">{listing.co2 ? `${listing.co2} g/km` : '—'}</div>
              </div>
              <div>
                <div className="text-xs text-[#7A8290]">{t('mkt.views')}</div>
                <div className="font-medium font-mono-num">{num(listing.views_count)}</div>
              </div>
            </div>

            <div>
              <h2 className="text-sm font-semibold font-display mb-2">{t('mkt.description')}</h2>
              <p className="text-sm text-[#7A8290] leading-relaxed whitespace-pre-line">
                {listing.description || t('mkt.defaultDesc')}
              </p>
            </div>
          </Card>
        </div>

        {/* Right: Seller + Contact Form */}
        <div className="space-y-6">
          <Card className="p-5 space-y-3">
            <div className="flex items-center gap-2.5">
              {listing.seller_type === 'professionnel' ? (
                <ShieldCheck className="w-5 h-5 text-[#2563EB]" />
              ) : (
                <UserCheck className="w-5 h-5 text-[#16A36A]" />
              )}
              <div>
                <div className="text-sm font-semibold">
                  {listing.seller_type === 'professionnel'
                    ? listing.business_profile_name || t('mkt.proSeller')
                    : `${listing.owner_first_name || ''} ${listing.owner_last_name || ''}`.trim() || t('mkt.privateSeller')}
                </div>
                <div className="text-xs text-[#7A8290]">
                  {listing.seller_type === 'professionnel'
                    ? `${t('common.professionalLabel')} · SIRET ${listing.business_siret || t('mkt.verifiedSiret')}`
                    : t('mkt.privateSeller')}
                </div>
              </div>
            </div>
            {listing.seller_type === 'professionnel' && listing.business_address && (
              <p className="text-xs text-[#7A8290]">{listing.business_address}</p>
            )}
            <Link
              to={`/marketplace/sellers/${listing.seller_user_id}`}
              className="block text-xs font-medium text-[#2563EB] hover:underline"
            >
              {t('mkt.seeAllSellerAds')}
            </Link>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold font-display mb-3">{t('mkt.contactSeller')}</h2>
            <form onSubmit={handleSendContact} className="space-y-3">
              {/* Honeypot anti-spam */}
              <input
                type="text"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
                className="hidden"
              />
              <div>
                <FieldLabel required>{t('mkt.yourName')}</FieldLabel>
                <Input required value={senderName} onChange={(e) => setSenderName(e.target.value)} />
              </div>
              <div>
                <FieldLabel required>{t('auth.email')}</FieldLabel>
                <Input type="email" required value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)} />
              </div>
              <div>
                <FieldLabel>{t('auth.phone')}</FieldLabel>
                <Input value={senderPhone} onChange={(e) => setSenderPhone(e.target.value)} />
              </div>
              <div>
                <FieldLabel required>{t('mkt.message')}</FieldLabel>
                <Textarea rows={4} required minLength={10} value={message} onChange={(e) => setMessage(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={sendingMsg}>
                <Send className="w-4 h-4" />
                {sendingMsg ? t('mkt.sending') : t('mkt.sendInquiry')}
              </Button>
            </form>
          </Card>
        </div>
      </div>

      <Modal open={reportOpen} onClose={() => setReportOpen(false)} title={t('mkt.reportModalTitle')} maxWidth="max-w-md">
        <form onSubmit={handleReport} className="space-y-4">
          <div>
            <FieldLabel required>{t('mkt.reportReason')}</FieldLabel>
            <Input required value={reportReason} onChange={(e) => setReportReason(e.target.value)} />
          </div>
          <div>
            <FieldLabel>{t('mkt.reportDetails')}</FieldLabel>
            <Textarea rows={3} value={reportDetails} onChange={(e) => setReportDetails(e.target.value)} />
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setReportOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="danger">
              {t('mkt.reportSubmit')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export const MarketplaceSellerPage: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const { t, money, num } = useI18n();

  const { data, isLoading } = useQuery({
    queryKey: ['marketplace-seller', userId],
    queryFn: () =>
      apiFetch<{
        seller: { id: number; first_name: string; last_name: string; country: string; created_at: string };
        businessProfiles: Array<{ id: number; nom_commercial: string; siret: string; adresse_pro: string }>;
        listings: MarketplaceListing[];
      }>(`/api/marketplace/sellers/${userId}`),
  });

  if (isLoading) return <Card><TableSkeleton rows={4} /></Card>;
  if (!data?.seller) return <Card className="p-6 text-sm">{t('mkt.sellerNotFound')}</Card>;

  const bp = data.businessProfiles[0];

  return (
    <div className="space-y-6">
      <Link to="/marketplace" className="inline-flex items-center gap-2 text-sm text-[#7A8290] hover:text-[#151922]">
        <ArrowLeft className="w-4 h-4" />
        {t('mkt.backToCatalog')}
      </Link>

      <Card className="p-6">
        <h1 className="text-xl font-bold font-display">
          {bp ? bp.nom_commercial : `${data.seller.first_name} ${data.seller.last_name}`}
        </h1>
        <p className="text-sm text-[#7A8290] mt-1">
          {bp
            ? `${t('mkt.proAutoLabel')} · SIRET ${bp.siret || '—'} · ${bp.adresse_pro || ''}`
            : t('mkt.privateSeller')}
        </p>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {data.listings.map((item) => (
          <Card key={item.id} className="overflow-hidden">
            <Link to={`/marketplace/${item.slug}`} className="block aspect-[4/3] bg-[#F0F2F6] dark:bg-gray-800">
              {item.primary_photo_url ? (
                <img src={item.primary_photo_url} alt={item.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[#7A8290]">
                  <Car className="w-10 h-10" />
                </div>
              )}
            </Link>
            <div className="p-4">
              <div className="flex justify-between gap-2">
                <Link to={`/marketplace/${item.slug}`} className="font-semibold hover:text-[#2563EB] truncate">
                  {item.title}
                </Link>
                <span className="font-mono-num font-bold">{money(item.price_cents)}</span>
              </div>
              <div className="text-xs text-[#7A8290] mt-1">
                {item.annee || '—'} · {num(item.kilometrage)} {t('common.kmUnit')} · {item.location_city}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};
