import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Mic, Package, Search, ShieldCheck, Sparkles, Square } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { PageLoader } from '../../components/ui/Loader';
import { cn, formatDateTime, getStatusColor } from '../../lib/utils';
import { DICTATION_LANGUAGES, toDigits, useDictation, type DictationLang } from '../../lib/useDictation';
import { parseDeliverySpeech, parseVisitorSpeech } from '../../lib/gateVoiceParser';
import type { Delivery, DeliveryType, FlatOption, Visitor } from '../../types';

const DICTATION_LANG_KEY = 'gate-dictation-lang';

type EntryMode = 'VISITOR' | 'DELIVERY';

const DELIVERY_TYPES: DeliveryType[] = ['COURIER', 'FOOD', 'GROCERY', 'MEDICINE', 'PARCEL', 'OTHER'];
const VISITOR_PURPOSES = ['Guest', 'Family Visit', 'Friend Visit', 'Maintenance', 'Official', 'Other'] as const;

type VisitorPurpose = (typeof VISITOR_PURPOSES)[number];
type VisitorForm = {
  flatId: string;
  visitorName: string;
  mobile: string;
  vehicleNumber: string;
  purpose: VisitorPurpose;
};

type DeliveryForm = {
  flatId: string;
  deliveryType: DeliveryType;
  deliveryPersonName: string;
  mobile: string;
  vehicleNumber: string;
};

const emptyVisitorForm: VisitorForm = {
  flatId: '',
  visitorName: '',
  mobile: '',
  vehicleNumber: '',
  purpose: VISITOR_PURPOSES[0],
};

const emptyDeliveryForm: DeliveryForm = {
  flatId: '',
  deliveryType: 'COURIER' as DeliveryType,
  deliveryPersonName: '',
  mobile: '',
  vehicleNumber: '',
};

export default function GateManagementPage() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<EntryMode>('VISITOR');
  const [visitorForm, setVisitorForm] = useState(emptyVisitorForm);
  const [deliveryForm, setDeliveryForm] = useState(emptyDeliveryForm);
  const [visitorPhoto, setVisitorPhoto] = useState<File | null>(null);
  const [deliveryPhoto, setDeliveryPhoto] = useState<File | null>(null);

  const { supported: dictationSupported, listening: dictationListening, start: startDictation, stop: stopDictation } = useDictation();
  const [dictationLang, setDictationLang] = useState<DictationLang>(() => {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(DICTATION_LANG_KEY) : null;
    return (stored as DictationLang) || 'en-IN';
  });
  const [activeMic, setActiveMic] = useState<string | null>(null);

  const handleDictate = async (
    field: string,
    apply: (text: string) => void,
    mode: 'text' | 'digits' = 'text',
  ) => {
    if (!dictationSupported) return;

    // Tap again while listening = stop this field.
    if (dictationListening) {
      if (activeMic === field) {
        await stopDictation();
      }
      return;
    }

    const process = (text: string) => (mode === 'digits' ? toDigits(text, dictationLang) : text);
    let gotAny = false;

    setActiveMic(field);
    try {
      await startDictation(dictationLang, {
        onPartial: (text) => {
          gotAny = true;
          apply(process(text));
        },
        onFinal: (text) => {
          setActiveMic(null);
          const value = process(text);
          if (value) {
            apply(value);
          } else if (!gotAny) {
            toast('Nothing captured. Please try again.', { icon: '🎤' });
          }
        },
      });
    } catch (error: any) {
      setActiveMic(null);
      if (error?.message === 'PERMISSION_DENIED') {
        toast.error('Microphone permission is required for voice entry.');
      } else {
        toast.error('Voice entry failed. Please type instead.');
      }
    }
  };

  const changeDictationLang = (lang: DictationLang) => {
    setDictationLang(lang);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DICTATION_LANG_KEY, lang);
    }
  };

  // ─── Smart "speak once" capture ──────────────────────────────────
  const [smartTranscript, setSmartTranscript] = useState('');
  const smartListening = activeMic === 'smart';

  const handleSmartCapture = async () => {
    if (!dictationSupported) return;

    if (dictationListening) {
      if (smartListening) {
        await stopDictation();
      }
      return;
    }

    setSmartTranscript('');
    setActiveMic('smart');
    try {
      await startDictation(dictationLang, {
        onPartial: (text) => setSmartTranscript(text),
        onFinal: (text) => {
          setActiveMic(null);
          const transcript = (text || '').trim();
          setSmartTranscript(transcript);
          if (!transcript) {
            toast('Nothing captured. Please try again.', { icon: '🎤' });
            return;
          }
          if (mode === 'VISITOR') {
            const parsed = parseVisitorSpeech(transcript, dictationLang);
            setVisitorForm((current) => ({
              ...current,
              visitorName: parsed.name || current.visitorName,
              mobile: parsed.mobile || current.mobile,
              purpose: (parsed.purpose as VisitorPurpose) || current.purpose,
            }));
          } else {
            const parsed = parseDeliverySpeech(transcript, dictationLang);
            setDeliveryForm((current) => ({
              ...current,
              deliveryPersonName: parsed.name || current.deliveryPersonName,
              mobile: parsed.mobile || current.mobile,
              deliveryType: (parsed.deliveryType as DeliveryType) || current.deliveryType,
            }));
          }
          toast.success('Captured. Please review the fields below.');
        },
      });
    } catch (error: any) {
      setActiveMic(null);
      if (error?.message === 'PERMISSION_DENIED') {
        toast.error('Microphone permission is required for voice entry.');
      } else {
        toast.error('Voice entry failed. Please type instead.');
      }
    }
  };

  const { data: flats = [], isLoading: flatsLoading } = useQuery<FlatOption[]>({
    queryKey: ['flat-options'],
    queryFn: async () => (await api.get('/flats/options')).data,
  });

  const { data: visitors = [], isLoading: visitorsLoading } = useQuery<Visitor[]>({
    queryKey: ['visitors', 'gate'],
    queryFn: async () => (await api.get('/visitors?limit=20')).data,
  });

  const { data: deliveries = [], isLoading: deliveriesLoading } = useQuery<Delivery[]>({
    queryKey: ['deliveries', 'gate'],
    queryFn: async () => (await api.get('/deliveries?limit=20')).data,
  });

  const createVisitor = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append('flatId', visitorForm.flatId);
      formData.append('visitorName', visitorForm.visitorName);
      formData.append('mobile', visitorForm.mobile);
      formData.append('vehicleNumber', visitorForm.vehicleNumber);
      formData.append('purpose', visitorForm.purpose);
      if (visitorPhoto) {
        formData.append('photo', visitorPhoto);
      }
      return (await api.post('/visitors', formData, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
    },
    onSuccess: () => {
      toast.success('Visitor recorded');
      setVisitorForm(emptyVisitorForm);
      setVisitorPhoto(null);
      queryClient.invalidateQueries({ queryKey: ['visitors'] });
      queryClient.invalidateQueries({ queryKey: ['my-flat'] });
    },
    onError: (error: any) => toast.error(error?.response?.data?.error || error?.message || 'Failed to record visitor'),
  });

  const createDelivery = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append('flatId', deliveryForm.flatId);
      formData.append('deliveryType', deliveryForm.deliveryType);
      formData.append('deliveryPersonName', deliveryForm.deliveryPersonName);
      formData.append('mobile', deliveryForm.mobile);
      formData.append('vehicleNumber', deliveryForm.vehicleNumber);
      if (deliveryPhoto) {
        formData.append('photo', deliveryPhoto);
      }

      return (await api.post('/deliveries', formData, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
    },
    onSuccess: () => {
      toast.success('Delivery recorded');
      setDeliveryForm(emptyDeliveryForm);
      setDeliveryPhoto(null);
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['my-flat'] });
    },
    onError: (error: any) => toast.error(error?.response?.data?.error || 'Failed to record delivery'),
  });

  const checkoutVisitor = useMutation({
    mutationFn: async (visitorId: string) => (await api.patch(`/visitors/${visitorId}/checkout`)).data,
    onSuccess: () => {
      toast.success('Visitor marked as left');
      queryClient.invalidateQueries({ queryKey: ['visitors'] });
      queryClient.invalidateQueries({ queryKey: ['my-flat'] });
    },
    onError: (error: any) => toast.error(error?.response?.data?.error || 'Failed to update visitor'),
  });

  const activeVisitors = useMemo(
    () => visitors.filter((visitor) => visitor.status === 'ACTIVE'),
    [visitors],
  );

  const gateRecentVisitors = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return visitors.filter((visitor) => {
      if (visitor.status === 'ACTIVE') {
        return true;
      }

      const checkedInDate = new Date(visitor.checkedInAt);
      checkedInDate.setHours(0, 0, 0, 0);

      return checkedInDate.getTime() === today.getTime();
    });
  }, [visitors]);

  if (flatsLoading || visitorsLoading || deliveriesLoading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="section-label mb-2">Gate Desk</p>
          <h1 className="page-title">Gate Management</h1>
          <p className="text-sm text-on-surface-variant">Record visitors and deliveries from one workflow.</p>
        </div>
        <div className="inline-flex rounded-2xl bg-white p-1 w-full max-w-sm" style={{ boxShadow: '0 1px 8px -2px rgba(0,0,0,0.04)' }}>
          {(['VISITOR', 'DELIVERY'] as EntryMode[]).map((value) => (
            <button
              key={value}
              type="button"
              className={cn(
                'flex-1 rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
                mode === value ? 'bg-primary text-white' : 'text-[#64748B]',
              )}
              onClick={() => setMode(value)}
            >
              {value === 'VISITOR' ? 'Visitor' : 'Delivery'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] gap-6">
        <div className="card-elevated p-6 space-y-5">
          {mode === 'VISITOR' ? (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-on-surface">Record Visitor</h2>
                  <p className="text-sm text-on-surface-variant mt-1">Visitor photo is optional.</p>
                </div>
                {dictationSupported && (
                  <LanguageToggle value={dictationLang} onChange={changeDictationLang} disabled={dictationListening} />
                )}
              </div>
              {dictationSupported && (
                <SmartVoicePanel
                  mode="VISITOR"
                  listening={smartListening}
                  busy={dictationListening && !smartListening}
                  transcript={smartTranscript}
                  onToggle={handleSmartCapture}
                />
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectFlat value={visitorForm.flatId} onChange={(value) => setVisitorForm((current) => ({ ...current, flatId: value }))} flats={flats} />
                <Field label="Visitor Name *">
                  <DictationInput
                    value={visitorForm.visitorName}
                    onChange={(value) => setVisitorForm((current) => ({ ...current, visitorName: value }))}
                    placeholder="Full name"
                    showMic={dictationSupported}
                    listening={activeMic === 'visitorName'}
                    micDisabled={dictationListening}
                    onMic={() => handleDictate('visitorName', (text) => setVisitorForm((current) => ({ ...current, visitorName: text })))}
                  />
                </Field>
                <Field label="Mobile *">
                  <DictationInput
                    value={visitorForm.mobile}
                    onChange={(value) => setVisitorForm((current) => ({ ...current, mobile: value }))}
                    placeholder="Phone number"
                    inputMode="numeric"
                    showMic={dictationSupported}
                    listening={activeMic === 'visitorMobile'}
                    micDisabled={dictationListening}
                    onMic={() => handleDictate('visitorMobile', (text) => setVisitorForm((current) => ({ ...current, mobile: text })), 'digits')}
                    hint={dictationSupported ? 'Tip: speak digits one at a time' : undefined}
                  />
                </Field>
                <Field label="Vehicle Number">
                  <input className="input" value={visitorForm.vehicleNumber} onChange={(event) => setVisitorForm((current) => ({ ...current, vehicleNumber: event.target.value }))} placeholder="Optional vehicle number" />
                </Field>
                <Field label="Photo">
                  <input className="input file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-semibold file:text-on-primary" type="file" accept="image/*" capture="environment" onChange={(event) => setVisitorPhoto(event.target.files?.[0] || null)} />
                  {visitorPhoto && <p className="mt-2 text-xs text-on-surface-variant">Selected: {visitorPhoto.name}</p>}
                </Field>
                <Field label="Purpose *" className="sm:col-span-2">
                  <select className="select" value={visitorForm.purpose} onChange={(event) => setVisitorForm((current) => ({ ...current, purpose: event.target.value as VisitorPurpose }))}>
                    {VISITOR_PURPOSES.map((purpose) => (
                      <option key={purpose} value={purpose}>{purpose}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="flex justify-end">
                <button
                  className="btn-primary"
                  disabled={createVisitor.isPending || !visitorForm.flatId || !visitorForm.visitorName.trim() || !visitorForm.mobile.trim() || !visitorForm.purpose.trim()}
                  onClick={() => createVisitor.mutate()}
                >
                  {createVisitor.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : 'Save Visitor'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-on-surface">Record Delivery</h2>
                  <p className="text-sm text-on-surface-variant mt-1">Delivery photo is optional.</p>
                </div>
                {dictationSupported && (
                  <LanguageToggle value={dictationLang} onChange={changeDictationLang} disabled={dictationListening} />
                )}
              </div>
              {dictationSupported && (
                <SmartVoicePanel
                  mode="DELIVERY"
                  listening={smartListening}
                  busy={dictationListening && !smartListening}
                  transcript={smartTranscript}
                  onToggle={handleSmartCapture}
                />
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectFlat value={deliveryForm.flatId} onChange={(value) => setDeliveryForm((current) => ({ ...current, flatId: value }))} flats={flats} />
                <Field label="Delivery Type *">
                  <select className="select" value={deliveryForm.deliveryType} onChange={(event) => setDeliveryForm((current) => ({ ...current, deliveryType: event.target.value as DeliveryType }))}>
                    {DELIVERY_TYPES.map((type) => (
                      <option key={type} value={type}>{getDeliveryTypeLabel(type)}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Delivery Person *">
                  <DictationInput
                    value={deliveryForm.deliveryPersonName}
                    onChange={(value) => setDeliveryForm((current) => ({ ...current, deliveryPersonName: value }))}
                    placeholder="Courier or rider name"
                    showMic={dictationSupported}
                    listening={activeMic === 'deliveryPerson'}
                    micDisabled={dictationListening}
                    onMic={() => handleDictate('deliveryPerson', (text) => setDeliveryForm((current) => ({ ...current, deliveryPersonName: text })))}
                  />
                </Field>
                <Field label="Mobile *">
                  <DictationInput
                    value={deliveryForm.mobile}
                    onChange={(value) => setDeliveryForm((current) => ({ ...current, mobile: value }))}
                    placeholder="Phone number"
                    inputMode="numeric"
                    showMic={dictationSupported}
                    listening={activeMic === 'deliveryMobile'}
                    micDisabled={dictationListening}
                    onMic={() => handleDictate('deliveryMobile', (text) => setDeliveryForm((current) => ({ ...current, mobile: text })), 'digits')}
                    hint={dictationSupported ? 'Tip: speak digits one at a time' : undefined}
                  />
                </Field>
                <Field label="Vehicle Number">
                  <input className="input" value={deliveryForm.vehicleNumber} onChange={(event) => setDeliveryForm((current) => ({ ...current, vehicleNumber: event.target.value }))} placeholder="Optional vehicle number" />
                </Field>
                <Field label="Photo" className="sm:col-span-2">
                  <input className="input file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-semibold file:text-on-primary" type="file" accept="image/*" capture="environment" onChange={(event) => setDeliveryPhoto(event.target.files?.[0] || null)} />
                  {deliveryPhoto && <p className="mt-2 text-xs text-on-surface-variant">Selected: {deliveryPhoto.name}</p>}
                </Field>
              </div>
              <div className="flex justify-end">
                <button
                  className="btn-primary"
                  disabled={createDelivery.isPending || !deliveryForm.flatId || !deliveryForm.deliveryPersonName.trim() || !deliveryForm.mobile.trim()}
                  onClick={() => createDelivery.mutate()}
                >
                  {createDelivery.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : 'Save Delivery'}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="space-y-6">
          <div className="card-elevated p-6">
            <div className="flex items-center gap-2 mb-4">
              <ShieldCheck className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold text-on-surface">Active Visitors</h2>
            </div>
            {activeVisitors.length === 0 ? (
              <p className="text-sm text-on-surface-variant">No active visitors at the moment.</p>
            ) : (
              <div className="space-y-3">
                {activeVisitors.map((visitor) => (
                  <div key={visitor.id} className="rounded-2xl p-4 bg-white space-y-2" style={{ boxShadow: '0 1px 8px -2px rgba(0,0,0,0.04)' }}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-on-surface">{visitor.visitorName}</p>
                        <p className="text-sm text-on-surface-variant">{visitor.flat?.block?.name} - {visitor.flat?.flatNumber}</p>
                      </div>
                      <span className={cn('badge', getStatusColor(visitor.status))}>{visitor.status}</span>
                    </div>
                    <div className="text-sm text-on-surface-variant space-y-1">
                      <p>Purpose: {visitor.purpose}</p>
                      <p>Checked in: {formatDateTime(visitor.checkedInAt)}</p>
                      {visitor.flat?.residentName && <p>Resident: {visitor.flat.residentName}</p>}
                    </div>
                    <button className="btn-secondary w-full" disabled={checkoutVisitor.isPending} onClick={() => checkoutVisitor.mutate(visitor.id)}>
                      Mark as Left
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card-elevated p-6">
            <div className="flex items-center gap-2 mb-4">
              {mode === 'VISITOR' ? <ShieldCheck className="w-5 h-5 text-primary" /> : <Package className="w-5 h-5 text-primary" />}
              <h2 className="text-lg font-semibold text-on-surface">Recent {mode === 'VISITOR' ? 'Visitors' : 'Deliveries'}</h2>
            </div>
            {mode === 'VISITOR' ? (
              <RecentVisitorList visitors={gateRecentVisitors.slice(0, 10)} />
            ) : (
              <RecentDeliveryList deliveries={deliveries.slice(0, 10)} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SelectFlat({ flats, value, onChange }: { flats: FlatOption[]; value: string; onChange: (value: string) => void }) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const selectedFlat = useMemo(
    () => flats.find((flat) => flat.id === value) || null,
    [flats, value],
  );

  const filteredFlats = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return flats;
    }

    return flats.filter((flat) => {
      const searchableText = [flat.blockName, flat.flatNumber, flat.residentName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return searchableText.includes(normalizedQuery);
    });
  }, [flats, query]);

  useEffect(() => {
    if (selectedFlat) {
      setQuery(getFlatLabel(selectedFlat));
      return;
    }

    setQuery('');
  }, [selectedFlat]);

  return (
    <Field label="Flat *">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-outline pointer-events-none" />
        <input
          className="input pl-10"
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            if (value) {
              onChange('');
            }
            setIsOpen(true);
          }}
          placeholder="Search by block, flat number, or resident"
        />
        {isOpen && (
          <div className="absolute z-20 mt-2 max-h-64 w-full overflow-y-auto rounded-2xl border border-outline-variant/30 bg-surface shadow-lg">
            {filteredFlats.length === 0 ? (
              <div className="px-4 py-3 text-sm text-on-surface-variant">No flats found.</div>
            ) : (
              filteredFlats.map((flat) => (
                <button
                  key={flat.id}
                  type="button"
                  className="w-full px-4 py-3 text-left hover:bg-surface-container transition-colors"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onChange(flat.id);
                    setQuery(getFlatLabel(flat));
                    setIsOpen(false);
                  }}
                >
                  <div className="font-medium text-on-surface">{flat.blockName} - {flat.flatNumber}</div>
                  {flat.residentName && <div className="text-xs text-on-surface-variant mt-1">{flat.residentName}</div>}
                </button>
              ))
            )}
          </div>
        )}
      </div>
      {selectedFlat && <p className="mt-2 text-xs text-on-surface-variant">Selected: {getFlatLabel(selectedFlat)}</p>}
    </Field>
  );
}

function getFlatLabel(flat: FlatOption) {
  return `${flat.blockName} - ${flat.flatNumber}${flat.residentName ? ` · ${flat.residentName}` : ''}`;
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function SmartVoicePanel({
  mode,
  listening,
  busy,
  transcript,
  onToggle,
}: {
  mode: EntryMode;
  listening: boolean;
  busy: boolean;
  transcript: string;
  onToggle: () => void;
}) {
  const example =
    mode === 'VISITOR'
      ? 'e.g. “Rajesh Kumar, nine eight seven six five four three two one zero, guest”'
      : 'e.g. “Suresh, nine eight … zero, food delivery”';

  return (
    <div className="rounded-2xl border border-primary/15 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onToggle}
          disabled={busy}
          aria-label={listening ? 'Stop listening' : 'Speak once to fill the form'}
          className={cn(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-colors',
            listening ? 'bg-error text-white animate-pulse' : 'bg-primary text-white hover:opacity-90',
            busy && 'opacity-50',
          )}
        >
          {listening ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold text-on-surface">Speak once to fill the form</p>
          </div>
          {listening ? (
            <p className="mt-1 text-xs font-medium text-error">Listening… say name, number &amp; purpose, then tap to stop</p>
          ) : (
            <p className="mt-1 text-xs text-on-surface-variant">{example}</p>
          )}
          {transcript && (
            <p className="mt-2 rounded-lg bg-white/70 px-3 py-2 text-sm text-on-surface break-words">{transcript}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function LanguageToggle({
  value,
  onChange,
  disabled,
}: {
  value: DictationLang;
  onChange: (lang: DictationLang) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl bg-surface-container p-1" role="group" aria-label="Voice language">
      <Mic className="w-4 h-4 text-on-surface-variant mx-1" aria-hidden />
      {DICTATION_LANGUAGES.map((lang) => (
        <button
          key={lang.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(lang.value)}
          className={cn(
            'rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50',
            value === lang.value ? 'bg-primary text-white' : 'text-on-surface-variant',
          )}
        >
          {lang.label}
        </button>
      ))}
    </div>
  );
}

function DictationInput({
  value,
  onChange,
  placeholder,
  inputMode,
  showMic,
  listening,
  micDisabled,
  onMic,
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: 'text' | 'numeric';
  showMic: boolean;
  listening: boolean;
  micDisabled: boolean;
  onMic: () => void;
  hint?: string;
}) {
  return (
    <div>
      <div className="relative">
        <input
          className={cn('input', showMic && 'pr-12')}
          value={value}
          inputMode={inputMode}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
        {showMic && (
          <button
            type="button"
            onClick={onMic}
            disabled={micDisabled && !listening}
            aria-label={listening ? 'Listening' : 'Dictate'}
            className={cn(
              'absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
              listening ? 'bg-error text-white animate-pulse' : 'bg-primary/10 text-primary hover:bg-primary/20',
              micDisabled && !listening && 'opacity-50',
            )}
          >
            {listening ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
          </button>
        )}
      </div>
      {listening ? (
        <p className="mt-1.5 text-xs font-medium text-error">Listening… tap mic to stop</p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-on-surface-variant">{hint}</p>
      )}
    </div>
  );
}

function RecentVisitorList({ visitors }: { visitors: Visitor[] }) {
  if (visitors.length === 0) {
    return <p className="text-sm text-on-surface-variant">No visitor records yet.</p>;
  }

  return (
    <div className="space-y-3">
      {visitors.map((visitor) => (
        <div key={visitor.id} className="rounded-2xl p-4 bg-white" style={{ boxShadow: '0 1px 8px -2px rgba(0,0,0,0.04)' }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-on-surface">{visitor.visitorName}</p>
              <p className="text-sm text-on-surface-variant">{visitor.flat?.block?.name} - {visitor.flat?.flatNumber}</p>
            </div>
            <span className={cn('badge', getStatusColor(visitor.status))}>{visitor.status}</span>
          </div>
          <div className="mt-3 text-sm text-on-surface-variant space-y-1">
            <p>{visitor.purpose}</p>
            <p>In: {formatDateTime(visitor.checkedInAt)}</p>
            {visitor.checkedOutAt && <p>Out: {formatDateTime(visitor.checkedOutAt)}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function RecentDeliveryList({ deliveries }: { deliveries: Delivery[] }) {
  if (deliveries.length === 0) {
    return <p className="text-sm text-on-surface-variant">No delivery records yet.</p>;
  }

  return (
    <div className="space-y-3">
      {deliveries.map((delivery) => (
        <div key={delivery.id} className="rounded-2xl p-4 bg-white" style={{ boxShadow: '0 1px 8px -2px rgba(0,0,0,0.04)' }}>
          <p className="font-semibold text-on-surface">{getDeliveryTypeLabel(delivery.deliveryType)}</p>
          <p className="text-sm text-on-surface-variant">{delivery.deliveryPersonName}</p>
          <div className="mt-3 text-sm text-on-surface-variant space-y-1">
            <p>{delivery.flat?.block?.name} - {delivery.flat?.flatNumber}</p>
            <p>At: {formatDateTime(delivery.deliveredAt)}</p>
            {delivery.companyName && <p>Company: {delivery.companyName}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function getDeliveryTypeLabel(type: DeliveryType) {
  return type.replace('_', ' ');
}