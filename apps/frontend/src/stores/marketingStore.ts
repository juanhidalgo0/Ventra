import { create } from 'zustand';
import api from '../services/api';

export interface MarketingGroupItem {
  id: string;
  marketingGroupId: string;
  productId: string;
  order: number;
  product: any; // We'll just use any for now, or import the Product type if it exists
}

export interface MarketingGroup {
  id: string;
  name: string;
  description: string | null;
  items: MarketingGroupItem[];
  createdAt: string;
}

interface MarketingState {
  groups: MarketingGroup[];
  isLoading: boolean;
  error: string | null;
  fetchGroups: () => Promise<void>;
  createGroup: (name: string, description: string | undefined, items: { productId: string; order?: number }[]) => Promise<void>;
  updateGroup: (id: string, name?: string, description?: string, items?: { productId: string; order?: number }[]) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
}

export const useMarketingStore = create<MarketingState>((set) => ({
  groups: [],
  isLoading: false,
  error: null,

  fetchGroups: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.get('/marketing');
      set({ groups: response.data, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  createGroup: async (name, description, items) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.post('/marketing', { name, description, items });
      set((state) => ({ groups: [response.data, ...state.groups], isLoading: false }));
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  updateGroup: async (id, name, description, items) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.patch(`/marketing/${id}`, { name, description, items });
      set((state) => ({
        groups: state.groups.map(g => g.id === id ? response.data : g),
        isLoading: false
      }));
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  deleteGroup: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await api.delete(`/marketing/${id}`);
      set((state) => ({
        groups: state.groups.filter(g => g.id !== id),
        isLoading: false
      }));
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  }
}));
