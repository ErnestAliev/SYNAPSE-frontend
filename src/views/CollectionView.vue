<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import axios from 'axios';
import { useRouter } from 'vue-router';
import { useEntitiesStore } from '../stores/entities';
import { useAuthStore } from '../stores/auth';
import { apiClient } from '../services/api';
import AppIcon from '../components/ui/AppIcon.vue';
import FilterDropdown from '../components/ui/FilterDropdown.vue';
import ProfileProgressRing from '../components/ui/ProfileProgressRing.vue';
import EntityInfoModal from '../components/entity/EntityInfoModal.vue';
import type { Entity, EntityType } from '../types/entity';
import { calculateEntityProfileProgress } from '../utils/profileProgress';

const props = defineProps<{
  type?: string;
}>();

const entitiesStore = useEntitiesStore();
const authStore = useAuthStore();
const router = useRouter();

type MetadataFieldKey =
  | 'tags'
  | 'markers'
  | 'phones'
  | 'skills'
  | 'importance'
  | 'links'
  | 'roles'
  | 'interests'
  | 'industry'
  | 'departments'
  | 'stage'
  | 'risks'
  | 'date'
  | 'location'
  | 'participants'
  | 'outcomes'
  | 'resources'
  | 'priority'
  | 'status'
  | 'owners'
  | 'metrics';

interface MetadataFieldConfig {
  key: MetadataFieldKey;
  label: string;
}

type QuickFilterKey = 'onlyWithPhoto' | 'onlyNameOnly' | 'hideWithoutPhoto' | 'hideWithoutName' | 'onlyMine';

interface QuickEntityFilters {
  onlyWithPhoto: boolean;
  onlyNameOnly: boolean;
  hideWithoutPhoto: boolean;
  hideWithoutName: boolean;
  onlyMine: boolean;
}

interface StoredCollectionFilterState {
  selectedFieldFilters?: Record<string, string[]>;
  quickFilters?: Partial<QuickEntityFilters>;
}

const QUICK_FILTER_ITEMS: ReadonlyArray<{ key: QuickFilterKey; label: string }> = [
  { key: 'onlyWithPhoto', label: 'Только с фото' },
  { key: 'onlyNameOnly', label: 'Только Имя' },
  { key: 'hideWithoutPhoto', label: 'Скрыть без фото' },
  { key: 'hideWithoutName', label: 'Скрыть без имени' },
  { key: 'onlyMine', label: 'Только моё' },
];

const IMPORTANCE_VALUE_MAP: Record<string, string> = {
  низкая: 'Низкая',
  low: 'Низкая',
  l: 'Низкая',
  средняя: 'Средняя',
  medium: 'Средняя',
  med: 'Средняя',
  m: 'Средняя',
  высокая: 'Высокая',
  high: 'Высокая',
  h: 'Высокая',
  critical: 'Высокая',
  критично: 'Высокая',
  критическая: 'Высокая',
};

const ENTITY_FILTER_FIELDS: Record<EntityType, MetadataFieldConfig[]> = {
  connection: [
    { key: 'tags', label: 'Теги' },
    { key: 'markers', label: 'Метки' },
    { key: 'phones', label: 'Телефоны' },
    { key: 'links', label: 'Ссылки' },
    { key: 'roles', label: 'Роли' },
    { key: 'status', label: 'Статусы' },
  ],
  person: [
    { key: 'tags', label: 'Теги' },
    { key: 'markers', label: 'Метки' },
    { key: 'skills', label: 'Навыки' },
    { key: 'importance', label: 'Значимость' },
    { key: 'links', label: 'Ссылки' },
    { key: 'roles', label: 'Роли' },
  ],
  company: [
    { key: 'tags', label: 'Теги' },
    { key: 'markers', label: 'Метки' },
    { key: 'industry', label: 'Отрасли' },
    { key: 'departments', label: 'Отделы' },
    { key: 'stage', label: 'Стадии' },
    { key: 'risks', label: 'Риски' },
    { key: 'phones', label: 'Телефоны' },
    { key: 'links', label: 'Ссылки' },
  ],
  event: [
    { key: 'tags', label: 'Теги' },
    { key: 'markers', label: 'Метки' },
    { key: 'date', label: 'Даты' },
    { key: 'location', label: 'Локации' },
    { key: 'participants', label: 'Участники' },
    { key: 'outcomes', label: 'Итоги' },
    { key: 'links', label: 'Ссылки' },
  ],
  resource: [
    { key: 'tags', label: 'Теги' },
    { key: 'markers', label: 'Метки' },
    { key: 'resources', label: 'Форматы' },
    { key: 'status', label: 'Статусы' },
    { key: 'importance', label: 'Значимость' },
    { key: 'owners', label: 'Владельцы' },
    { key: 'links', label: 'Ссылки' },
  ],
  goal: [
    { key: 'tags', label: 'Теги' },
    { key: 'markers', label: 'Метки' },
    { key: 'priority', label: 'Приоритеты' },
    { key: 'metrics', label: 'Метрики' },
    { key: 'owners', label: 'Ответственные' },
    { key: 'status', label: 'Статусы' },
    { key: 'links', label: 'Ссылки' },
  ],
  result: [
    { key: 'tags', label: 'Теги' },
    { key: 'markers', label: 'Метки' },
    { key: 'outcomes', label: 'Результаты' },
    { key: 'metrics', label: 'Метрики' },
    { key: 'importance', label: 'Значимость' },
    { key: 'owners', label: 'Ответственные' },
    { key: 'links', label: 'Ссылки' },
  ],
  task: [
    { key: 'tags', label: 'Теги' },
    { key: 'markers', label: 'Метки' },
    { key: 'priority', label: 'Приоритеты' },
    { key: 'status', label: 'Статусы' },
    { key: 'owners', label: 'Ответственные' },
    { key: 'date', label: 'Даты' },
    { key: 'links', label: 'Ссылки' },
  ],
  project: [
    { key: 'tags', label: 'Теги' },
    { key: 'markers', label: 'Метки' },
    { key: 'stage', label: 'Стадии' },
    { key: 'priority', label: 'Приоритеты' },
    { key: 'risks', label: 'Риски' },
    { key: 'owners', label: 'Ответственные' },
    { key: 'links', label: 'Ссылки' },
  ],
  shape: [
    { key: 'tags', label: 'Теги' },
    { key: 'markers', label: 'Метки' },
    { key: 'importance', label: 'Значимость' },
    { key: 'status', label: 'Статусы' },
    { key: 'links', label: 'Ссылки' },
  ],
};

const FILTER_STORAGE_PREFIX = 'synapse12.collection.filters.v2';

function createDefaultQuickFilters(): QuickEntityFilters {
  return {
    onlyWithPhoto: false,
    onlyNameOnly: false,
    hideWithoutPhoto: false,
    hideWithoutName: false,
    onlyMine: false,
  };
}

const searchQuery = ref('');
const collectionViewRef = ref<HTMLElement | null>(null);
const selectedFieldFilters = ref<Record<string, string[]>>({});
const quickEntityFilters = ref<QuickEntityFilters>(createDefaultQuickFilters());
const isHydratingFilterPrefs = ref(false);
const entityInfoEntityId = ref<string | null>(null);
// FIX B: Deferred full-refresh flag. Set when a fetchEntities() call was
// requested while the EntityInfoModal was open. The fetch runs as soon as
// the modal closes so we never miss the refresh but also never stomp
// mid-quiz entity state.
const pendingEntitiesRefetch = ref(false);
const activeProjectRenameId = ref<string | null>(null);
const projectRenameDraft = ref('');
const projectDeleteTarget = ref<Entity | null>(null);
const isProjectDeleteBusy = ref(false);
const isCreateBusy = ref(false);
const isConnectionImportModalOpen = ref(false);
const isConnectionImportBusy = ref(false);
const connectionImportMessage = ref('');
const connectionImportError = ref('');
const connectionImportStats = ref<{
  total: number;
  imported: number;
  matched: number;
  matchedByPhone: number;
  matchedByImportKey: number;
  matchedByJid: number;
  matchedByName: number;
  newAvailable: number;
  newWithName: number;
  newWithoutName: number;
  importedWithImage: number;
} | null>(null);
const connectionMoveBusyById = ref<Record<string, boolean>>({});
const connectionImportSessionId = ref('');
const connectionImportQrCode = ref('');
const connectionImportSessionStatus = ref<
  'idle' | 'initializing' | 'qr' | 'ready' | 'importing' | 'error' | 'disconnected'
>('idle');
const connectionImportPollTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const connectionImportProgress = ref<{
  stage: string;
  note: string;
  total: number;
  processed: number;
  percent: number;
} | null>(null);
const connectionClientLogs = ref<Array<{ ts: string; step: string; data?: unknown }>>([]);
const isConnectionCopyLogsBusy = ref(false);
const connectionCopyLogsMessage = ref('');
const isConnectionPhotosBusy = ref(false);
const isDeleteWhatsappConfirmVisible = ref(false);
const connectionBackgroundSyncActive = ref(false);
const connectionGlobalMessage = ref('');
const connectionGlobalError = ref('');
const connectionGlobalMessageTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const connectionSuccessAlert = ref<{
  title: string;
  message: string;
} | null>(null);

interface WhatsappSessionStatus {
  sessionId: string;
  status: 'idle' | 'initializing' | 'qr' | 'ready' | 'importing' | 'error' | 'disconnected';
  qrCodeDataUrl?: string;
  error?: string;
  importProgress?: {
    stage?: string;
    note?: string;
    total?: number;
    processed?: number;
    percent?: number;
  };
}

interface WhatsappImportResult {
  imported: number;
  skipped: number;
  total: number;
  cursor?: number;
  nextCursor?: number;
  hasMore?: boolean;
  batchSize?: number;
  batchCount?: number;
  matched?: number;
  matchedByPhone?: number;
  matchedByImportKey?: number;
  matchedByJid?: number;
  matchedByName?: number;
  newAvailable?: number;
  newWithName?: number;
  newWithoutName?: number;
  importedWithImage?: number;
  entities?: Entity[];
  session?: WhatsappSessionStatus;
}

interface WhatsappSessionLogsResponse {
  sessionId: string;
  status: string;
  connector: string;
  logs: Array<{ ts?: string; step?: string; data?: unknown }>;
}

interface WhatsappDeleteImportedResult {
  deleted: number;
}

interface ProjectPreviewPoint {
  id: string;
  x: number;
  y: number;
  r: number;
  color: string;
  image: string;
  emoji: string;
  glyph: string;
  clipId: string;
}

interface ProjectPreviewEdge {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface ProjectPreview {
  nodes: ProjectPreviewPoint[];
  edges: ProjectPreviewEdge[];
}

const PROJECT_PREVIEW_WIDTH = 180;
const PROJECT_PREVIEW_HEIGHT = 112;
const PROJECT_NODE_BASE_RADIUS = 36;

function normalizeNodeScale(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(1.2, Math.max(0.8, value));
  }
  return 1;
}

function parseProfile(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {} as Record<string, unknown>;
  }
  return raw as Record<string, unknown>;
}

function parseLogoImage(profile: Record<string, unknown>) {
  const raw = profile.logo;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return '';
  }
  const logo = raw as Record<string, unknown>;
  return typeof logo.image === 'string' ? logo.image.trim() : '';
}

function getNodeGlyph(type: EntityType) {
  const glyphMap: Record<EntityType, string> = {
    project: 'П',
    connection: 'К',
    person: 'Л',
    company: 'К',
    event: 'С',
    resource: 'Р',
    goal: 'Ц',
    result: 'И',
    task: 'З',
    shape: 'Э',
  };
  return glyphMap[type] || '•';
}

function normalizeType(value: unknown): EntityType {
  const allowed: EntityType[] = [
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

  if (typeof value === 'string' && allowed.includes(value as EntityType)) {
    return value as EntityType;
  }

  return 'project';
}

const activeType = computed<EntityType>(() => normalizeType(props.type));
const CREATE_BUTTON_LABELS: Record<EntityType, string> = {
  project: 'Создать проект',
  connection: 'Подключить WhatsApp',
  person: 'Создать персону',
  company: 'Создать компанию',
  event: 'Создать событие',
  resource: 'Создать ресурс',
  goal: 'Создать цель',
  result: 'Создать результат',
  task: 'Создать задачу',
  shape: 'Создать элемент',
};
const CREATE_ENTITY_NAME_TEMPLATES: Record<EntityType, string> = {
  project: 'Новый проект',
  connection: 'Новое подключение',
  person: 'Новая персона',
  company: 'Новая компания',
  event: 'Новое событие',
  resource: 'Новый ресурс',
  goal: 'Новая цель',
  result: 'Новый результат',
  task: 'Новая задача',
  shape: 'Новый элемент',
};

const createButtonLabel = computed(() => CREATE_BUTTON_LABELS[activeType.value] || 'Создать');

const typedEntities = computed(() => entitiesStore.byType(activeType.value));

function buildDefaultEntityName(type: EntityType, nextNumber: number) {
  const base = CREATE_ENTITY_NAME_TEMPLATES[type] || 'Новая сущность';
  return `${base} ${nextNumber}`;
}

function normalizeProjectPreview(entity: Entity): ProjectPreview | null {
  const rawCanvas = entity.canvas_data;
  if (!rawCanvas || typeof rawCanvas !== 'object') return null;

  const rawNodes = Array.isArray(rawCanvas.nodes) ? rawCanvas.nodes : [];
  const rawEdges = Array.isArray(rawCanvas.edges) ? rawCanvas.edges : [];
  const rawViewport =
    rawCanvas.viewport && typeof rawCanvas.viewport === 'object' ? rawCanvas.viewport : null;

  const nodes = rawNodes
    .filter((node) => {
      return (
        !!node &&
        typeof node.id === 'string' &&
        typeof node.entityId === 'string' &&
        Number.isFinite(node.x) &&
        Number.isFinite(node.y)
      );
    })
    .map((node) => ({
      id: node.id,
      entityId: node.entityId,
      x: node.x,
      y: node.y,
      scale: normalizeNodeScale(node.scale),
    }));

  if (!nodes.length) return null;

  const viewportIsValid =
    rawViewport &&
    Number.isFinite(rawViewport.x) &&
    Number.isFinite(rawViewport.y) &&
    Number.isFinite(rawViewport.zoom) &&
    rawViewport.zoom > 0 &&
    Number.isFinite(rawViewport.width) &&
    rawViewport.width > 0 &&
    Number.isFinite(rawViewport.height) &&
    rawViewport.height > 0;

  let worldMinX = 0;
  let worldMinY = 0;
  let sourceWidth = PROJECT_PREVIEW_WIDTH;
  let sourceHeight = PROJECT_PREVIEW_HEIGHT;
  let sourceZoom = 1;
  let sourceOffsetX = 0;
  let sourceOffsetY = 0;

  if (viewportIsValid && rawViewport) {
    sourceWidth = rawViewport.width;
    sourceHeight = rawViewport.height;
    sourceZoom = rawViewport.zoom;
    sourceOffsetX = rawViewport.x;
    sourceOffsetY = rawViewport.y;
  } else {
    worldMinX = Math.min(...nodes.map((node) => node.x - PROJECT_NODE_BASE_RADIUS * node.scale));
    const worldMaxX = Math.max(...nodes.map((node) => node.x + PROJECT_NODE_BASE_RADIUS * node.scale));
    worldMinY = Math.min(...nodes.map((node) => node.y - PROJECT_NODE_BASE_RADIUS * node.scale));
    const worldMaxY = Math.max(...nodes.map((node) => node.y + PROJECT_NODE_BASE_RADIUS * node.scale));

    sourceWidth = Math.max(1, worldMaxX - worldMinX);
    sourceHeight = Math.max(1, worldMaxY - worldMinY);
  }

  const previewScale = Math.min(
    PROJECT_PREVIEW_WIDTH / Math.max(1, sourceWidth),
    PROJECT_PREVIEW_HEIGHT / Math.max(1, sourceHeight),
  );
  const previewOffsetX = (PROJECT_PREVIEW_WIDTH - sourceWidth * previewScale) / 2;
  const previewOffsetY = (PROJECT_PREVIEW_HEIGHT - sourceHeight * previewScale) / 2;

  const previewNodes = nodes.map((node) => {
    const linkedEntity = entitiesStore.byId(node.entityId);
    const linkedProfile = parseProfile(linkedEntity?.profile);
    const nodeColor =
      typeof linkedProfile.color === 'string' && linkedProfile.color.trim()
        ? linkedProfile.color.trim()
        : '#1058ff';
    const nodeImageRaw =
      typeof linkedProfile.image === 'string' && linkedProfile.image.trim()
        ? linkedProfile.image.trim()
        : parseLogoImage(linkedProfile);
    const nodeEmoji =
      typeof linkedProfile.emoji === 'string' && linkedProfile.emoji.trim()
        ? linkedProfile.emoji.trim()
        : '';
    const nodeType = linkedEntity?.type || 'shape';

    const sourceX = viewportIsValid
      ? sourceOffsetX + node.x * sourceZoom
      : node.x - worldMinX;
    const sourceY = viewportIsValid
      ? sourceOffsetY + node.y * sourceZoom
      : node.y - worldMinY;
    const sourceRadius = PROJECT_NODE_BASE_RADIUS * node.scale * (viewportIsValid ? sourceZoom : 1);
    const previewRadius = Math.max(2, sourceRadius * previewScale);

    return {
      id: node.id,
      x: previewOffsetX + sourceX * previewScale,
      y: previewOffsetY + sourceY * previewScale,
      r: previewRadius,
      color: nodeColor,
      image: nodeImageRaw,
      emoji: nodeEmoji,
      glyph: getNodeGlyph(nodeType),
      clipId: `project-preview-${entity._id}-${node.id}`,
    };
  });
  const nodeById = new Map(previewNodes.map((node) => [node.id, node]));

  const previewEdges = rawEdges
    .filter((edge) => {
      return (
        !!edge &&
        typeof edge.id === 'string' &&
        typeof edge.source === 'string' &&
        typeof edge.target === 'string'
      );
    })
    .map((edge) => {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) return null;

      return {
        id: edge.id,
        x1: source.x,
        y1: source.y,
        x2: target.x,
        y2: target.y,
      };
    })
    .filter((edge): edge is ProjectPreviewEdge => Boolean(edge));

  return {
    nodes: previewNodes,
    edges: previewEdges,
  };
}

const projectPreviewById = computed<Record<string, ProjectPreview | null>>(() => {
  const map: Record<string, ProjectPreview | null> = {};
  for (const entity of typedEntities.value) {
    if (entity.type !== 'project') continue;
    map[entity._id] = normalizeProjectPreview(entity);
  }
  return map;
});

function projectPreview(entity: Entity) {
  return projectPreviewById.value[entity._id] || null;
}

function projectPreviewNodes(entity: Entity) {
  const preview = projectPreview(entity);
  if (!preview || !Array.isArray(preview.nodes)) return [] as ProjectPreviewPoint[];
  return preview.nodes.filter((node): node is ProjectPreviewPoint => Boolean(node));
}

function projectPreviewEdges(entity: Entity) {
  const preview = projectPreview(entity);
  if (!preview || !Array.isArray(preview.edges)) return [] as ProjectPreviewEdge[];
  return preview.edges.filter((edge): edge is ProjectPreviewEdge => Boolean(edge));
}

function toMetadata(entity: Entity) {
  const raw = entity.ai_metadata;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {} as Record<string, unknown>;
  }
  return raw as Record<string, unknown>;
}

function toStringArray(value: unknown) {
  if (typeof value === 'string') {
    return value.trim() ? [value.trim()] : [];
  }
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function normalizeImportanceList(values: string[]) {
  const result: string[] = [];
  for (const value of values) {
    const mapped = IMPORTANCE_VALUE_MAP[value.trim().toLowerCase()] || '';
    if (!mapped) continue;
    if (!result.includes(mapped)) result.push(mapped);
  }
  return result.slice(0, 1);
}

function metadataList(entity: Entity, key: MetadataFieldKey) {
  const values = toStringArray(toMetadata(entity)[key]);
  if (key !== 'importance') return values;
  return normalizeImportanceList(values);
}

function hasEntityPhoto(entity: Entity) {
  const image = entityImage(entity);
  return typeof image === 'string' && image.trim().length > 0;
}

function hasEntityName(entity: Entity) {
  return typeof entity.name === 'string' && entity.name.trim().length > 0;
}

function isEntityMine(entity: Entity) {
  const isMine = entity.is_mine === true;
  const isMe = entity.is_me === true;
  if (entity.type === 'person') {
    return isMine || isMe;
  }
  return isMine;
}

function quickFilterOptions() {
  return QUICK_FILTER_ITEMS.map((item) => item.label);
}

function getSelectedQuickFilterValues() {
  return QUICK_FILTER_ITEMS.filter((item) => quickEntityFilters.value[item.key]).map((item) => item.label);
}

function setSelectedQuickFilterValues(values: string[]) {
  const selected = new Set(
    values
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean),
  );

  const nextState = createDefaultQuickFilters();
  for (const item of QUICK_FILTER_ITEMS) {
    if (selected.has(item.label)) {
      nextState[item.key] = true;
    }
  }

  quickEntityFilters.value = nextState;
}

const activeFilterFields = computed<MetadataFieldConfig[]>(() => {
  return ENTITY_FILTER_FIELDS[activeType.value] || [];
});

const filterOptionsByKey = computed<Record<string, string[]>>(() => {
  const map: Record<string, string[]> = {};

  for (const field of activeFilterFields.value) {
    const values = new Set<string>();
    for (const entity of typedEntities.value) {
      for (const value of metadataList(entity, field.key)) {
        values.add(value);
      }
    }

    map[field.key] = Array.from(values);
  }

  return map;
});

function getFilterOptions(fieldKey: string) {
  return filterOptionsByKey.value[fieldKey] || [];
}

function storageKey() {
  const userId = (authStore.user?.id || 'guest').trim() || 'guest';
  return `${FILTER_STORAGE_PREFIX}:${userId}`;
}

function readStoredFilterState(): Record<string, StoredCollectionFilterState> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(storageKey());
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, StoredCollectionFilterState>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeStoredFilterState(value: Record<string, StoredCollectionFilterState>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(value));
  } catch {
    // Ignore localStorage write failures.
  }
}

function normalizeQuickFilters(raw: Partial<QuickEntityFilters> | undefined): QuickEntityFilters {
  const defaults = createDefaultQuickFilters();
  if (!raw || typeof raw !== 'object') return defaults;
  return {
    onlyWithPhoto: raw.onlyWithPhoto === true,
    onlyNameOnly: raw.onlyNameOnly === true,
    hideWithoutPhoto: raw.hideWithoutPhoto === true,
    hideWithoutName: raw.hideWithoutName === true,
    onlyMine: raw.onlyMine === true,
  };
}

function applyStoredFiltersForType(type: EntityType) {
  isHydratingFilterPrefs.value = true;
  const storedState = readStoredFilterState();
  const typeState = storedState[type] || {};
  const rawFilters =
    typeState.selectedFieldFilters && typeof typeState.selectedFieldFilters === 'object'
      ? typeState.selectedFieldFilters
      : {};

  const nextSelected: Record<string, string[]> = {};
  for (const field of activeFilterFields.value) {
    const values = rawFilters[field.key];
    nextSelected[field.key] = Array.isArray(values)
      ? values.filter((value) => typeof value === 'string' && value.trim().length > 0)
      : [];
  }

  selectedFieldFilters.value = nextSelected;
  quickEntityFilters.value = normalizeQuickFilters(typeState.quickFilters);
  isHydratingFilterPrefs.value = false;
}

function persistFiltersForType(type: EntityType) {
  if (isHydratingFilterPrefs.value) return;
  const storedState = readStoredFilterState();
  storedState[type] = {
    selectedFieldFilters: selectedFieldFilters.value,
    quickFilters: quickEntityFilters.value,
  };
  writeStoredFilterState(storedState);
}

function getSelectedFilterValues(fieldKey: string) {
  const options = getFilterOptions(fieldKey);
  const selected = selectedFieldFilters.value[fieldKey] || [];
  return selected.filter((value) => options.includes(value));
}

function setSelectedFilterValues(fieldKey: string, values: string[]) {
  selectedFieldFilters.value = {
    ...selectedFieldFilters.value,
    [fieldKey]: values,
  };
}

const filteredEntities = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();

  return typedEntities.value.filter((entity) => {
    if (q && !entity.name.toLowerCase().includes(q)) {
      return false;
    }

    const hasPhoto = hasEntityPhoto(entity);
    const hasName = hasEntityName(entity);

    if (quickEntityFilters.value.onlyWithPhoto && !hasPhoto) {
      return false;
    }

    if (quickEntityFilters.value.onlyNameOnly && !(hasName && !hasPhoto)) {
      return false;
    }

    if (quickEntityFilters.value.hideWithoutPhoto && !hasPhoto) {
      return false;
    }

    if (quickEntityFilters.value.hideWithoutName && !hasName) {
      return false;
    }

    if (quickEntityFilters.value.onlyMine && !isEntityMine(entity)) {
      return false;
    }

    for (const field of activeFilterFields.value) {
      const selected = getSelectedFilterValues(field.key);
      if (!selected.length) {
        continue;
      }

      const entityValues = metadataList(entity, field.key);
      const hasMatch = selected.some((value) => entityValues.includes(value));
      if (!hasMatch) {
        return false;
      }
    }

    return true;
  });
});

const filteredEntitiesCount = computed(() => filteredEntities.value.length);
const totalEntitiesCount = computed(() => typedEntities.value.length);
const filtersCounterLabel = computed(() => (activeType.value === 'connection' ? 'контактов' : 'элементов'));
const showConnectionSyncBanner = computed(
  () =>
    activeType.value === 'connection' &&
    (connectionBackgroundSyncActive.value || Boolean(connectionGlobalMessage.value) || Boolean(connectionGlobalError.value)),
);

const firstEntity = computed<Entity | null>(() => {
  const entities = filteredEntities.value;
  if (!entities.length) {
    return null;
  }

  const preferredId = entitiesStore.lastCreatedIdByType[activeType.value];
  if (!preferredId) {
    return entities[0]!;
  }

  return entities.find((entity) => entity._id === preferredId) || entities[0]!;
});

const remainingEntities = computed(() => {
  const first = firstEntity.value;

  if (!first) {
    return [] as Entity[];
  }

  return filteredEntities.value.filter((entity) => entity._id !== first._id);
});

onMounted(async () => {
  if (!authStore.isAuthenticated) {
    applyStoredFiltersForType(activeType.value);
    return;
  }

  if (!entitiesStore.initialized) {
    await entitiesStore.bootstrap();
  }

  applyStoredFiltersForType(activeType.value);
  void entitiesStore.fetchTypeIfNeeded(activeType.value);
});

onBeforeUnmount(() => {
  clearConnectionImportPoll();
  if (connectionGlobalMessageTimer.value) {
    clearTimeout(connectionGlobalMessageTimer.value);
    connectionGlobalMessageTimer.value = null;
  }
  void stopConnectionSession({ silent: true });
});

watch(
  activeFilterFields,
  (fields) => {
    const next: Record<string, string[]> = {};
    for (const field of fields) {
      next[field.key] = getSelectedFilterValues(field.key);
    }
    selectedFieldFilters.value = next;
  },
  { immediate: true },
);

watch(filterOptionsByKey, (nextOptions) => {
  const nextSelection: Record<string, string[]> = { ...selectedFieldFilters.value };

  for (const [fieldKey, options] of Object.entries(nextOptions)) {
    const currentValues = Array.isArray(nextSelection[fieldKey]) ? nextSelection[fieldKey] : [];
    nextSelection[fieldKey] = currentValues.filter((value) => options.includes(value));
  }

  selectedFieldFilters.value = nextSelection;
});

watch(activeType, () => {
  activeProjectRenameId.value = null;
  projectRenameDraft.value = '';
  projectDeleteTarget.value = null;
  if (connectionImportPollTimer.value) {
    clearTimeout(connectionImportPollTimer.value);
    connectionImportPollTimer.value = null;
  }
  isConnectionImportModalOpen.value = false;
  connectionImportSessionId.value = '';
  connectionImportQrCode.value = '';
  connectionImportSessionStatus.value = 'idle';
  connectionImportMessage.value = '';
  connectionImportError.value = '';
  connectionImportStats.value = null;
  connectionImportProgress.value = null;
  connectionClientLogs.value = [];
  connectionCopyLogsMessage.value = '';
  isDeleteWhatsappConfirmVisible.value = false;
  isConnectionPhotosBusy.value = false;
  applyStoredFiltersForType(activeType.value);
  void entitiesStore.fetchTypeIfNeeded(activeType.value);
});

watch(
  () => authStore.user?.id,
  () => {
    applyStoredFiltersForType(activeType.value);
  },
);

watch(
  [selectedFieldFilters, quickEntityFilters, () => authStore.user?.id, activeType],
  () => {
    persistFiltersForType(activeType.value);
  },
  { deep: true },
);

function appendConnectionClientLog(step: string, data?: unknown) {
  connectionClientLogs.value.push({
    ts: new Date().toISOString(),
    step,
    data,
  });
  if (connectionClientLogs.value.length > 200) {
    connectionClientLogs.value = connectionClientLogs.value.slice(-200);
  }
}

function formatConnectionImportError(error: unknown) {
  if (axios.isAxiosError(error) && !error.response) {
    return 'Сервис подключения временно недоступен (backend перезапускается или недоступен). Повторите через 1-2 минуты.';
  }

  const baseMessage = entitiesStore.formatApiError(error);

  if (/Could not find Chrome/i.test(baseMessage)) {
    return `${baseMessage}. На production-сервере не установлен браузер для Puppeteer. Проверьте postinstall и PUPPETEER_EXECUTABLE_PATH.`;
  }

  if (/integration is unavailable/i.test(baseMessage)) {
    return `${baseMessage}. На backend отсутствуют зависимости WhatsApp (whatsapp-web.js / qrcode).`;
  }

  if (/connector is disabled on this backend instance/i.test(baseMessage)) {
    return 'На этом сервере локальный WhatsApp-коннектор отключен для защиты от падений памяти. Нужен remote browser (PUPPETEER_BROWSER_WS_ENDPOINT) или отдельный high-memory worker.';
  }

  return baseMessage;
}

async function createEntity() {
  if (activeType.value === 'connection') {
    clearConnectionImportPoll();
    connectionImportError.value = '';
    connectionImportMessage.value = '';
    connectionImportStats.value = null;
    connectionImportProgress.value = null;
    connectionClientLogs.value = [];
    connectionCopyLogsMessage.value = '';
    isDeleteWhatsappConfirmVisible.value = false;
    isConnectionPhotosBusy.value = false;
    connectionImportSessionId.value = '';
    connectionImportQrCode.value = '';
    connectionImportSessionStatus.value = 'idle';
    appendConnectionClientLog('modal.open');
    isConnectionImportModalOpen.value = true;
    void startConnectionSession();
    return;
  }

  if (isCreateBusy.value) return;
  isCreateBusy.value = true;

  const nextEntityNumber = entitiesStore.countByType(activeType.value) + 1;
  const payload: {
    type: EntityType;
    name: string;
    profile: Record<string, unknown>;
    ai_metadata: Record<string, unknown>;
    canvas_data?: { nodes: []; edges: [] };
  } = {
    type: activeType.value,
    name: buildDefaultEntityName(activeType.value, nextEntityNumber),
    profile: {},
    ai_metadata: {},
  };

  if (activeType.value === 'project') {
    payload.canvas_data = { nodes: [], edges: [] };
  }

  try {
    await entitiesStore.createEntity(payload);

    // Keep the just-created card visible near "Создать".
    searchQuery.value = '';
    await nextTick();
    collectionViewRef.value?.scrollTo({ top: 0, behavior: 'auto' });
  } catch (error) {
    entitiesStore.error = entitiesStore.formatApiError(error);
  } finally {
    isCreateBusy.value = false;
  }
}

function clearConnectionImportPoll() {
  if (connectionImportPollTimer.value) {
    clearTimeout(connectionImportPollTimer.value);
    connectionImportPollTimer.value = null;
  }
}

function applyConnectionSessionState(session: WhatsappSessionStatus | undefined) {
  if (!session) return;

  const previousStatus = connectionImportSessionStatus.value;
  connectionImportSessionId.value = session.sessionId || '';
  connectionImportSessionStatus.value = session.status || 'idle';
  connectionImportQrCode.value = session.qrCodeDataUrl || '';
  if (session.importProgress && typeof session.importProgress === 'object') {
    connectionImportProgress.value = {
      stage: typeof session.importProgress.stage === 'string' ? session.importProgress.stage : '',
      note: typeof session.importProgress.note === 'string' ? session.importProgress.note : '',
      total: Number(session.importProgress.total) || 0,
      processed: Number(session.importProgress.processed) || 0,
      percent: Math.max(0, Math.min(100, Number(session.importProgress.percent) || 0)),
    };
  } else if (session.status !== 'importing') {
    connectionImportProgress.value = null;
  }

  if (previousStatus !== connectionImportSessionStatus.value) {
    appendConnectionClientLog('status.change', {
      from: previousStatus,
      to: connectionImportSessionStatus.value,
    });
  }

  if (session.error?.trim()) {
    connectionImportError.value = session.error.trim();
    appendConnectionClientLog('status.error', { message: session.error.trim() });
  } else if (connectionImportError.value && session.status !== 'error') {
    connectionImportError.value = '';
  }
}

function scheduleConnectionImportPoll(delay = 1800) {
  clearConnectionImportPoll();
  connectionImportPollTimer.value = setTimeout(() => {
    void fetchConnectionSessionStatus();
  }, delay);
}

async function fetchConnectionSessionStatus() {
  if (!isConnectionImportModalOpen.value) return;
  if (!connectionImportSessionId.value) return;

  try {
    const { data } = await apiClient.get<{ session: WhatsappSessionStatus }>(
      `/integrations/whatsapp/session/${connectionImportSessionId.value}`,
    );
    applyConnectionSessionState(data.session);

    if (
      data.session &&
      ['initializing', 'qr', 'importing'].includes(data.session.status)
    ) {
      scheduleConnectionImportPoll(1800);
    }
  } catch (error) {
    connectionImportError.value = formatConnectionImportError(error);
    connectionImportSessionStatus.value = 'error';
    appendConnectionClientLog('session.poll.error', { message: connectionImportError.value });
    clearConnectionImportPoll();
  }
}

async function startConnectionSession() {
  if (isConnectionImportBusy.value) return;
  isConnectionImportBusy.value = true;
  connectionImportError.value = '';
  connectionImportMessage.value = '';
  connectionGlobalError.value = '';
  connectionGlobalMessage.value = '';
  connectionImportStats.value = null;
  connectionImportProgress.value = null;
  connectionCopyLogsMessage.value = '';
  appendConnectionClientLog('session.start.request');
  clearConnectionImportPoll();

  try {
    const { data } = await apiClient.post<{ session: WhatsappSessionStatus }>(
      '/integrations/whatsapp/session/start',
      {},
    );
    applyConnectionSessionState(data.session);
    appendConnectionClientLog('session.start.response', {
      status: data.session?.status,
      sessionId: data.session?.sessionId,
    });

    if (data.session && ['initializing', 'qr', 'importing'].includes(data.session.status)) {
      scheduleConnectionImportPoll(1200);
    }
  } catch (error) {
    connectionImportError.value = formatConnectionImportError(error);
    connectionImportSessionStatus.value = 'error';
    appendConnectionClientLog('session.start.error', { message: connectionImportError.value });
    clearConnectionImportPoll();
  } finally {
    isConnectionImportBusy.value = false;
  }
}

async function stopConnectionSession(options?: { silent?: boolean }) {
  const sessionId = connectionImportSessionId.value;
  if (!sessionId) return;

  try {
    await apiClient.delete(`/integrations/whatsapp/session/${sessionId}`);
    appendConnectionClientLog('session.stop.request', { sessionId });
  } catch (error) {
    if (!options?.silent) {
      connectionImportError.value = formatConnectionImportError(error);
    }
  } finally {
    connectionImportSessionId.value = '';
    connectionImportQrCode.value = '';
    connectionImportSessionStatus.value = 'idle';
    connectionImportProgress.value = null;
    isDeleteWhatsappConfirmVisible.value = false;
  }
}

async function closeConnectionImportModal() {
  if (isConnectionImportBusy.value || isConnectionPhotosBusy.value) return;
  appendConnectionClientLog('modal.close');
  clearConnectionImportPoll();
  await stopConnectionSession({ silent: true });
  isConnectionImportModalOpen.value = false;
}

function closeConnectionSuccessAlert() {
  connectionSuccessAlert.value = null;
}

function setConnectionGlobalMessage(message: string, autoClearMs = 0) {
  if (connectionGlobalMessageTimer.value) {
    clearTimeout(connectionGlobalMessageTimer.value);
    connectionGlobalMessageTimer.value = null;
  }

  connectionGlobalMessage.value = message;

  if (!message || autoClearMs <= 0) {
    return;
  }

  const snapshot = message;
  connectionGlobalMessageTimer.value = setTimeout(() => {
    if (
      connectionGlobalMessage.value === snapshot &&
      !connectionBackgroundSyncActive.value &&
      !connectionGlobalError.value
    ) {
      connectionGlobalMessage.value = '';
    }
    connectionGlobalMessageTimer.value = null;
  }, autoClearMs);
}

function waitFor(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(() => resolve(), ms);
  });
}

async function ensureConnectionSessionForBackgroundSync() {
  try {
    const { data } = await apiClient.post<{ session: WhatsappSessionStatus }>(
      '/integrations/whatsapp/session/start',
      {},
    );
    if (data.session) {
      applyConnectionSessionState(data.session);
      appendConnectionClientLog('background.session.ensure', {
        status: data.session.status,
        sessionId: data.session.sessionId,
      });
    }
    return data.session;
  } catch (error) {
    appendConnectionClientLog('background.session.ensure.error', {
      message: formatConnectionImportError(error),
    });
    return null;
  }
}

async function importWhatsAppContacts() {
  if (isConnectionImportBusy.value) return;
  if (!connectionImportSessionId.value) {
    connectionImportError.value = 'Сначала запустите подключение WhatsApp.';
    return;
  }
  if (connectionImportSessionStatus.value !== 'ready') {
    connectionImportError.value = 'Подключение еще не готово. Сканируйте QR и дождитесь статуса "Подключено".';
    return;
  }

  isConnectionImportBusy.value = true;
  connectionImportError.value = '';
  connectionImportMessage.value = '';
  connectionImportStats.value = null;
  connectionImportSessionStatus.value = 'importing';
  connectionImportProgress.value = {
    stage: 'prepare',
    note: 'Подготовка импорта с фото',
    processed: 0,
    total: 0,
    percent: 5,
  };
  appendConnectionClientLog('import.request', { sessionId: connectionImportSessionId.value });

  try {
    const batchSize = 80;
    let cursor = 0;
    let total = 0;
    let hasMore = true;
    let batchNumber = 0;

    let importedTotal = 0;
    let matchedTotal = 0;
    let matchedByPhoneTotal = 0;
    let matchedByImportKeyTotal = 0;
    let matchedByJidTotal = 0;
    let matchedByNameTotal = 0;
    let newAvailableTotal = 0;
    let newWithNameTotal = 0;
    let newWithoutNameTotal = 0;
    let importedWithImageTotal = 0;

    while (hasMore) {
      batchNumber += 1;
      let data: WhatsappImportResult | null = null;
      let attempt = 0;

      while (!data && attempt < 3) {
        attempt += 1;
        try {
          const response = await apiClient.post<WhatsappImportResult>('/integrations/whatsapp/import', {
            sessionId: connectionImportSessionId.value,
            includeImages: true,
            cursor,
            batchSize,
          });
          data = response.data;
        } catch (error) {
          const status = axios.isAxiosError(error) ? Number(error.response?.status) || 0 : 0;
          const canRetry = status === 404 || status === 409 || status === 429 || status >= 500 || status === 0;
          if (!canRetry || attempt >= 3) {
            throw error;
          }
          appendConnectionClientLog('import.batch.retry', {
            batchNumber,
            attempt,
            status,
            message: formatConnectionImportError(error),
          });
          const session = await ensureConnectionSessionForBackgroundSync();
          if (!session || session.status !== 'ready') {
            throw error;
          }
          connectionImportSessionId.value = session.sessionId || connectionImportSessionId.value;
          await waitFor(700 * attempt);
        }
      }

      if (!data) {
        break;
      }

      applyConnectionSessionState(data.session);

      const batchImported = Number(data.imported) || 0;
      const batchMatched = Number(data.matched ?? data.skipped) || 0;
      const batchMatchedByPhone = Number(data.matchedByPhone) || 0;
      const batchMatchedByImportKey = Number(data.matchedByImportKey) || 0;
      const batchMatchedByJid = Number(data.matchedByJid) || 0;
      const batchMatchedByName = Number(data.matchedByName) || 0;
      const batchNewAvailable = Number(data.newAvailable ?? batchImported) || 0;
      const batchNewWithName = Number(data.newWithName) || 0;
      const batchNewWithoutName = Number(data.newWithoutName) || 0;
      const batchImportedWithImage = Number(data.importedWithImage) || 0;
      const nextCursor = Math.max(0, Number(data.nextCursor ?? cursor + (Number(data.batchCount) || 0)));

      total = Math.max(total, Number(data.total) || 0);
      importedTotal += batchImported;
      matchedTotal += batchMatched;
      matchedByPhoneTotal += batchMatchedByPhone;
      matchedByImportKeyTotal += batchMatchedByImportKey;
      matchedByJidTotal += batchMatchedByJid;
      matchedByNameTotal += batchMatchedByName;
      newAvailableTotal += batchNewAvailable;
      newWithNameTotal += batchNewWithName;
      newWithoutNameTotal += batchNewWithoutName;
      importedWithImageTotal += batchImportedWithImage;

      connectionImportStats.value = {
        total,
        imported: importedTotal,
        matched: matchedTotal,
        matchedByPhone: matchedByPhoneTotal,
        matchedByImportKey: matchedByImportKeyTotal,
        matchedByJid: matchedByJidTotal,
        matchedByName: matchedByNameTotal,
        newAvailable: newAvailableTotal,
        newWithName: newWithNameTotal,
        newWithoutName: newWithoutNameTotal,
        importedWithImage: importedWithImageTotal,
      };

      const importedEntities = Array.isArray(data.entities) ? data.entities : [];
      if (importedEntities.length) {
        const existingIds = new Set(entitiesStore.items.map((item) => item._id));
        const newItems = importedEntities.filter((item) => item && !existingIds.has(item._id));
        if (newItems.length) {
          entitiesStore.items = [...newItems, ...entitiesStore.items];
        }
      }

      if (batchImported > 0) {
        entitiesStore.triggerFlash('connection');
      }

      const processed = total > 0 ? Math.min(total, nextCursor) : nextCursor;
      const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 100;
      connectionImportProgress.value = {
        stage: 'import',
        note: `Импорт контактов с фото (пакет ${batchNumber})`,
        processed,
        total,
        percent,
      };
      connectionImportMessage.value = `Пакет ${batchNumber}: +${batchImported} новых, ${batchMatched} совпадений.`;

      appendConnectionClientLog('import.batch.response', {
        batchNumber,
        cursor,
        nextCursor,
        total,
        imported: batchImported,
        matched: batchMatched,
        importedWithImage: batchImportedWithImage,
      });

      cursor = nextCursor;
      hasMore = Boolean(data.hasMore) && nextCursor > 0 && (total === 0 || nextCursor < total);
      if (total > 0 && nextCursor >= total) {
        hasMore = false;
      }
    }

    // FIX B: Modal is open — quiz may be active. Defer the full refresh
    // until the modal closes (see watch on entityInfoEntityId below).
    if (entityInfoEntityId.value) {
      pendingEntitiesRefetch.value = true;
    } else {
      await entitiesStore.fetchEntities({ silent: true });
    }

    const successMessage =
      importedTotal > 0
        ? `Новых: ${importedTotal} (с фото: ${importedWithImageTotal}, с именем: ${newWithNameTotal}, без имени: ${newWithoutNameTotal}). Совпадений: ${matchedTotal}.`
        : matchedTotal > 0
          ? `Новых контактов нет. Совпадений: ${matchedTotal}.`
          : 'Контакты не найдены для импорта.';

    connectionImportMessage.value = successMessage;
    appendConnectionClientLog('import.response', {
      total,
      imported: importedTotal,
      matched: matchedTotal,
      matchedByPhone: matchedByPhoneTotal,
      matchedByImportKey: matchedByImportKeyTotal,
      matchedByJid: matchedByJidTotal,
      matchedByName: matchedByNameTotal,
      newAvailable: newAvailableTotal,
      newWithName: newWithNameTotal,
      newWithoutName: newWithoutNameTotal,
      importedWithImage: importedWithImageTotal,
    });

    connectionImportProgress.value = {
      stage: 'done',
      note: 'Импорт завершен',
      processed: total,
      total,
      percent: 100,
    };

    connectionSuccessAlert.value = {
      title: 'Импорт завершен',
      message: successMessage,
    };

    isConnectionImportModalOpen.value = false;
    clearConnectionImportPoll();
    await stopConnectionSession({ silent: true });

    await nextTick();
    collectionViewRef.value?.scrollTo({ top: 0, behavior: 'auto' });
  } catch (error) {
    connectionImportError.value = formatConnectionImportError(error);
    appendConnectionClientLog('import.error', { message: connectionImportError.value });
  } finally {
    isConnectionImportBusy.value = false;
  }
}

function requestDeleteImportedWhatsApp() {
  isDeleteWhatsappConfirmVisible.value = true;
  setConnectionGlobalMessage(
    'Подтвердите удаление импортированных WhatsApp-контактов. Они будут удалены из коллекции и из всех проектов.',
  );
}

function cancelDeleteImportedWhatsApp() {
  isDeleteWhatsappConfirmVisible.value = false;
  setConnectionGlobalMessage('');
}

async function confirmDeleteImportedWhatsApp() {
  if (isConnectionImportBusy.value || isConnectionPhotosBusy.value) return;
  isConnectionImportBusy.value = true;
  connectionImportError.value = '';
  appendConnectionClientLog('imported.delete.request');

  try {
    const { data } = await apiClient.delete<WhatsappDeleteImportedResult>('/integrations/whatsapp/imported');
    isDeleteWhatsappConfirmVisible.value = false;
    connectionImportStats.value = null;
    setConnectionGlobalMessage(`Удалено импортированных контактов: ${Number(data.deleted) || 0}.`, 3200);
    // FIX B: Modal open — defer.
    if (entityInfoEntityId.value) {
      pendingEntitiesRefetch.value = true;
    } else {
      await entitiesStore.fetchEntities({ silent: true });
    }
    appendConnectionClientLog('imported.delete.response', data);
  } catch (error) {
    connectionImportError.value = formatConnectionImportError(error);
    appendConnectionClientLog('imported.delete.error', { message: connectionImportError.value });
  } finally {
    isConnectionImportBusy.value = false;
  }
}

function connectionSessionStatusLabel() {
  const status = connectionImportSessionStatus.value;
  if (status === 'ready') return 'Подключено';
  if (status === 'qr') return 'Ожидает сканирования QR';
  if (status === 'initializing') return 'Генерация QR';
  if (status === 'importing') return 'Импорт контактов';
  if (status === 'error') return 'Ошибка';
  if (status === 'disconnected') return 'Отключено';
  return 'Не подключено';
}

function connectionSessionActionLabel() {
  const status = connectionImportSessionStatus.value;
  if (status === 'ready') return 'Обновить QR';
  if (status === 'qr') return 'Обновить QR';
  if (status === 'initializing') return 'Генерация...';
  return 'Повторить';
}

async function copyConnectionLogs() {
  if (isConnectionCopyLogsBusy.value) return;
  isConnectionCopyLogsBusy.value = true;
  connectionCopyLogsMessage.value = '';

  try {
    let serverLogs: unknown[] = [];
    if (connectionImportSessionId.value) {
      try {
        const { data } = await apiClient.get<WhatsappSessionLogsResponse>(
          `/integrations/whatsapp/session/${connectionImportSessionId.value}/logs`,
        );
        serverLogs = Array.isArray(data.logs) ? data.logs : [];
      } catch (error) {
        appendConnectionClientLog('logs.fetch.error', {
          message: entitiesStore.formatApiError(error),
        });
      }
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      sessionId: connectionImportSessionId.value,
      status: connectionImportSessionStatus.value,
      progress: connectionImportProgress.value,
      stats: connectionImportStats.value,
      message: connectionImportMessage.value,
      error: connectionImportError.value,
      clientLogs: connectionClientLogs.value,
      serverLogs,
    };
    const text = JSON.stringify(payload, null, 2);
    await navigator.clipboard.writeText(text);
    connectionCopyLogsMessage.value = 'Логи скопированы.';
    appendConnectionClientLog('logs.copy.success', {
      clientLogs: connectionClientLogs.value.length,
      serverLogs: Array.isArray(serverLogs) ? serverLogs.length : 0,
    });
  } catch {
    connectionCopyLogsMessage.value = 'Не удалось скопировать логи.';
    appendConnectionClientLog('logs.copy.error');
  } finally {
    isConnectionCopyLogsBusy.value = false;
  }
}

function connectionPhone(entity: Entity) {
  const profile = toProfile(entity);
  const direct = typeof profile.phone === 'string' ? profile.phone.trim() : '';
  if (direct) return direct;

  if (Array.isArray(profile.phones)) {
    const first = profile.phones.find((value) => typeof value === 'string' && value.trim().length > 0);
    if (typeof first === 'string') return first.trim();
  }

  return '';
}

function connectionSource(entity: Entity) {
  const profile = toProfile(entity);
  const source = profile.source;
  if (typeof source !== 'string') return '';
  return source.trim().toLowerCase();
}

function connectionMeta(entity: Entity) {
  const source = connectionSource(entity);
  const phone = connectionPhone(entity);
  const sourceLabel = source === 'whatsapp' ? 'WhatsApp' : source || 'Источник не указан';
  if (phone) {
    return `${sourceLabel} · ${phone}`;
  }
  return sourceLabel;
}

function companyPhone(entity: Entity) {
  return connectionPhone(entity);
}

function setConnectionMoveBusy(entityId: string, busy: boolean) {
  connectionMoveBusyById.value = {
    ...connectionMoveBusyById.value,
    [entityId]: busy,
  };
}

function isConnectionMoveBusy(entityId: string) {
  return Boolean(connectionMoveBusyById.value[entityId]);
}

async function moveConnectionTo(entity: Entity, targetType: 'person' | 'company', event: MouseEvent) {
  event.stopPropagation();

  if (isConnectionMoveBusy(entity._id)) return;
  setConnectionMoveBusy(entity._id, true);

  try {
    const currentProfile = toProfile(entity);
    const nextProfile = {
      ...currentProfile,
      // После переноса из "Подключение" в категорию сущность должна считаться категоризированной.
      categoryLocked: true,
    };

    await entitiesStore.updateEntity(entity._id, {
      type: targetType,
      profile: nextProfile,
      canvas_data: undefined,
    });
    entitiesStore.triggerFlash(targetType);
  } catch (error) {
    entitiesStore.error = entitiesStore.formatApiError(error);
  } finally {
    setConnectionMoveBusy(entity._id, false);
  }
}

function getProjectInputElement(projectId: string) {
  if (typeof document === 'undefined') return null;
  const escapedId =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(projectId)
      : projectId.replace(/"/g, '\\"');
  return document.querySelector<HTMLInputElement>(`input[data-project-name-id="${escapedId}"]`);
}

function openProjectRename(project: Entity) {
  activeProjectRenameId.value = project._id;
  projectRenameDraft.value = project.name || '';

  void nextTick(() => {
    const input = getProjectInputElement(project._id);
    if (!input) return;
    input.focus();
    input.select();
  });
}

function projectNameValue(project: Entity) {
  if (activeProjectRenameId.value === project._id) {
    return projectRenameDraft.value;
  }
  return project.name || '';
}

function onProjectNameInput(event: Event, project: Entity) {
  if (activeProjectRenameId.value !== project._id) {
    openProjectRename(project);
  }

  const input = event.target as HTMLInputElement | null;
  if (!input) return;
  projectRenameDraft.value = input.value.slice(0, 64);
}

function onProjectNameClick(event: MouseEvent, project: Entity) {
  event.stopPropagation();
  if (activeProjectRenameId.value !== project._id) {
    openProjectRename(project);
    return;
  }

  const input = event.target as HTMLInputElement | null;
  if (!input) return;
  requestAnimationFrame(() => {
    input.select();
  });
}

function onProjectNameFocus(event: FocusEvent, project: Entity) {
  const input = event.target as HTMLInputElement | null;
  if (activeProjectRenameId.value !== project._id) {
    openProjectRename(project);
    return;
  }

  if (input) {
    input.select();
  }
}

function commitProjectRename(project: Entity) {
  if (activeProjectRenameId.value !== project._id) return;

  const nextName = projectRenameDraft.value.trim();
  const currentName = (project.name || '').trim();
  activeProjectRenameId.value = null;

  if (!nextName || nextName === currentName) {
    projectRenameDraft.value = '';
    return;
  }

  entitiesStore.queueEntityUpdate(
    project._id,
    {
      name: nextName,
    },
    { delay: 0 },
  );
  projectRenameDraft.value = '';
}

function onProjectNameKeydown(event: KeyboardEvent, project: Entity) {
  if (event.key === 'Enter') {
    event.preventDefault();
    (event.target as HTMLInputElement | null)?.blur();
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    projectRenameDraft.value = project.name || '';
    activeProjectRenameId.value = null;
    (event.target as HTMLInputElement | null)?.blur();
  }
}

function openProjectDeleteConfirm(project: Entity, event: MouseEvent) {
  event.stopPropagation();
  projectDeleteTarget.value = project;
}

function closeProjectDeleteConfirm() {
  if (isProjectDeleteBusy.value) return;
  projectDeleteTarget.value = null;
}

async function confirmProjectDelete() {
  const target = projectDeleteTarget.value;
  if (!target || isProjectDeleteBusy.value) return;

  isProjectDeleteBusy.value = true;
  try {
    await entitiesStore.deleteEntity(target._id);
    projectDeleteTarget.value = null;
  } finally {
    isProjectDeleteBusy.value = false;
  }
}

function onCardClick(entity: Entity) {
  if (entity.type === 'project') {
    router.push({ name: 'project-canvas', params: { id: entity._id } });
    return;
  }

  entityInfoEntityId.value = entity._id;
}

function toProfile(entity: Entity | null | undefined) {
  const raw = entity?.profile;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {} as Record<string, unknown>;
  }
  return raw as Record<string, unknown>;
}

function entityColor(entity: Entity) {
  const raw = toProfile(entity).color;
  if (typeof raw === 'string' && raw.trim()) {
    return raw;
  }
  return '#1058ff';
}

function entityImage(entity: Entity) {
  const raw = toProfile(entity).image;
  return typeof raw === 'string' ? raw : '';
}

function entityEmoji(entity: Entity) {
  const raw = toProfile(entity).emoji;
  return typeof raw === 'string' ? raw : '';
}

function entityProgress(entity: Entity) {
  return calculateEntityProfileProgress(entity);
}

function closeEntityInfoModal() {
  entityInfoEntityId.value = null;
}

// FIX B: When the modal closes, flush any pending full-refresh that was
// deferred while a quiz was potentially active inside the modal.
watch(entityInfoEntityId, (id) => {
  if (id !== null) return; // modal is still open
  if (!pendingEntitiesRefetch.value) return;
  pendingEntitiesRefetch.value = false;
  void entitiesStore.fetchEntities({ silent: true });
});
</script>

<template>
  <main class="workspace">
    <div class="tools-header">
      <div class="search-bar">
        <AppIcon name="search" />
        <input v-model="searchQuery" type="search" placeholder="Поиск..." />
      </div>

      <div class="filters-group">
        <FilterDropdown
          v-for="field in activeFilterFields"
          :key="field.key"
          :label="field.label"
          :model-value="getSelectedFilterValues(field.key)"
          :options="getFilterOptions(field.key)"
          @update:model-value="(values) => setSelectedFilterValues(field.key, values)"
        />
        <FilterDropdown
          label="Фото/Имя"
          :model-value="getSelectedQuickFilterValues()"
          :options="quickFilterOptions()"
          @update:model-value="setSelectedQuickFilterValues"
        />
      </div>

      <div class="tools-right">
        <div class="filters-counter">
          Показано {{ filteredEntitiesCount }} из {{ totalEntitiesCount }} {{ filtersCounterLabel }}
        </div>
        <div v-if="activeType === 'connection'" class="connection-toolbar-actions">
          <button
            v-if="!isDeleteWhatsappConfirmVisible"
            type="button"
            class="connection-toolbar-btn danger"
            :disabled="isConnectionImportBusy || isConnectionPhotosBusy"
            @click="requestDeleteImportedWhatsApp"
          >
            Удалить импорт
          </button>
          <template v-else>
            <button
              type="button"
              class="connection-toolbar-btn danger"
              :disabled="isConnectionImportBusy || isConnectionPhotosBusy"
              @click="confirmDeleteImportedWhatsApp"
            >
              Подтвердить
            </button>
            <button
              type="button"
              class="connection-toolbar-btn"
              :disabled="isConnectionImportBusy || isConnectionPhotosBusy"
              @click="cancelDeleteImportedWhatsApp"
            >
              Отмена
            </button>
          </template>
        </div>
      </div>
    </div>

    <div v-if="showConnectionSyncBanner" class="connection-sync-banner" :class="{ error: Boolean(connectionGlobalError) }">
      <span class="connection-sync-text">
        {{ connectionGlobalError || connectionGlobalMessage }}
      </span>
      <span v-if="connectionBackgroundSyncActive" class="connection-sync-badge">Фоновая загрузка</span>
    </div>

    <section ref="collectionViewRef" class="collection-view">
      <div v-if="entitiesStore.loading" class="state">Загрузка...</div>
      <div v-else-if="entitiesStore.error" class="state state-error">{{ entitiesStore.error }}</div>
      <div v-else class="grid-layout">
        <button class="create-card" :disabled="isCreateBusy" @click="createEntity">
          <AppIcon name="plus" />
          <span class="create-card-label">{{ createButtonLabel }}</span>
        </button>

        <template v-if="firstEntity">
          <article
            v-if="activeType === 'project'"
            class="project-card"
            @click="onCardClick(firstEntity)"
          >
            <span class="project-progress">
              <ProfileProgressRing :value="entityProgress(firstEntity)" :size="28" :stroke-width="2.5">
                <span class="project-progress-dot" />
              </ProfileProgressRing>
            </span>
            <div class="project-thumbnail">
              <svg
                v-if="projectPreview(firstEntity)"
                class="project-preview-svg"
                viewBox="0 0 180 112"
                preserveAspectRatio="xMidYMid meet"
                aria-hidden="true"
              >
                <defs>
                  <clipPath
                    v-for="node in projectPreviewNodes(firstEntity)"
                    :id="node.clipId"
                    :key="`clip-${node.id}`"
                  >
                    <circle :cx="node.x" :cy="node.y" :r="node.r" />
                  </clipPath>
                </defs>
                <line
                  v-for="edge in projectPreviewEdges(firstEntity)"
                  :key="edge.id"
                  :x1="edge.x1"
                  :y1="edge.y1"
                  :x2="edge.x2"
                  :y2="edge.y2"
                  class="project-preview-edge"
                />
                <circle
                  v-for="node in projectPreviewNodes(firstEntity)"
                  :key="`bg-${node.id}`"
                  :cx="node.x"
                  :cy="node.y"
                  :r="node.r"
                  class="project-preview-node"
                  :style="{ fill: node.color }"
                />
                <template v-for="node in projectPreviewNodes(firstEntity)" :key="`content-${node.id}`">
                  <image
                    v-if="node && node.image"
                    :href="node.image"
                    :x="node.x - node.r"
                    :y="node.y - node.r"
                    :width="node.r * 2"
                    :height="node.r * 2"
                    preserveAspectRatio="xMidYMid slice"
                    :clip-path="`url(#${node.clipId})`"
                  />
                  <text
                    v-else-if="node && node.emoji"
                    :x="node.x"
                    :y="node.y"
                    class="project-preview-emoji"
                  >
                    {{ node.emoji }}
                  </text>
                  <text
                    v-else
                    :x="node.x"
                    :y="node.y"
                    class="project-preview-glyph"
                  >
                    {{ node.glyph }}
                  </text>
                </template>
              </svg>
            </div>
            <div class="project-info">
              <input
                class="project-name-input"
                type="text"
                :value="projectNameValue(firstEntity)"
                maxlength="64"
                :data-project-name-id="firstEntity._id"
                @pointerdown.stop
                @click="onProjectNameClick($event, firstEntity)"
                @focus="onProjectNameFocus($event, firstEntity)"
                @input="onProjectNameInput($event, firstEntity)"
                @keydown="onProjectNameKeydown($event, firstEntity)"
                @blur="commitProjectRename(firstEntity)"
              />
              <button
                type="button"
                class="project-delete-btn"
                title="Удалить"
                @click="openProjectDeleteConfirm(firstEntity, $event)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                </svg>
              </button>
            </div>
          </article>

          <article
            v-else-if="activeType === 'connection'"
            class="entity-card connection-card"
            @click="onCardClick(firstEntity)"
          >
            <div class="card-cycle-wrap">
              <ProfileProgressRing class="card-progress-ring" :value="entityProgress(firstEntity)" :size="84" :stroke-width="4" />
              <div class="card-cycle" :style="{ background: entityColor(firstEntity), borderColor: entityColor(firstEntity) }">
                <img v-if="entityImage(firstEntity)" class="card-image" :src="entityImage(firstEntity)" alt="" />
                <span v-else-if="entityEmoji(firstEntity)" class="card-emoji">{{ entityEmoji(firstEntity) }}</span>
                <AppIcon v-else :name="firstEntity.type" class="card-icon" />
              </div>
            </div>
            <div class="card-name">{{ firstEntity.name }}</div>
            <div v-if="activeType === 'connection'" class="connection-meta">
              {{ connectionMeta(firstEntity) }}
            </div>
            <div v-if="activeType === 'connection'" class="connection-actions">
              <button
                type="button"
                class="connection-action-btn"
                :disabled="isConnectionMoveBusy(firstEntity._id)"
                @click="moveConnectionTo(firstEntity, 'person', $event)"
              >
                В Персоны
              </button>
              <button
                type="button"
                class="connection-action-btn"
                :disabled="isConnectionMoveBusy(firstEntity._id)"
                @click="moveConnectionTo(firstEntity, 'company', $event)"
              >
                В Компании
              </button>
            </div>
          </article>

          <button
            v-else
            class="entity-card"
            @click="onCardClick(firstEntity)"
          >
            <div class="card-cycle-wrap">
              <ProfileProgressRing class="card-progress-ring" :value="entityProgress(firstEntity)" :size="84" :stroke-width="4" />
              <div class="card-cycle" :style="{ background: entityColor(firstEntity), borderColor: entityColor(firstEntity) }">
                <img v-if="entityImage(firstEntity)" class="card-image" :src="entityImage(firstEntity)" alt="" />
                <span v-else-if="entityEmoji(firstEntity)" class="card-emoji">{{ entityEmoji(firstEntity) }}</span>
                <AppIcon v-else :name="firstEntity.type" class="card-icon" />
              </div>
            </div>
            <div class="card-name">{{ firstEntity.name }}</div>
            <div v-if="activeType === 'company' && companyPhone(firstEntity)" class="entity-phone-meta">
              {{ companyPhone(firstEntity) }}
            </div>
          </button>
        </template>

        <template v-for="entity in remainingEntities" :key="entity._id">
          <article
            v-if="activeType === 'project'"
            class="project-card"
            @click="onCardClick(entity)"
          >
            <span class="project-progress">
              <ProfileProgressRing :value="entityProgress(entity)" :size="28" :stroke-width="2.5">
                <span class="project-progress-dot" />
              </ProfileProgressRing>
            </span>
            <div class="project-thumbnail">
              <svg
                v-if="projectPreview(entity)"
                class="project-preview-svg"
                viewBox="0 0 180 112"
                preserveAspectRatio="xMidYMid meet"
                aria-hidden="true"
              >
                <defs>
                  <clipPath
                    v-for="node in projectPreviewNodes(entity)"
                    :id="node.clipId"
                    :key="`clip-${node.id}`"
                  >
                    <circle :cx="node.x" :cy="node.y" :r="node.r" />
                  </clipPath>
                </defs>
                <line
                  v-for="edge in projectPreviewEdges(entity)"
                  :key="edge.id"
                  :x1="edge.x1"
                  :y1="edge.y1"
                  :x2="edge.x2"
                  :y2="edge.y2"
                  class="project-preview-edge"
                />
                <circle
                  v-for="node in projectPreviewNodes(entity)"
                  :key="`bg-${node.id}`"
                  :cx="node.x"
                  :cy="node.y"
                  :r="node.r"
                  class="project-preview-node"
                  :style="{ fill: node.color }"
                />
                <template v-for="node in projectPreviewNodes(entity)" :key="`content-${node.id}`">
                  <image
                    v-if="node && node.image"
                    :href="node.image"
                    :x="node.x - node.r"
                    :y="node.y - node.r"
                    :width="node.r * 2"
                    :height="node.r * 2"
                    preserveAspectRatio="xMidYMid slice"
                    :clip-path="`url(#${node.clipId})`"
                  />
                  <text
                    v-else-if="node && node.emoji"
                    :x="node.x"
                    :y="node.y"
                    class="project-preview-emoji"
                  >
                    {{ node.emoji }}
                  </text>
                  <text
                    v-else
                    :x="node.x"
                    :y="node.y"
                    class="project-preview-glyph"
                  >
                    {{ node.glyph }}
                  </text>
                </template>
              </svg>
            </div>
            <div class="project-info">
              <input
                class="project-name-input"
                type="text"
                :value="projectNameValue(entity)"
                maxlength="64"
                :data-project-name-id="entity._id"
                @pointerdown.stop
                @click="onProjectNameClick($event, entity)"
                @focus="onProjectNameFocus($event, entity)"
                @input="onProjectNameInput($event, entity)"
                @keydown="onProjectNameKeydown($event, entity)"
                @blur="commitProjectRename(entity)"
              />
              <button
                type="button"
                class="project-delete-btn"
                title="Удалить"
                @click="openProjectDeleteConfirm(entity, $event)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                </svg>
              </button>
            </div>
          </article>

          <article
            v-else-if="activeType === 'connection'"
            class="entity-card connection-card"
            @click="onCardClick(entity)"
          >
            <div class="card-cycle-wrap">
              <ProfileProgressRing class="card-progress-ring" :value="entityProgress(entity)" :size="84" :stroke-width="4" />
              <div class="card-cycle" :style="{ background: entityColor(entity), borderColor: entityColor(entity) }">
                <img v-if="entityImage(entity)" class="card-image" :src="entityImage(entity)" alt="" />
                <span v-else-if="entityEmoji(entity)" class="card-emoji">{{ entityEmoji(entity) }}</span>
                <AppIcon v-else :name="entity.type" class="card-icon" />
              </div>
            </div>
            <div class="card-name">{{ entity.name }}</div>
            <div v-if="activeType === 'connection'" class="connection-meta">
              {{ connectionMeta(entity) }}
            </div>
            <div v-if="activeType === 'connection'" class="connection-actions">
              <button
                type="button"
                class="connection-action-btn"
                :disabled="isConnectionMoveBusy(entity._id)"
                @click="moveConnectionTo(entity, 'person', $event)"
              >
                В Персоны
              </button>
              <button
                type="button"
                class="connection-action-btn"
                :disabled="isConnectionMoveBusy(entity._id)"
                @click="moveConnectionTo(entity, 'company', $event)"
              >
                В Компании
              </button>
            </div>
          </article>

          <button
            v-else
            class="entity-card"
            @click="onCardClick(entity)"
          >
            <div class="card-cycle-wrap">
              <ProfileProgressRing class="card-progress-ring" :value="entityProgress(entity)" :size="84" :stroke-width="4" />
              <div class="card-cycle" :style="{ background: entityColor(entity), borderColor: entityColor(entity) }">
                <img v-if="entityImage(entity)" class="card-image" :src="entityImage(entity)" alt="" />
                <span v-else-if="entityEmoji(entity)" class="card-emoji">{{ entityEmoji(entity) }}</span>
                <AppIcon v-else :name="entity.type" class="card-icon" />
              </div>
            </div>
            <div class="card-name">{{ entity.name }}</div>
            <div v-if="activeType === 'company' && companyPhone(entity)" class="entity-phone-meta">
              {{ companyPhone(entity) }}
            </div>
          </button>
        </template>
      </div>
    </section>

    <EntityInfoModal
      v-if="entityInfoEntityId"
      :entity-id="entityInfoEntityId"
      @close="closeEntityInfoModal"
    />

    <div
      v-if="projectDeleteTarget"
      class="project-delete-overlay"
      @pointerdown.self="closeProjectDeleteConfirm"
    >
      <div class="project-delete-card" @pointerdown.stop>
        <h3 class="project-delete-title">Удалить проект?</h3>
        <p class="project-delete-text">
          "{{ projectDeleteTarget.name || 'Без названия' }}" будет удален из базы.
        </p>
        <p class="project-delete-text">
          Все ноды этого проекта также будут удалены из базы и из всех других проектов.
        </p>
        <p class="project-delete-warning">Действие необратимо.</p>
        <div class="project-delete-actions">
          <button
            type="button"
            class="project-delete-btn-secondary"
            :disabled="isProjectDeleteBusy"
            @click="closeProjectDeleteConfirm"
          >
            Отмена
          </button>
          <button
            type="button"
            class="project-delete-btn-danger"
            :disabled="isProjectDeleteBusy"
            @click="confirmProjectDelete"
          >
            Удалить
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="isConnectionImportModalOpen"
      class="connection-import-overlay"
      @pointerdown.self="closeConnectionImportModal"
    >
      <div class="connection-import-card" @pointerdown.stop>
        <h3 class="connection-import-title">Подключение WhatsApp</h3>
        <p class="connection-import-text">
          Сканируйте QR-код и импортируйте контакты один раз. Мы не получаем постоянный доступ к вашей адресной книге.
        </p>
        <p class="connection-import-note">
          Разовое подключение: если в WhatsApp появятся новые контакты, запустите импорт повторно.
        </p>

        <div
          class="connection-status-badge"
          :class="`status-${connectionImportSessionStatus}`"
        >
          {{ connectionSessionStatusLabel() }}
        </div>

        <div
          v-if="connectionImportQrCode && connectionImportSessionStatus !== 'importing'"
          class="connection-qr-wrap"
        >
          <img class="connection-qr-image" :src="connectionImportQrCode" alt="WhatsApp QR" />
          <p class="connection-qr-hint">Сканируйте QR-код в WhatsApp на телефоне.</p>
        </div>
        <div
          v-else-if="connectionImportSessionStatus !== 'importing'"
          class="connection-qr-placeholder"
        >
          QR загружается. Если код не появился, нажмите «{{ connectionSessionActionLabel() }}».
        </div>

        <div class="connection-import-actions">
          <button
            type="button"
            class="connection-link-btn"
            :disabled="isConnectionImportBusy || isConnectionPhotosBusy || connectionImportSessionStatus === 'initializing' || connectionImportSessionStatus === 'importing'"
            @click="startConnectionSession"
          >
            {{ connectionSessionActionLabel() }}
          </button>
          <button
            v-if="connectionImportSessionStatus === 'ready'"
            type="button"
            class="connection-import-btn"
            :disabled="isConnectionImportBusy || isConnectionPhotosBusy"
            @click="importWhatsAppContacts"
          >
            {{ isConnectionImportBusy ? 'Импорт...' : 'Импортировать контакты' }}
          </button>
        </div>

        <div v-if="connectionImportProgress" class="connection-progress-wrap">
          <div class="connection-progress-head">
            <span>{{ connectionImportProgress.note || 'Импорт контактов' }}</span>
            <span>{{ Math.round(connectionImportProgress.percent) }}%</span>
          </div>
          <div class="connection-progress-track">
            <div class="connection-progress-fill" :style="{ width: `${connectionImportProgress.percent}%` }"></div>
          </div>
          <div
            v-if="connectionImportProgress.total > 0"
            class="connection-progress-meta"
          >
            {{ connectionImportProgress.processed }} / {{ connectionImportProgress.total }}
          </div>
        </div>

        <p v-if="connectionImportSessionStatus === 'importing'" class="connection-step-hint">
          Идет импорт контактов. QR скрыт до завершения шага.
        </p>
        <p v-else-if="connectionImportSessionStatus !== 'ready'" class="connection-step-hint">
          1) Сканируйте QR в WhatsApp -> Связанные устройства. 2) Дождитесь статуса «Подключено». 3) Нажмите «Импортировать контакты».
        </p>

        <div v-if="connectionImportStats" class="connection-import-stats">
          <span>Всего найдено: {{ connectionImportStats.total }}</span>
          <span>Совпадения: {{ connectionImportStats.matched }}</span>
          <span>Новых доступно: {{ connectionImportStats.newAvailable }}</span>
          <span>Совпадений по телефону: {{ connectionImportStats.matchedByPhone }}</span>
          <span>Совпадений по ключу: {{ connectionImportStats.matchedByImportKey }}</span>
          <span>Совпадений по JID: {{ connectionImportStats.matchedByJid }}</span>
          <span>Совпадений по имени: {{ connectionImportStats.matchedByName }}</span>
          <span>Новых с именем: {{ connectionImportStats.newWithName }}</span>
          <span>Новых без имени: {{ connectionImportStats.newWithoutName }}</span>
          <span>Импортировано сразу с фото: {{ connectionImportStats.importedWithImage }}</span>
        </div>

        <p v-if="connectionImportMessage" class="connection-import-message">
          {{ connectionImportMessage }}
        </p>
        <p v-if="connectionImportError" class="connection-import-error">
          {{ connectionImportError }}
        </p>
        <div class="connection-logs-actions">
          <button
            type="button"
            class="connection-log-btn"
            :disabled="isConnectionCopyLogsBusy"
            @click="copyConnectionLogs"
          >
            {{ isConnectionCopyLogsBusy ? 'Сбор логов...' : 'Скопировать логи' }}
          </button>
          <span v-if="connectionCopyLogsMessage" class="connection-log-copy-message">
            {{ connectionCopyLogsMessage }}
          </span>
        </div>
      </div>
    </div>

    <div
      v-if="connectionSuccessAlert"
      class="connection-success-overlay"
      @pointerdown.self="closeConnectionSuccessAlert"
    >
      <div class="connection-success-card" @pointerdown.stop>
        <h3 class="connection-success-title">{{ connectionSuccessAlert.title }}</h3>
        <p class="connection-success-text">{{ connectionSuccessAlert.message }}</p>
        <div class="connection-success-actions">
          <button type="button" class="connection-success-btn" @click="closeConnectionSuccessAlert">
            OK
          </button>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.workspace {
  height: 100%;
  min-height: 0;
  flex: 1;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.tools-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 24px;
  background: var(--bg-header);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(178, 197, 222, 0.72);
  box-shadow: none;
  z-index: 90;
  flex-wrap: nowrap;
  overflow-x: auto;
  flex-shrink: 0;
}

.tools-header::-webkit-scrollbar {
  display: none;
}

.connection-sync-banner {
  margin: 8px 32px 0;
  border: 1px solid #dbe4f3;
  border-radius: 12px;
  background: #f8fbff;
  min-height: 34px;
  padding: 7px 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: #334155;
  font-size: 12px;
  font-weight: 600;
}

.connection-sync-banner.error {
  border-color: #fecaca;
  background: #fff5f5;
  color: #b91c1c;
}

.connection-sync-text {
  flex: 1;
  min-width: 0;
  line-height: 1.35;
}

.connection-sync-badge {
  flex-shrink: 0;
  border: 1px solid #bcd3ff;
  background: #edf4ff;
  color: #1058ff;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  padding: 4px 8px;
}

.search-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-card);
  border: 1px solid transparent;
  padding: 5px 10px;
  border-radius: 20px;
  min-width: 220px;
  width: 220px;
  color: var(--text-muted);
  transition: 0.2s;
  box-shadow: var(--shadow-base);
  flex-shrink: 0;
}

.search-bar:focus-within {
  box-shadow: 0 0 0 2px var(--primary-soft), var(--shadow-base);
}

.search-bar input {
  border: none;
  outline: none;
  background: transparent;
  font-size: 12px;
  color: var(--text-main);
  width: 100%;
}

.search-bar input::placeholder {
  color: var(--text-muted);
}

.filters-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  flex-shrink: 0;
}

.filters-counter {
  height: 27px;
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  border-radius: 11px;
  background: rgba(250, 253, 255, 0.96);
  border: 1px solid #d2dfef;
  color: #475569;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  box-shadow: none;
  flex-shrink: 0;
}

.tools-right {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.connection-toolbar-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.connection-toolbar-btn {
  height: 27px;
  border-radius: 10px;
  border: 1px solid #d2dfef;
  background: rgba(250, 253, 255, 0.96);
  color: #334155;
  font-size: 10px;
  font-weight: 700;
  padding: 0 10px;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    color 0.16s ease;
}

.connection-toolbar-btn:hover:not(:disabled) {
  border-color: #95b8fb;
  background: #edf4ff;
  color: #1058ff;
}

.connection-toolbar-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.connection-toolbar-btn.danger {
  border-color: #fecaca;
  background: #fff1f2;
  color: #b91c1c;
}

.connection-toolbar-btn.danger:hover:not(:disabled) {
  border-color: #fca5a5;
  background: #ffe4e6;
  color: #991b1b;
}

.collection-view {
  min-height: 0;
  padding: 8px 32px 40px;
  overflow-y: auto;
  flex: 1;
}

.grid-layout {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 24px;
}

.create-card {
  background: var(--bg-card);
  border: 2px dashed #cbd5e1;
  border-radius: var(--radius-lg);
  min-height: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  cursor: pointer;
  transition: all 0.2s;
  gap: 12px;
}

.create-card:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: #fff;
}

.create-card:disabled {
  cursor: wait;
  opacity: 0.72;
}

.create-card-label {
  font-weight: 600;
}

.entity-card {
  background: #e6effc;
  border: 1px solid #d2e1fb;
  border-radius: var(--radius-lg);
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  min-height: 180px;
  position: relative;
  box-shadow: var(--shadow-base);
}

.entity-card.connection-card {
  padding: 18px 16px 14px;
  justify-content: flex-start;
}

.entity-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-hover);
}

.card-cycle-wrap {
  width: 84px;
  height: 84px;
  margin-bottom: 14px;
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.card-progress-ring {
  position: absolute;
  inset: 0;
}

.card-cycle {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: #1058ff;
  border: 1px solid #1058ff;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  overflow: hidden;
  z-index: 1;
}

.card-icon {
  width: 60%;
  height: 60%;
}

.card-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.card-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.card-emoji {
  font-size: 36px;
  line-height: 1;
}

.card-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-main);
  text-align: center;
}

.connection-meta {
  margin-top: 4px;
  font-size: 12px;
  color: #4b5f80;
  text-align: center;
}

.connection-actions {
  margin-top: 10px;
  width: 100%;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.connection-action-btn {
  height: 30px;
  border-radius: 9px;
  border: 1px solid #bfd5ff;
  background: #ffffff;
  color: #1058ff;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

.connection-action-btn:hover:not(:disabled) {
  background: #edf4ff;
  border-color: #95b8fb;
  color: #0b45cc;
}

.connection-action-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.project-card {
  background: #e6effc;
  border: 1px solid #d2e1fb;
  border-radius: var(--radius-lg);
  overflow: hidden;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  height: 180px;
  box-shadow: var(--shadow-base);
  position: relative;
}

.project-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-hover);
}

.project-thumbnail {
  flex: 1 1 auto;
  min-height: 0;
  background: #e6effc;
  background-image: radial-gradient(rgba(148, 163, 184, 0.45) 1px, transparent 1px);
  background-size: 16px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 12px;
  border-bottom: 1px solid var(--border-color);
}

.project-preview-svg {
  width: 100%;
  height: 100%;
  display: block;
}

.project-preview-edge {
  stroke: rgba(51, 65, 85, 0.3);
  stroke-width: 1.6;
}

.project-preview-node {
  fill: rgba(16, 88, 255, 0.92);
  stroke: rgba(255, 255, 255, 0.92);
  stroke-width: 1.4;
}

.project-preview-glyph,
.project-preview-emoji {
  fill: #ffffff;
  font-size: 11px;
  font-weight: 700;
  text-anchor: middle;
  dominant-baseline: middle;
  pointer-events: none;
}

.project-progress {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
}

.project-progress-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(16, 88, 255, 0.25);
}

.project-info {
  margin-top: auto;
  flex: 0 0 auto;
  border-radius: 16px;
  padding: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  border-top: 1px solid rgba(226, 232, 240, 0.95);
  background: #f6f9ff;
}

.project-name-input {
  flex: 1;
  min-width: 0;
  border: 1px solid hsl(218, 83%, 91%);
  border-radius: 8px;
  background: #ffffff;
  color: #1e293b;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 8px;
  outline: none;
}

.project-name-input:focus {
  border-color: #a9c5fb;
  box-shadow: 0 0 0 2px rgba(16, 88, 255, 0.14);
}

.project-delete-btn {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid #fecaca;
  background: #fff1f2;
  color: #dc2626;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease;
}

.project-delete-btn svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.project-delete-btn:hover {
  background: #ffe4e6;
  border-color: #fca5a5;
  color: #b91c1c;
}

.project-delete-overlay {
  position: fixed;
  inset: 0;
  z-index: 170;
  background: rgba(15, 23, 42, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.project-delete-card {
  width: min(420px, 100%);
  border-radius: 14px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  box-shadow: 0 18px 34px rgba(15, 23, 42, 0.3);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.project-delete-title {
  margin: 0;
  color: #0f172a;
  font-size: 16px;
  font-weight: 800;
}

.project-delete-text {
  margin: 0;
  color: #334155;
  font-size: 13px;
  line-height: 1.4;
}

.project-delete-warning {
  margin: 0;
  color: #b91c1c;
  font-size: 12px;
  font-weight: 700;
}

.project-delete-actions {
  margin-top: 4px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.project-delete-btn-secondary,
.project-delete-btn-danger {
  height: 32px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 700;
  padding: 0 12px;
  cursor: pointer;
}

.project-delete-btn-secondary {
  border: 1px solid #dbe4f3;
  background: #f8fafc;
  color: #334155;
}

.project-delete-btn-secondary:hover:not(:disabled) {
  border-color: #bfd5ff;
  background: #eef4ff;
  color: #1058ff;
}

.project-delete-btn-danger {
  border: 1px solid #fecaca;
  background: #fff1f2;
  color: #b91c1c;
}

.project-delete-btn-danger:hover:not(:disabled) {
  border-color: #fca5a5;
  background: #ffe4e6;
}

.project-delete-btn-secondary:disabled,
.project-delete-btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.connection-import-overlay {
  position: fixed;
  inset: 0;
  z-index: 180;
  background: rgba(15, 23, 42, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.connection-import-card {
  width: min(460px, 100%);
  border-radius: 14px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  box-shadow: 0 20px 34px rgba(15, 23, 42, 0.28);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.connection-import-title {
  margin: 0;
  color: #0f172a;
  font-size: 18px;
  font-weight: 800;
}

.connection-import-text {
  margin: 0;
  color: #475569;
  font-size: 13px;
}

.connection-import-note {
  margin: -2px 0 2px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.4;
}

.connection-provider-item {
  border-radius: 12px;
  border: 1px solid #dbe7ff;
  background: #f8fbff;
  padding: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.connection-provider-item.active {
  border-color: #98bcff;
  background: #eff5ff;
}

.connection-provider-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #1058ff;
  color: #ffffff;
  font-size: 14px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.connection-provider-content {
  min-width: 0;
}

.connection-provider-name {
  color: #0f172a;
  font-size: 14px;
  font-weight: 700;
}

.connection-provider-hint {
  color: #64748b;
  font-size: 12px;
  line-height: 1.3;
}

.connection-status-badge {
  align-self: flex-start;
  border-radius: 999px;
  border: 1px solid #dbe4f3;
  background: #f8fafc;
  color: #334155;
  font-size: 11px;
  font-weight: 700;
  padding: 4px 10px;
}

.connection-status-badge.status-ready {
  border-color: #99f6e4;
  background: #f0fdfa;
  color: #0f766e;
}

.connection-status-badge.status-qr,
.connection-status-badge.status-initializing,
.connection-status-badge.status-importing {
  border-color: #bfdbfe;
  background: #eff6ff;
  color: #1d4ed8;
}

.connection-status-badge.status-error,
.connection-status-badge.status-disconnected {
  border-color: #fecaca;
  background: #fff1f2;
  color: #b91c1c;
}

.connection-qr-wrap {
  width: 100%;
  border-radius: 12px;
  border: 1px dashed #bfd5ff;
  background: #f8fbff;
  padding: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.connection-qr-placeholder {
  width: 100%;
  border-radius: 12px;
  border: 1px dashed #cbd5e1;
  background: #f8fafc;
  min-height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
  font-size: 12px;
  text-align: center;
  padding: 12px;
}

.connection-qr-image {
  width: min(260px, 100%);
  aspect-ratio: 1 / 1;
  object-fit: contain;
  border-radius: 10px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
}

.connection-qr-hint {
  margin: 0;
  text-align: center;
  font-size: 12px;
  color: #64748b;
}

.connection-import-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.connection-progress-wrap {
  border-radius: 10px;
  border: 1px solid #dbe4f3;
  background: #f8fbff;
  padding: 10px;
  display: grid;
  gap: 6px;
}

.connection-progress-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #334155;
  font-size: 11px;
  font-weight: 700;
}

.connection-progress-track {
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  background: #e7eefb;
}

.connection-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6 0%, #1058ff 100%);
  transition: width 0.25s ease;
}

.connection-progress-meta {
  color: #64748b;
  font-size: 11px;
  font-weight: 600;
}

.connection-import-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 10px;
  border-radius: 10px;
  border: 1px solid #dbe4f3;
  background: #f8fbff;
  padding: 10px;
  color: #334155;
  font-size: 11px;
  font-weight: 600;
}

.connection-link-btn,
.connection-import-btn {
  height: 34px;
  border-radius: 10px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
  padding: 0 12px;
  cursor: pointer;
}

.connection-import-btn {
  border-color: #bcd3ff;
  background: #edf4ff;
  color: #1058ff;
}

.connection-link-btn:hover:not(:disabled),
.connection-import-btn:hover:not(:disabled) {
  border-color: #97b9ff;
}

.connection-link-btn:disabled,
.connection-import-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.connection-import-message {
  margin: 0;
  color: #0f766e;
  font-size: 12px;
  font-weight: 600;
}

.connection-import-error {
  margin: 0;
  color: #b91c1c;
  font-size: 12px;
  font-weight: 600;
}

.connection-step-hint {
  margin: 0;
  color: #475569;
  font-size: 12px;
  line-height: 1.4;
}

.connection-logs-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.connection-log-btn {
  height: 30px;
  border-radius: 10px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  color: #334155;
  font-size: 11px;
  font-weight: 700;
  padding: 0 10px;
  cursor: pointer;
}

.connection-log-btn:hover:not(:disabled) {
  border-color: #97b9ff;
}

.connection-log-btn:disabled {
  opacity: 0.7;
  cursor: wait;
}

.connection-log-copy-message {
  color: #475569;
  font-size: 11px;
  font-weight: 600;
}

.connection-success-overlay {
  position: absolute;
  inset: 0;
  z-index: 142;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.36);
}

.connection-success-card {
  width: min(380px, calc(100% - 28px));
  border-radius: 14px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  box-shadow: 0 22px 44px rgba(15, 23, 42, 0.3);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.connection-success-title {
  margin: 0;
  color: #0f172a;
  font-size: 16px;
  font-weight: 800;
}

.connection-success-text {
  margin: 0;
  color: #334155;
  font-size: 13px;
  line-height: 1.45;
}

.connection-success-actions {
  display: flex;
  justify-content: flex-end;
}

.connection-success-btn {
  height: 34px;
  min-width: 84px;
  border-radius: 10px;
  border: 1px solid #bcd3ff;
  background: #edf4ff;
  color: #1058ff;
  font-size: 12px;
  font-weight: 700;
  padding: 0 12px;
  cursor: pointer;
}

.connection-success-btn:hover {
  border-color: #97b9ff;
}

.entity-phone-meta {
  margin-top: 4px;
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}

.state {
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-md);
  padding: 18px;
  background: #fff;
  color: var(--text-muted);
}

.state-error {
  color: #dc2626;
}

@media (max-width: 900px) {
  .tools-header {
    padding: 12px;
    gap: 10px;
  }

  .connection-sync-banner {
    margin: 8px 12px 0;
  }

  .collection-view {
    padding: 8px 12px 24px;
  }
}
</style>
