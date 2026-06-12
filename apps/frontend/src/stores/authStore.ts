import { create } from 'zustand';
import api from '../services/api';
import { wsService } from '../services/websocket';

interface User { id: string; username: string; fullName: string; role: string; avatarUrl?: string; }

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => void;
  autoLoginAdmin: () => Promise<void>;
  resetAdminUnlock: () => void;
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  isAuthenticated: !!localStorage.getItem('accessToken'),
  isLoading: false,

  login: async (username, password) => {
    set({ isLoading: true });
    try {
      const { data } = await api.post('/auth/login', { username, password });
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('user', JSON.stringify(data.user));
      set({ user: data.user, isAuthenticated: true, isLoading: false });
      wsService.connect();
    } catch (error: any) {
      set({ isLoading: false });
      throw new Error(error.response?.data?.message || 'Error al iniciar sesión');
    }
  },

  loginWithGoogle: async (idToken) => {
    set({ isLoading: true });
    try {
      const { data } = await api.post('/auth/google', { idToken });
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('user', JSON.stringify(data.user));
      set({ user: data.user, isAuthenticated: true, isLoading: false });
      wsService.connect();
    } catch (error: any) {
      set({ isLoading: false });
      throw new Error(error.response?.data?.message || 'Error al iniciar sesión con Google');
    }
  },

  logout: () => {
    // Clear admin unlock flag on logout
    sessionStorage.removeItem('admin_unlocked');
    // Also clear stored admin password (optional security)
    localStorage.removeItem('admin_password');
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    sessionStorage.removeItem('admin_unlocked');
    wsService.disconnect();
    set({ user: null, isAuthenticated: false });
    set({ user: null, isAuthenticated: false });
  },

  checkAuth: () => {
    const token = localStorage.getItem('accessToken');
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    if (token && user) { set({ user, isAuthenticated: true }); wsService.connect(); }
  },
  // Clear accessToken to ensure credentials are requested on every fresh app run
  autoLoginAdmin: async () => {
    // Disabled to always prompt for credentials (username/password) on app startup
  },
  // Reset admin unlock flag after password change
  resetAdminUnlock: () => {
    sessionStorage.setItem('admin_unlocked', 'true');
  },
  setUser: (user) => {
    localStorage.setItem('user', JSON.stringify(user));
    set({ user });
  }
}));
