import { defineStore } from 'pinia';
import axios from 'axios';
import { apiClient } from '../services/api';
import { AUTH_SESSION_STORAGE_KEY } from '../constants/auth';
import type { Entity, EntityPayload, EntityType, ProjectCanvasData } from '../types/entity';

const bufferedEntityPatches = new Map<string, Partial<Entity>>();
const bufferedEntityPatchTimers = new Map<string, ReturnType<typeof setTimeout>>();
const bufferedEntityPatchInFlight = new Set<string>();
const bufferedEntityPatchRetryCounts = new Map<string, number>();
const recentlyDeletedEntityIds = new Map<string, number>();
let realtimeEventSource: EventSource | null = null;
let realtimeReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let realtimeReconnectAttempt = 0;
let realtimeShouldReconnect = false;
let entitiesBootstrapPromise: Promise<void> | null = null;
const entitiesFetchInFlight = new Map<string, Promise<void>>();

const RECENT_DELETE_TTL_MS = 15000;
const ENTITIES_FETCH_TIMEOUT_MS = 120000;
const ENTITY_UPDATE_TIMEOUT_MS = 60000;
const REALTIME_RETRY_BASE_MS = 1000;
const REALTIME_RETRY_MAX_MS = 30000;

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
  aiAnalyzePendingById: Record<string, boolean>;
}

interface FetchEntitiesOptions {
  silent?: boolean;
  type?: EntityType;
  excludeType?: EntityType;
  merge?: boolean;
}

interface SetPersonAsMeResponse {
  entity?: Entity;
  entities?: Entity[];
  clearedPersonIds?: string[];
}

function createInitialLoadedTypeState(): Partial<Record<EntityType, boolean>> {
  return ENTITY_TYPES.reduce((acc, type) => {
    acc[type] = false;
    return acc;
  }, {} as Partial<Record<EntityType, boolean>>);
}

function normalizeAiPendingFlag(entity: Entity) {
  const metadata = (entity as { ai_metadata?: unknown }).ai_metadata as Record<string, unknown> | undefined;
  if (!metadata || typeof metadata !== 'object') return false;
  return Boolean((metadata as Record<string, unknown>).analysis_pending);
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

function normalizeEntityId(value: unknown) {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (value && typeof value === 'object') {
    const candidate = String(value).trim();
    if (candidate && candidate !== '[object Object]') {
      return candidate;
    }
  }

  return '';
}

function normalizeEntityForStore(entity: Entity | null | undefined): Entity | null {
  if (!entity || typeof entity !== 'object') {
    return null;
  }

  const nextId = normalizeEntityId((entity as { _id?: unknown })._id);
  if (!nextId) {
    return null;
  }

  return {
    ...entity,
    _id: nextId,
  };
}

function dedupeEntitiesById(items: Entity[]) {
  const seen = new Set<string>();
  const result: Entity[] = [];

  for (const row of items) {
    const normalized = normalizeEntityForStore(row);
    if (!normalized) continue;
    if (seen.has(normalized._id)) continue;
    seen.add(normalized._id);
    result.push(normalized);
  }

  return result;
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

function readRealtimeSessionToken() {
  if (typeof window === 'undefined') return '';
  try {
    const token = window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
    return typeof token === 'string' ? token.trim() : '';
  } catch {
    return '';
  }
}

function resolveRealtimeEventsUrl(sessionToken: string) {
  if (typeof window === 'undefined') return '';

  const rawApiBase = String(import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api')
    .trim()
    .replace(/\/+$/, '');
  if (!rawApiBase) return '';

  let url: URL;
  try {
    if (rawApiBase.startsWith('http://') || rawApiBase.startsWith('https://')) {
      url = new URL(`${rawApiBase}/events`);
    } else {
      url = new URL(`${rawApiBase}/events`, window.location.origin);
    }
  } catch {
    return '';
  }

  if (sessionToken) {
    url.searchParams.set('sessionToken', sessionToken);
  }

  return url.toString();
}

/**
 * FIX A — 3-way version comparison for SSE upserts.
 *
 * Returns:
 *   'newer'           — incoming is strictly newer than existing  → replace
 *   'equal_or_unknown'— versions are equal or no version field    → merge
 *   'older'           — incoming is strictly older               → skip
 *
 * Comparison order:
 *   1. updatedAt / updated_at (ISO string lexicographic compare)
 *   2. __v / version / rev (numeric compare)
 *   3. Neither field present → 'equal_or_unknown'
 */
function compareEntityVersion(
  incoming: Entity,
  existing: Entity,
): 'newer' | 'equal_or_unknown' | 'older' {
  const inc = incoming as unknown as Record<string, unknown>;
  const ext = existing as unknown as Record<string, unknown>;

  // 1. ISO date fields
  const inDate = (inc.updatedAt || inc.updated_at) as string | undefined;
  const exDate = (ext.updatedAt || ext.updated_at) as string | undefined;
  if (typeof inDate === 'string' && typeof exDate === 'string') {
    if (inDate > exDate) return 'newer';
    if (inDate < exDate) return 'older';
    return 'equal_or_unknown';
  }

  // 2. Numeric version fields
  const inVer = (inc.__v ?? inc.version ?? inc.rev) as number | undefined;
  const exVer = (ext.__v ?? ext.version ?? ext.rev) as number | undefined;
  if (typeof inVer === 'number' && typeof exVer === 'number') {
    if (inVer > exVer) return 'newer';
    if (inVer < exVer) return 'older';
    return 'equal_or_unknown';
  }

  // 3. No comparable version info
  return 'equal_or_unknown';
}

function parseEntityEventPayload(rawData: string): Record<string, unknown> | null {
  if (!rawData) return null;
  try {
    const parsed = JSON.parse(rawData);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
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
    aiAnalyzePendingById: {},
  }),

  getters: {
    byType: (state) => (type: EntityType) => state.items.filter((item) => item.type === type),
    byId: (state) => (id: string) => state.items.find((item) => item._id === id),
    countByType: (state) => (type: EntityType) =>
      state.items.filter((item) => item.type === type).length,
    isEntityAiPending: (state) => (id: string) => Boolean(state.aiAnalyzePendingById[id]),
  },

  actions: {
    hasPendingEntityUpdate(id: string) {
      const normalizedId = String(id || '').trim();
      if (!normalizedId) return false;

      return (
        bufferedEntityPatches.has(normalizedId) ||
        bufferedEntityPatchTimers.has(normalizedId) ||
        bufferedEntityPatchInFlight.has(normalizedId)
      );
    },

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

    setEntityAiPending(id: string, pending: boolean) {
      const normalizedId = normalizeEntityId(id);
      if (!normalizedId) return;
      if (pending) {
        this.aiAnalyzePendingById[normalizedId] = true;
      } else {
        delete this.aiAnalyzePendingById[normalizedId];
      }
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

    scheduleRealtimeReconnect() {
      if (!realtimeShouldReconnect) return;
      if (realtimeReconnectTimer) return;

      const attempt = realtimeReconnectAttempt;
      const delay = Math.min(REALTIME_RETRY_MAX_MS, REALTIME_RETRY_BASE_MS * 2 ** Math.min(attempt, 5));
      realtimeReconnectAttempt += 1;

      realtimeReconnectTimer = setTimeout(() => {
        realtimeReconnectTimer = null;
        this.startRealtimeSync();
      }, delay);
    },

    stopRealtimeSync() {
      realtimeShouldReconnect = false;
      realtimeReconnectAttempt = 0;

      if (realtimeReconnectTimer) {
        clearTimeout(realtimeReconnectTimer);
        realtimeReconnectTimer = null;
      }

      if (realtimeEventSource) {
        realtimeEventSource.close();
        realtimeEventSource = null;
      }
    },

    upsertEntityFromRealtime(entity: Entity, options?: { flash?: boolean }) {
      const normalizedEntity = normalizeEntityForStore(entity);
      if (!normalizedEntity) return;

      cleanupExpiredRecentlyDeleted();
      clearRecentlyDeleted([normalizedEntity._id]);
      this.setEntityAiPending(normalizedEntity._id, normalizeAiPendingFlag(normalizedEntity));

      const nextItems = [...this.items];
      const existingIndex = nextItems.findIndex(
        (item) => normalizeEntityId(item._id) === normalizedEntity._id,
      );
      let inserted = false;
      if (existingIndex >= 0) {
        const existing = nextItems[existingIndex]!;
        const rel = compareEntityVersion(normalizedEntity, existing);
        if (rel === 'older') {
          // Strictly older snapshot — skip to protect active local state.
          return;
        }
        if (rel === 'equal_or_unknown') {
          // FIX A: Equal/unknown version — shallow-merge to pick up new server
          // fields without overwriting anything already held locally.
          nextItems[existingIndex] = { ...existing, ...normalizedEntity };
        } else {
          // 'newer' — straightforward replace.
          nextItems[existingIndex] = normalizedEntity;
        }
      } else {
        nextItems.unshift(normalizedEntity);
        this.lastCreatedIdByType[normalizedEntity.type] = normalizedEntity._id;
        inserted = true;
      }

      this.items = dedupeEntitiesById(nextItems);

      if (options?.flash && inserted) {
        this.triggerFlash(normalizedEntity.type);
      }
    },

    applyRealtimeEntityDelete(entityIds: string[]) {
      const normalizedIds = Array.from(
        new Set(
          (Array.isArray(entityIds) ? entityIds : [])
            .map((id) => (typeof id === 'string' ? id.trim() : ''))
            .filter(Boolean),
        ),
      );
      if (!normalizedIds.length) return;

      const removedEntityIds = new Set(normalizedIds);
      for (const removedEntityId of removedEntityIds) {
        this.clearBufferedPatchState(removedEntityId);
        this.setEntityAiPending(removedEntityId, false);
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
    },

    handleRealtimeEntityEvent(eventType: string, rawData: string) {
      const payload = parseEntityEventPayload(rawData);
      if (!payload) return;

      if (eventType === 'entity.created') {
        const entity = payload.entity as Entity | undefined;
        if (!entity?._id) return;
        this.upsertEntityFromRealtime(entity, { flash: true });
        return;
      }

      if (eventType === 'entity.updated') {
        const entity = payload.entity as Entity | undefined;
        if (!entity?._id) return;
        this.upsertEntityFromRealtime(entity);
        return;
      }

      if (eventType === 'entity.deleted') {
        const entityIds = payload.entityIds as string[] | undefined;
        this.applyRealtimeEntityDelete(Array.isArray(entityIds) ? entityIds : []);
      }
    },

    startRealtimeSync() {
      if (typeof window === 'undefined') return;
      if (typeof EventSource === 'undefined') return;

      realtimeShouldReconnect = true;
      const sessionToken = readRealtimeSessionToken();
      if (!sessionToken) {
        this.stopRealtimeSync();
        return;
      }

      const eventsUrl = resolveRealtimeEventsUrl(sessionToken);
      if (!eventsUrl) {
        this.error = 'Realtime channel URL is invalid';
        return;
      }

      if (realtimeReconnectTimer) {
        clearTimeout(realtimeReconnectTimer);
        realtimeReconnectTimer = null;
      }

      if (realtimeEventSource) {
        return;
      }

      const source = new EventSource(eventsUrl, { withCredentials: true });
      realtimeEventSource = source;

      source.onopen = () => {
        realtimeReconnectAttempt = 0;
      };

      source.addEventListener('entity.created', (event: MessageEvent<string>) => {
        this.handleRealtimeEntityEvent('entity.created', event.data);
      });

      source.addEventListener('entity.updated', (event: MessageEvent<string>) => {
        this.handleRealtimeEntityEvent('entity.updated', event.data);
      });

      source.addEventListener('entity.deleted', (event: MessageEvent<string>) => {
        this.handleRealtimeEntityEvent('entity.deleted', event.data);
      });

      source.onerror = () => {
        if (realtimeEventSource) {
          realtimeEventSource.close();
          realtimeEventSource = null;
        }
        this.scheduleRealtimeReconnect();
      };
    },

    async fetchEntities(options?: FetchEntitiesOptions) {
      const silent = options?.silent ?? false;
      const requestedType = options?.type;
      const excludedType = requestedType ? undefined : options?.excludeType;
      const merge = options?.merge ?? false;
      const requestKey = requestedType ? `type:${requestedType}` : excludedType ? `exclude:${excludedType}` : 'all';
      const existingRequest = entitiesFetchInFlight.get(requestKey);
      if (existingRequest) {
        await existingRequest;
        return;
      }

      const requestPromise = (async () => {
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
          const nextFetchedItems = dedupeEntitiesById(data).filter(
            (item) => !recentlyDeletedEntityIds.has(item._id),
          );

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
      })();

      entitiesFetchInFlight.set(requestKey, requestPromise);
      try {
        await requestPromise;
      } finally {
        if (entitiesFetchInFlight.get(requestKey) === requestPromise) {
          entitiesFetchInFlight.delete(requestKey);
        }
      }
    },

    async bootstrap(options?: { deferConnection?: boolean }) {
      if (this.initialized) {
        this.startRealtimeSync();
        return;
      }
      if (entitiesBootstrapPromise) {
        await entitiesBootstrapPromise;
        return;
      }
      const deferConnection = options?.deferConnection ?? true;
      entitiesBootstrapPromise = (async () => {
        if (deferConnection) {
          await this.fetchEntities({ excludeType: 'connection' });
          this.initialized = true;
          this.startRealtimeSync();
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
        this.startRealtimeSync();
      })();
      try {
        await entitiesBootstrapPromise;
      } finally {
        entitiesBootstrapPromise = null;
      }
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

      // Avoid duplicate cards when realtime `entity.created` arrives before the POST response.
      this.upsertEntityFromRealtime(data, { flash });

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

    async setPersonAsMe(id: string) {
      const normalizedId = String(id || '').trim();
      if (!normalizedId) {
        throw new Error('Entity id is required');
      }

      this.clearBufferedPatchState(normalizedId);
      const { data } = await apiClient.post<SetPersonAsMeResponse>(`/entities/${normalizedId}/set-me`, {});
      const updatedEntities = Array.isArray(data?.entities)
        ? data.entities.filter((item): item is Entity => Boolean(item?._id))
        : [];

      if (updatedEntities.length) {
        const map = new Map(this.items.map((item) => [item._id, item] as const));
        for (const entity of updatedEntities) {
          map.set(entity._id, entity);
        }
        this.items = Array.from(map.values());
      } else if (data?.entity?._id) {
        this.items = this.items.map((item) => (item._id === data.entity!._id ? data.entity! : item));
      }

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
    },
  },
});
