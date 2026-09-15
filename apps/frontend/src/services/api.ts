import axios from 'axios';

const getBaseUrl = () => {
  const savedIp = localStorage.getItem('server_ip');
  const activePort = sessionStorage.getItem('active_backend_port') || '3001';
  // A saved server_ip that IS this page's own host means we're deployed on a
  // real domain and already talking to the right server — no LAN IP or extra
  // port involved, so keep it relative (same origin, same HTTPS). Only an ip
  // pointing at a DIFFERENT machine (an actual LAN "Conectar Cliente" setup)
  // needs the explicit http://ip:3001 form.
  if (savedIp && savedIp !== 'localhost' && savedIp !== '127.0.0.1' && savedIp !== window.location.host && savedIp !== window.location.hostname) {
    const hasPort = savedIp.includes(':');
    return `http://${savedIp}${hasPort ? '' : ':3001'}/api`;
  }
  if (window.location.protocol === 'file:' || window.location.protocol.startsWith('tauri') || window.location.hostname.includes('tauri')) {
    return `http://127.0.0.1:${activePort}/api`;
  }
  return '/api'; // Default proxy
};

const api = axios.create({ 
  baseURL: getBaseUrl(), 
  timeout: 60000, // 60 seconds
});

api.interceptors.request.use((config) => {
  // Dynamically update baseURL in case it changed in localStorage
  config.baseURL = getBaseUrl();
  
  // Use admin token if admin mode is unlocked and an admin token exists
  const isAdminUnlocked = sessionStorage.getItem('admin_unlocked') === 'true';
  const adminToken = sessionStorage.getItem('adminAccessToken');
  const token = (isAdminUnlocked && adminToken) ? adminToken : localStorage.getItem('accessToken');
  
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      
      const isAdminUnlocked = sessionStorage.getItem('admin_unlocked') === 'true';
      const adminRefreshToken = sessionStorage.getItem('adminRefreshToken');
      
      if (isAdminUnlocked && adminRefreshToken) {
        try {
          const { data } = await axios.post(`${getBaseUrl()}/auth/refresh`, { refreshToken: adminRefreshToken });
          sessionStorage.setItem('adminAccessToken', data.accessToken);
          sessionStorage.setItem('adminRefreshToken', data.refreshToken);
          originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
          return api(originalRequest);
        } catch {
          // If refresh fails, lock admin mode
          sessionStorage.removeItem('admin_unlocked');
          sessionStorage.removeItem('adminAccessToken');
          sessionStorage.removeItem('adminRefreshToken');
        }
      }
      
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) {
        try {
          const { data } = await axios.post(`${getBaseUrl()}/auth/refresh`, { refreshToken });
          localStorage.setItem('accessToken', data.accessToken);
          localStorage.setItem('refreshToken', data.refreshToken);
          originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
          return api(originalRequest);
        } catch {
          import('../stores/authStore').then(({ useAuthStore }) => {
            useAuthStore.getState().logout();
          }).catch(() => {
            localStorage.clear();
          }).finally(() => {
            window.location.hash = '#/login';
          });
        }
      } else {
        import('../stores/authStore').then(({ useAuthStore }) => {
          useAuthStore.getState().logout();
        }).catch(() => {
          localStorage.clear();
        }).finally(() => {
          window.location.hash = '#/login';
        });
      }
    }
    return Promise.reject(error);
  }
);

export default api;
