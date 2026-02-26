import { defineStore } from 'pinia';
import axios from 'axios';
import { apiClient } from '../services/api';
import type { Entity, EntityPayload, EntityType, ProjectCanvasData } from '../types/entity';

const bufferedEntityPatches = new Map<string, Partial<Entity>>();
const bufferedEntityPatchTimers = new Map<string, ReturnType<typeof setTimeout>>();
const bufferedEntityPatchInFlight = new Set<string>();
const bufferedEntityPatchRetryCounts = new Map<string, number>();
const recentlyDeletedEntityIds = new Map<string, number>();

const RECENT_DELETE_TTL_MS = 15000;
const ENTITIES_FETCH_TIMEOUT_MS = 60000;
const ENTITY_UPDATE_TIMEOUT_MS = 60000;

const ENTITY_TYPES: EntityType[] = [
  'project',
  'connection',
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
  loadedTypes: Partial<Record<EntityType, boolean>>;
}

interface FetchEntitiesOptions {
  silent?: boolean;
  type?: EntityType;
  excludeType?: EntityType;
  merge?: boolean;
}

function createInitialLoadedTypeState(): Partial<Record<EntityType, boolean>> {
  return ENTITY_TYPES.reduce((acc, type) => {
    acc[type] = false;
    return acc;
  }, {} as Partial<Record<EntityType, boolean>>);
}

function mergeEntityPatch(base: Partial<Entity>, patch: Partial<Entity>): Partial<Entity> {
  const next: Partial<Entity> = { ...base };

  for (const key of Object.keys(patch) as Array<keyof Entity>) {
    const value = patch[key];
    if (value === undefined) {
      delete next[key];
      continue;
    }
    next[key] = value as never;
  }

  return next;
}

function markRecentlyDeleted(ids: Iterable<string>, ttlMs = RECENT_DELETE_TTL_MS) {
  const expiresAt = Date.now() + ttlMs;
  for (const id of ids) {
    if (!id) continue;
    recentlyDeletedEntityIds.set(id, expiresAt);
  }
}

function clearRecentlyDeleted(ids: Iterable<string>) {
  for (const id of ids) {
    if (!id) continue;
    recentlyDeletedEntityIds.delete(id);
  }
}

function cleanupExpiredRecentlyDeleted(now = Date.now()) {
  for (const [id, expiresAt] of recentlyDeletedEntityIds.entries()) {
    if (expiresAt <= now) {
      recentlyDeletedEntityIds.delete(id);
    }
  }
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
    loadedTypes: createInitialLoadedTypeState(),
  }),

  getters: {
    byType: (state) => (type: EntityType) => state.items.filter((item) => item.type === type),
    byId: (state) => (id: string) => state.items.find((item) => item._id === id),
    countByType: (state) => (type: EntityType) =>
      state.items.filter((item) => item.type === type).length,
  },

  actions: {
    clearBufferedPatchState(id: string) {
      const timer = bufferedEntityPatchTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        bufferedEntityPatchTimers.delete(id);
      }

      bufferedEntityPatches.delete(id);
      bufferedEntityPatchInFlight.delete(id);
      bufferedEntityPatchRetryCounts.delete(id);
    },

    applyLocalEntityPatch(id: string, payload: Partial<Entity>) {
      this.items = this.items.map((item) => {
        if (item._id !== id) return item;

        const next: Entity = { ...item };
        for (const key of Object.keys(payload) as Array<keyof Entity>) {
          const value = payload[key];
          if (value === undefined) {
            delete (next as Partial<Entity>)[key];
            continue;
          }
          next[key] = value as never;
        }

        return next;
      });
    },

    projectNodeEntityIds(project: Entity | undefined) {
      if (!project || project.type !== 'project') return [] as string[];

      const rawCanvas = project.canvas_data;
      if (!rawCanvas || typeof rawCanvas !== 'object' || Array.isArray(rawCanvas)) {
        return [] as string[];
      }

      const canvasData = rawCanvas as ProjectCanvasData;
      const nodes = Array.isArray(canvasData.nodes) ? canvasData.nodes : [];

      return Array.from(
        new Set(
          nodes
            .map((node) => (typeof node.entityId === 'string' ? node.entityId : ''))
            .filter((entityId) => entityId && entityId !== project._id),
        ),
      );
    },

    pruneRemovedEntitiesFromProjectCanvases(removedEntityIds: Set<string>) {
      if (!removedEntityIds.size) return;

      this.items = this.items.map((item) => {
        if (item.type !== 'project') return item;

        const rawCanvas = item.canvas_data;
        if (!rawCanvas || typeof rawCanvas !== 'object' || Array.isArray(rawCanvas)) {
          return item;
        }

        const canvasData = rawCanvas as ProjectCanvasData;
        const nodes = Array.isArray(canvasData.nodes) ? canvasData.nodes : [];
        const edges = Array.isArray(canvasData.edges) ? canvasData.edges : [];

        const removedNodeIds = new Set(
          nodes
            .filter((node) => removedEntityIds.has(node.entityId))
            .map((node) => node.id),
        );

        if (!removedNodeIds.size) {
          return item;
        }

        const nextNodes = nodes.filter((node) => !removedEntityIds.has(node.entityId));
        const nextEdges = edges.filter(
          (edge) => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target),
        );

        return {
          ...item,
          canvas_data: {
            ...canvasData,
            nodes: nextNodes,
            edges: nextEdges,
          },
        };
      });
    },

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

    async fetchEntities(options?: FetchEntitiesOptions) {
      const silent = options?.silent ?? false;
      const requestedType = options?.type;
      const excludedType = requestedType ? undefined : options?.excludeType;
      const merge = options?.merge ?? false;
      if (!silent) {
        this.loading = true;
      }
      this.error = null;

      try {
        const params: Record<string, string | number> = { _t: Date.now() };
        if (requestedType) {
          params.type = requestedType;
        } else if (excludedType) {
          params.excludeType = excludedType;
        }

        const { data } = await apiClient.get<Entity[]>('/entities', {
          params,
          timeout: ENTITIES_FETCH_TIMEOUT_MS,
        });

        cleanupExpiredRecentlyDeleted();
        const nextFetchedItems = data.filter((item) => !recentlyDeletedEntityIds.has(item._id));

        if (merge) {
          const merged = new Map(this.items.map((item) => [item._id, item] as const));
          for (const item of nextFetchedItems) {
            merged.set(item._id, item);
          }
          this.items = Array.from(merged.values());
        } else {
          this.items = nextFetchedItems;
        }

        if (requestedType) {
          this.loadedTypes[requestedType] = true;
        } else if (excludedType) {
          for (const type of ENTITY_TYPES) {
            this.loadedTypes[type] = type !== excludedType;
          }
        } else {
          for (const type of ENTITY_TYPES) {
            this.loadedTypes[type] = true;
          }
        }

        const existingIds = new Set(this.items.map((item) => item._id));
        const affectedTypes = requestedType
          ? [requestedType]
          : excludedType
            ? ENTITY_TYPES.filter((type) => type !== excludedType)
            : ENTITY_TYPES;
        for (const type of affectedTypes) {
          const lastCreatedId = this.lastCreatedIdByType[type];
          if (lastCreatedId && !existingIds.has(lastCreatedId)) {
            this.lastCreatedIdByType[type] = null;
          }
        }
      } catch (error: unknown) {
        this.error = this.formatApiError(error);
      } finally {
        if (!silent) {
          this.loading = false;
        }
      }
    },

    async bootstrap(options?: { deferConnection?: boolean }) {
      if (this.initialized) return;
      const deferConnection = options?.deferConnection ?? true;

      if (deferConnection) {
        await this.fetchEntities({ excludeType: 'connection' });
        this.initialized = true;
        if (!this.loadedTypes.connection) {
          void this.fetchEntities({
            silent: true,
            type: 'connection',
            merge: true,
          });
        }
        return;
      }

      await this.fetchEntities();

      this.initialized = true;
    },

    async fetchTypeIfNeeded(type: EntityType) {
      if (this.loadedTypes[type]) return;

      await this.fetchEntities({
        silent: true,
        type,
        merge: true,
      });
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

    queueEntityUpdate(id: string, payload: Partial<Entity>, options?: { delay?: number }) {
      const delay = options?.delay ?? 500;

      this.applyLocalEntityPatch(id, payload);

      const existing = bufferedEntityPatches.get(id) || {};
      bufferedEntityPatches.set(id, mergeEntityPatch(existing, payload));

      const currentTimer = bufferedEntityPatchTimers.get(id);
      if (currentTimer) {
        clearTimeout(currentTimer);
      }

      const nextTimer = setTimeout(() => {
        void this.flushQueuedEntityUpdate(id);
      }, delay);

      bufferedEntityPatchTimers.set(id, nextTimer);
    },

    async flushQueuedEntityUpdate(id: string) {
      const timer = bufferedEntityPatchTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        bufferedEntityPatchTimers.delete(id);
      }

      if (bufferedEntityPatchInFlight.has(id)) {
        return;
      }

      const payload = bufferedEntityPatches.get(id);
      if (!payload) return;

      bufferedEntityPatches.delete(id);
      bufferedEntityPatchInFlight.add(id);

      try {
        const { data } = await apiClient.put<Entity>(`/entities/${id}`, payload, {
          timeout: ENTITY_UPDATE_TIMEOUT_MS,
        });
        this.items = this.items.map((item) => (item._id === id ? data : item));
        bufferedEntityPatchRetryCounts.delete(id);
      } catch (error: unknown) {
        this.error = this.formatApiError(error);
        const current = bufferedEntityPatches.get(id) || {};
        bufferedEntityPatches.set(id, mergeEntityPatch(payload, current));
        const nextRetryCount = (bufferedEntityPatchRetryCounts.get(id) || 0) + 1;
        bufferedEntityPatchRetryCounts.set(id, nextRetryCount);
      } finally {
        bufferedEntityPatchInFlight.delete(id);

        if (bufferedEntityPatches.has(id)) {
          const retryCount = bufferedEntityPatchRetryCounts.get(id) || 0;
          const retryDelay = Math.min(5000, 300 * Math.max(1, retryCount));
          const retryTimer = setTimeout(() => {
            void this.flushQueuedEntityUpdate(id);
          }, retryDelay);
          bufferedEntityPatchTimers.set(id, retryTimer);
        }
      }
    },

    async flushAllQueuedUpdates() {
      const ids = Array.from(new Set([...bufferedEntityPatches.keys(), ...bufferedEntityPatchTimers.keys()]));

      for (const id of ids) {
        await this.flushQueuedEntityUpdate(id);
      }
    },

    async updateEntity(id: string, payload: Partial<Entity>) {
      this.clearBufferedPatchState(id);
      const { data } = await apiClient.put<Entity>(`/entities/${id}`, payload);
      this.items = this.items.map((item) => (item._id === id ? data : item));

      return data;
    },

    async deleteEntity(id: string) {
      const target = this.items.find((item) => item._id === id);
      const removedEntityIds = new Set<string>([id]);

      if (target?.type === 'project') {
        for (const nodeEntityId of this.projectNodeEntityIds(target)) {
          removedEntityIds.add(nodeEntityId);
        }
      }

      for (const removedEntityId of removedEntityIds) {
        this.clearBufferedPatchState(removedEntityId);
      }
      markRecentlyDeleted(removedEntityIds);

      this.items = this.items.filter((item) => !removedEntityIds.has(item._id));
      this.pruneRemovedEntitiesFromProjectCanvases(removedEntityIds);

      for (const type of ENTITY_TYPES) {
        const lastCreatedId = this.lastCreatedIdByType[type];
        if (lastCreatedId && removedEntityIds.has(lastCreatedId)) {
          this.lastCreatedIdByType[type] = null;
        }
      }

      try {
        await apiClient.delete(`/entities/${id}`);
      } catch (error: unknown) {
        clearRecentlyDeleted(removedEntityIds);
        this.error = this.formatApiError(error);
        void this.fetchEntities({ silent: true });
        throw error;
      }

      void this.fetchEntities({ silent: true });
    },
  },
});
