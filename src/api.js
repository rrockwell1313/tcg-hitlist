import axios from 'axios';

const API_BASE_FALLBACK = 'https://api.gamershq.com/api';

function resolveApiBase() {
  const configured = import.meta.env.VITE_API_URL;
  return configured && !/localhost|127\.0\.0\.1/i.test(configured)
    ? configured
    : API_BASE_FALLBACK;
}

export const API_BASE = resolveApiBase();
const TOKEN_KEY = 'pt_token';
const REFRESH_TOKEN_KEY = 'pt_refreshToken';

const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use(config => {
  const token = getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearStoredAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export async function loginDashboardUser(username, password) {
  const res = await api.post('/auth/login', { username, password });
  const { token, refreshToken } = res.data || {};
  if (token) localStorage.setItem(TOKEN_KEY, token);
  if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  return res.data;
}

export async function getTcgHitList({ search, game, limit } = {}) {
  const res = await api.get('/trade-hitlist/display/tcg', {
    params: {
      search: search || undefined,
      game: game || undefined,
      limit: limit || undefined,
    },
  });
  return res.data;
}

export async function getTradeHitListItems({ source, search, game } = {}) {
  const res = await api.get('/trade-hitlist/', {
    params: {
      source: source || undefined,
      search: search || undefined,
      game: game || undefined,
    },
  });
  return res.data;
}

export async function syncTradeHitListItem(id) {
  const res = await api.post(`/trade-hitlist/${id}/sync`);
  return res.data;
}

export async function updateHitListImageUrl(id, imageUrl) {
  const res = await api.patch(`/trade-hitlist/${id}`, {
    imageUrl: imageUrl || '',
  });
  return res.data;
}
