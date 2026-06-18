import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import type { Flat, Block } from '../types';
import type { PremiumStatusResponse } from '../types/flats';

// ─── QUERIES ────────────────────────────────────────────

export function useFlats() {
  return useQuery<Flat[]>({
    queryKey: ['flats'],
    queryFn: async () => (await api.get('/flats/flats')).data,
  });
}

export function useBlocks() {
  return useQuery<Block[]>({
    queryKey: ['blocks'],
    queryFn: async () => (await api.get('/flats/blocks')).data,
  });
}

export function useSocieties() {
  return useQuery<{ id: string; name: string }[]>({
    queryKey: ['societies'],
    queryFn: async () => (await api.get('/flats/societies')).data,
  });
}

export function usePremiumStatus() {
  return useQuery<PremiumStatusResponse>({
    queryKey: ['premium-status'],
    queryFn: async () => (await api.get('/premium/status')).data,
  });
}

// ─── MUTATIONS ──────────────────────────────────────────

export function useCreateBlockMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post('/flats/blocks', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blocks'] });
    },
  });
}

export function useUpdateBlockMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ blockId, ...data }: { blockId: string; [key: string]: any }) => api.put(`/flats/blocks/${blockId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blocks'] });
      queryClient.invalidateQueries({ queryKey: ['flats'] });
    },
  });
}

export function useDeleteFlatMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, confirmation }: { id: string; confirmation: string }) =>
      api.delete(`/flats/flats/${id}`, { data: { confirmation } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flats'] });
      queryClient.invalidateQueries({ queryKey: ['blocks'] });
    },
  });
}

export function useCreateFlatMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post('/flats/flats', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flats'] });
      queryClient.invalidateQueries({ queryKey: ['blocks'] });
    },
  });
}

export function useUpdateFlatMutation(flatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.put(`/flats/flats/${flatId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flats'] });
      queryClient.invalidateQueries({ queryKey: ['blocks'] });
    },
  });
}

export function useCreateOwnerMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post('/flats/owners', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flats'] });
    },
  });
}

export function useUpdateOwnerMutation(ownerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.put(`/flats/owners/${ownerId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flats'] });
    },
  });
}

export function useDeactivateOwnerMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ownerId, reason }: { ownerId: string; reason: string }) =>
      api.delete(`/flats/owners/${ownerId}`, { data: { reason } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flats'] });
    },
  });
}

export function useAssignMyFlatMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (flatId: string) => api.post(`/flats/flats/${flatId}/assign-me`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flats'] });
      queryClient.invalidateQueries({ queryKey: ['my-flat'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['my-dashboard'] });
    },
  });
}

export function useUnmapMyFlatMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (flatId: string) => api.delete(`/flats/flats/${flatId}/assign-me`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flats'] });
      queryClient.invalidateQueries({ queryKey: ['my-flat'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['my-dashboard'] });
    },
  });
}

export function useCreateTenantMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post('/flats/tenants', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flats'] });
    },
  });
}

export function useUpdateTenantMutation(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.put(`/flats/tenants/${tenantId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flats'] });
    },
  });
}

export function useRemoveTenantMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tenantId, reason }: { tenantId: string; reason: string }) =>
      api.delete(`/flats/tenants/${tenantId}`, { data: { reason } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flats'] });
    },
  });
}
