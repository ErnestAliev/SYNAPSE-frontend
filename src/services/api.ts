import axios from 'axios';
import { AUTH_SESSION_STORAGE_KEY } from '../constants/auth';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

function readSessionToken() {
  if (typeof window === 'undefined') return '';
  try {
    const token = window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
    return typeof token === 'string' ? token.trim() : '';
  } catch {
    return '';
  }
}

export const apiClient = axios.create({
  baseURL: apiBaseUrl,
  timeout: 30000,
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  const token = readSessionToken();
  if (!token) return config;

  const headers = config.headers ?? {};
  const hasAuthorizationHeader =
    typeof headers.Authorization === 'string' && headers.Authorization.trim().length > 0;
  if (!hasAuthorizationHeader) {
    headers.Authorization = `Bearer ${token}`;
  }

  config.headers = headers;
  return config;
});
