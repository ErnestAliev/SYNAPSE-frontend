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
import QuickEntityVoiceModal from '../components/entity/QuickEntityVoiceModal.vue';
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
    { key: 'phones', label: 'Телефоны' },
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
    { key: 'phones', label: 'Телефоны' },
    { key: 'links', label: 'Ссылки' },
  ],
  resource: [
    { key: 'tags', label: 'Теги' },
    { key: 'markers', label: 'Метки' },
    { key: 'resources', label: 'Форматы' },
    { key: 'status', label: 'Статусы' },
    { key: 'importance', label: 'Значимость' },
    { key: 'owners', label: 'Владельцы' },
    { key: 'phones', label: 'Телефоны' },
    { key: 'links', label: 'Ссылки' },
  ],
  goal: [
    { key: 'tags', label: 'Теги' },
    { key: 'markers', label: 'Метки' },
    { key: 'priority', label: 'Приоритеты' },
    { key: 'metrics', label: 'Метрики' },
    { key: 'owners', label: 'Ответственные' },
    { key: 'status', label: 'Статусы' },
    { key: 'phones', label: 'Телефоны' },
    { key: 'links', label: 'Ссылки' },
  ],
  result: [
    { key: 'tags', label: 'Теги' },
    { key: 'markers', label: 'Метки' },
    { key: 'outcomes', label: 'Результаты' },
    { key: 'metrics', label: 'Метрики' },
    { key: 'importance', label: 'Значимость' },
    { key: 'owners', label: 'Ответственные' },
    { key: 'phones', label: 'Телефоны' },
    { key: 'links', label: 'Ссылки' },
  ],
  task: [
    { key: 'tags', label: 'Теги' },
    { key: 'markers', label: 'Метки' },
    { key: 'priority', label: 'Приоритеты' },
    { key: 'status', label: 'Статусы' },
    { key: 'owners', label: 'Ответственные' },
    { key: 'date', label: 'Даты' },
    { key: 'phones', label: 'Телефоны' },
    { key: 'links', label: 'Ссылки' },
  ],
  project: [
    { key: 'tags', label: 'Теги' },
    { key: 'markers', label: 'Метки' },
    { key: 'stage', label: 'Стадии' },
    { key: 'priority', label: 'Приоритеты' },
    { key: 'risks', label: 'Риски' },
    { key: 'owners', label: 'Ответственные' },
    { key: 'phones', label: 'Телефоны' },
    { key: 'links', label: 'Ссылки' },
  ],
  shape: [
    { key: 'tags', label: 'Теги' },
    { key: 'markers', label: 'Метки' },
    { key: 'importance', label: 'Значимость' },
    { key: 'status', label: 'Статусы' },
    { key: 'phones', label: 'Телефоны' },
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
const quickVoiceEntityId = ref<string | null>(null);
const CARD_HOLD_OPEN_DELAY_MS = 1000;
const CARD_HOLD_MOVE_CANCEL_PX = 10;
const CARD_HOLD_CLICK_SUPPRESS_MS = 900;
const cardHoldState = ref<{
  entityId: string;
  pointerId: number;
  startX: number;
  startY: number;
  timer: ReturnType<typeof setTimeout>;
} | null>(null);
const suppressCardClickUntilByEntityId = ref<Record<string, number>>({});
// Deferred full-refresh flag. Set when a fetchEntities() call was
// requested while the EntityInfoModal was open. The fetch runs as soon as
// the modal closes so we never miss the refresh but also never stomp
// mid-edit entity state.
const pendingEntitiesRefetch = ref(false);
const activeProjectRenameId = ref<string | null>(null);
const projectRenameDraft = ref('');
const projectDeleteTarget = ref<Entity | null>(null);
const isProjectDeleteBusy = ref(false);
const isCreateBusy = ref(false);
const isConnectionImportModalOpen = ref(false);
const connectionDialogMode = ref<'qr' | 'prompt_action'>('qr');
const isConnectionImportBusy = ref(false);
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
  updatedNames: number;
  updatedImages: number;
} | null>(null);
const connectionMoveBusyById = ref<Record<string, boolean>>({});
const connectionImportSessionId = ref('');
const connectionImportQrCode = ref('');
const connectionImportSessionStatus = ref<
  'idle' | 'initializing' | 'qr' | 'ready' | 'importing' | 'error' | 'disconnected'
>('idle');
const connectionSessionStatus = ref<
  'idle' | 'initializing' | 'qr' | 'prompt_action' | 'importing' | 'paused' | 'ready'
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
const isConnectionPhotosBusy = ref(false);
const isDeleteWhatsappConfirmVisible = ref(false);
const connectionBackgroundSyncActive = ref(false);
const connectionBackgroundState = ref('');
const connectionBackgroundLastCursor = ref(0);
const connectionBackgroundLastState = ref('');
const isConnectionStateHydrated = ref(false);
const connectionAwaitingBackgroundStart = ref(false);
const connectionGlobalMessage = ref('');
const connectionGlobalError = ref('');
const CONNECTION_IMPORT_REQUEST_TIMEOUT_MS = 180_000;
const WHATSAPP_BG_SESSION_STORAGE_KEY = 'synapse.whatsapp.background.session';

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
  backgroundImport?: {
    state?: string;
    includeImages?: boolean;
    overwriteNames?: boolean;
    cursor?: number;
    total?: number;
    imported?: number;
    matched?: number;
    newWithName?: number;
    newWithoutName?: number;
    importedWithImage?: number;
    updatedNames?: number;
    updatedImages?: number;
    batchSize?: number;
    startedAt?: string;
    updatedAt?: string;
    endedAt?: string;
    error?: string;
  };
}

interface WhatsappDeleteImportedResult {
  deleted: number;
}

function resetConnectionSessionStateToIdle() {
  connectionImportSessionId.value = '';
  connectionImportQrCode.value = '';
  connectionImportSessionStatus.value = 'idle';
  connectionSessionStatus.value = 'idle';
  connectionDialogMode.value = 'qr';
  isConnectionImportModalOpen.value = false;
  connectionBackgroundState.value = '';
  connectionBackgroundLastState.value = '';
  connectionBackgroundLastCursor.value = 0;
  connectionImportProgress.value = null;
  connectionBackgroundSyncActive.value = false;
  connectionAwaitingBackgroundStart.value = false;
  isConnectionStateHydrated.value = false;
}

function syncConnectionSessionStatus() {
  if (
    isConnectionImportModalOpen.value &&
    connectionDialogMode.value === 'prompt_action' &&
    connectionImportSessionStatus.value === 'ready' &&
    !isConnectionBackgroundRunning.value &&
    !connectionAwaitingBackgroundStart.value
  ) {
    connectionSessionStatus.value = 'prompt_action';
    return;
  }

  if (connectionBackgroundState.value === 'paused') {
    connectionSessionStatus.value = 'paused';
    return;
  }

  if (
    connectionAwaitingBackgroundStart.value ||
    connectionBackgroundState.value === 'running' ||
    connectionImportSessionStatus.value === 'importing'
  ) {
    connectionSessionStatus.value = 'importing';
    return;
  }

  if (connectionImportSessionStatus.value === 'initializing') {
    connectionSessionStatus.value = 'initializing';
    return;
  }
  if (connectionImportSessionStatus.value === 'qr') {
    connectionSessionStatus.value = 'qr';
    return;
  }
  if (connectionImportSessionStatus.value === 'ready') {
    connectionSessionStatus.value = 'ready';
    return;
  }

  connectionSessionStatus.value = 'idle';
}

function openPromptActionDialog() {
  connectionDialogMode.value = 'prompt_action';
  isConnectionImportModalOpen.value = true;
  syncConnectionSessionStatus();
}

function openQrConnectionDialog() {
  connectionDialogMode.value = 'qr';
  isConnectionImportModalOpen.value = true;
  syncConnectionSessionStatus();
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
  if (typeof image === 'string' && image.trim().length > 0) {
    return true;
  }
  const profile = toProfile(entity);
  return profile.has_image === true || profile.hasImage === true;
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
const isConnectionBackgroundRunning = computed(
  () => connectionBackgroundState.value === 'running' || connectionBackgroundState.value === 'paused',
);
const isConnectionCreateBlocked = computed(
  () =>
    activeType.value === 'connection' &&
    (
      isConnectionImportBusy.value ||
      ['importing', 'paused'].includes(connectionSessionStatus.value)
    ),
);
const showConnectionSyncBanner = computed(() => Boolean(connectionGlobalMessage.value) || Boolean(connectionGlobalError.value));
const connectionImportProgressPercent = computed(() =>
  Math.max(0, Math.min(100, Math.round(connectionImportProgress.value?.percent || 0))),
);
const connectionImportProgressProcessed = computed(() =>
  Math.max(0, Number(connectionImportProgress.value?.processed) || 0),
);
const connectionImportProgressTotal = computed(() =>
  Math.max(0, Number(connectionImportProgress.value?.total) || 0),
);
const connectionToolbarProgressLabel = computed(() => {
  const percent = connectionImportProgressPercent.value;
  const processed = connectionImportProgressProcessed.value;
  const total = connectionImportProgressTotal.value;
  if (total > 0) {
    return `${connectionSessionStatus.value === 'paused' ? 'Пауза' : 'Загрузка'} ${percent}% (${processed}/${total})`;
  }
  return `${connectionSessionStatus.value === 'paused' ? 'Пауза' : 'Загрузка'} ${percent}%`;
});

function storeTrackedWhatsappBackgroundSession(sessionId: string) {
  if (typeof window === 'undefined') return;
  const normalized = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!normalized) return;
  try {
    window.localStorage.setItem(
      WHATSAPP_BG_SESSION_STORAGE_KEY,
      JSON.stringify({
        sessionId: normalized,
        trackedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // Ignore storage failures.
  }
}

function readTrackedWhatsappBackgroundSession() {
  if (typeof window === 'undefined') return '';
  try {
    const raw = window.localStorage.getItem(WHATSAPP_BG_SESSION_STORAGE_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { sessionId?: unknown };
    return typeof parsed?.sessionId === 'string' ? parsed.sessionId.trim() : '';
  } catch {
    return '';
  }
}

function clearTrackedWhatsappBackgroundSession() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(WHATSAPP_BG_SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

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
  connectionGlobalMessage.value = '';
  connectionGlobalError.value = '';
  const trackedSessionId = readTrackedWhatsappBackgroundSession();
  if (trackedSessionId) {
    connectionImportSessionId.value = trackedSessionId;
    scheduleConnectionImportPoll(600);
  } else if (activeType.value === 'connection') {
    void fetchCurrentConnectionSession({ silent: true });
  }
});

onBeforeUnmount(() => {
  clearCardHoldState();
  clearConnectionImportPoll();
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
  connectionGlobalMessage.value = '';
  connectionGlobalError.value = '';
  if (connectionImportPollTimer.value && !isConnectionBackgroundRunning.value) {
    clearTimeout(connectionImportPollTimer.value);
    connectionImportPollTimer.value = null;
  }
  isConnectionImportModalOpen.value = false;
  const trackedSessionId = readTrackedWhatsappBackgroundSession();
  if (trackedSessionId && !connectionImportSessionId.value) {
    connectionImportSessionId.value = trackedSessionId;
  }
  if (trackedSessionId) {
    scheduleConnectionImportPoll(800);
  } else if (activeType.value === 'connection') {
    void fetchCurrentConnectionSession({ silent: true });
  }
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
  if (
    axios.isAxiosError(error) &&
    !error.response &&
    (error.code === 'ECONNABORTED' || /timeout/i.test(String(error.message || '')))
  ) {
    return 'Импорт занял слишком много времени для текущего таймаута клиента. Повторите снова — запрос будет ждать дольше.';
  }

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

async function fetchCurrentConnectionSession(options?: { silent?: boolean }) {
  try {
    const { data } = await apiClient.get<{ session?: WhatsappSessionStatus | null }>(
      '/integrations/whatsapp/session/current',
    );
    if (data?.session) {
      applyConnectionSessionState(data.session);
      const backgroundState =
        typeof data.session?.backgroundImport?.state === 'string'
          ? data.session.backgroundImport.state.trim().toLowerCase()
          : '';
      if (
        ['initializing', 'qr', 'importing'].includes(data.session.status) ||
        ['running', 'paused'].includes(backgroundState)
      ) {
        scheduleConnectionImportPoll(900);
      }
      return true;
    }

    resetConnectionSessionStateToIdle();
    return false;
  } catch (error) {
    if (!options?.silent) {
      connectionImportError.value = formatConnectionImportError(error);
    }
    return false;
  }
}

async function createEntity() {
  if (activeType.value === 'connection') {
    if (isConnectionCreateBlocked.value) {
      return;
    }
    isDeleteWhatsappConfirmVisible.value = false;
    appendConnectionClientLog('modal.open');
    void openConnectionDialogFromButton();
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
  const previousBackgroundState = connectionBackgroundState.value;
  const previousDialogMode = connectionDialogMode.value;
  const isFirstHydrationFrame = !isConnectionStateHydrated.value;
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
  } else if (session.status !== 'importing' && !connectionAwaitingBackgroundStart.value) {
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

  const background =
    session.backgroundImport && typeof session.backgroundImport === 'object' ? session.backgroundImport : null;
  const backgroundState =
    typeof background?.state === 'string' ? background.state.trim().toLowerCase() : '';
  connectionBackgroundState.value = backgroundState;
  const backgroundCursor = Math.max(0, Number(background?.cursor) || 0);
  const backgroundTotal = Math.max(0, Number(background?.total) || 0);
  const backgroundRunning = ['running', 'paused'].includes(backgroundState);
  connectionBackgroundSyncActive.value = backgroundRunning;
  if (backgroundRunning || ['completed', 'stopped', 'error'].includes(backgroundState)) {
    connectionAwaitingBackgroundStart.value = false;
  }

  if (background) {
    connectionImportStats.value = {
      total: Math.max(0, Number(background.total) || 0),
      imported: Math.max(0, Number(background.imported) || 0),
      matched: Math.max(0, Number(background.matched) || 0),
      matchedByPhone: 0,
      matchedByImportKey: 0,
      matchedByJid: 0,
      matchedByName: 0,
      newAvailable: Math.max(0, Number(background.imported) || 0),
      newWithName: Math.max(0, Number(background.newWithName) || 0),
      newWithoutName: Math.max(0, Number(background.newWithoutName) || 0),
      importedWithImage: Math.max(0, Number(background.importedWithImage) || 0),
      updatedNames: Math.max(0, Number(background.updatedNames) || 0),
      updatedImages: Math.max(0, Number(background.updatedImages) || 0),
    };

    const total = backgroundTotal;
    const processed = total > 0 ? Math.min(total, backgroundCursor) : backgroundCursor;
    const percent =
      total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : backgroundState === 'completed' ? 100 : 0;
    if (backgroundRunning) {
      connectionImportProgress.value = {
        stage: backgroundState,
        note: backgroundState === 'paused' ? 'Фоновый импорт на паузе' : 'Фоновый импорт контактов',
        processed,
        total,
        percent,
      };
    }
  }

  if (['error', 'disconnected'].includes(connectionImportSessionStatus.value)) {
    connectionAwaitingBackgroundStart.value = false;
  }

  if (backgroundRunning && backgroundCursor > 0 && backgroundCursor !== connectionBackgroundLastCursor.value) {
    connectionBackgroundLastCursor.value = backgroundCursor;
    void entitiesStore.fetchEntities({ silent: true });
  }

  if (backgroundRunning && connectionImportSessionId.value) {
    storeTrackedWhatsappBackgroundSession(connectionImportSessionId.value);
  }
  if (backgroundState && backgroundState !== connectionBackgroundLastState.value) {
    connectionBackgroundLastState.value = backgroundState;
    if (backgroundState === 'completed') {
      clearTrackedWhatsappBackgroundSession();
      connectionBackgroundSyncActive.value = false;
      connectionGlobalError.value = '';
      const imported = Math.max(0, Number(background?.imported) || 0);
      const updatedNames = Math.max(0, Number(background?.updatedNames) || 0);
      const updatedImages = Math.max(0, Number(background?.updatedImages) || 0);
      if (!isFirstHydrationFrame && ['running', 'paused'].includes(previousBackgroundState)) {
        connectionGlobalMessage.value = `Загрузка WhatsApp завершена: новых ${imported}, обновлено имен ${updatedNames}, фото ${updatedImages}.`;
      }
      void entitiesStore.fetchEntities({ silent: true });
    } else if (backgroundState === 'error') {
      clearTrackedWhatsappBackgroundSession();
      connectionBackgroundSyncActive.value = false;
      if (!isFirstHydrationFrame) {
        connectionGlobalError.value = typeof background?.error === 'string' ? background.error : 'Ошибка фонового импорта.';
      }
    } else if (backgroundState === 'stopped') {
      clearTrackedWhatsappBackgroundSession();
      connectionBackgroundSyncActive.value = false;
      if (!isFirstHydrationFrame && ['running', 'paused'].includes(previousBackgroundState)) {
        connectionGlobalMessage.value = 'Фоновый импорт остановлен.';
      }
      connectionGlobalError.value = '';
    }
  }

  const becameReadyAfterQr =
    connectionImportSessionStatus.value === 'ready' &&
    previousStatus !== 'ready' &&
    ['initializing', 'qr'].includes(previousStatus);
  if (becameReadyAfterQr && isConnectionImportModalOpen.value && previousDialogMode === 'qr') {
    openPromptActionDialog();
  }

  if (previousBackgroundState !== 'paused' && backgroundState === 'paused' && isConnectionImportModalOpen.value) {
    isConnectionImportModalOpen.value = false;
  }

  isConnectionStateHydrated.value = true;
  syncConnectionSessionStatus();
}

function scheduleConnectionImportPoll(delay = 1800) {
  clearConnectionImportPoll();
  connectionImportPollTimer.value = setTimeout(() => {
    void fetchConnectionSessionStatus();
  }, delay);
}

async function fetchConnectionSessionStatus() {
  if (!connectionImportSessionId.value) return;

  try {
    const { data } = await apiClient.get<{ session: WhatsappSessionStatus }>(
      `/integrations/whatsapp/session/${connectionImportSessionId.value}`,
    );
    applyConnectionSessionState(data.session);

    const backgroundState =
      typeof data.session?.backgroundImport?.state === 'string'
        ? data.session.backgroundImport.state.trim().toLowerCase()
        : '';
    if (
      data.session &&
      (
        isConnectionImportModalOpen.value ||
        ['initializing', 'qr', 'importing'].includes(data.session.status) ||
        ['running', 'paused'].includes(backgroundState)
      )
    ) {
      scheduleConnectionImportPoll(1800);
    }
  } catch (error) {
    connectionImportError.value = formatConnectionImportError(error);
    appendConnectionClientLog('session.poll.error', { message: connectionImportError.value });
    if (isConnectionBackgroundRunning.value) {
      scheduleConnectionImportPoll(3000);
    } else {
      connectionImportSessionStatus.value = 'error';
      syncConnectionSessionStatus();
      clearConnectionImportPoll();
    }
  }
}

async function startConnectionSession(options?: { preserveMessages?: boolean }) {
  if (isConnectionImportBusy.value) return;
  isConnectionImportBusy.value = true;
  if (!options?.preserveMessages) {
    connectionImportError.value = '';
    connectionGlobalError.value = '';
    connectionGlobalMessage.value = '';
    connectionImportStats.value = null;
    connectionImportProgress.value = null;
  }
  appendConnectionClientLog('session.start.request');
  clearConnectionImportPoll();

  try {
    const { data } = await apiClient.post<{ session: WhatsappSessionStatus }>(
      '/integrations/whatsapp/session/start',
      {},
    );
    applyConnectionSessionState(data.session);
    syncConnectionSessionStatus();
    appendConnectionClientLog('session.start.response', {
      status: data.session?.status,
      sessionId: data.session?.sessionId,
    });

    const backgroundState =
      typeof data.session?.backgroundImport?.state === 'string'
        ? data.session.backgroundImport.state.trim().toLowerCase()
        : '';
    if (
      data.session &&
      (
        ['initializing', 'qr', 'importing'].includes(data.session.status) ||
        ['running', 'paused'].includes(backgroundState)
      )
    ) {
      scheduleConnectionImportPoll(1200);
      openQrConnectionDialog();
    } else if (data.session?.status === 'ready') {
      openPromptActionDialog();
    }
    return data.session;
  } catch (error) {
    connectionImportError.value = formatConnectionImportError(error);
    connectionImportSessionStatus.value = 'error';
    syncConnectionSessionStatus();
    appendConnectionClientLog('session.start.error', { message: connectionImportError.value });
    clearConnectionImportPoll();
    return null;
  } finally {
    isConnectionImportBusy.value = false;
  }
}

async function openConnectionDialogFromButton() {
  if (isConnectionImportBusy.value || isConnectionPhotosBusy.value) return;

  if (connectionImportSessionId.value) {
    try {
      const { data } = await apiClient.get<{ session: WhatsappSessionStatus }>(
        `/integrations/whatsapp/session/${connectionImportSessionId.value}`,
      );
      applyConnectionSessionState(data.session);
    } catch {
      resetConnectionSessionStateToIdle();
    }
  } else {
    const hasCurrentSession = await fetchCurrentConnectionSession({ silent: true });
    if (!hasCurrentSession) {
      resetConnectionSessionStateToIdle();
    }
  }

  if (['importing', 'paused'].includes(connectionSessionStatus.value)) {
    scheduleConnectionImportPoll(1000);
    return;
  }

  if (connectionImportSessionStatus.value === 'ready' && connectionImportSessionId.value) {
    openPromptActionDialog();
    scheduleConnectionImportPoll(1200);
    return;
  }

  if (['initializing', 'qr'].includes(connectionImportSessionStatus.value) && connectionImportSessionId.value) {
    openQrConnectionDialog();
    scheduleConnectionImportPoll(800);
    return;
  }

  const session = await startConnectionSession();
  if (!session) return;

  const status = typeof session.status === 'string' ? session.status.trim().toLowerCase() : 'idle';
  if (status === 'ready') {
    openPromptActionDialog();
    return;
  }
  if (['initializing', 'qr'].includes(status)) {
    openQrConnectionDialog();
    scheduleConnectionImportPoll(800);
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
    clearTrackedWhatsappBackgroundSession();
    connectionImportSessionId.value = '';
    connectionImportQrCode.value = '';
    connectionImportSessionStatus.value = 'idle';
    connectionSessionStatus.value = 'idle';
    connectionImportProgress.value = null;
    connectionBackgroundState.value = '';
    connectionBackgroundLastState.value = '';
    connectionBackgroundLastCursor.value = 0;
    connectionAwaitingBackgroundStart.value = false;
    connectionDialogMode.value = 'qr';
    isConnectionImportModalOpen.value = false;
    isDeleteWhatsappConfirmVisible.value = false;
  }
}

async function closeConnectionImportModal() {
  if (isConnectionImportBusy.value || isConnectionPhotosBusy.value) return;
  appendConnectionClientLog('modal.close');
  if (['importing', 'paused'].includes(connectionSessionStatus.value)) {
    connectionGlobalMessage.value = 'Загрузка продолжается в фоне. Сообщим, когда обновление завершится.';
    scheduleConnectionImportPoll(1400);
  } else if (!connectionBackgroundSyncActive.value) {
    clearConnectionImportPoll();
  }
  isConnectionImportModalOpen.value = false;
  syncConnectionSessionStatus();
}

async function disconnectWhatsappSession() {
  if (isConnectionImportBusy.value || isConnectionPhotosBusy.value) return;
  isConnectionImportBusy.value = true;
  connectionImportError.value = '';
  try {
    await stopConnectionSession();
    connectionBackgroundSyncActive.value = false;
    clearConnectionImportPoll();
    connectionGlobalMessage.value = 'WhatsApp-сессия отключена.';
    connectionGlobalError.value = '';
    isConnectionImportModalOpen.value = false;
  } finally {
    isConnectionImportBusy.value = false;
  }
}

async function openConnectionControlPanel() {
  await openConnectionDialogFromButton();
}

function setConnectionGlobalMessage(message: string) {
  connectionGlobalMessage.value = message;
}

async function importWhatsAppContacts(options?: { overwriteNames?: boolean }) {
  if (isConnectionImportBusy.value) return;
  if (isConnectionBackgroundRunning.value) return;
  if (!connectionImportSessionId.value) {
    connectionImportError.value = 'Сначала запустите подключение WhatsApp.';
    return;
  }
  if (connectionImportSessionStatus.value !== 'ready') {
    connectionImportError.value = 'Подключение еще не готово. Сканируйте QR и дождитесь статуса "Подключено".';
    return;
  }

  isConnectionImportBusy.value = true;
  connectionAwaitingBackgroundStart.value = true;
  connectionImportError.value = '';
  connectionGlobalError.value = '';
  connectionImportProgress.value = {
    stage: 'prepare',
    note: 'Запуск фонового импорта',
    processed: 0,
    total: 0,
    percent: 5,
  };
  connectionSessionStatus.value = 'importing';
  appendConnectionClientLog('import.background.start.request', { sessionId: connectionImportSessionId.value });
  clearConnectionImportPoll();

  try {
    const { data } = await apiClient.post<{ started: boolean; session: WhatsappSessionStatus }>(
      '/integrations/whatsapp/import/background/start',
      {
        sessionId: connectionImportSessionId.value,
        includeImages: true,
        overwriteNames: options?.overwriteNames === true,
        cursor: 0,
        batchSize: 80,
      },
      {
        timeout: CONNECTION_IMPORT_REQUEST_TIMEOUT_MS,
      },
    );
    applyConnectionSessionState(data.session);
    if (!['running', 'paused'].includes(connectionBackgroundState.value)) {
      connectionAwaitingBackgroundStart.value = true;
    }
    connectionBackgroundSyncActive.value = true;
    if (data.session?.sessionId) {
      storeTrackedWhatsappBackgroundSession(data.session.sessionId);
    }
    appendConnectionClientLog('import.background.start.response', {
      sessionId: data.session?.sessionId,
      state: data.session?.backgroundImport?.state,
    });
    scheduleConnectionImportPoll(1200);
    isConnectionImportModalOpen.value = false;
    syncConnectionSessionStatus();
  } catch (error) {
    connectionAwaitingBackgroundStart.value = false;
    connectionBackgroundSyncActive.value = false;
    connectionBackgroundState.value = '';
    if (connectionImportSessionId.value) {
      connectionImportSessionStatus.value = 'ready';
    }
    syncConnectionSessionStatus();
    connectionImportError.value = formatConnectionImportError(error);
    connectionGlobalError.value = connectionImportError.value;
    appendConnectionClientLog('import.background.start.error', { message: connectionImportError.value });
  } finally {
    isConnectionImportBusy.value = false;
  }
}

async function triggerContactsUpdateFromConnected() {
  if (isConnectionImportBusy.value || isConnectionPhotosBusy.value) return;
  await importWhatsAppContacts();
}

async function triggerContactsOverwriteFromConnected() {
  if (isConnectionImportBusy.value || isConnectionPhotosBusy.value) return;
  await importWhatsAppContacts({ overwriteNames: true });
}

async function pauseBackgroundImport() {
  if (!connectionImportSessionId.value || isConnectionImportBusy.value) return;
  isConnectionImportBusy.value = true;
  connectionAwaitingBackgroundStart.value = false;
  connectionBackgroundState.value = 'paused';
  connectionImportError.value = '';
  try {
    const { data } = await apiClient.post<{ paused: boolean; session: WhatsappSessionStatus }>(
      '/integrations/whatsapp/import/background/pause',
      { sessionId: connectionImportSessionId.value },
    );
    applyConnectionSessionState(data.session);
    scheduleConnectionImportPoll(1200);
  } catch (error) {
    connectionImportError.value = formatConnectionImportError(error);
  } finally {
    isConnectionImportBusy.value = false;
  }
}

async function resumeBackgroundImport() {
  if (!connectionImportSessionId.value || isConnectionImportBusy.value) return;
  isConnectionImportBusy.value = true;
  connectionAwaitingBackgroundStart.value = false;
  connectionBackgroundState.value = 'running';
  connectionImportError.value = '';
  try {
    const { data } = await apiClient.post<{ resumed: boolean; session: WhatsappSessionStatus }>(
      '/integrations/whatsapp/import/background/resume',
      { sessionId: connectionImportSessionId.value },
    );
    applyConnectionSessionState(data.session);
    scheduleConnectionImportPoll(1200);
  } catch (error) {
    connectionImportError.value = formatConnectionImportError(error);
  } finally {
    isConnectionImportBusy.value = false;
  }
}

async function stopBackgroundImport() {
  if (!connectionImportSessionId.value || isConnectionImportBusy.value) return;
  isConnectionImportBusy.value = true;
  connectionAwaitingBackgroundStart.value = false;
  connectionImportError.value = '';
  try {
    const { data } = await apiClient.post<{ stopped: boolean; session: WhatsappSessionStatus }>(
      '/integrations/whatsapp/import/background/stop',
      { sessionId: connectionImportSessionId.value },
    );
    applyConnectionSessionState(data.session);
    connectionBackgroundSyncActive.value = false;
    clearTrackedWhatsappBackgroundSession();
    scheduleConnectionImportPoll(800);
    syncConnectionSessionStatus();
  } catch (error) {
    connectionImportError.value = formatConnectionImportError(error);
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
    setConnectionGlobalMessage(`Удалено импортированных контактов: ${Number(data.deleted) || 0}.`);
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

function normalizeEntityPhoneDigits(value: string) {
  let digits = value.replace(/\D/g, '');
  if (!digits) return '';

  if (digits.length === 10) {
    digits = `7${digits}`;
  }
  if (digits.startsWith('8')) {
    digits = `7${digits.slice(1)}`;
  }
  if (!digits.startsWith('7')) {
    digits = `7${digits.slice(1)}`;
  }
  if (digits.length > 11) {
    digits = digits.slice(0, 11);
  }
  return digits;
}

function formatEntityPhone(value: string) {
  const digits = normalizeEntityPhoneDigits(value);
  if (!digits) return '';

  const countryCode = digits.slice(0, 1);
  const local = digits.slice(1);
  const parts = [local.slice(0, 3), local.slice(3, 6), local.slice(6, 8), local.slice(8, 10)].filter(Boolean);
  return parts.length ? `+ ${countryCode} ${parts.join(' ')}` : `+ ${countryCode}`;
}

function collectEntityPhones(entity: Entity) {
  const profile = toProfile(entity);
  const metadata = toMetadata(entity);
  const rawValues = [
    typeof profile.phone === 'string' ? profile.phone : '',
    ...toStringArray(profile.phones),
    ...toStringArray(metadata.phones),
  ];

  const unique: string[] = [];
  const seenDigits = new Set<string>();
  for (const value of rawValues) {
    const formatted = formatEntityPhone(value.trim());
    const dedupeKey = normalizeEntityPhoneDigits(formatted);
    if (!formatted || !dedupeKey || seenDigits.has(dedupeKey)) continue;
    seenDigits.add(dedupeKey);
    unique.push(formatted);
  }
  return unique;
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
    const currentMetadata = toMetadata(entity);
    const phones = collectEntityPhones(entity);
    const primaryPhone = phones[0] || '';
    const nextProfile = {
      ...currentProfile,
      phone: primaryPhone,
      phones,
      // После переноса из "Подключение" в категорию сущность должна считаться категоризированной.
      categoryLocked: true,
    };
    const nextMetadata = {
      ...currentMetadata,
      phones,
    };

    await entitiesStore.updateEntity(entity._id, {
      type: targetType,
      profile: nextProfile,
      ai_metadata: nextMetadata,
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
  if (shouldSuppressCardClick(entity._id)) {
    return;
  }
  activeTooltip.value = null;

  if (entity.type === 'project') {
    router.push({ name: 'project-canvas', params: { id: entity._id } });
    return;
  }

  entityInfoEntityId.value = entity._id;
}

function clearCardHoldState() {
  const active = cardHoldState.value;
  if (active) {
    clearTimeout(active.timer);
  }
  cardHoldState.value = null;
}

function shouldSuppressCardClick(entityId: string) {
  const until = suppressCardClickUntilByEntityId.value[entityId] || 0;
  if (until <= Date.now()) {
    if (until) {
      delete suppressCardClickUntilByEntityId.value[entityId];
    }
    return false;
  }
  return true;
}

function onEntityCardPointerDown(entity: Entity, event: PointerEvent) {
  if (event.button !== 0) return;
  clearCardHoldState();

  const timer = setTimeout(() => {
    suppressCardClickUntilByEntityId.value[entity._id] = Date.now() + CARD_HOLD_CLICK_SUPPRESS_MS;
    activeTooltip.value = null;
    quickVoiceEntityId.value = entity._id;
    clearCardHoldState();
  }, CARD_HOLD_OPEN_DELAY_MS);

  cardHoldState.value = {
    entityId: entity._id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    timer,
  };
}

function onEntityCardPointerMove(event: PointerEvent) {
  const active = cardHoldState.value;
  if (!active || active.pointerId !== event.pointerId) return;
  const dx = event.clientX - active.startX;
  const dy = event.clientY - active.startY;
  if (Math.hypot(dx, dy) >= CARD_HOLD_MOVE_CANCEL_PX) {
    clearCardHoldState();
  }
}

function onEntityCardPointerEnd(event: PointerEvent) {
  const active = cardHoldState.value;
  if (!active || active.pointerId !== event.pointerId) return;
  clearCardHoldState();
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

// ─── Entity card tooltip ──────────────────────────────────────────────────────
interface EntityTooltipState {
  entity: Entity;
  cardRect: DOMRect;
}

const activeTooltip = ref<EntityTooltipState | null>(null);

function canShowEntityCardTooltip() {
  if (typeof window === 'undefined') return false;
  const isMobileLayout = window.matchMedia('(max-width: 900px)').matches;
  const supportsHoverPointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  return supportsHoverPointer && !isMobileLayout;
}

function onEntityCardMouseEnter(entity: Entity, e: MouseEvent) {
  if (!canShowEntityCardTooltip()) return;
  if (entityInfoEntityId.value) return;
  const card = e.currentTarget as HTMLElement;
  activeTooltip.value = { entity, cardRect: card.getBoundingClientRect() };
}

function onEntityCardMouseLeave() {
  activeTooltip.value = null;
}

function getTooltipDescription(entity: Entity): string {
  const meta = entity.ai_metadata as Record<string, unknown> | null | undefined;
  if (!meta) return '';
  const desc = typeof meta.description === 'string' ? meta.description.trim() : '';
  return desc.length > 240 ? `${desc.slice(0, 240)}…` : desc;
}

function getTooltipFields(entity: Entity): Array<{ label: string; values: string[] }> {
  const meta = entity.ai_metadata as Record<string, unknown> | null | undefined;
  if (!meta) return [];
  const fieldConfigs = ENTITY_FILTER_FIELDS[entity.type as EntityType] ?? [];
  const result: Array<{ label: string; values: string[] }> = [];
  for (const { key, label } of fieldConfigs) {
    if (key === 'phones' || key === 'links') continue;
    const raw = meta[key];
    const values = Array.isArray(raw)
      ? (raw as unknown[]).filter((v): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, 6)
      : [];
    if (values.length) result.push({ label, values });
  }
  return result.slice(0, 5);
}

const tooltipStyle = computed<Partial<Record<string, string>>>(() => {
  const state = activeTooltip.value;
  if (!state) return {};
  const rect = state.cardRect;
  const W = 264;
  const GAP = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Prefer right of card, fall back to left if not enough space
  let left = rect.right + GAP;
  if (left + W > vw - GAP) {
    left = rect.left - W - GAP;
    if (left < GAP) left = GAP;
  }

  // Align tooltip top to card top, prevent bottom/top overflow
  let top = rect.top;
  if (top + 320 > vh - GAP) top = Math.max(GAP, vh - 320 - GAP);
  if (top < GAP) top = GAP;

  return { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, width: `${W}px` };
});

function closeEntityInfoModal() {
  entityInfoEntityId.value = null;
}

// When the modal closes, flush any pending full-refresh that was
// deferred while the modal was open.
watch(entityInfoEntityId, (id) => {
  if (id !== null) {
    activeTooltip.value = null;
    return;
  }

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
          <div
            v-if="['importing', 'paused'].includes(connectionSessionStatus)"
            class="connection-progress-toolbar"
            :class="{ paused: connectionSessionStatus === 'paused' }"
          >
            <div class="connection-progress-toolbar-main">
              <AppIcon name="loader" class="connection-progress-loader" />
              <span>{{ connectionToolbarProgressLabel }}</span>
            </div>
            <button
              type="button"
              class="connection-progress-toolbar-action"
              :disabled="isConnectionImportBusy || isConnectionPhotosBusy"
              :title="connectionSessionStatus === 'paused' ? 'Продолжить импорт' : 'Пауза импорта'"
              @click="connectionSessionStatus === 'paused' ? resumeBackgroundImport() : pauseBackgroundImport()"
            >
              <AppIcon :name="connectionSessionStatus === 'paused' ? 'play' : 'pause'" />
              <span>{{ connectionSessionStatus === 'paused' ? 'Продолжить' : 'Пауза' }}</span>
            </button>
            <button
              type="button"
              class="connection-progress-toolbar-action stop"
              :disabled="isConnectionImportBusy || isConnectionPhotosBusy"
              title="Остановить импорт"
              @click="stopBackgroundImport"
            >
              <AppIcon name="square" />
              <span>Стоп</span>
            </button>
          </div>
          <div v-else-if="connectionSessionStatus === 'ready'" class="connection-ready-toolbar">
            <button
              type="button"
              class="connection-ready-main"
              :disabled="isConnectionImportBusy || isConnectionPhotosBusy"
              @click="openConnectionControlPanel"
            >
              <AppIcon name="check-circle" />
              <span>Подключено</span>
            </button>
            <button
              type="button"
              class="connection-ready-disconnect"
              :disabled="isConnectionImportBusy || isConnectionPhotosBusy"
              @click="disconnectWhatsappSession"
            >
              <AppIcon name="unplug" />
            </button>
          </div>
          <button
            v-else-if="['initializing', 'qr', 'prompt_action'].includes(connectionSessionStatus)"
            type="button"
            class="connection-toolbar-btn status-connecting"
            :disabled="isConnectionImportBusy"
            @click="openConnectionControlPanel"
          >
            <AppIcon
              :name="connectionSessionStatus === 'prompt_action' ? 'check-circle' : 'loader'"
              :class="{ 'connection-progress-loader': connectionSessionStatus !== 'prompt_action' }"
            />
            <span>{{ connectionSessionStatus === 'prompt_action' ? 'Подключено' : 'Подключение...' }}</span>
          </button>
          <button
            v-else
            type="button"
            class="connection-toolbar-btn status-idle"
            :disabled="isConnectionImportBusy"
            @click="openConnectionControlPanel"
          >
            <AppIcon name="wifi-off" />
            <span>Нет активных подключений</span>
          </button>
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
    </div>

    <section ref="collectionViewRef" class="collection-view">
      <div v-if="entitiesStore.loading" class="state">Загрузка...</div>
      <div v-else-if="entitiesStore.error" class="state state-error">{{ entitiesStore.error }}</div>
      <div v-else class="grid-layout">
        <button
          class="create-card"
          :class="{ 'connection-create-blocked': activeType === 'connection' && isConnectionCreateBlocked }"
          :disabled="isCreateBusy || isConnectionCreateBlocked"
          @click="createEntity"
        >
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
            @contextmenu.prevent
            @pointerdown="onEntityCardPointerDown(firstEntity, $event)"
            @pointermove="onEntityCardPointerMove"
            @pointerup="onEntityCardPointerEnd"
            @pointercancel="onEntityCardPointerEnd"
            @pointerleave="onEntityCardPointerEnd"
            @mouseenter="onEntityCardMouseEnter(firstEntity, $event)"
            @mouseleave="onEntityCardMouseLeave"
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
            @contextmenu.prevent
            @pointerdown="onEntityCardPointerDown(firstEntity, $event)"
            @pointermove="onEntityCardPointerMove"
            @pointerup="onEntityCardPointerEnd"
            @pointercancel="onEntityCardPointerEnd"
            @pointerleave="onEntityCardPointerEnd"
            @mouseenter="onEntityCardMouseEnter(firstEntity, $event)"
            @mouseleave="onEntityCardMouseLeave"
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
            @contextmenu.prevent
            @pointerdown="onEntityCardPointerDown(entity, $event)"
            @pointermove="onEntityCardPointerMove"
            @pointerup="onEntityCardPointerEnd"
            @pointercancel="onEntityCardPointerEnd"
            @pointerleave="onEntityCardPointerEnd"
            @mouseenter="onEntityCardMouseEnter(entity, $event)"
            @mouseleave="onEntityCardMouseLeave"
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
            @contextmenu.prevent
            @pointerdown="onEntityCardPointerDown(entity, $event)"
            @pointermove="onEntityCardPointerMove"
            @pointerup="onEntityCardPointerEnd"
            @pointercancel="onEntityCardPointerEnd"
            @pointerleave="onEntityCardPointerEnd"
            @mouseenter="onEntityCardMouseEnter(entity, $event)"
            @mouseleave="onEntityCardMouseLeave"
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

    <!-- Entity card tooltip -->
    <Teleport to="body">
      <div
        v-if="activeTooltip"
        class="entity-card-tooltip"
        :style="tooltipStyle"
      >
        <div class="entity-card-tooltip-name">{{ activeTooltip.entity.name || 'Без названия' }}</div>
        <p v-if="getTooltipDescription(activeTooltip.entity)" class="entity-card-tooltip-desc">
          {{ getTooltipDescription(activeTooltip.entity) }}
        </p>
        <template v-if="getTooltipFields(activeTooltip.entity).length">
          <div class="entity-card-tooltip-fields">
            <div
              v-for="group in getTooltipFields(activeTooltip.entity)"
              :key="group.label"
              class="entity-card-tooltip-field-group"
            >
              <span class="entity-card-tooltip-field-label">{{ group.label }}</span>
              <div class="entity-card-tooltip-tags">
                <span v-for="val in group.values" :key="val" class="entity-card-tooltip-tag">{{ val }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </Teleport>

    <EntityInfoModal
      v-if="entityInfoEntityId"
      :entity-id="entityInfoEntityId"
      @close="closeEntityInfoModal"
    />
    <QuickEntityVoiceModal
      v-if="quickVoiceEntityId"
      :entity-id="quickVoiceEntityId"
      @close="quickVoiceEntityId = null"
    />

    <div
      v-if="projectDeleteTarget"
      class="project-delete-overlay"
      @pointerdown.stop
      @touchstart.stop.prevent
      @touchend.stop.prevent
      @click.stop.prevent
      @click.self.prevent="closeProjectDeleteConfirm"
    >
      <div class="project-delete-card" @pointerdown.stop @touchstart.stop @touchend.stop @click.stop>
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
      @pointerdown.stop
      @touchstart.stop.prevent
      @touchend.stop.prevent
      @click.stop.prevent
      @click.self.prevent="closeConnectionImportModal"
    >
      <div class="connection-import-card" @pointerdown.stop @touchstart.stop @touchend.stop @click.stop>
        <div class="connection-import-head">
          <h3 class="connection-import-title">
            {{ connectionDialogMode === 'prompt_action' ? 'Управление контактами' : 'Подключение WhatsApp' }}
          </h3>
          <button
            type="button"
            class="connection-modal-close"
            :disabled="isConnectionImportBusy || isConnectionPhotosBusy"
            @click="closeConnectionImportModal"
          >
            <AppIcon name="close" />
          </button>
        </div>

        <template v-if="connectionDialogMode === 'qr'">
          <div class="connection-privacy-card">
            <div class="connection-privacy-head">
              <AppIcon name="shield-check" />
              <span>Полная конфиденциальность</span>
            </div>
            <p>
              Мы не имеем доступа к вашей переписке, файлам или звонкам. Интеграция лишь однократно перенесет имена,
              аватарки и номера телефонов.
            </p>
          </div>
          <div class="connection-qr-block">
            <img
              v-if="connectionImportQrCode"
              class="connection-qr-image"
              :src="connectionImportQrCode"
              alt="WhatsApp QR"
            />
            <div v-else class="connection-qr-placeholder">
              <AppIcon name="loader" class="connection-progress-loader" />
            </div>
          </div>
        </template>

        <template v-else>
          <p class="connection-import-text">
            Что необходимо сделать с контактами WhatsApp?
          </p>
          <button
            type="button"
            class="connection-action-option"
            :disabled="isConnectionImportBusy || isConnectionPhotosBusy || isConnectionBackgroundRunning"
            @click="triggerContactsUpdateFromConnected"
          >
            <strong>Синхронизировать</strong>
            <span>Добавить новые контакты. Существующие карточки и имена не изменятся.</span>
          </button>
          <button
            type="button"
            class="connection-action-option overwrite"
            :disabled="isConnectionImportBusy || isConnectionPhotosBusy || isConnectionBackgroundRunning"
            @click="triggerContactsOverwriteFromConnected"
          >
            <strong>Перезаписать</strong>
            <span>Принудительная перезапись. Полностью обновить аватарки и заменить имена на актуальные из WhatsApp.</span>
          </button>
          <div v-if="connectionImportStats" class="connection-import-stats">
            <span>Всего найдено: {{ connectionImportStats.total }}</span>
            <span>Импортировано: {{ connectionImportStats.imported }}</span>
            <span>Обновлено имен: {{ connectionImportStats.updatedNames }}</span>
            <span>Обновлено фото: {{ connectionImportStats.updatedImages }}</span>
          </div>
        </template>

        <p v-if="connectionImportError" class="connection-import-error">
          {{ connectionImportError }}
        </p>
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
  height: 28px;
  border-radius: 10px;
  border: 1px solid #d2dfef;
  background: #fafdff;
  color: #475569;
  font-size: 10px;
  font-weight: 700;
  padding: 0 10px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    color 0.16s ease;
}

.connection-toolbar-btn.status-idle:hover:not(:disabled) {
  border-color: #95b8fb;
  background: #edf4ff;
  color: #1058ff;
}

.connection-toolbar-btn.status-connecting {
  border-color: #bcd3ff;
  background: #edf4ff;
  color: #1058ff;
}

.connection-toolbar-btn.status-connecting:hover:not(:disabled) {
  border-color: #95b8fb;
}

.connection-toolbar-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.connection-progress-toolbar {
  height: 28px;
  border-radius: 10px;
  border: 1px solid #86efac;
  background: #ecfdf5;
  color: #047857;
  display: inline-flex;
  align-items: center;
  overflow: hidden;
}

.connection-progress-toolbar.paused {
  border-color: #fcd34d;
  background: #fffbeb;
  color: #d97706;
}

.connection-progress-toolbar-main {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
}

.connection-progress-toolbar-action {
  border: none;
  border-left: 1px solid rgba(15, 23, 42, 0.08);
  background: transparent;
  color: currentColor;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 8px;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
}

.connection-progress-toolbar-action:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.55);
}

.connection-progress-toolbar-action :deep(svg) {
  width: 13px;
  height: 13px;
}

.connection-progress-toolbar-action.stop:hover:not(:disabled) {
  color: #be123c;
  background: #ffe4e6;
}

.connection-ready-toolbar {
  height: 28px;
  border-radius: 10px;
  border: 1px solid #99f6e4;
  background: #f0fdfa;
  color: #0f766e;
  display: inline-flex;
  align-items: stretch;
  overflow: hidden;
}

.connection-ready-main,
.connection-ready-disconnect {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.connection-ready-main {
  padding: 0 10px;
  gap: 6px;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
}

.connection-ready-disconnect {
  width: 28px;
  border-left: 1px solid rgba(15, 23, 42, 0.08);
}

.connection-ready-main:hover:not(:disabled),
.connection-ready-disconnect:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.6);
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

.create-card.connection-create-blocked {
  opacity: 0.7;
  cursor: not-allowed;
  pointer-events: none;
}

.connection-progress-loader {
  animation: connection-spin 1s linear infinite;
}

.connection-progress-loader :deep(svg) {
  width: 14px;
  height: 14px;
}

@keyframes connection-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
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
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
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
  background: rgba(15, 23, 42, 0.3);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.connection-import-card {
  width: min(420px, 100%);
  border-radius: 24px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  box-shadow: 0 24px 48px rgba(15, 23, 42, 0.15);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.connection-import-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.connection-import-title {
  margin: 0;
  color: #0f172a;
  font-size: 20px;
  font-weight: 800;
}

.connection-modal-close {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 999px;
  background: #f1f5f9;
  color: #334155;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.connection-modal-close:hover:not(:disabled) {
  background: #e2e8f0;
}

.connection-modal-close:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.connection-import-text {
  margin: 0;
  color: #475569;
  font-size: 14px;
  line-height: 1.4;
}

.connection-privacy-card {
  border-radius: 16px;
  border: 1px solid #bae6fd;
  background: #f0f9ff;
  padding: 12px 14px;
  display: grid;
  gap: 6px;
}

.connection-privacy-head {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #0369a1;
  font-size: 14px;
  font-weight: 700;
}

.connection-privacy-head :deep(svg) {
  width: 16px;
  height: 16px;
  color: #0ea5e9;
}

.connection-privacy-card p {
  margin: 0;
  color: #0c4a6e;
  font-size: 12px;
  line-height: 1.45;
}

.connection-qr-block {
  width: 100%;
  border-radius: 24px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.08);
  min-height: 240px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px;
}

.connection-qr-placeholder {
  width: 240px;
  height: 240px;
  border-radius: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
  background: #f8fafc;
}

.connection-qr-image {
  width: 240px;
  height: 240px;
  object-fit: contain;
  border-radius: 24px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
}

.connection-import-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
  border-radius: 14px;
  border: 1px solid #dbe4f3;
  background: #f8fbff;
  padding: 12px;
  color: #334155;
  font-size: 12px;
  font-weight: 600;
}

.connection-action-option {
  border-radius: 14px;
  border: 2px solid #e2e8f0;
  background: #ffffff;
  color: #0f172a;
  text-align: left;
  padding: 12px;
  display: grid;
  gap: 6px;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    color 0.16s ease;
}

.connection-action-option strong {
  font-size: 15px;
  font-weight: 800;
  line-height: 1.2;
}

.connection-action-option span {
  font-size: 13px;
  color: #64748b;
  line-height: 1.35;
}

.connection-action-option:hover:not(:disabled) {
  border-color: #1058ff;
  background: #f8fbff;
}

.connection-action-option.overwrite:hover:not(:disabled) {
  border-color: #f43f5e;
  background: #fff1f2;
}

.connection-action-option.overwrite:hover:not(:disabled) strong {
  color: #e11d48;
}

.connection-action-option:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.connection-import-error {
  margin: 0;
  color: #b91c1c;
  font-size: 12px;
  font-weight: 600;
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
