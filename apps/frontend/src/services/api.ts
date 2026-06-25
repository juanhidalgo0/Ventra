import axios from 'axios';

const getBaseUrl = () => {
  const connectionMode = localStorage.getItem('connection_mode') || 'LOCAL';
  const savedIp = localStorage.getItem('server_ip');
  const activePort = sessionStorage.getItem('active_backend_port') || '3001';
  if (savedIp && savedIp !== 'localhost' && savedIp !== '127.0.0.1') {
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
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
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
  },
);

export default api;
