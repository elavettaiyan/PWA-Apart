import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Mail,
  MessageSquare,
  MoreVertical,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../../components/ui/Modal';
import { EmptyState, PageLoader } from '../../components/ui/Loader';
import {
  AddBlockForm,
  AddFlatForm,
  BulkUploadForm,
  DeleteFlatForm,
  IosUpgradeInfo,
  ManageFlatForm,
  UpgradePrompt,
} from '../../components/flats';
import { useBlocks, useFlats } from '../../hooks/flatsHooks';
import { openRazorpaySubscriptionCheckout } from '../../lib/razorpay';
import { isNativeIos } from '../../lib/platform';
import { useAuthStore } from '../../store/authStore';
import { cn, getFlatTypeLabel } from '../../lib/utils';
import api from '../../lib/api';
import type { Flat } from '../../types';

type ViewMode = 'flats' | 'residents';

type ResidentEntry = {
  id: string;
  relation: 'OWNER' | 'TENANT';
  name: string;
  phone: string;
  email?: string;
  flat: Flat;
};

function getActiveOwner(flat: Flat) {
  return flat.owner?.isActive === false ? null : flat.owner ?? null;
}

const ROWS_PER_PAGE_OPTIONS = [10, 20, 50];
const RESIDENT_PICKER_PAGE_SIZE = 12;
const MOBILE_LIST_SPACING_CLASS = 'space-y-3 p-4';
const MOBILE_OVERLAY_CONTENT_CLASS = 'space-y-3 px-4 pb-[calc(1rem+var(--sab,0px))] pt-1';
const MOBILE_SURFACE_CARD_CLASS = 'rounded-xl border border-slate-100 bg-white p-4 shadow-sm';
type ManageResidentIntent = 'default' | 'edit' | 'deactivate';

export default function FlatsPage() {
  const [showAddFlat, setShowAddFlat] = useState(false);
  const [showAddBlock, setShowAddBlock] = useState(false);
  const [showManageFlat, setShowManageFlat] = useState(false);
  const [showResidentFlatPicker, setShowResidentFlatPicker] = useState(false);
  const [residentPickerSearch, setResidentPickerSearch] = useState('');
  const [residentPickerBlockId, setResidentPickerBlockId] = useState<string>('');
  const [residentPickerPage, setResidentPickerPage] = useState(1);
  const [showEditFlat, setShowEditFlat] = useState(false);
  const [showEditBlock, setShowEditBlock] = useState(false);
  const [editingBlock, setEditingBlock] = useState<NonNullable<(typeof blocks)[number]> | null>(null);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [showDeleteFlat, setShowDeleteFlat] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showIosUpgradeInfo, setShowIosUpgradeInfo] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('flats');
  const [selectedBlockId, setSelectedBlockId] = useState<string>('all');
  const [selectedFlatId, setSelectedFlatId] = useState<string | null>(null);
  const [selectedResidentId, setSelectedResidentId] = useState<string | null>(null);
  const [mobileDetailFlatId, setMobileDetailFlatId] = useState<string | null>(null);
  const [mobileResidentId, setMobileResidentId] = useState<string | null>(null);
  const [manageFlatId, setManageFlatId] = useState<string | null>(null);
  const [manageResidentIntent, setManageResidentIntent] = useState<ManageResidentIntent>('default');
  const [manageResidentMode, setManageResidentMode] = useState<'OWNER' | 'TENANT' | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [flatPage, setFlatPage] = useState(1);
  const [flatRowsPerPage, setFlatRowsPerPage] = useState(10);
  const [residentPage, setResidentPage] = useState(1);
  const [residentRowsPerPage, setResidentRowsPerPage] = useState(10);
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === 'SUPER_ADMIN' || (['ADMIN', 'SECRETARY', 'JOINT_SECRETARY'] as string[]).includes(user?.role || '');

  const { data: flats = [], isLoading } = useFlats();
  const { data: blocks = [] } = useBlocks();

  const residents = useMemo<ResidentEntry[]>(() => {
    return flats.flatMap((flat) => {
      const items: ResidentEntry[] = [];
      const activeOwner = getActiveOwner(flat);

      if (activeOwner) {
        items.push({
          id: `owner-${flat.id}`,
          relation: 'OWNER',
          name: activeOwner.name,
          phone: activeOwner.phone,
          email: activeOwner.email,
          flat,
        });
      }

      if (flat.tenant?.isActive) {
        items.push({
          id: `tenant-${flat.id}`,
          relation: 'TENANT',
          name: flat.tenant.name,
          phone: flat.tenant.phone,
          email: flat.tenant.email,
          flat,
        });
      }

      return items;
    });
  }, [flats]);

  const normalizedSearch = search.trim().toLowerCase();

  const filteredFlats = useMemo(() => {
    return flats.filter((flat) => {
      const activeOwner = getActiveOwner(flat);
      const matchesBlock = selectedBlockId === 'all' || flat.blockId === selectedBlockId;
      const matchesSearch =
        !normalizedSearch ||
        flat.flatNumber.toLowerCase().includes(normalizedSearch) ||
        activeOwner?.name?.toLowerCase().includes(normalizedSearch) ||
        activeOwner?.phone?.toLowerCase().includes(normalizedSearch) ||
        flat.tenant?.name?.toLowerCase().includes(normalizedSearch) ||
        flat.tenant?.phone?.toLowerCase().includes(normalizedSearch);
      return matchesBlock && matchesSearch;
    });
  }, [flats, normalizedSearch, selectedBlockId]);

  const filteredResidents = useMemo(() => {
    return residents.filter((resident) => {
      const matchesSearch =
        !normalizedSearch ||
        resident.name.toLowerCase().includes(normalizedSearch) ||
        resident.phone.toLowerCase().includes(normalizedSearch) ||
        resident.email?.toLowerCase().includes(normalizedSearch) ||
        resident.flat.flatNumber.toLowerCase().includes(normalizedSearch);
      return matchesSearch;
    });
  }, [normalizedSearch, residents]);

  const selectedFlat = useMemo(
    () => flats.find((flat) => flat.id === selectedFlatId) ?? null,
    [flats, selectedFlatId],
  );

  const selectedBlock = useMemo(
    () => blocks.find((block) => block.id === selectedBlockId) ?? null,
    [blocks, selectedBlockId],
  );

  const selectedResident = useMemo(
    () => residents.find((resident) => resident.id === selectedResidentId) ?? null,
    [residents, selectedResidentId],
  );

  const detailFlat = viewMode === 'residents' ? selectedResident?.flat ?? null : selectedFlat;
  const hasDesktopOverlay = viewMode === 'flats' ? Boolean(detailFlat) : Boolean(selectedResident);

  const mobileDetailFlat = useMemo(
    () => flats.find((flat) => flat.id === mobileDetailFlatId) ?? null,
    [flats, mobileDetailFlatId],
  );

  const mobileResident = useMemo(
    () => residents.find((resident) => resident.id === mobileResidentId) ?? null,
    [mobileResidentId, residents],
  );

  const manageFlat = useMemo(
    () => flats.find((flat) => flat.id === manageFlatId) ?? null,
    [flats, manageFlatId],
  );

  const vacantFlats = useMemo(
    () => flats.filter((flat) => !flat.isOccupied),
    [flats],
  );

  const filteredVacantFlats = useMemo(() => {
    if (!residentPickerBlockId) {
      return [];
    }

    const normalizedPickerSearch = residentPickerSearch.trim().toLowerCase();

    return vacantFlats.filter((flat) => {
      const matchesBlock = flat.blockId === residentPickerBlockId;
      const matchesSearch =
        !normalizedPickerSearch ||
        flat.flatNumber.toLowerCase().includes(normalizedPickerSearch) ||
        flat.block?.name?.toLowerCase().includes(normalizedPickerSearch) ||
        String(flat.floor).includes(normalizedPickerSearch);

      return matchesBlock && matchesSearch;
    });
  }, [residentPickerBlockId, residentPickerSearch, vacantFlats]);

  const residentPickerTotalPages = Math.max(1, Math.ceil(filteredVacantFlats.length / RESIDENT_PICKER_PAGE_SIZE));

  const paginatedVacantFlats = useMemo(() => {
    const startIndex = (residentPickerPage - 1) * RESIDENT_PICKER_PAGE_SIZE;
    return filteredVacantFlats.slice(startIndex, startIndex + RESIDENT_PICKER_PAGE_SIZE);
  }, [filteredVacantFlats, residentPickerPage]);

  const flatTotalPages = Math.max(1, Math.ceil(filteredFlats.length / flatRowsPerPage));
  const residentTotalPages = Math.max(1, Math.ceil(filteredResidents.length / residentRowsPerPage));

  const paginatedFlats = useMemo(() => {
    const startIndex = (flatPage - 1) * flatRowsPerPage;
    return filteredFlats.slice(startIndex, startIndex + flatRowsPerPage);
  }, [filteredFlats, flatPage, flatRowsPerPage]);

  const paginatedResidents = useMemo(() => {
    const startIndex = (residentPage - 1) * residentRowsPerPage;
    return filteredResidents.slice(startIndex, startIndex + residentRowsPerPage);
  }, [filteredResidents, residentPage, residentRowsPerPage]);

  useEffect(() => {
    if (searchParams.get('upgrade') === 'true') {
      setShowUpgradeModal(true);
      setSearchParams((prev) => {
        prev.delete('upgrade');
        return prev;
      }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    setFlatPage(1);
  }, [normalizedSearch, selectedBlockId, flatRowsPerPage]);

  useEffect(() => {
    setResidentPage(1);
  }, [normalizedSearch, residentRowsPerPage]);

  useEffect(() => {
    if (flatPage > flatTotalPages) {
      setFlatPage(flatTotalPages);
    }
  }, [flatPage, flatTotalPages]);

  useEffect(() => {
    if (residentPage > residentTotalPages) {
      setResidentPage(residentTotalPages);
    }
  }, [residentPage, residentTotalPages]);

  useEffect(() => {
    setResidentPickerPage(1);
  }, [residentPickerSearch, residentPickerBlockId]);

  useEffect(() => {
    if (residentPickerPage > residentPickerTotalPages) {
      setResidentPickerPage(residentPickerTotalPages);
    }
  }, [residentPickerPage, residentPickerTotalPages]);

  useEffect(() => {
    if (filteredFlats.length === 0) {
      setSelectedFlatId(null);
      return;
    }

    if (selectedFlatId && !filteredFlats.some((flat) => flat.id === selectedFlatId)) {
      setSelectedFlatId(null);
    }
  }, [filteredFlats, selectedFlatId]);

  useEffect(() => {
    if (filteredResidents.length === 0) {
      setSelectedResidentId(null);
      return;
    }

    if (selectedResidentId && !filteredResidents.some((resident) => resident.id === selectedResidentId)) {
      setSelectedResidentId(null);
    }
  }, [filteredResidents, selectedResidentId]);

  const [pendingRazorpayPayload, setPendingRazorpayPayload] = useState<any>(null);

  const verifyMutation = useMutation({
    mutationFn: (payload: { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }) =>
      api.post('/premium/verify', payload),
    onSuccess: () => {
      toast.success('Premium activated successfully');
      queryClient.invalidateQueries({ queryKey: ['premium-status'] });
      queryClient.invalidateQueries({ queryKey: ['flats'] });
      queryClient.invalidateQueries({ queryKey: ['blocks'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to verify Premium activation');
    },
  });

  const subscribeMutation = useMutation({
    mutationFn: async (flatCount: number) => (await api.post('/premium/subscribe', { requestedFlatCount: flatCount })).data,
    onSuccess: (payload) => {
      setShowUpgradeModal(false);
      setPendingRazorpayPayload(payload);
    },
    onError: (error: any) => {
      if (error.response?.data?.code === 'PREMIUM_ALREADY_ACTIVE') {
        queryClient.invalidateQueries({ queryKey: ['premium-status'] });
        toast.success('Premium is already active for this society');
        setShowUpgradeModal(false);
        return;
      }
      toast.error(error.response?.data?.error || 'Failed to start Premium checkout');
    },
  });

  useEffect(() => {
    if (!pendingRazorpayPayload || showUpgradeModal) return;
    const payload = pendingRazorpayPayload;
    setPendingRazorpayPayload(null);
    requestAnimationFrame(() => {
      openRazorpaySubscriptionCheckout({
        key: payload.keyId,
        subscriptionId: payload.subscriptionId,
        name: 'Dwell Hub Premium',
        description: `Premium plan locked at ${payload.lockedFlatCount} flats`,
        prefill: { name: user?.name, email: user?.email, contact: user?.phone },
        notes: { lockedFlatCount: String(payload.lockedFlatCount) },
        onSuccess: (response) => verifyMutation.mutate(response),
        onDismiss: () => toast('Premium checkout was closed before completion.'),
      }).catch((error: any) => toast.error(error.message || 'Failed to open Razorpay checkout'));
    });
  }, [pendingRazorpayPayload, showUpgradeModal, user, verifyMutation]);

  const deleteMutation = useMutation({
    mutationFn: ({ id, confirmation }: { id: string; confirmation: string }) => api.delete(`/flats/flats/${id}`, { data: { confirmation } }),
    onSuccess: () => {
      toast.success('Flat deleted');
      setShowDeleteFlat(false);
      setSelectedFlatId(null);
      setMobileDetailFlatId(null);
      queryClient.invalidateQueries({ queryKey: ['flats'] });
      queryClient.invalidateQueries({ queryKey: ['blocks'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to delete flat');
    },
  });

  const openManageFlat = (
    flat: Flat | null,
    options?: {
      intent?: ManageResidentIntent;
      residentMode?: 'OWNER' | 'TENANT';
    },
  ) => {
    if (!flat) {
      toast.error('Select a flat first');
      return;
    }

    setManageFlatId(flat.id);
    setManageResidentIntent(options?.intent ?? 'default');
    setManageResidentMode(options?.residentMode);
    setShowManageFlat(true);
  };

  const openEditFlat = (flat: Flat | null) => {
    if (!flat) {
      toast.error('Select a flat first');
      return;
    }

    setSelectedFlatId(flat.id);
    setShowEditFlat(true);
  };

  const openEditBlock = (block: (typeof blocks)[number] | null) => {
    if (!block) {
      toast.error('Select a block first');
      return;
    }

    setEditingBlock(block);
    setSelectedBlockId(block.id);
    setShowEditBlock(true);
  };

  const handleAddResident = () => {
    setResidentPickerSearch('');
    setResidentPickerBlockId('');
    setResidentPickerPage(1);
    setShowResidentFlatPicker(true);
  };

  const handleSelectResidentFlat = (flat: Flat) => {
    setShowResidentFlatPicker(false);
    openManageFlat(flat);
  };

  const handleLimitReached = () => {
    if (isNativeIos()) {
      setShowIosUpgradeInfo(true);
      return;
    }
    setShowUpgradeModal(true);
  };

  if (isLoading) return <PageLoader />;

  return (
    <>
      <div className={cn('space-y-6', hasDesktopOverlay && 'xl:pr-[344px]')}>
        <section className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Flats &amp; Residents</h1>
            <p className="mt-1 max-w-sm text-sm text-slate-400">Manage blocks, flats and residents</p>
          </div>

          {isAdmin ? (
            <div className="flex flex-wrap gap-3 xl:justify-end">
              {viewMode === 'flats' ? (
                <>
                  <ActionButton kind="secondary" onClick={() => setShowAddBlock(true)}>
                    <Plus className="h-4 w-4" />
                    Add Block
                  </ActionButton>
                  <ActionButton kind="secondary" onClick={() => setShowAddFlat(true)}>
                    <Plus className="h-4 w-4" />
                    Add Flat
                  </ActionButton>
                </>
              ) : null}
              {viewMode === 'residents' ? (
                <ActionButton kind="secondary" onClick={handleAddResident}>
                  <Plus className="h-4 w-4" />
                  Add Resident
                </ActionButton>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="space-y-5">
          <div className="max-w-xl">
            <SearchBar value={search} onChange={setSearch} />
          </div>

          <div className="flex gap-8 border-b border-slate-200">
            <TabButton active={viewMode === 'flats'} onClick={() => setViewMode('flats')}>Flats</TabButton>
            <TabButton active={viewMode === 'residents'} onClick={() => setViewMode('residents')}>Residents</TabButton>
          </div>
        </section>

        {viewMode === 'flats' ? (
        <section className="space-y-4">
          <h2 className="text-base font-bold text-slate-900">Blocks Overview</h2>
          <div className="overflow-x-auto pb-2">
            <div className="flex min-w-max gap-3">
            {blocks.map((block) => {
              const blockFlats = flats.filter((flat) => flat.blockId === block.id);
              const occupiedCount = blockFlats.filter((flat) => flat.isOccupied).length;
              const vacantCount = Math.max(blockFlats.length - occupiedCount, 0);
              const isActive = selectedBlockId === block.id;

              return (
                <div
                  key={block.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedBlockId(block.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedBlockId(block.id);
                    }
                  }}
                  className={cn(
                    'w-[220px] shrink-0 rounded-xl border bg-white p-3.5 text-left shadow-sm transition hover:shadow-md',
                    isActive ? 'border-blue-100 ring-1 ring-blue-50' : 'border-slate-100'
                  )}
                >
                  <div className="mb-2.5 flex items-start justify-between">
                    <div className={cn('rounded-lg p-2', isActive ? 'bg-blue-50 text-blue-600' : 'bg-slate-50 text-slate-400')}>
                      <Building2 className="h-4.5 w-4.5" />
                    </div>
                    <div className="flex items-center gap-1">
                      {isAdmin ? (
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-50 hover:text-slate-700"
                          onClick={(event) => {
                            event.stopPropagation();
                            openEditBlock(block);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      ) : null}
                      <ChevronRight className="h-4 w-4 text-slate-400" />
                    </div>
                  </div>
                  <h3 className="text-sm font-bold text-slate-800">{block.name}</h3>
                  <p className="mb-0.5 text-xs text-slate-400">{blockFlats.length} Flats</p>
                  <p className="mb-1.5 text-xs text-slate-400">{block.totalWings ? `${block.totalWings} Wings` : `${block.floors} Floors`}</p>
                  <div className="flex items-center gap-2 text-[11px] font-semibold">
                    <span className="text-emerald-600">{occupiedCount} Occupied</span>
                    <span className="h-1 w-1 rounded-full bg-slate-300" />
                    <span className="text-slate-500">{vacantCount} Vacant</span>
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        </section>
        ) : null}

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="min-w-0">
            {viewMode === 'flats' ? (
              <>
                <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                  <button type="button" className="flex items-center gap-2 font-bold text-slate-800" onClick={() => setSelectedBlockId('all')}>
                    <span>{selectedBlockId === 'all' ? 'All Blocks' : detailFlat?.block?.name || blocks.find((block) => block.id === selectedBlockId)?.name || 'Selected Block'}</span>
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  <span className="text-xs text-slate-400">{filteredFlats.length} Flats</span>
                </div>

                <div className="hidden lg:block">
                  <FlatsDesktopTable
                    flats={paginatedFlats}
                    selectedFlatId={selectedFlatId}
                    onSelectFlat={setSelectedFlatId}
                    onOpenMobileDetails={setMobileDetailFlatId}
                    isAdmin={isAdmin}
                    onAddFlat={() => setShowAddFlat(true)}
                    onAddResident={(flat) => openManageFlat(flat)}
                  />
                </div>
                <div className="lg:hidden">
                  <FlatsMobileList
                    flats={paginatedFlats}
                    isAdmin={isAdmin}
                    onAddFlat={() => setShowAddFlat(true)}
                    onAddResident={(flat) => openManageFlat(flat)}
                    onOpenDetails={(flat) => {
                      setSelectedFlatId(flat.id);
                      setMobileDetailFlatId(flat.id);
                    }}
                  />
                </div>

                {filteredFlats.length > 10 ? (
                  <ListFooter
                    itemLabel="flats"
                    totalItems={filteredFlats.length}
                    currentPage={flatPage}
                    totalPages={flatTotalPages}
                    rowsPerPage={flatRowsPerPage}
                    onPageChange={setFlatPage}
                    onRowsPerPageChange={setFlatRowsPerPage}
                  />
                ) : null}
              </>
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                  <div>
                    <p className="font-bold text-slate-800">Residents</p>
                    <p className="text-xs text-slate-400">Centralized resident management</p>
                  </div>
                  <span className="text-xs text-slate-400">{filteredResidents.length} Residents</span>
                </div>

                {filteredResidents.length === 0 ? (
                  <EmptyState
                    icon={Users}
                    title="No residents found"
                    description="Add a resident to a vacant flat or try another search or block filter to find mapped owners and tenants."
                    action={isAdmin ? <ActionButton kind="secondary" onClick={handleAddResident}>Add Resident</ActionButton> : undefined}
                  />
                ) : (
                  <>
                    <div className="flex items-center justify-between px-4 pb-4 pt-5 lg:hidden">
                      <h3 className="text-2xl font-bold text-slate-900">Active Residents</h3>
                      <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-slate-900">{filteredResidents.length} Total</span>
                    </div>
                    <div className="hidden lg:block">
                      <ResidentsDesktopTable residents={paginatedResidents} selectedResidentId={selectedResidentId} onSelectResident={setSelectedResidentId} />
                    </div>
                    <div className="lg:hidden">
                      <ResidentsMobileList
                        residents={paginatedResidents}
                        onOpenDetails={(resident) => {
                          setSelectedResidentId(resident.id);
                          setSelectedFlatId(resident.flat.id);
                          setMobileResidentId(resident.id);
                        }}
                      />
                    </div>

                    {filteredResidents.length > 10 ? (
                      <ListFooter
                        itemLabel="residents"
                        totalItems={filteredResidents.length}
                        currentPage={residentPage}
                        totalPages={residentTotalPages}
                        rowsPerPage={residentRowsPerPage}
                        onPageChange={setResidentPage}
                        onRowsPerPageChange={setResidentRowsPerPage}
                      />
                    ) : null}
                  </>
                )}
              </>
            )}
          </div>

        </section>
      </div>

      {viewMode === 'flats' && detailFlat ? (
        <DetailPanel
          flat={detailFlat}
          resident={selectedResident}
          isAdmin={isAdmin}
          onClose={() => setSelectedFlatId(null)}
          onEditFlat={() => openEditFlat(detailFlat)}
          onManageResidents={() => openManageFlat(detailFlat)}
          onDeleteFlat={() => setShowDeleteFlat(true)}
        />
      ) : null}

      {viewMode === 'residents' && selectedResident ? (
        <ResidentsDetailPanel
          resident={selectedResident}
          onClose={() => setSelectedResidentId(null)}
          onEditResident={() => openManageFlat(selectedResident.flat, { intent: 'edit', residentMode: selectedResident.relation })}
          onDeactivateResident={() => openManageFlat(selectedResident.flat, { intent: 'deactivate', residentMode: selectedResident.relation })}
        />
      ) : null}

      {viewMode === 'flats' ? (
        <MobileDetailScreen
          flat={mobileDetailFlat}
          onClose={() => setMobileDetailFlatId(null)}
          onEditFlat={() => openEditFlat(mobileDetailFlat)}
          onManageResidents={() => openManageFlat(mobileDetailFlat)}
          onDeleteFlat={() => setShowDeleteFlat(true)}
        />
      ) : (
        <MobileResidentProfileScreen
          resident={mobileResident}
          onClose={() => setMobileResidentId(null)}
          onEditResident={() => openManageFlat(mobileResident?.flat ?? null, { intent: 'edit', residentMode: mobileResident?.relation })}
          onDeactivateResident={() => openManageFlat(mobileResident?.flat ?? null, { intent: 'deactivate', residentMode: mobileResident?.relation })}
        />
      )}

      <Modal isOpen={showAddBlock} onClose={() => setShowAddBlock(false)} title="Add New Block / Wing" size="xl">
        <AddBlockForm
          onSuccess={() => {
            setShowAddBlock(false);
            queryClient.invalidateQueries({ queryKey: ['blocks'] });
          }}
        />
      </Modal>

      <Modal isOpen={showEditBlock} onClose={() => { setShowEditBlock(false); setEditingBlock(null); }} title={`Edit Block - ${editingBlock?.name || ''}`} size="xl">
        {editingBlock ? (
          <AddBlockForm
            block={editingBlock}
            onSuccess={() => {
              setShowEditBlock(false);
              setEditingBlock(null);
              queryClient.invalidateQueries({ queryKey: ['blocks'] });
              queryClient.invalidateQueries({ queryKey: ['flats'] });
            }}
          />
        ) : null}
      </Modal>

      <Modal isOpen={showAddFlat} onClose={() => setShowAddFlat(false)} title="Add New Flat" size="xl">
        <AddFlatForm
          blocks={blocks}
          initialBlockId={selectedBlockId !== 'all' ? selectedBlockId : undefined}
          onSuccess={() => {
            setShowAddFlat(false);
            queryClient.invalidateQueries({ queryKey: ['flats'] });
          }}
          onLimitReached={() => {
            setShowAddFlat(false);
            handleLimitReached();
          }}
        />
      </Modal>

      <Modal isOpen={showEditFlat} onClose={() => setShowEditFlat(false)} title={`Edit Flat - ${detailFlat?.flatNumber || selectedFlat?.flatNumber || ''}`} size="xl">
        {(detailFlat || selectedFlat) ? (
          <AddFlatForm
            blocks={blocks}
            flat={(detailFlat || selectedFlat)!}
            onSuccess={() => {
              setShowEditFlat(false);
              queryClient.invalidateQueries({ queryKey: ['flats'] });
              queryClient.invalidateQueries({ queryKey: ['blocks'] });
            }}
            onLimitReached={handleLimitReached}
            onDeleteRequest={() => {
              setShowEditFlat(false);
              setShowDeleteFlat(true);
            }}
          />
        ) : null}
      </Modal>

      <Modal
        isOpen={showManageFlat}
        onClose={() => {
          setShowManageFlat(false);
          setManageFlatId(null);
          setManageResidentIntent('default');
          setManageResidentMode(undefined);
        }}
        title={`${manageResidentIntent === 'deactivate' ? 'Deactivate Resident' : 'Edit Resident'} - ${manageFlat?.flatNumber || ''}`}
        size="xl"
      >
        {manageFlat ? (
          <ManageFlatForm
            flat={manageFlat}
            entryIntent={manageResidentIntent}
            initialResidentMode={manageResidentMode}
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ['flats'] });
            }}
          />
        ) : null}
      </Modal>

      <Modal isOpen={showResidentFlatPicker} onClose={() => setShowResidentFlatPicker(false)} title="Select Vacant Flat" size="lg">
        {vacantFlats.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No vacant flats available"
            description="All flats already have residents assigned. Vacate a flat first or add a new flat before creating a resident from the top action."
          />
        ) : (
          <div className="space-y-4">
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
                <div className="relative">
                  <select
                    className="input appearance-none !h-14 !rounded-2xl !border-outline-variant/80 !bg-surface-container-low px-4 pr-11 text-base text-on-surface shadow-none"
                    value={residentPickerBlockId}
                    onChange={(event) => setResidentPickerBlockId(event.target.value)}
                  >
                    <option value="" disabled>Select block</option>
                    {blocks.map((block) => (
                      <option key={block.id} value={block.id}>{block.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-outline" />
                </div>
                <div className={cn('flex items-center rounded-xl border px-4 py-3 transition-colors', residentPickerBlockId ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50')}>
                  <Search className="mr-3 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    className="w-full border-0 bg-transparent p-0 text-sm text-slate-700 placeholder:text-slate-400 focus:ring-0 disabled:cursor-not-allowed disabled:text-slate-400"
                    placeholder="Search flat no., block or floor"
                    value={residentPickerSearch}
                    onChange={(event) => setResidentPickerSearch(event.target.value)}
                    disabled={!residentPickerBlockId}
                  />
                </div>
              </div>
              {residentPickerBlockId ? (
                <div className="flex flex-col gap-1 text-left">
                  <p className="text-sm font-medium text-slate-700">Choose a vacant flat before adding a resident from the top action.</p>
                  <p className="text-xs text-slate-400">{filteredVacantFlats.length} vacant flats found in the selected block</p>
                </div>
              ) : null}
            </div>

            {!residentPickerBlockId ? (
              <EmptyState
                icon={Building2}
                title="Select a block"
                description="Choose a block first, then pick one of its vacant flats to continue adding a resident."
              />
            ) : filteredVacantFlats.length === 0 ? (
              <EmptyState
                icon={Search}
                title="No matching vacant flats"
                description="Try another search term or block filter to find a vacant flat."
              />
            ) : (
              <>
            <div className="max-h-[52vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {paginatedVacantFlats.map((flat) => (
                <button
                  key={flat.id}
                  type="button"
                  onClick={() => handleSelectResidentFlat(flat)}
                  className="rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-blue-200 hover:bg-blue-50/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold text-slate-900">Flat {flat.flatNumber}</p>
                      <p className="mt-1 text-sm text-slate-500">{flat.block?.name || 'Unassigned Block'} • Floor {flat.floor}</p>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">Vacant</span>
                  </div>
                  <p className="mt-3 text-xs text-slate-400">{getFlatTypeLabel(flat.type)}{flat.areaSqFt ? ` • ${flat.areaSqFt} sq.ft` : ''}</p>
                </button>
              ))}
              </div>
            </div>

            {residentPickerTotalPages > 1 ? (
              <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                <span className="text-xs text-slate-500">Page {residentPickerPage} of {residentPickerTotalPages}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => setResidentPickerPage((page) => Math.max(1, page - 1))}
                    disabled={residentPickerPage === 1}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => setResidentPickerPage((page) => Math.min(residentPickerTotalPages, page + 1))}
                    disabled={residentPickerPage === residentPickerTotalPages}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
              </>
            )}
          </div>
        )}
      </Modal>

      <Modal isOpen={showDeleteFlat} onClose={() => setShowDeleteFlat(false)} title="Delete Apartment" size="md">
        {detailFlat ? (
          <DeleteFlatForm
            flat={detailFlat}
            isPending={deleteMutation.isPending}
            onConfirm={(confirmation) => deleteMutation.mutate({ id: detailFlat.id, confirmation })}
          />
        ) : (
          <div className="py-4 text-sm text-on-surface-variant">Select a flat first.</div>
        )}
      </Modal>

      <Modal isOpen={showBulkUpload} onClose={() => setShowBulkUpload(false)} title="Bulk Upload Flats from Excel" size="lg">
        <BulkUploadForm
          onSuccess={() => {
            setShowBulkUpload(false);
            queryClient.invalidateQueries({ queryKey: ['flats'] });
            queryClient.invalidateQueries({ queryKey: ['blocks'] });
          }}
          onLimitReached={() => {
            setShowBulkUpload(false);
            handleLimitReached();
          }}
        />
      </Modal>

      <Modal isOpen={showUpgradeModal} onClose={() => setShowUpgradeModal(false)} title="Upgrade to Premium" size="lg">
        <UpgradePrompt
          onClose={() => setShowUpgradeModal(false)}
          onSubscribeRequest={(flatCount) => subscribeMutation.mutate(flatCount)}
          isSubscribePending={subscribeMutation.isPending}
          isVerifyPending={verifyMutation.isPending}
        />
      </Modal>

      <Modal isOpen={showIosUpgradeInfo} onClose={() => setShowIosUpgradeInfo(false)} title="Plan changes unavailable on iOS" size="md">
        <IosUpgradeInfo onClose={() => setShowIosUpgradeInfo(false)} />
      </Modal>
    </>
  );
}

function ActionButton({ kind, children, onClick }: { kind: 'primary' | 'secondary'; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors',
        kind === 'primary'
          ? 'bg-blue-600 text-white shadow-sm hover:bg-blue-700'
          : 'border border-blue-600 bg-white text-blue-600 hover:bg-blue-50'
      )}
    >
      {children}
    </button>
  );
}

function SearchBar({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex items-center rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <Search className="mr-3 h-5 w-5 text-slate-400" />
      <input
        type="text"
        className="w-full border-0 bg-transparent p-0 text-sm text-slate-700 placeholder:text-slate-400 focus:ring-0"
        placeholder="Search by flat no., resident name or phone..."
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function TabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'pb-3 text-sm transition-colors',
        active ? 'border-b-2 border-blue-600 font-bold text-blue-600' : 'font-medium text-slate-500 hover:text-slate-800'
      )}
    >
      {children}
    </button>
  );
}

function FlatsDesktopTable({
  flats,
  selectedFlatId,
  onSelectFlat,
  onOpenMobileDetails,
  isAdmin,
  onAddFlat,
  onAddResident,
}: {
  flats: Flat[];
  selectedFlatId: string | null;
  onSelectFlat: (flatId: string) => void;
  onOpenMobileDetails: (flatId: string) => void;
  isAdmin: boolean;
  onAddFlat: () => void;
  onAddResident: (flat: Flat) => void;
}) {
  if (flats.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title="No flats found"
        description="Add a flat or change the active block filter to see flats here."
        action={isAdmin ? <ActionButton kind="primary" onClick={onAddFlat}>Add Flat</ActionButton> : undefined}
      />
    );
  }

  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-400">
          <th className="border-b border-slate-100 px-6 py-3">Flat No.</th>
          <th className="border-b border-slate-100 px-6 py-3">Type</th>
          <th className="border-b border-slate-100 px-6 py-3">Area (sq.ft)</th>
          <th className="border-b border-slate-100 px-6 py-3">Status</th>
          <th className="border-b border-slate-100 px-6 py-3">Resident / Owner</th>
          <th className="border-b border-slate-100 px-6 py-3">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 text-sm">
        {flats.map((flat) => {
          const activeOwner = getActiveOwner(flat);
          const residentName = flat.tenant?.isActive ? flat.tenant.name : activeOwner?.name;
          const residentType = flat.tenant?.isActive ? 'Tenant' : activeOwner ? 'Owner' : null;
          const residentPhone = flat.tenant?.isActive ? flat.tenant.phone : activeOwner?.phone;
          const effectiveResidentName = flat.tenant?.isActive ? flat.tenant.name : activeOwner?.name;
          const isActive = selectedFlatId === flat.id;

          return (
            <tr key={flat.id} className={cn('cursor-pointer transition-colors hover:bg-slate-50', isActive && 'bg-blue-50/30')} onClick={() => onSelectFlat(flat.id)}>
              <td className="px-6 py-4 font-bold text-slate-800">{flat.flatNumber}</td>
              <td className="px-6 py-4 text-slate-500">{getFlatTypeLabel(flat.type)}</td>
              <td className="px-6 py-4 text-slate-500">{flat.areaSqFt || '—'}</td>
              <td className="px-6 py-4"><StatusPill occupied={flat.isOccupied} /></td>
              <td className="px-6 py-4">
                {effectiveResidentName ? (
                  <>
                    <div className="font-bold text-slate-800">{effectiveResidentName} <span className="font-normal text-slate-400">({residentType})</span></div>
                    <div className="text-xs text-slate-400">{residentPhone}</div>
                  </>
                ) : (
                  <button
                    type="button"
                    className="rounded-lg border border-blue-200 px-3 py-1 text-xs font-semibold text-blue-600 transition-colors hover:bg-blue-50"
                    onClick={(event) => {
                      event.stopPropagation();
                      onAddResident(flat);
                    }}
                  >
                    Add
                  </button>
                )}
              </td>
              <td className="px-6 py-4">
                <button
                  type="button"
                  className="text-slate-400 hover:text-slate-600"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectFlat(flat.id);
                    onOpenMobileDetails(flat.id);
                  }}
                >
                  <MoreVertical className="h-5 w-5" />
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FlatsMobileList({
  flats,
  isAdmin,
  onAddFlat,
  onOpenDetails,
  onAddResident,
}: {
  flats: Flat[];
  isAdmin: boolean;
  onAddFlat: () => void;
  onOpenDetails: (flat: Flat) => void;
  onAddResident: (flat: Flat) => void;
}) {
  if (flats.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title="No flats found"
        description="Add a flat or change the active block filter to see flats here."
        action={isAdmin ? <ActionButton kind="primary" onClick={onAddFlat}>Add Flat</ActionButton> : undefined}
      />
    );
  }

  return (
    <div className={MOBILE_LIST_SPACING_CLASS}>
      {flats.map((flat) => {
        const activeOwner = getActiveOwner(flat);
        const residentName = flat.tenant?.isActive ? flat.tenant.name : activeOwner?.name;
        const residentType = flat.tenant?.isActive ? 'Tenant' : activeOwner ? 'Owner' : null;

        return (
          <button key={flat.id} type="button" onClick={() => onOpenDetails(flat)} className={cn(MOBILE_SURFACE_CARD_CLASS, 'flex w-full items-center justify-between gap-4 text-left')}>
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-slate-900">{flat.flatNumber}</h3>
              <p className="text-[11px] text-slate-400">{getFlatTypeLabel(flat.type)} • {flat.areaSqFt || '—'} sq.ft</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2 text-right">
              <StatusBadge occupied={flat.isOccupied} compact />
              {residentName ? (
                <p className="text-[11px] text-slate-600">
                  <span className="font-semibold text-blue-600">{residentName}</span>
                  {residentType ? ` (${residentType})` : ''}
                </p>
              ) : (
                <button
                  type="button"
                  className="inline-flex min-w-[80px] items-center justify-center rounded-lg border border-blue-200 px-3 py-1.5 text-[11px] font-semibold text-blue-600 transition-colors hover:bg-blue-50"
                  onClick={(event) => {
                    event.stopPropagation();
                    onAddResident(flat);
                  }}
                >
                  Add
                </button>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ResidentsDesktopTable({
  residents,
  selectedResidentId,
  onSelectResident,
}: {
  residents: ResidentEntry[];
  selectedResidentId: string | null;
  onSelectResident: (residentId: string) => void;
}) {
  if (residents.length === 0) {
    return <EmptyState icon={Users} title="No residents found" description="Try another search or block filter to find mapped owners and tenants." />;
  }

  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-400">
          <th className="border-b border-slate-100 px-6 py-3">Name</th>
          <th className="border-b border-slate-100 px-6 py-3">Phone Number</th>
          <th className="border-b border-slate-100 px-6 py-3">Flat No.</th>
          <th className="border-b border-slate-100 px-6 py-3">Type</th>
          <th className="border-b border-slate-100 px-6 py-3">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 text-sm">
        {residents.map((resident) => {
          const active = selectedResidentId === resident.id;

          return (
            <tr key={resident.id} className={cn('cursor-pointer transition-colors hover:bg-slate-50', active && 'bg-blue-50/30')} onClick={() => onSelectResident(resident.id)}>
              <td className="px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className={cn('flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold', getResidentAvatarClass(resident))}>
                    {getResidentInitials(resident.name)}
                  </div>
                  <span className="font-bold text-slate-800">{resident.name}</span>
                </div>
              </td>
              <td className="px-6 py-4 text-slate-500">{formatResidentPhone(resident.phone)}</td>
              <td className="px-6 py-4 text-slate-500">{resident.flat.flatNumber}</td>
              <td className="px-6 py-4">
                <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ring-1', resident.relation === 'OWNER' ? 'bg-emerald-50 text-emerald-600 ring-emerald-500/20' : 'bg-slate-100 text-slate-500 ring-slate-400/20')}>
                  {resident.relation}
                </span>
              </td>
              <td className="px-6 py-4">
                <div className="flex items-center gap-1.5 text-emerald-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <span className="font-medium">Active</span>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ResidentsMobileList({ residents, onOpenDetails }: { residents: ResidentEntry[]; onOpenDetails: (resident: ResidentEntry) => void }) {
  if (residents.length === 0) {
    return <EmptyState icon={Users} title="No residents found" description="Try another search or block filter to find mapped owners and tenants." />;
  }

  return (
    <div className={MOBILE_LIST_SPACING_CLASS}>
      {residents.map((resident) => (
        <button key={resident.id} type="button" onClick={() => onOpenDetails(resident)} className={cn(MOBILE_SURFACE_CARD_CLASS, 'flex w-full items-center justify-between text-left')}>
          <div>
            <h3 className="font-bold text-slate-900">{resident.name}</h3>
            <p className="text-[11px] text-slate-400">Flat {resident.flat.flatNumber} • {formatResidentPhone(resident.phone)}</p>
          </div>
          <div className="flex items-center gap-4 text-right">
            <div>
              <div className="mb-1 flex justify-end">
                <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ring-1', resident.relation === 'OWNER' ? 'bg-emerald-50 text-emerald-600 ring-emerald-500/20' : 'bg-slate-100 text-slate-500 ring-slate-400/20')}>
                  {resident.relation}
                </span>
              </div>
              <p className="text-[11px] font-semibold text-emerald-600">Active</p>
            </div>
            <MoreVertical className="h-5 w-5 text-slate-400" />
          </div>
        </button>
      ))}
    </div>
  );
}

function ResidentsDetailPanel({
  resident,
  onClose,
  onEditResident,
  onDeactivateResident,
}: {
  resident: ResidentEntry | null;
  onClose: () => void;
  onEditResident: () => void;
  onDeactivateResident: () => void;
}) {
  return (
    <aside className="hidden border-l border-slate-200 bg-white xl:fixed xl:inset-y-0 xl:right-0 xl:z-30 xl:flex xl:w-80 xl:flex-col xl:shadow-[-12px_0_32px_rgba(15,23,42,0.08)]">
      {resident ? (
        <>
          <div className="flex items-start justify-between border-b border-slate-100 p-6">
            <div>
              <h3 className="text-xl font-bold text-slate-800">{resident.name}</h3>
              <p className="text-sm text-slate-400">{resident.relation === 'OWNER' ? 'Owner' : 'Tenant'} • Flat {resident.flat.flatNumber}</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose}>
                <X className="h-5 w-5" />
              </button>
              <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ring-1', resident.relation === 'OWNER' ? 'bg-emerald-50 text-emerald-600 ring-emerald-500/20' : 'bg-slate-100 text-slate-500 ring-slate-400/20')}>
                {resident.relation}
              </span>
            </div>
          </div>

          <div className="flex-1 space-y-8 overflow-y-auto p-6">
            <div>
              <h4 className="mb-4 text-xs font-bold uppercase tracking-widest text-slate-800">Flat Information</h4>
              <div className="space-y-3">
                <InfoRow label="Block" value={resident.flat.block?.name || '—'} />
                <InfoRow label="Flat" value={resident.flat.flatNumber} />
                <InfoRow label="Type" value={resident.relation === 'OWNER' ? 'Owner' : 'Tenant'} />
                <InfoRow label="Status" value="Active" />
              </div>
            </div>

            <div>
              <h4 className="mb-4 text-xs font-bold uppercase tracking-widest text-slate-800">Contact Details</h4>
              <div className="space-y-4">
                {resident.email ? (
                  <ResidentDetailRow icon={<Mail className="h-5 w-5 text-slate-400" />} label="Email Address" value={resident.email} />
                ) : null}
                <ResidentDetailRow icon={<Phone className="h-5 w-5 text-slate-400" />} label="Phone Number" value={formatResidentPhone(resident.phone)} />
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 p-4 shadow-sm">
              <h4 className="mb-3 text-sm font-bold text-slate-900">Quick Actions</h4>
              <div className="divide-y divide-slate-50">
                <QuickAction label="Edit Resident" icon={<Pencil className="h-5 w-5 text-slate-500" />} onClick={onEditResident} />
                <QuickAction label="Message Resident" icon={<MessageSquare className="h-5 w-5 text-slate-500" />} onClick={() => { if (resident.email) window.location.href = `mailto:${resident.email}`; }} danger={false} />
                <QuickAction label="Call Resident" icon={<Phone className="h-5 w-5 text-slate-500" />} onClick={() => { window.location.href = `tel:${resident.phone}`; }} danger={false} />
                <QuickAction label="Deactivate Resident" icon={<Trash2 className="h-5 w-5 text-red-500" />} danger onClick={onDeactivateResident} />
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="flex h-full items-center justify-center p-6 text-sm text-slate-400">Select a resident to view details.</div>
      )}
    </aside>
  );
}

function MobileResidentProfileScreen({
  resident,
  onClose,
  onEditResident,
  onDeactivateResident,
}: {
  resident: ResidentEntry | null;
  onClose: () => void;
  onEditResident: () => void;
  onDeactivateResident: () => void;
}) {
  if (!resident) return null;

  return (
    <div className="fixed inset-0 z-40 bg-slate-50 xl:hidden">
      <div className="hide-scrollbar flex h-full flex-col overflow-y-auto">
        <header className="sticky top-0 z-10 bg-slate-50/95 px-4 pb-3 pt-12 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <button type="button" className="rounded-full bg-slate-100 p-2 text-slate-700 transition active:scale-95" onClick={onClose}>
              <ChevronLeft className="h-6 w-6" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <h1 className="truncate text-2xl font-bold tracking-tight text-slate-900">{resident.name}</h1>
                <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ring-1', resident.relation === 'OWNER' ? 'bg-emerald-50 text-emerald-600 ring-emerald-500/20' : 'bg-slate-100 text-slate-500 ring-slate-400/20')}>
                  {resident.relation}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-slate-400">Flat {resident.flat.flatNumber} • {resident.flat.block?.name || 'Unassigned block'}</p>
            </div>
          </div>
        </header>

        <main className={MOBILE_OVERLAY_CONTENT_CLASS}>
          <div className={MOBILE_SURFACE_CARD_CLASS}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Resident Details</h3>
                <p className="mt-1 text-xs text-slate-400">Core resident information</p>
              </div>
              <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Active</div>
            </div>
            <div className="space-y-4">
              <InfoRow label="Resident Type" value={resident.relation === 'OWNER' ? 'Owner' : 'Tenant'} mobile />
              <InfoRow label="Flat" value={resident.flat.flatNumber} mobile />
              <InfoRow label="Block" value={resident.flat.block?.name || '—'} mobile />
              <InfoRow label="Phone" value={formatResidentPhone(resident.phone)} mobile />
              <InfoRow label="Email" value={resident.email || '—'} mobile />
            </div>
          </div>

          <div className={MOBILE_SURFACE_CARD_CLASS}>
            <h3 className="mb-1 text-lg font-bold text-slate-900">Contact Details</h3>
            <p className="mb-4 text-xs text-slate-400">Resident communication details</p>
            <div className="space-y-4">
              {resident.email ? (
                <ResidentDetailRow icon={<Mail className="h-5 w-5 text-slate-400" />} label="Email Address" value={resident.email} />
              ) : null}
              <ResidentDetailRow icon={<Phone className="h-5 w-5 text-slate-400" />} label="Phone Number" value={formatResidentPhone(resident.phone)} />
            </div>
          </div>

          <div className={MOBILE_SURFACE_CARD_CLASS}>
            <h3 className="mb-1 text-lg font-bold text-slate-900">Quick Actions</h3>
            <p className="mb-4 text-xs text-slate-400">Resident management shortcuts</p>
            <div className="divide-y divide-gray-50">
              <QuickAction label="Edit Resident" icon={<Pencil className="h-5 w-5 text-slate-500" />} onClick={onEditResident} />
              <QuickAction label="Message Resident" icon={<MessageSquare className="h-5 w-5 text-slate-500" />} onClick={() => { if (resident.email) window.location.href = `mailto:${resident.email}`; }} />
              <QuickAction label="Call Resident" icon={<Phone className="h-5 w-5 text-slate-500" />} onClick={() => { window.location.href = `tel:${resident.phone}`; }} />
              <QuickAction label="Deactivate Resident" icon={<Trash2 className="h-5 w-5 text-red-500" />} danger onClick={onDeactivateResident} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function DetailPanel({
  flat,
  resident,
  isAdmin,
  onClose,
  onEditFlat,
  onManageResidents,
  onDeleteFlat,
}: {
  flat: Flat | null;
  resident: ResidentEntry | null;
  isAdmin: boolean;
  onClose: () => void;
  onEditFlat: () => void;
  onManageResidents: () => void;
  onDeleteFlat: () => void;
}) {
  return (
    <aside className="hidden border-l border-slate-200 bg-white xl:fixed xl:inset-y-0 xl:right-0 xl:z-30 xl:flex xl:w-80 xl:flex-col xl:shadow-[-12px_0_32px_rgba(15,23,42,0.08)]">
      {flat ? (
        <>
          <div className="flex items-start justify-between border-b border-slate-100 p-6">
            <div>
              <h3 className="text-xl font-bold text-slate-800">{flat.flatNumber}</h3>
              <p className="text-sm text-slate-400">{flat.block?.name}</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose}>
                <X className="h-5 w-5" />
              </button>
              <StatusBadge occupied={flat.isOccupied} compact />
            </div>
          </div>

          <div className="flex-1 space-y-8 overflow-y-auto p-6">
            <div>
              <h4 className="mb-4 text-xs font-bold uppercase tracking-widest text-slate-800">Flat Details</h4>
              <div className="space-y-3">
                <InfoRow label="Type" value={getFlatTypeLabel(flat.type)} />
                <InfoRow label="Area" value={flat.areaSqFt ? `${flat.areaSqFt} sq.ft` : '—'} />
                <InfoRow label="Floor" value={`Floor ${flat.floor}`} />
                <InfoRow label="Status" value={flat.isOccupied ? 'Occupied' : 'Vacant'} />
              </div>
            </div>

            <ResidentCard title="Owner" tone="owner" name={getActiveOwner(flat)?.name || '—'} phone={getActiveOwner(flat)?.phone || 'No owner'} email={getActiveOwner(flat)?.email} />
            <ResidentCard title="Tenant" tone="tenant" name={flat.tenant?.isActive ? flat.tenant.name : '—'} phone={flat.tenant?.isActive ? flat.tenant.phone : 'No tenant'} email={flat.tenant?.isActive ? flat.tenant.email : undefined} />

            <div className="rounded-xl border border-slate-100 p-4 shadow-sm">
              <h4 className="mb-3 text-sm font-bold text-slate-900">Quick Actions</h4>
              <div className="divide-y divide-slate-50">
                <QuickAction label="Edit Flat" icon={<Building2 className="h-5 w-5 text-slate-500" />} onClick={onEditFlat} />
                <QuickAction label="Manage Residents" icon={<Users className="h-5 w-5 text-slate-500" />} onClick={onManageResidents} />
                {isAdmin ? <QuickAction label="Delete Flat" icon={<Trash2 className="h-5 w-5 text-red-500" />} danger onClick={onDeleteFlat} /> : null}
              </div>
            </div>

            {resident ? (
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-500">
                Viewing resident context for <span className="font-semibold text-slate-800">{resident.name}</span>.
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div className="flex h-full items-center justify-center p-6 text-sm text-slate-400">Select a flat to view details.</div>
      )}
    </aside>
  );
}

function MobileDetailScreen({
  flat,
  onClose,
  onEditFlat,
  onManageResidents,
  onDeleteFlat,
}: {
  flat: Flat | null;
  onClose: () => void;
  onEditFlat: () => void;
  onManageResidents: () => void;
  onDeleteFlat: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!flat) return;
    const container = scrollRef.current;
    if (!container) return;

    container.scrollTop = 0;
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
      }
    });
  }, [flat?.id]);

  if (!flat) return null;

  return (
    <div className="fixed inset-0 z-40 bg-slate-50 xl:hidden">
      <div key={flat.id} ref={scrollRef} className="hide-scrollbar flex h-full flex-col overflow-y-auto">
        <header className="sticky top-0 z-10 bg-slate-50/95 px-4 pb-3 pt-12 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <button type="button" className="rounded-full bg-slate-100 p-2 text-slate-700 transition active:scale-95" onClick={onClose}>
              <ChevronLeft className="h-6 w-6" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <h1 className="truncate text-2xl font-bold tracking-tight text-slate-900">{flat.flatNumber}</h1>
                <StatusBadge occupied={flat.isOccupied} compact />
              </div>
              <p className="mt-0.5 text-sm text-slate-400">{flat.block?.name || 'Unassigned block'}</p>
            </div>
          </div>
        </header>

        <div className={MOBILE_OVERLAY_CONTENT_CLASS}>
          <div className={MOBILE_SURFACE_CARD_CLASS}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Flat Details</h3>
                <p className="mt-1 text-xs text-slate-400">Core apartment information</p>
              </div>
              <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{flat.block?.name || 'Block'}</div>
            </div>
            <div className="space-y-4">
              <InfoRow label="Type" value={getFlatTypeLabel(flat.type)} mobile />
              <InfoRow label="Area" value={flat.areaSqFt ? `${flat.areaSqFt} sq.ft` : '—'} mobile />
              <InfoRow label="Floor" value={`Floor ${flat.floor}`} mobile />
              <InfoRow label="Status" value={flat.isOccupied ? 'Occupied' : 'Vacant'} mobile />
            </div>
          </div>

          <ResidentCard title="Owner" tone="owner" name={getActiveOwner(flat)?.name || '—'} phone={getActiveOwner(flat)?.phone || 'No owner'} email={getActiveOwner(flat)?.email} mobile />
          <ResidentCard title="Tenant" tone="tenant" name={flat.tenant?.isActive ? flat.tenant.name : '—'} phone={flat.tenant?.isActive ? flat.tenant.phone : 'No tenant'} email={flat.tenant?.isActive ? flat.tenant.email : undefined} mobile />

          <div className={MOBILE_SURFACE_CARD_CLASS}>
            <h3 className="mb-1 text-lg font-bold text-slate-900">Quick Actions</h3>
            <p className="mb-4 text-xs text-slate-400">Flat management shortcuts</p>
            <div className="divide-y divide-gray-50">
              <QuickAction label="Edit Flat" icon={<Building2 className="h-5 w-5 text-slate-500" />} onClick={onEditFlat} />
              <QuickAction label="Manage Residents" icon={<Users className="h-5 w-5 text-slate-500" />} onClick={onManageResidents} />
              <QuickAction label="Delete Flat" icon={<Trash2 className="h-5 w-5 text-red-500" />} danger onClick={onDeleteFlat} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResidentCard({
  title,
  tone,
  name,
  phone,
  email,
  mobile = false,
}: {
  title: string;
  tone: 'owner' | 'tenant';
  name: string;
  phone: string;
  email?: string;
  mobile?: boolean;
}) {
  const toneClasses = tone === 'owner'
    ? 'border-emerald-100 bg-emerald-50/50 text-emerald-600'
    : 'border-blue-100 bg-blue-50/30 text-blue-600';

  return (
    <div className={cn(MOBILE_SURFACE_CARD_CLASS, 'flex items-center justify-between', toneClasses)}>
      <div className="flex items-center gap-4">
        <div className={cn('flex h-12 w-12 items-center justify-center rounded-full', tone === 'owner' ? 'bg-emerald-100' : 'bg-blue-100')}>
          <User className="h-7 w-7" />
        </div>
        <div>
          <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-widest">{title}</span>
          <h4 className="font-bold text-slate-900">{name}</h4>
          <p className="text-xs text-slate-500">{phone}</p>
          {email ? <p className="text-xs text-slate-400">{email}</p> : null}
        </div>
      </div>
      <button type="button" className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-100 bg-white shadow-sm">
        <Phone className="h-5 w-5 text-blue-600" />
      </button>
    </div>
  );
}

function QuickAction({ label, icon, onClick, danger = false }: { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" className="flex w-full items-center justify-between py-4 text-left" onClick={onClick}>
      <div className="flex items-center gap-3">
        {icon}
        <span className={cn('text-sm font-medium', danger ? 'text-red-500' : 'text-slate-700')}>{label}</span>
      </div>
      <ChevronRight className="h-4 w-4 text-slate-300" />
    </button>
  );
}

function InfoRow({ label, value, mobile = false }: { label: string; value: string; mobile?: boolean }) {
  return (
    <div className={cn('flex justify-between text-sm', mobile && 'items-center')}>
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-slate-700">{value}</span>
    </div>
  );
}

function StatusPill({ occupied }: { occupied: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1',
        occupied ? 'bg-emerald-50 text-emerald-600 ring-emerald-500/20' : 'bg-slate-100 text-slate-500 ring-slate-400/20'
      )}
    >
      <span className={cn('h-1 w-1 rounded-full', occupied ? 'bg-emerald-500' : 'bg-slate-400')} />
      {occupied ? 'Occupied' : 'Vacant'}
    </span>
  );
}

function StatusBadge({ occupied, compact = false }: { occupied: boolean; compact?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-bold',
        compact ? 'px-2 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]',
        occupied ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
      )}
    >
      <span className={cn('h-1 w-1 rounded-full', occupied ? 'bg-emerald-500' : 'bg-slate-400')} />
      {occupied ? 'Occupied' : 'Vacant'}
    </span>
  );
}

function ListFooter({
  itemLabel,
  totalItems,
  currentPage,
  totalPages,
  rowsPerPage,
  onPageChange,
  onRowsPerPageChange,
}: {
  itemLabel: string;
  totalItems: number;
  currentPage: number;
  totalPages: number;
  rowsPerPage: number;
  onPageChange: (page: number) => void;
  onRowsPerPageChange: (value: number) => void;
}) {
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * rowsPerPage + 1;
  const endItem = Math.min(currentPage * rowsPerPage, totalItems);

  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span className="font-medium text-slate-400">
          Showing {startItem}-{endItem} of {totalItems} {itemLabel}
        </span>
        <label className="flex items-center gap-2">
          <span>Rows per page</span>
          <select
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 outline-none transition focus:border-blue-400"
            value={rowsPerPage}
            onChange={(event) => onRowsPerPageChange(Number(event.target.value))}
          >
            {ROWS_PER_PAGE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          className="rounded-lg border border-slate-200 p-2 text-slate-400 transition hover:bg-white hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[72px] text-center text-xs font-semibold text-slate-600">
          Page {currentPage} of {totalPages}
        </span>
        <button
          type="button"
          className="rounded-lg border border-slate-200 p-2 text-slate-400 transition hover:bg-white hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function ResidentDetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5">{icon}</div>
      <div>
        <p className="text-[10px] font-bold uppercase text-slate-400">{label}</p>
        <p className="text-sm font-medium text-slate-700">{value}</p>
      </div>
    </div>
  );
}

function formatResidentPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return phone;
}

function getResidentInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function getResidentAvatarClass(resident: ResidentEntry, mobile = false) {
  const ownerClasses = mobile ? 'bg-blue-600 text-blue-100' : 'bg-slate-200 text-slate-600';
  const tenantPalette = ['bg-slate-500 text-slate-100', 'bg-blue-700 text-blue-100', 'bg-emerald-400 text-slate-900', 'bg-blue-200 text-blue-800'];
  if (resident.relation === 'OWNER') return ownerClasses;
  const index = resident.name.length % tenantPalette.length;
  return tenantPalette[index];
}

