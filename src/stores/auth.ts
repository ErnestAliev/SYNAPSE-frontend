import { defineStore } from 'pinia';
import axios from 'axios';
import { apiClient } from '../services/api';
import { AUTH_SESSION_STORAGE_KEY } from '../constants/auth';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture: string;
  givenName: string;
  familyName: string;
  provider?: string;
  settings?: Record<string, unknown>;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  initialized: boolean;
  error: string | null;
  runtimeGoogleClientId: string;
  publicConfigLoaded: boolean;
  publicConfigLoading: boolean;
}

let bootstrapPromise: Promise<void> | null = null;

interface GoogleAuthResponse {
  user: AuthUser;
  sessionToken: string;
  expiresIn: number;
}

interface DevAuthPayload {
  name?: string;
  email?: string;
}

interface PublicAuthConfigResponse {
  googleClientId?: string;
}

const DEFAULT_GOOGLE_CLIENT_ID =
  '1045694315962-uh125p31np5gori1q6oga0geevpusatk.apps.googleusercontent.com';

function readStoredSessionToken() {
  if (typeof window === 'undefined') return '';
  try {
    const token = window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
    return typeof token === 'string' ? token.trim() : '';
  } catch {
    return '';
  }
}

function writeStoredSessionToken(token: string) {
  if (typeof window === 'undefined') return;
  try {
    if (token.trim()) {
      window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, token.trim());
      return;
    }

    window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
  } catch {
    // Ignore localStorage failures.
  }
}

function formatApiError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const responseMessage =
      (error.response?.data as { message?: string } | undefined)?.message || error.message;

    if (status) {
      return `${responseMessage} (HTTP ${status})`;
    }

    return responseMessage;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Authentication request failed';
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: null,
    loading: false,
    initialized: false,
    error: null,
    runtimeGoogleClientId: '',
    publicConfigLoaded: false,
    publicConfigLoading: false,
  }),

  getters: {
    isAuthenticated: (state) => Boolean(state.user),
    googleClientId: (state) => {
      const fromBuildEnv = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
      return fromBuildEnv || state.runtimeGoogleClientId || DEFAULT_GOOGLE_CLIENT_ID;
    },
  },

  actions: {
    async loadPublicConfig(options?: { force?: boolean }) {
      const force = options?.force === true;
      if (this.publicConfigLoading) return;
      if (this.publicConfigLoaded && !force) return;

      this.publicConfigLoading = true;

      try {
        const { data } = await apiClient.get<PublicAuthConfigResponse>('/auth/config');
        this.runtimeGoogleClientId =
          typeof data.googleClientId === 'string' ? data.googleClientId.trim() : '';
      } catch {
        this.runtimeGoogleClientId = '';
      } finally {
        this.publicConfigLoaded = true;
        this.publicConfigLoading = false;
      }
    },

    clearLocalSession() {
      writeStoredSessionToken('');
    },

    async bootstrap() {
      if (this.initialized) return;
      if (bootstrapPromise) {
        await bootstrapPromise;
        return;
      }

      bootstrapPromise = (async () => {
        await this.loadPublicConfig();

        const token = readStoredSessionToken();
        if (!token) {
          this.initialized = true;
          return;
        }

        this.loading = true;
        this.error = null;

        try {
          const { data } = await apiClient.get<{ user: AuthUser }>('/auth/me');
          this.user = data.user;
        } catch (error: unknown) {
          this.user = null;
          this.clearLocalSession();
          this.error = formatApiError(error);
        } finally {
          this.loading = false;
          this.initialized = true;
        }
      })();

      try {
        await bootstrapPromise;
      } finally {
        bootstrapPromise = null;
      }
    },

    async signInWithGoogleCredential(credential: string) {
      const normalizedCredential = credential.trim();
      if (!normalizedCredential) {
        throw new Error('Google credential is required');
      }

      this.loading = true;
      this.error = null;

      try {
        const { data } = await apiClient.post<GoogleAuthResponse>('/auth/google', {
          credential: normalizedCredential,
        });
        this.user = data.user;
        writeStoredSessionToken(data.sessionToken || '');
        return data.user;
      } catch (error: unknown) {
        this.user = null;
        this.clearLocalSession();
        this.error = formatApiError(error);
        throw error;
      } finally {
        this.loading = false;
        this.initialized = true;
      }
    },

    async signOut() {
      this.loading = true;
      this.error = null;

      try {
        await apiClient.post('/auth/logout');
      } catch (error: unknown) {
        this.error = formatApiError(error);
      } finally {
        this.user = null;
        this.clearLocalSession();
        this.loading = false;
        this.initialized = true;
      }
    },

    async signInAsDev(payload?: DevAuthPayload) {
      this.loading = true;
      this.error = null;

      try {
        const { data } = await apiClient.post<GoogleAuthResponse>('/auth/dev-login', {
          name: payload?.name || 'Local Developer',
          email: payload?.email || 'local.dev@synapse12.local',
        });
        this.user = data.user;
        writeStoredSessionToken(data.sessionToken || '');
        return data.user;
      } catch (error: unknown) {
        this.user = null;
        this.clearLocalSession();
        this.error = formatApiError(error);
        throw error;
      } finally {
        this.loading = false;
        this.initialized = true;
      }
    },
  },
});
