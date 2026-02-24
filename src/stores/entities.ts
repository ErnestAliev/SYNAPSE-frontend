import { defineStore } from 'pinia';
import axios from 'axios';
import { apiClient } from '../services/api';
import type { Entity, EntityPayload, EntityType } from '../types/entity';

const ENTITY_TYPES: EntityType[] = [
  'project',
  'person',
  'company',
  'event',
  'resource',
  'goal',
  'result',
  'task',
  'shape',
];

function createInitialFlashState(): Partial<Record<EntityType, number | null>> {
  return ENTITY_TYPES.reduce((acc, type) => {
    acc[type] = null;
    return acc;
  }, {} as Partial<Record<EntityType, number | null>>);
}

interface EntitiesState {
  items: Entity[];
  loading: boolean;
  error: string | null;
  initialized: boolean;
  flashStates: Partial<Record<EntityType, number | null>>;
  lastCreatedIdByType: Partial<Record<EntityType, string | null>>;
}

export const useEntitiesStore = defineStore('entities', {
  state: (): EntitiesState => ({
    items: [],
    loading: false,
    error: null,
    initialized: false,
    flashStates: createInitialFlashState(),
    lastCreatedIdByType: ENTITY_TYPES.reduce((acc, type) => {
      acc[type] = null;
      return acc;
    }, {} as Partial<Record<EntityType, string | null>>),
  }),

  getters: {
    byType: (state) => (type: EntityType) => state.items.filter((item) => item.type === type),
    byId: (state) => (id: string) => state.items.find((item) => item._id === id),
    countByType: (state) => (type: EntityType) =>
      state.items.filter((item) => item.type === type).length,
  },

  actions: {
    formatApiError(error: unknown) {
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

      return 'Failed to load entities';
    },

    async fetchEntities() {
      this.loading = true;
      this.error = null;

      try {
        const { data } = await apiClient.get<Entity[]>('/entities');

        this.items = data;

        const existingIds = new Set(data.map((item) => item._id));
        for (const type of ENTITY_TYPES) {
          const lastCreatedId = this.lastCreatedIdByType[type];
          if (lastCreatedId && !existingIds.has(lastCreatedId)) {
            this.lastCreatedIdByType[type] = null;
          }
        }
      } catch (error: unknown) {
        this.error = this.formatApiError(error);
      } finally {
        this.loading = false;
      }
    },

    async bootstrap() {
      if (this.initialized) return;

      await this.fetchEntities();

      this.initialized = true;
    },

    triggerFlash(type: EntityType) {
      this.flashStates[type] = Date.now();

      setTimeout(() => {
        this.flashStates[type] = null;
      }, 900);
    },

    async createEntity(payload: EntityPayload, options?: { flash?: boolean }) {
      const flash = options?.flash ?? true;
      const { data } = await apiClient.post<Entity>('/entities', payload);

      this.items.unshift(data);
      this.lastCreatedIdByType[data.type] = data._id;

      if (flash) {
        this.triggerFlash(data.type);
      }

      return data;
    },

    async updateEntity(id: string, payload: Partial<Entity>) {
      const { data } = await apiClient.put<Entity>(`/entities/${id}`, payload);
      this.items = this.items.map((item) => (item._id === id ? data : item));

      return data;
    },

    async deleteEntity(id: string) {
      await apiClient.delete(`/entities/${id}`);
      this.items = this.items.filter((item) => item._id !== id);

      for (const type of ENTITY_TYPES) {
        if (this.lastCreatedIdByType[type] === id) {
          this.lastCreatedIdByType[type] = null;
        }
      }
    },
  },
});
