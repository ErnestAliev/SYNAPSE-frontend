<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type CSSProperties } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import CanvasContextMenu from '../components/canvas/CanvasContextMenu.vue';
import ConnectionContextMenu from '../components/canvas/ConnectionContextMenu.vue';
import EdgeLayerCanvas from '../components/canvas/EdgeLayerCanvas.vue';
import CanvasNode from '../components/canvas/CanvasNode.vue';
import AppIcon from '../components/ui/AppIcon.vue';
import ProfileProgressRing from '../components/ui/ProfileProgressRing.vue';
import { useEntitiesStore } from '../stores/entities';
import { useAuthStore } from '../stores/auth';
import { analyzeEntityWithAi } from '../services/entityAi';
import { calculateEntityProfileProgress } from '../utils/profileProgress';
import type { LogoLibraryItem } from '../data/logoLibrary';
import type {
  CanvasEdgeProjection,
  CanvasNodeProjection,
  Entity,
  EntityType,
  ProjectCanvasData,
  ProjectCanvasViewport,
} from '../types/entity';

const GRID_STEP = 40;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3.0;
const MENU_WIDTH = 320;
const MENU_HEIGHT = 320;
const MIN_NODE_SCALE = 0.8;
const MAX_NODE_SCALE = 1.2;
const DEFAULT_NODE_SCALE = 1;
const NODE_CIRCLE_DIAMETER = 72;
const AUTO_CONNECT_EDGE_GAP_PX = 20;
const AUTO_CONNECT_LIMIT = 2;
const EDGE_DEFAULT_COLOR = '#262626';
const EDGE_HIT_LINE_TOLERANCE = 10;
const EDGE_HIT_MIDPOINT_TOLERANCE = 18;
const CANVAS_CACHE_PREFIX = 'synapse12.canvas.v1';
const CANVAS_SYNC_DELAY = 650;
const VIEWPORT_SYNC_DELAY = 220;
const ENTITY_SYNC_DELAY = 420;
const SELECTION_MOVE_THRESHOLD_PX = 4;
const PROFILE_PROGRESS_RING_SIZE = 72;
const PROFILE_PROGRESS_STROKE_WIDTH = 5;
const PROFILE_PROGRESS_RADIUS = (PROFILE_PROGRESS_RING_SIZE - PROFILE_PROGRESS_STROKE_WIDTH) / 2;
const PROFILE_PROGRESS_CIRCUMFERENCE = 2 * Math.PI * PROFILE_PROGRESS_RADIUS;
const NODE_MENU_HINT_STORAGE_PREFIX = 'synapse12.hints.nodeMenu.v3';
const NODE_MENU_HINT_FIRST_PROJECT_STORAGE_KEY = 'synapse12.hints.nodeMenu.firstProjectId.v1';
const LIBRARY_DRAG_MIME = 'application/x-synapse12-entity-id';
const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  project: 'Проект',
  connection: 'Подключение',
  person: 'Персона',
  company: 'Компания',
  event: 'Событие',
  resource: 'Ресурс',
  goal: 'Цель',
  result: 'Результат',
  task: 'Задача',
  shape: 'Элемент',
};
const ENTITY_TYPE_CHAT_TARGET: Record<EntityType, string> = {
  project: 'проект',
  connection: 'контакт',
  person: 'персону',
  company: 'компанию',
  event: 'событие',
  resource: 'ресурс',
  goal: 'цель',
  result: 'результат',
  task: 'задачу',
  shape: 'элемент',
};
const EMPTY_CONNECTION_RELATION_LABEL = 'Связь не указана';
const DEFAULT_CONNECTION_RELATION_OPTIONS = [
  EMPTY_CONNECTION_RELATION_LABEL,
  'Коллеги',
  'Партнеры',
  'Клиентские отношения',
  'Профессиональные связи',
  'Семейные связи',
  'Друзья',
  'Соперники',
  'Романтические партнеры',
  'Социальные связи',
];
type CanvasArrangePreset = 'line' | 'circle' | 'square' | 'rectangle';

interface CanvasBackgroundPreset {
  id: string;
  label: string;
  appBackground: string;
  gridColor: string;
}

const DEFAULT_CANVAS_BACKGROUND = 'default';
const ALIGN_MIN_NODE_GAP_PX = 40;
const ARRANGE_SHAPE_MIN_NODE_GAP_PX = 100;
const CANVAS_BACKGROUND_PRESETS: CanvasBackgroundPreset[] = [
  {
    id: 'default',
    label: 'Базовый',
    appBackground: '#f0f4f8',
    gridColor: 'rgba(112, 144, 176, 0.08)',
  },
  {
    id: 'mist',
    label: 'Туман',
    appBackground: '#edf3fb',
    gridColor: 'rgba(148, 163, 184, 0.12)',
  },
  {
    id: 'paper',
    label: 'Бумага',
    appBackground: '#f8f6ef',
    gridColor: 'rgba(148, 131, 103, 0.14)',
  },
  {
    id: 'mint',
    label: 'Мята',
    appBackground: '#edf8f4',
    gridColor: 'rgba(75, 130, 110, 0.14)',
  },
];
const FALLBACK_CANVAS_BACKGROUND: CanvasBackgroundPreset =
  CANVAS_BACKGROUND_PRESETS[0] || {
    id: 'default',
    label: 'Базовый',
    appBackground: '#f0f4f8',
    gridColor: 'rgba(112, 144, 176, 0.08)',
  };

type NodeOnboardingStepId =
  | 'open-menu'
  | 'open-context';

type NodeOnboardingHintPlacement = 'top' | 'bottom' | 'left' | 'right';

interface NodeOnboardingStep {
  id: NodeOnboardingStepId;
  title: string;
  description: string;
}

const NODE_ONBOARDING_STEPS: NodeOnboardingStep[] = [
  {
    id: 'open-menu',
    title: 'Откройте меню ноды',
    description: 'Нажмите на ноду, чтобы открыть меню',
  },
  {
    id: 'open-context',
    title: 'Откройте контекстное окно',
    description: 'Нажмите ноду еще раз чтобы открыть описание',
  },
];

type EntityChatRole = 'user' | 'assistant';

interface EntityAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  data: string;
}

interface EntityChatMessage {
  id: string;
  role: EntityChatRole;
  text: string;
  createdAt: string;
  attachments: EntityAttachment[];
}

type MetadataFieldKey =
  | 'tags'
  | 'markers'
  | 'skills'
  | 'importance'
  | 'links'
  | 'roles'
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

const ENTITY_CONTEXT_FIELDS: Record<EntityType, MetadataFieldConfig[]> = {
  connection: [
    { key: 'tags', label: 'Теги' },
    { key: 'markers', label: 'Метки' },
    { key: 'roles', label: 'Роли' },
    { key: 'status', label: 'Статусы' },
    { key: 'links', label: 'Ссылки' },
    { key: 'importance', label: 'Значимость' },
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
    { key: 'industry', label: 'Отрасли' },
    { key: 'departments', label: 'Отделы' },
    { key: 'stage', label: 'Стадии' },
    { key: 'risks', label: 'Риски' },
    { key: 'links', label: 'Ссылки' },
  ],
  event: [
    { key: 'tags', label: 'Теги' },
    { key: 'date', label: 'Даты' },
    { key: 'location', label: 'Локации' },
    { key: 'participants', label: 'Участники' },
    { key: 'outcomes', label: 'Итоги' },
    { key: 'links', label: 'Ссылки' },
  ],
  resource: [
    { key: 'tags', label: 'Теги' },
    { key: 'resources', label: 'Ресурсы' },
    { key: 'status', label: 'Статусы' },
    { key: 'importance', label: 'Значимость' },
    { key: 'owners', label: 'Владельцы' },
    { key: 'links', label: 'Ссылки' },
  ],
  goal: [
    { key: 'tags', label: 'Теги' },
    { key: 'priority', label: 'Приоритеты' },
    { key: 'metrics', label: 'Метрики' },
    { key: 'owners', label: 'Ответственные' },
    { key: 'status', label: 'Статусы' },
    { key: 'links', label: 'Ссылки' },
  ],
  result: [
    { key: 'tags', label: 'Теги' },
    { key: 'outcomes', label: 'Результаты' },
    { key: 'metrics', label: 'Метрики' },
    { key: 'importance', label: 'Значимость' },
    { key: 'owners', label: 'Ответственные' },
    { key: 'links', label: 'Ссылки' },
  ],
  task: [
    { key: 'tags', label: 'Теги' },
    { key: 'priority', label: 'Приоритеты' },
    { key: 'status', label: 'Статусы' },
    { key: 'owners', label: 'Ответственные' },
    { key: 'date', label: 'Даты' },
    { key: 'links', label: 'Ссылки' },
  ],
  project: [
    { key: 'tags', label: 'Теги' },
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
const PROFILE_METADATA_TARGETS: Record<MetadataFieldKey, number> = {
  tags: 4,
  markers: 3,
  skills: 4,
  importance: 1,
  links: 2,
  roles: 2,
  industry: 2,
  departments: 2,
  stage: 1,
  risks: 2,
  date: 1,
  location: 1,
  participants: 3,
  outcomes: 3,
  resources: 3,
  priority: 1,
  status: 1,
  owners: 2,
  metrics: 2,
};
const PROFILE_METADATA_WEIGHTS: Record<EntityType, Partial<Record<MetadataFieldKey, number>>> = {
  connection: {
    tags: 1.2,
    markers: 1,
    roles: 1.1,
    status: 1.1,
    links: 0.9,
    importance: 1.1,
  },
  person: {
    tags: 1.1,
    markers: 0.8,
    skills: 1.3,
    importance: 1.2,
    links: 0.9,
    roles: 1.3,
  },
  company: {
    tags: 1,
    industry: 1.3,
    departments: 1.2,
    stage: 1.2,
    risks: 1,
    links: 0.9,
  },
  event: {
    tags: 0.9,
    date: 1.3,
    location: 1.2,
    participants: 1.1,
    outcomes: 1.1,
    links: 0.9,
  },
  resource: {
    tags: 1,
    resources: 1.3,
    status: 1.2,
    importance: 1.1,
    owners: 1,
    links: 0.9,
  },
  goal: {
    tags: 0.9,
    priority: 1.2,
    metrics: 1.3,
    owners: 1.1,
    status: 1.1,
    links: 0.9,
  },
  result: {
    tags: 0.9,
    outcomes: 1.3,
    metrics: 1.2,
    importance: 1.1,
    owners: 1,
    links: 0.9,
  },
  task: {
    tags: 0.9,
    priority: 1.2,
    status: 1.3,
    owners: 1.1,
    date: 1.1,
    links: 0.9,
  },
  project: {
    tags: 1,
    stage: 1.2,
    priority: 1.2,
    risks: 1.1,
    owners: 1.1,
    links: 0.9,
  },
  shape: {
    tags: 1,
    markers: 1.1,
    importance: 1.2,
    status: 1.2,
    links: 0.9,
  },
};
const LIBRARY_CATEGORY_ORDER: EntityType[] = [
  'project',
  'person',
  'company',
  'event',
  'resource',
  'goal',
  'result',
  'task',
  'shape',
  'connection',
];

const route = useRoute();
const router = useRouter();
const entitiesStore = useEntitiesStore();
const authStore = useAuthStore();

const viewportRef = ref<HTMLDivElement | null>(null);
const nodes = ref<CanvasNodeProjection[]>([]);
const edges = ref<CanvasEdgeProjection[]>([]);
const isLoading = ref(true);
const loadError = ref<string | null>(null);

const camera = ref({
  x: 0,
  y: 0,
  zoom: 1,
});
const canvasBackgroundId = ref(DEFAULT_CANVAS_BACKGROUND);
const selectedNodeIds = ref<string[]>([]);
const isAlignMenuOpen = ref(false);
const isArrangeMenuOpen = ref(false);
const isBackgroundMenuOpen = ref(false);
const isResetCanvasConfirmOpen = ref(false);
const selectionRect = ref<{
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  additive: boolean;
  moved: boolean;
} | null>(null);
const isPanning = ref(false);
const panStart = ref({
  clientX: 0,
  clientY: 0,
  cameraX: 0,
  cameraY: 0,
});

const draggingNode = ref<{
  nodeId: string;
  offsetX: number;
  offsetY: number;
  moved: boolean;
} | null>(null);
const draggingGroup = ref<{
  nodeIds: string[];
  startPointerX: number;
  startPointerY: number;
  startPositions: Record<string, { x: number; y: number }>;
  moved: boolean;
} | null>(null);
const nameEditingNodeId = ref<string | null>(null);

const suppressMenuOpenUntil = ref(0);
const contextMenu = ref<{
  nodeId: string;
} | null>(null);
const edgeMenu = ref<{
  edgeId: string;
} | null>(null);
const contextMenuHoverType = ref<EntityType | null>(null);
const pendingCenterTarget = ref<{
  x: number;
  y: number;
} | null>(null);
const nodeMenuHint = ref<{
  nodeId: string;
  progress: Record<NodeOnboardingStepId, boolean>;
} | null>(null);
const isLibraryOpen = ref(false);
const activeLibraryType = ref<EntityType>('shape');
const hoveredLibraryType = ref<EntityType | null>(null);
const libraryQuery = ref('');
const isCanvasDropActive = ref(false);
const viewportDragDepth = ref(0);
const entityInfoModal = ref<{
  entityId: string;
  name: string;
  type: EntityType;
  description: string;
  metadataValues: Record<string, string[]>;
  fieldDrafts: Record<string, string>;
  textInput: string;
  voiceInput: string;
  documents: EntityAttachment[];
  pendingUploads: EntityAttachment[];
  chatHistory: EntityChatMessage[];
} | null>(null);
const entityInfoDocInputRef = ref<HTMLInputElement | null>(null);
const entityInfoChatInputRef = ref<HTMLTextAreaElement | null>(null);
const entityInfoChatFeedRef = ref<HTMLElement | null>(null);
const isVoiceListening = ref(false);
const isEntityInfoAiRequestInFlight = ref(false);
const pendingComposerHeightReset = ref(false);
const infoSaveTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const activeVoiceRecognition = ref<{
  stop: () => void;
} | null>(null);
const viewportSyncTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const nodeSearchOpen = ref(false);
const nodeSearchQuery = ref('');
const nodeSearchInputRef = ref<HTMLInputElement | null>(null);

const routeProjectId = computed(() => {
  const id = route.params.id;
  return typeof id === 'string' ? id : '';
});

function createNodeOnboardingProgress() {
  return NODE_ONBOARDING_STEPS.reduce(
    (acc, step) => {
      acc[step.id] = false;
      return acc;
    },
    {} as Record<NodeOnboardingStepId, boolean>,
  );
}

const libraryCategories = computed(() =>
  LIBRARY_CATEGORY_ORDER.map((type) => ({
    type,
    label: ENTITY_TYPE_LABELS[type],
  })),
);

const activeLibraryLabel = computed(() => {
  return ENTITY_TYPE_LABELS[activeLibraryType.value] || 'Сущность';
});

const zoomPercent = computed(() => Math.round(camera.value.zoom * 100));
const selectedNodeIdSet = computed(() => new Set(selectedNodeIds.value));
const selectedNodes = computed(() => {
  if (!selectedNodeIds.value.length) return [] as CanvasNodeProjection[];

  const selectedSet = selectedNodeIdSet.value;
  return nodes.value.filter((node) => selectedSet.has(node.id));
});
const activeCanvasBackground = computed<CanvasBackgroundPreset>(() => {
  return (
    CANVAS_BACKGROUND_PRESETS.find((item) => item.id === canvasBackgroundId.value) ||
    FALLBACK_CANVAS_BACKGROUND
  );
});
const canvasViewportStyle = computed<CSSProperties>(() => ({
  '--canvas-bg-color': activeCanvasBackground.value.appBackground,
  '--canvas-grid-color': activeCanvasBackground.value.gridColor,
} as CSSProperties));

const worldStyle = computed(() => ({
  transform: `translate(${camera.value.x}px, ${camera.value.y}px) scale(${camera.value.zoom})`,
}));

const gridStyle = computed(() => {
  const step = GRID_STEP * camera.value.zoom;
  return {
    backgroundSize: `${step}px ${step}px`,
    backgroundPosition: `${camera.value.x}px ${camera.value.y}px`,
  };
});
const selectionRectStyle = computed<CSSProperties | null>(() => {
  const rect = selectionRect.value;
  if (!rect) return null;

  const leftWorld = Math.min(rect.startX, rect.currentX);
  const rightWorld = Math.max(rect.startX, rect.currentX);
  const topWorld = Math.min(rect.startY, rect.currentY);
  const bottomWorld = Math.max(rect.startY, rect.currentY);

  const left = camera.value.x + leftWorld * camera.value.zoom;
  const top = camera.value.y + topWorld * camera.value.zoom;
  const width = Math.max(1, (rightWorld - leftWorld) * camera.value.zoom);
  const height = Math.max(1, (bottomWorld - topWorld) * camera.value.zoom);

  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  };
});

const activeMenuNode = computed(() => {
  if (!contextMenu.value) return null;
  return nodes.value.find((node) => node.id === contextMenu.value?.nodeId) || null;
});

const activeNodeViewportPosition = computed(() => {
  const node = activeMenuNode.value;
  if (!node) return null;
  return {
    x: camera.value.x + node.x * camera.value.zoom,
    y: camera.value.y + node.y * camera.value.zoom,
  };
});

const nodeMenuHintPosition = computed(() => {
  const viewport = viewportRef.value;
  const hint = nodeMenuHint.value;
  if (!viewport || !hint) return null;
  if (entityInfoModal.value) return null;

  const node = nodes.value.find((item) => item.id === hint.nodeId);
  if (!node) return null;

  const rect = viewport.getBoundingClientRect();
  const step = activeNodeOnboardingStep.value;
  const hintHalfWidth = 148;
  const padding = 14;

  if (step?.id === 'open-menu' && contextMenu.value?.nodeId === node.id) {
    return null;
  }

  if (step?.id === 'open-context') {
    const isMenuOpenForNode = contextMenu.value?.nodeId === node.id;
    const entity = entitiesStore.byId(node.entityId);
    const isCategoryApplied = isCategoryLocked(entity);

    // Second hint appears only when category is already applied and menu is open.
    if (!isMenuOpenForNode || !isCategoryApplied || !contextMenuPosition.value) {
      return null;
    }
  }

  const rawX = camera.value.x + node.x * camera.value.zoom;
  const rawY = camera.value.y + node.y * camera.value.zoom - 66;

  return {
    x: Math.min(Math.max(rawX, padding + hintHalfWidth), rect.width - padding - hintHalfWidth),
    y: Math.min(Math.max(rawY, 92), rect.height - padding),
    placement: 'top' as NodeOnboardingHintPlacement,
  };
});

const activeNodeOnboardingStep = computed<NodeOnboardingStep | null>(() => {
  const hint = nodeMenuHint.value;
  if (!hint) return null;

  return NODE_ONBOARDING_STEPS.find((step) => !hint.progress[step.id]) || null;
});

const activeNodeOnboardingStepIndex = computed(() => {
  const step = activeNodeOnboardingStep.value;
  if (!step) return 0;
  return NODE_ONBOARDING_STEPS.findIndex((item) => item.id === step.id) + 1;
});

const contextMenuPosition = computed(() => {
  const viewport = viewportRef.value;
  const node = activeMenuNode.value;
  if (!viewport || !node) return null;

  const rect = viewport.getBoundingClientRect();
  const rawX = rect.left + camera.value.x + node.x * camera.value.zoom;
  const rawY = rect.top + camera.value.y + node.y * camera.value.zoom;
  const padding = 10;
  const menuHalfWidth = (MENU_WIDTH * camera.value.zoom) / 2;
  const menuHalfHeight = (MENU_HEIGHT * camera.value.zoom) / 2;

  return {
    x: Math.min(
      Math.max(rawX, padding + menuHalfWidth),
      window.innerWidth - padding - menuHalfWidth,
    ),
    y: Math.min(
      Math.max(rawY, padding + menuHalfHeight),
      window.innerHeight - padding - menuHalfHeight,
    ),
  };
});

const activeEdge = computed(() => {
  if (!edgeMenu.value) return null;
  return edges.value.find((edge) => edge.id === edgeMenu.value?.edgeId) || null;
});

const activeEdgeNodes = computed(() => {
  const edge = activeEdge.value;
  if (!edge) return null;

  const sourceNode = nodes.value.find((node) => node.id === edge.source);
  const targetNode = nodes.value.find((node) => node.id === edge.target);
  if (!sourceNode || !targetNode) return null;

  return { sourceNode, targetNode };
});

const edgeMenuPosition = computed(() => {
  const viewport = viewportRef.value;
  const pair = activeEdgeNodes.value;
  if (!viewport || !pair) return null;

  const rect = viewport.getBoundingClientRect();
  const midpointWorldX = (pair.sourceNode.x + pair.targetNode.x) / 2;
  const midpointWorldY = (pair.sourceNode.y + pair.targetNode.y) / 2;
  const rawX = rect.left + camera.value.x + midpointWorldX * camera.value.zoom;
  const rawY = rect.top + camera.value.y + midpointWorldY * camera.value.zoom;
  const padding = 28;

  return {
    x: Math.min(Math.max(rawX, rect.left + padding), rect.right - padding),
    y: Math.min(Math.max(rawY, rect.top + padding), rect.bottom - padding),
  };
});

const connectionRelationOptions = computed(() => {
  const customOptions = getCustomConnectionRelationOptions(authStore.user?.settings);
  const dedup = new Set<string>();

  return [...DEFAULT_CONNECTION_RELATION_OPTIONS, ...customOptions].filter((option) => {
    const normalized = normalizeRelationOption(option);
    if (!normalized) return false;
    const key = normalized.toLowerCase();
    if (dedup.has(key)) return false;
    dedup.add(key);
    return true;
  });
});

const menuBackdropStyle = computed<CSSProperties>(() => {
  const pos = activeNodeViewportPosition.value;
  if (!pos) return {};

  return {
    '--focus-x': `${pos.x}px`,
    '--focus-y': `${pos.y}px`,
  } as CSSProperties;
});

const activeMenuEntity = computed<Entity | null>(() => {
  if (!activeMenuNode.value) return null;
  return entitiesStore.byId(activeMenuNode.value.entityId) || null;
});

const activeMenuEntityType = computed<EntityType>(() => {
  return activeMenuEntity.value?.type || 'shape';
});

const activeMenuProfile = computed<Record<string, unknown>>(() =>
  toProfile(activeMenuEntity.value?.profile),
);

const activeMenuLocked = computed(() => isEntityLocked(activeMenuEntity.value));
const activeMenuCategoryLocked = computed(() => isCategoryLocked(activeMenuEntity.value));

const activeMenuColor = computed(() => {
  const raw = activeMenuProfile.value.color;
  if (typeof raw === 'string' && raw.trim()) {
    return raw;
  }
  return '#1058ff';
});

const activeMenuHasImage = computed(() => {
  const raw = activeMenuProfile.value.image;
  return typeof raw === 'string' && raw.trim().length > 0;
});

const activeMenuHasEmoji = computed(() => {
  const raw = activeMenuProfile.value.emoji;
  return typeof raw === 'string' && raw.trim().length > 0;
});

const activeMenuHasLogo = computed(() => {
  const raw = activeMenuProfile.value.logo;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;

  const record = raw as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.image === 'string' &&
    record.image.trim().length > 0
  );
});

const activeMenuScalePercent = computed(() => {
  return Math.round(normalizeNodeScale(activeMenuNode.value?.scale) * 100);
});

const entityInfoModalIcon = computed(() => {
  const modal = entityInfoModal.value;
  if (!modal) return null;

  const entity = entitiesStore.byId(modal.entityId);
  if (!entity) return null;

  const profile = toProfile(entity.profile);
  const color = typeof profile.color === 'string' && profile.color.trim() ? profile.color : '#1058ff';
  const image = typeof profile.image === 'string' ? profile.image : '';
  const emoji = typeof profile.emoji === 'string' ? profile.emoji : '';
  const hasLogo = logoImageFromProfile(profile).trim().length > 0;

  return {
    type: entity.type,
    color,
    image,
    emoji,
    hasLogo,
  };
});

const entityInfoChatPlaceholder = computed(() => {
  const type = entityInfoModal.value?.type || 'shape';
  return `Опишите ${ENTITY_TYPE_CHAT_TARGET[type]}`;
});

const entityInfoActiveFields = computed(() => {
  const type = entityInfoModal.value?.type || 'shape';
  return ENTITY_CONTEXT_FIELDS[type] || [];
});

const entityInfoProfileProgress = computed(() => {
  const modal = entityInfoModal.value;
  if (!modal) return 0;

  const entity = entitiesStore.byId(modal.entityId);
  const profile = toProfile(entity?.profile);

  const trimmedName = modal.name.trim();
  const trimmedDescription = modal.description.trim();
  const hasImage = typeof profile.image === 'string' && profile.image.trim().length > 0;
  const hasEmoji = typeof profile.emoji === 'string' && profile.emoji.trim().length > 0;
  const colorValue = typeof profile.color === 'string' ? profile.color.trim().toLowerCase() : '';
  const hasCustomColor = Boolean(colorValue && colorValue !== '#1058ff');

  const metadataCompletion = calculateMetadataCompletion(modal.type, modal.metadataValues);
  const messageCount = modal.chatHistory.filter(
    (message) => message.role === 'user' && (message.text.trim().length > 0 || message.attachments.length > 0),
  ).length;

  const nameScore = trimmedName ? Math.min(trimmedName.length / 20, 1) : 0;
  const descriptionScore = trimmedDescription ? Math.min(trimmedDescription.length / 260, 1) : 0;
  const mediaScore = hasImage ? 1 : hasEmoji ? 0.8 : hasCustomColor ? 0.45 : 0;
  const docsScore = Math.min((modal.documents.length + modal.pendingUploads.length) / 3, 1);
  const chatScore = Math.min(messageCount / 8, 1);

  const weightedScore =
    nameScore * 14 +
    descriptionScore * 22 +
    mediaScore * 16 +
    metadataCompletion * 30 +
    docsScore * 10 +
    chatScore * 8;

  return clampPercent(Math.round(weightedScore));
});

const entityInfoProfileProgressDashoffset = computed(() => {
  return (
    PROFILE_PROGRESS_CIRCUMFERENCE -
    (entityInfoProfileProgress.value / 100) * PROFILE_PROGRESS_CIRCUMFERENCE
  );
});

const entityInfoProfileProgressLevel = computed(() => {
  const value = entityInfoProfileProgress.value;
  if (value >= 85) return 'Высокая заполненность';
  if (value >= 60) return 'Хорошая заполненность';
  if (value >= 35) return 'Средняя заполненность';
  return 'Низкая заполненность';
});

interface MenuSearchItem {
  id: string;
  name: string;
  type: EntityType;
  color: string;
  image: string;
  emoji: string;
  hasLogo: boolean;
  progress: number;
}

interface CanvasNodeSearchItem {
  nodeId: string;
  entityId: string;
  name: string;
  type: EntityType;
  color: string;
  image: string;
  logoImage: string;
  emoji: string;
  hasLogo: boolean;
}

const menuSearchItems = computed<MenuSearchItem[]>(() => {
  const type = activeMenuEntityType.value;
  const currentEntityId = activeMenuEntity.value?._id;

  return entitiesStore
    .byType(type)
    .filter((entity) => entity._id !== currentEntityId)
    .map((entity) => toEntityListItem(entity));
});

const libraryItems = computed<MenuSearchItem[]>(() => {
  return entitiesStore
    .byType(activeLibraryType.value)
    .map((entity) => toEntityListItem(entity));
});

const filteredLibraryItems = computed<MenuSearchItem[]>(() => {
  const query = libraryQuery.value.trim().toLowerCase();
  if (!query) return libraryItems.value;

  return libraryItems.value.filter((item) => item.name.toLowerCase().includes(query));
});

const nodeSearchItems = computed<CanvasNodeSearchItem[]>(() => {
  return nodes.value
    .map((node) => {
      const entity = entitiesStore.byId(node.entityId);
      if (!entity) return null;

      const profile = toProfile(entity.profile);
      const color = typeof profile.color === 'string' && profile.color.trim() ? profile.color : '#1058ff';
      const image = typeof profile.image === 'string' ? profile.image : '';
      const logoImage = logoImageFromProfile(profile);
      const emoji = typeof profile.emoji === 'string' ? profile.emoji : '';
      const hasLogo = logoImage.trim().length > 0;

      return {
        nodeId: node.id,
        entityId: entity._id,
        name: entity.name?.trim() || 'Без названия',
        type: entity.type,
        color,
        image,
        logoImage,
        emoji,
        hasLogo,
      } satisfies CanvasNodeSearchItem;
    })
    .filter((item): item is CanvasNodeSearchItem => Boolean(item));
});

const nodeSearchResults = computed<CanvasNodeSearchItem[]>(() => {
  const query = nodeSearchQuery.value.trim().toLowerCase();
  if (!query) return [];

  return nodeSearchItems.value
    .filter((item) => {
      const typeLabel = (ENTITY_TYPE_LABELS[item.type] || '').toLowerCase();
      return item.name.toLowerCase().includes(query) || typeLabel.includes(query);
    })
    .slice(0, 20);
});

let loadVersion = 0;

interface CanvasCacheSnapshot {
  savedAt: number;
  canvas_data: ProjectCanvasData;
}

function normalizeCanvasViewport(value: unknown): ProjectCanvasViewport | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const raw = value as Partial<ProjectCanvasViewport>;
  const x = typeof raw.x === 'number' && Number.isFinite(raw.x) ? raw.x : null;
  const y = typeof raw.y === 'number' && Number.isFinite(raw.y) ? raw.y : null;
  const zoom = typeof raw.zoom === 'number' && Number.isFinite(raw.zoom) ? clampZoom(raw.zoom) : null;
  const width = typeof raw.width === 'number' && Number.isFinite(raw.width) ? Math.max(1, raw.width) : null;
  const height = typeof raw.height === 'number' && Number.isFinite(raw.height) ? Math.max(1, raw.height) : null;

  if (x === null || y === null || zoom === null || width === null || height === null) {
    return undefined;
  }

  return { x, y, zoom, width, height };
}

function createLocalNodeId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

function createLocalEdgeId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `edge-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

function snap(value: number) {
  return Math.round(value / GRID_STEP) * GRID_STEP;
}

function getNextEntityName(type: EntityType) {
  const label = type === 'shape' ? 'Новый элемент' : ENTITY_TYPE_LABELS[type] || 'Сущность';
  const count = entitiesStore.countByType(type) + 1;
  return `${label} - ${count}`;
}

function clampZoom(value: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function clampNodeScale(scale: number) {
  return Math.min(MAX_NODE_SCALE, Math.max(MIN_NODE_SCALE, scale));
}

function normalizeNodeScale(raw: unknown) {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return clampNodeScale(raw);
  }

  if (typeof raw === 'string') {
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) {
      return clampNodeScale(parsed);
    }
  }

  return DEFAULT_NODE_SCALE;
}

function getNodeById(nodeId: string) {
  return nodes.value.find((node) => node.id === nodeId) || null;
}

function edgeExistsBetween(nodeAId: string, nodeBId: string) {
  return edges.value.some((edge) => {
    return (
      (edge.source === nodeAId && edge.target === nodeBId) ||
      (edge.source === nodeBId && edge.target === nodeAId)
    );
  });
}

function createEdge(sourceNodeId: string, targetNodeId: string, patch?: Partial<CanvasEdgeProjection>) {
  return {
    id: createLocalEdgeId(),
    source: sourceNodeId,
    target: targetNodeId,
    color: EDGE_DEFAULT_COLOR,
    ...patch,
  } satisfies CanvasEdgeProjection;
}

function getNodeRadiusWorld(node: CanvasNodeProjection) {
  const scale = normalizeNodeScale(node.scale);

  return (NODE_CIRCLE_DIAMETER / 2) * scale;
}

function closeCanvasControlMenus() {
  isAlignMenuOpen.value = false;
  isArrangeMenuOpen.value = false;
  isBackgroundMenuOpen.value = false;
}

function closeResetCanvasConfirm() {
  isResetCanvasConfirmOpen.value = false;
}

function clearSelectionRect() {
  selectionRect.value = null;
}

function clearSelectedNodes() {
  selectedNodeIds.value = [];
}

function isNodeSelected(nodeId: string) {
  return selectedNodeIdSet.value.has(nodeId);
}

function snapUp(value: number) {
  const snapped = snap(value);
  return snapped >= value ? snapped : snapped + GRID_STEP;
}

function distributeAlongAxisFromFirst(
  ordered: CanvasNodeProjection[],
  axis: 'x' | 'y',
  minGapWorld: number,
) {
  if (ordered.length < 2) return;

  const first = ordered[0];
  if (!first) return;
  first[axis] = snap(first[axis]);

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (!previous || !current) continue;

    const minDistance = getNodeRadiusWorld(previous) + getNodeRadiusWorld(current) + minGapWorld;
    current[axis] = snapUp(previous[axis] + minDistance);
  }
}

function selectNodesByIds(nodeIds: string[], options?: { additive?: boolean }) {
  const additive = options?.additive ?? false;
  const uniqueIds = Array.from(new Set(nodeIds.filter(Boolean)));
  if (!additive) {
    selectedNodeIds.value = uniqueIds;
    return;
  }

  const next = new Set(selectedNodeIds.value);
  for (const nodeId of uniqueIds) {
    next.add(nodeId);
  }
  selectedNodeIds.value = Array.from(next);
}

function finalizeSelectionRect() {
  const rect = selectionRect.value;
  if (!rect) return false;

  if (!rect.moved) {
    if (!rect.additive) {
      clearSelectedNodes();
    }
    clearSelectionRect();
    return false;
  }

  const minX = Math.min(rect.startX, rect.currentX);
  const maxX = Math.max(rect.startX, rect.currentX);
  const minY = Math.min(rect.startY, rect.currentY);
  const maxY = Math.max(rect.startY, rect.currentY);

  const withinRect = nodes.value
    .filter((node) => {
      const radius = getNodeRadiusWorld(node);
      const left = node.x - radius;
      const right = node.x + radius;
      const top = node.y - radius;
      const bottom = node.y + radius;

      const intersects = right >= minX && left <= maxX && bottom >= minY && top <= maxY;
      return intersects;
    })
    .map((node) => node.id);

  selectNodesByIds(withinRect, { additive: rect.additive });
  clearSelectionRect();
  return true;
}

function getSelectedNodesForTransform() {
  if (selectedNodeIds.value.length < 2) return [] as CanvasNodeProjection[];

  const byId = new Map(nodes.value.map((node) => [node.id, node]));
  const ordered = selectedNodeIds.value
    .map((nodeId) => byId.get(nodeId))
    .filter((node): node is CanvasNodeProjection => Boolean(node));

  if (ordered.length < 2) return [] as CanvasNodeProjection[];
  return ordered;
}

function onAlignSelected(mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') {
  const targetNodes = getSelectedNodesForTransform();
  if (!targetNodes.length) return;
  const alignMinGapWorld = ALIGN_MIN_NODE_GAP_PX / Math.max(camera.value.zoom, 0.0001);

  if (mode === 'left' || mode === 'center' || mode === 'right') {
    const xValues = targetNodes.map((node) => node.x);
    const targetX =
      mode === 'left'
        ? Math.min(...xValues)
        : mode === 'right'
          ? Math.max(...xValues)
          : xValues.reduce((sum, value) => sum + value, 0) / xValues.length;

    const alignedX = snap(targetX);
    for (const node of targetNodes) {
      node.x = alignedX;
    }
    distributeAlongAxisFromFirst(targetNodes, 'y', alignMinGapWorld);
  } else {
    const yValues = targetNodes.map((node) => node.y);
    const targetY =
      mode === 'top'
        ? Math.min(...yValues)
        : mode === 'bottom'
          ? Math.max(...yValues)
          : yValues.reduce((sum, value) => sum + value, 0) / yValues.length;

    const alignedY = snap(targetY);
    for (const node of targetNodes) {
      node.y = alignedY;
    }
    distributeAlongAxisFromFirst(targetNodes, 'x', alignMinGapWorld);
  }

  queueCanvasSync();
  closeCanvasControlMenus();
}

function distributeOnRectanglePerimeter(
  targetNodes: CanvasNodeProjection[],
  width: number,
  height: number,
  centerX: number,
  centerY: number,
) {
  const perimeter = 2 * (width + height);
  if (perimeter <= 0) return;

  for (let index = 0; index < targetNodes.length; index += 1) {
    const node = targetNodes[index];
    if (!node) continue;

    const t = (index / targetNodes.length) * perimeter;
    let x = -width / 2;
    let y = -height / 2;

    if (t <= width) {
      x = -width / 2 + t;
      y = -height / 2;
    } else if (t <= width + height) {
      x = width / 2;
      y = -height / 2 + (t - width);
    } else if (t <= width * 2 + height) {
      x = width / 2 - (t - (width + height));
      y = height / 2;
    } else {
      x = -width / 2;
      y = height / 2 - (t - (width * 2 + height));
    }

    node.x = snap(centerX + x);
    node.y = snap(centerY + y);
  }
}

function onArrangeSelected(preset: CanvasArrangePreset) {
  const targetNodes = getSelectedNodesForTransform();
  if (!targetNodes.length) return;

  const ordered = [...targetNodes];
  const anchor = ordered[0];
  if (!anchor) return;
  const maxDiameter = Math.max(...ordered.map((node) => getNodeRadiusWorld(node) * 2));
  const alignMinGapWorld = ALIGN_MIN_NODE_GAP_PX / Math.max(camera.value.zoom, 0.0001);
  const shapeMinGapWorld = ARRANGE_SHAPE_MIN_NODE_GAP_PX / Math.max(camera.value.zoom, 0.0001);
  const lineSpacing = Math.max(GRID_STEP, maxDiameter + alignMinGapWorld);
  const shapeSpacing = Math.max(GRID_STEP, maxDiameter + shapeMinGapWorld);

  if (preset === 'line') {
    const lineY = snap(anchor.y);
    anchor.x = snap(anchor.x);
    anchor.y = lineY;

    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const node = ordered[index];
      if (!node || !previous) continue;

      const minDistance =
        getNodeRadiusWorld(previous) + getNodeRadiusWorld(node) + alignMinGapWorld;
      const baseX = previous.x + Math.max(lineSpacing, minDistance);
      node.x = snapUp(baseX);
      node.y = lineY;
    }
    queueCanvasSync();
    closeCanvasControlMenus();
    return;
  }

  if (preset === 'circle') {
    const radius = Math.max(shapeSpacing, (ordered.length * shapeSpacing) / (2 * Math.PI));
    const centerX = anchor.x;
    const centerY = anchor.y + radius;
    for (let index = 0; index < ordered.length; index += 1) {
      const node = ordered[index];
      if (!node) continue;

      const angle = (-Math.PI / 2) + (index / ordered.length) * Math.PI * 2;
      node.x = snap(centerX + Math.cos(angle) * radius);
      node.y = snap(centerY + Math.sin(angle) * radius);
    }
    queueCanvasSync();
    closeCanvasControlMenus();
    return;
  }

  if (preset === 'square') {
    const side = Math.max(shapeSpacing * 2, Math.ceil(ordered.length / 4) * shapeSpacing);
    const centerX = anchor.x + side / 2;
    const centerY = anchor.y + side / 2;
    distributeOnRectanglePerimeter(ordered, side, side, centerX, centerY);
    queueCanvasSync();
    closeCanvasControlMenus();
    return;
  }

  const width = Math.max(shapeSpacing * 3, Math.ceil(ordered.length / 2) * shapeSpacing);
  const height = Math.max(shapeSpacing * 2, Math.ceil(ordered.length / 4) * shapeSpacing);
  const centerX = anchor.x + width / 2;
  const centerY = anchor.y + height / 2;
  distributeOnRectanglePerimeter(ordered, width, height, centerX, centerY);
  queueCanvasSync();
  closeCanvasControlMenus();
}

function onBackgroundChange(backgroundId: string) {
  const preset = CANVAS_BACKGROUND_PRESETS.find((item) => item.id === backgroundId);
  if (!preset) return;

  canvasBackgroundId.value = preset.id;
  queueCanvasSync();
  closeCanvasControlMenus();
}

function openResetCanvasConfirm() {
  isResetCanvasConfirmOpen.value = true;
}

function onConfirmResetCanvas() {
  nodes.value = [];
  edges.value = [];
  clearSelectedNodes();
  clearSelectionRect();
  nameEditingNodeId.value = null;
  closeContextMenu();
  closeEdgeMenu();
  closeResetCanvasConfirm();
  queueCanvasSync({ immediate: true });
}

function connectNodeToNearest(nodeId: string) {
  const node = getNodeById(nodeId);
  if (!node) return false;
  const currentRadius = getNodeRadiusWorld(node);
  const edgeGapThresholdWorld = AUTO_CONNECT_EDGE_GAP_PX / camera.value.zoom;

  const candidates = nodes.value
    .filter((item) => item.id !== node.id)
    .map((item) => ({
      node: item,
      centerDistance: Math.hypot(item.x - node.x, item.y - node.y),
      edgeGap:
        Math.hypot(item.x - node.x, item.y - node.y) -
        (currentRadius + getNodeRadiusWorld(item)),
    }))
    .filter((item) => item.edgeGap <= edgeGapThresholdWorld)
    .sort((left, right) => {
      if (left.edgeGap === right.edgeGap) {
        return left.centerDistance - right.centerDistance;
      }
      return left.edgeGap - right.edgeGap;
    })
    .slice(0, AUTO_CONNECT_LIMIT);

  let created = false;
  for (const candidate of candidates) {
    if (edgeExistsBetween(node.id, candidate.node.id)) {
      continue;
    }

    edges.value.push(createEdge(node.id, candidate.node.id));
    created = true;
  }

  return created;
}

function distancePointToSegment(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) {
  const dx = endX - startX;
  const dy = endY - startY;
  const lengthSquared = dx * dx + dy * dy;

  if (!lengthSquared) {
    return Math.hypot(pointX - startX, pointY - startY);
  }

  const projection = ((pointX - startX) * dx + (pointY - startY) * dy) / lengthSquared;
  const clamped = Math.max(0, Math.min(1, projection));
  const nearestX = startX + dx * clamped;
  const nearestY = startY + dy * clamped;

  return Math.hypot(pointX - nearestX, pointY - nearestY);
}

function findEdgeAtClientPosition(clientX: number, clientY: number) {
  const viewport = viewportRef.value;
  if (!viewport || !edges.value.length) return null;

  const rect = viewport.getBoundingClientRect();
  const pointX = clientX - rect.left;
  const pointY = clientY - rect.top;
  const lineTolerance = EDGE_HIT_LINE_TOLERANCE;
  const midpointTolerance = EDGE_HIT_MIDPOINT_TOLERANCE;

  let bestMatch:
    | {
        edgeId: string;
        score: number;
      }
    | null = null;

  for (const edge of edges.value) {
    const sourceNode = getNodeById(edge.source);
    const targetNode = getNodeById(edge.target);
    if (!sourceNode || !targetNode) continue;

    const sourceX = camera.value.x + sourceNode.x * camera.value.zoom;
    const sourceY = camera.value.y + sourceNode.y * camera.value.zoom;
    const targetX = camera.value.x + targetNode.x * camera.value.zoom;
    const targetY = camera.value.y + targetNode.y * camera.value.zoom;
    const midpointX = (sourceX + targetX) / 2;
    const midpointY = (sourceY + targetY) / 2;

    const lineDistance = distancePointToSegment(pointX, pointY, sourceX, sourceY, targetX, targetY);
    const midpointDistance = Math.hypot(pointX - midpointX, pointY - midpointY);
    const isHit = lineDistance <= lineTolerance || midpointDistance <= midpointTolerance;

    if (!isHit) continue;

    const score = Math.min(lineDistance, midpointDistance * 0.9);
    if (!bestMatch || score < bestMatch.score) {
      bestMatch = {
        edgeId: edge.id,
        score,
      };
    }
  }

  return bestMatch;
}

function toProfile(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return { ...(value as Record<string, unknown>) };
}

function logoImageFromProfile(profile: Record<string, unknown>) {
  const raw = profile.logo;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '';

  const logo = raw as Record<string, unknown>;
  return typeof logo.image === 'string' ? logo.image : '';
}

function toEntityListItem(entity: Entity): MenuSearchItem {
  const profile = toProfile(entity.profile);
  const color = typeof profile.color === 'string' && profile.color.trim()
    ? profile.color
    : '#1058ff';
  const image = typeof profile.image === 'string' ? profile.image : '';
  const emoji = typeof profile.emoji === 'string' ? profile.emoji : '';
  const hasLogo = logoImageFromProfile(profile).trim().length > 0;

  return {
    id: entity._id,
    name: entity.name || 'Без названия',
    type: entity.type,
    color,
    image,
    emoji,
    hasLogo,
    progress: calculateEntityProfileProgress(entity),
  };
}

function toBooleanFlag(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }

  return false;
}

function isEntityLocked(entity: Entity | null | undefined) {
  const profile = toProfile(entity?.profile);
  return toBooleanFlag(profile.locked);
}

function isCategoryLocked(entity: Entity | null | undefined) {
  if (!entity) return false;

  const profile = toProfile(entity.profile);
  const explicit = profile.categoryLocked;
  if (typeof explicit === 'boolean') {
    return explicit;
  }

  // Backward compatibility: non-shape entities are considered already categorized.
  return entity.type !== 'shape';
}

function withCategoryLock(profileValue: unknown, locked: boolean) {
  const next = toProfile(profileValue);
  if (locked) {
    next.categoryLocked = true;
  } else {
    delete next.categoryLocked;
  }
  return next;
}

function isNodeLocked(node: CanvasNodeProjection | null | undefined) {
  if (!node) return false;
  return isEntityLocked(entitiesStore.byId(node.entityId));
}

function queueEntityProfileUpdate(entityId: string, patch: Record<string, unknown>) {
  const entity = entitiesStore.byId(entityId);
  if (!entity) return;

  const nextProfile = toProfile(entity.profile);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null) {
      delete nextProfile[key];
      continue;
    }

    nextProfile[key] = value;
  }

  entitiesStore.queueEntityUpdate(
    entityId,
    {
      profile: nextProfile,
    },
    { delay: ENTITY_SYNC_DELAY },
  );
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function normalizeRelationOption(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 60);
}

function getCustomConnectionRelationOptions(settingsValue: unknown) {
  const settings = toProfile(settingsValue);
  const raw = toStringArray(settings.connectionRelationOptions);
  const dedup = new Set<string>();

  return raw
    .map((item) => normalizeRelationOption(item))
    .filter((item) => item.length > 0 && item.toLowerCase() !== EMPTY_CONNECTION_RELATION_LABEL.toLowerCase())
    .filter((item) => {
      const key = item.toLowerCase();
      if (dedup.has(key)) return false;
      dedup.add(key);
      return true;
    });
}

function toMetadataStringArray(value: unknown) {
  if (typeof value === 'string') {
    return value.trim() ? [value.trim()] : [];
  }
  return toStringArray(value);
}

function getEntityContextFields(type: EntityType) {
  return ENTITY_CONTEXT_FIELDS[type] || [];
}

function buildEntityMetadataValues(type: EntityType, metadata: Record<string, unknown>) {
  const values: Record<string, string[]> = {};
  for (const field of getEntityContextFields(type)) {
    values[field.key] = toMetadataStringArray(metadata[field.key]);
  }
  return values;
}

function buildEntityFieldDrafts(type: EntityType) {
  const drafts: Record<string, string> = {};
  for (const field of getEntityContextFields(type)) {
    drafts[field.key] = '';
  }
  return drafts;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function metadataFieldCompletion(fieldKey: MetadataFieldKey, values: string[]) {
  const target = PROFILE_METADATA_TARGETS[fieldKey] || 1;
  if (!values.length || target <= 0) return 0;
  return Math.min(values.length / target, 1);
}

function calculateMetadataCompletion(type: EntityType, metadataValues: Record<string, string[]>) {
  const fields = getEntityContextFields(type);
  if (!fields.length) return 0;

  const typeWeights = PROFILE_METADATA_WEIGHTS[type] || {};
  let sum = 0;
  let weightTotal = 0;

  for (const field of fields) {
    const weight = typeWeights[field.key] ?? 1;
    const values = metadataValues[field.key] || [];
    const completion = metadataFieldCompletion(field.key, values);
    sum += completion * weight;
    weightTotal += weight;
  }

  if (!weightTotal) return 0;
  return sum / weightTotal;
}

function getModalFieldValues(fieldKey: string) {
  if (!entityInfoModal.value) return [] as string[];
  return entityInfoModal.value.metadataValues[fieldKey] || [];
}

function getModalFieldDraft(fieldKey: string) {
  if (!entityInfoModal.value) return '';
  return entityInfoModal.value.fieldDrafts[fieldKey] || '';
}

function setModalFieldDraft(fieldKey: string, value: string) {
  const draft = entityInfoModal.value;
  if (!draft) return;
  draft.fieldDrafts[fieldKey] = value;
}

function onModalFieldDraftInput(fieldKey: string, event: Event) {
  const input = event.target as HTMLInputElement | null;
  if (!input) return;
  setModalFieldDraft(fieldKey, input.value.slice(0, 32));
}

function createLocalAttachmentId() {
  return `doc-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

function createLocalChatMessageId() {
  return `msg-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

function getIsoNow() {
  return new Date().toISOString();
}

function normalizeChatHistory(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as EntityChatMessage[];
  }

  return value
    .map((item) => {
      const record = toProfile(item);
      const id = typeof record.id === 'string' ? record.id : createLocalChatMessageId();
      const role = record.role === 'assistant' ? 'assistant' : 'user';
      const text = typeof record.text === 'string' ? record.text : '';
      const createdAt = typeof record.createdAt === 'string' ? record.createdAt : getIsoNow();
      const rawAttachments = Array.isArray(record.attachments) ? record.attachments : [];
      const attachments = rawAttachments
        .map((attachment) => {
          const raw = toProfile(attachment);
          const data = typeof raw.data === 'string' ? raw.data : '';
          if (!data) return null;
          return {
            id: typeof raw.id === 'string' ? raw.id : createLocalAttachmentId(),
            name: typeof raw.name === 'string' ? raw.name : 'Файл',
            mime: typeof raw.mime === 'string' ? raw.mime : '',
            size: typeof raw.size === 'number' ? raw.size : 0,
            data,
          };
        })
        .filter((attachment): attachment is EntityAttachment => Boolean(attachment));

      if (!text.trim() && !attachments.length) {
        return null;
      }

      return {
        id,
        role,
        text,
        createdAt,
        attachments,
      } satisfies EntityChatMessage;
    })
    .filter((message): message is EntityChatMessage => Boolean(message));
}

function scheduleEntityInfoSave() {
  const draft = entityInfoModal.value;
  if (!draft) return;

  if (infoSaveTimer.value) {
    clearTimeout(infoSaveTimer.value);
  }

  infoSaveTimer.value = setTimeout(() => {
    persistEntityInfoDraft(draft.entityId);
  }, ENTITY_SYNC_DELAY);
}

function persistEntityInfoDraft(entityId: string) {
  const draft = entityInfoModal.value;
  if (!draft || draft.entityId !== entityId) return;

  const entity = entitiesStore.byId(entityId);
  if (!entity) return;

  const aiMetadata = toProfile(entity.ai_metadata);
  const nextMetadata: Record<string, unknown> = {
    ...aiMetadata,
    description: draft.description.trim(),
    text_input: draft.textInput,
    voice_input: draft.voiceInput.trim(),
    chat_history: draft.chatHistory.map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      createdAt: message.createdAt,
      attachments: message.attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        mime: attachment.mime,
        size: attachment.size,
        data: attachment.data,
      })),
    })),
    documents: draft.documents.map((doc) => ({
      id: doc.id,
      name: doc.name,
      mime: doc.mime,
      size: doc.size,
      data: doc.data,
    })),
  };

  for (const field of getEntityContextFields(draft.type)) {
    nextMetadata[field.key] = draft.metadataValues[field.key] || [];
  }

  entitiesStore.queueEntityUpdate(
    entityId,
    {
      name: draft.name.trim() || entity.name,
      ai_metadata: nextMetadata,
    },
    { delay: ENTITY_SYNC_DELAY },
  );
}

function stopVoiceCapture() {
  isVoiceListening.value = false;
  if (activeVoiceRecognition.value) {
    activeVoiceRecognition.value.stop();
    activeVoiceRecognition.value = null;
  }
}

function openEntityInfoModal(entityId: string) {
  const entity = entitiesStore.byId(entityId);
  if (!entity) return;

  const aiMetadata = toProfile(entity.ai_metadata);
  const rawDocuments = Array.isArray(aiMetadata.documents) ? aiMetadata.documents : [];
  const documents = rawDocuments
    .map((doc, index) => {
      const record = toProfile(doc);
      const data = typeof record.data === 'string' ? record.data : '';
      const name = typeof record.name === 'string' ? record.name : `Документ ${index + 1}`;
      const mime = typeof record.mime === 'string' ? record.mime : '';
      const size = typeof record.size === 'number' ? record.size : 0;
      if (!data) return null;
      return {
        id: typeof record.id === 'string' ? record.id : createLocalAttachmentId(),
        name,
        mime,
        size,
        data,
      };
    })
    .filter((doc): doc is NonNullable<typeof doc> => Boolean(doc));

  entityInfoModal.value = {
    entityId,
    name: entity.name || '',
    type: entity.type,
    description: typeof aiMetadata.description === 'string' ? aiMetadata.description : '',
    metadataValues: buildEntityMetadataValues(entity.type, aiMetadata),
    fieldDrafts: buildEntityFieldDrafts(entity.type),
    textInput: '',
    voiceInput: typeof aiMetadata.voice_input === 'string' ? aiMetadata.voice_input : '',
    documents,
    pendingUploads: [],
    chatHistory: normalizeChatHistory(aiMetadata.chat_history),
  };

  pendingComposerHeightReset.value = true;
  void nextTick(() => {
    autoResizeChatInput();
    scrollEntityChatToBottom('auto');
  });
}

function closeEntityInfoModal() {
  if (entityInfoModal.value) {
    persistEntityInfoDraft(entityInfoModal.value.entityId);
  }

  if (infoSaveTimer.value) {
    clearTimeout(infoSaveTimer.value);
    infoSaveTimer.value = null;
  }

  stopVoiceCapture();
  entityInfoModal.value = null;
}

function addModalFieldValue(fieldKey: string) {
  const draft = entityInfoModal.value;
  if (!draft) return;

  const currentInput = (draft.fieldDrafts[fieldKey] || '').trim();
  if (!currentInput) return;

  const normalized = currentInput.slice(0, 32);
  const currentValues = draft.metadataValues[fieldKey] || [];
  if (!currentValues.includes(normalized)) {
    draft.metadataValues[fieldKey] = [...currentValues, normalized];
  }
  draft.fieldDrafts[fieldKey] = '';
  scheduleEntityInfoSave();
}

function removeModalFieldValue(fieldKey: string, value: string) {
  const draft = entityInfoModal.value;
  if (!draft) return;

  draft.metadataValues[fieldKey] = (draft.metadataValues[fieldKey] || []).filter((item) => item !== value);
  scheduleEntityInfoSave();
}

function onInfoNameInput() {
  scheduleEntityInfoSave();
}

function onInfoDescriptionInput() {
  scheduleEntityInfoSave();
}

function onInfoTextInput() {
  autoResizeChatInput();
  scheduleEntityInfoSave();
}

function autoResizeChatInput() {
  const input = entityInfoChatInputRef.value;
  if (!input) return;

  if (pendingComposerHeightReset.value) {
    input.style.height = '0px';
    pendingComposerHeightReset.value = false;
  }

  input.style.height = '0px';
  const maxHeight = 176;
  const nextHeight = Math.min(maxHeight, input.scrollHeight);
  input.style.height = `${nextHeight}px`;
}

function resetEntityInfoChatInputSize() {
  pendingComposerHeightReset.value = true;
  void nextTick(() => {
    autoResizeChatInput();
  });
}

function scrollEntityChatToBottom(behavior: ScrollBehavior = 'smooth') {
  const feed = entityInfoChatFeedRef.value;
  if (!feed) return;

  feed.scrollTo({
    top: feed.scrollHeight,
    behavior,
  });
}

function normalizeChatText(value: string) {
  return value.replace(/\r\n/g, '\n').trim();
}

function toDisplayTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function pushChatMessage(role: EntityChatRole, text: string, attachments: EntityAttachment[] = []) {
  const draft = entityInfoModal.value;
  if (!draft) return;

  const normalizedText = normalizeChatText(text);
  if (!normalizedText && !attachments.length) return;

  draft.chatHistory = [
    ...draft.chatHistory,
    {
      id: createLocalChatMessageId(),
      role,
      text: normalizedText,
      createdAt: getIsoNow(),
      attachments: attachments.map((attachment) => ({ ...attachment })),
    },
  ];
}

function toAiAttachmentPayload(attachment: EntityAttachment) {
  return {
    name: attachment.name,
    mime: attachment.mime,
    size: attachment.size,
  };
}

function buildEntityInfoDebugAttachment(debug: Record<string, unknown>) {
  const fileName = `llm-debug-${Date.now()}.json`;
  const json = JSON.stringify(debug, null, 2);
  const encoded = encodeURIComponent(json);

  return {
    id: createLocalAttachmentId(),
    name: fileName,
    mime: 'application/json',
    size: json.length,
    data: `data:application/json;charset=utf-8,${encoded}`,
  } satisfies EntityAttachment;
}

function parseEntityInfoRequestError(error: unknown) {
  if (typeof error === 'object' && error && 'response' in error) {
    const axiosError = error as {
      response?: { status?: number; data?: { message?: string } };
      message?: string;
    };
    const message = axiosError.response?.data?.message || axiosError.message || 'LLM request failed';
    const status = axiosError.response?.status;
    return status ? `${message} (HTTP ${status})` : message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'LLM request failed';
}

function openEntityInfoAttachment(attachment: EntityAttachment) {
  if (typeof window === 'undefined') return;
  if (!attachment.data) return;

  const anchor = window.document.createElement('a');
  anchor.href = attachment.data;
  anchor.download = attachment.name || 'attachment';
  anchor.rel = 'noopener';
  anchor.target = '_blank';
  window.document.body.appendChild(anchor);
  anchor.click();
  window.document.body.removeChild(anchor);
}

async function onInfoSendInput() {
  const draft = entityInfoModal.value;
  if (!draft) return;
  if (isEntityInfoAiRequestInFlight.value) return;

  const message = normalizeChatText(draft.textInput);
  const attachments = [...draft.pendingUploads];
  if (!message && !attachments.length) return;

  pushChatMessage('user', message, attachments);
  draft.pendingUploads = [];
  draft.documents = Array.from(
    new Map(
      [...draft.documents, ...attachments].map((attachment) => [attachment.id, attachment]),
    ).values(),
  );

  draft.textInput = '';
  resetEntityInfoChatInputSize();
  void nextTick(() => {
    scrollEntityChatToBottom('auto');
  });

  scheduleEntityInfoSave();

  isEntityInfoAiRequestInFlight.value = true;
  try {
    const response = await analyzeEntityWithAi({
      entityId: draft.entityId,
      message,
      voiceInput: draft.voiceInput,
      history: draft.chatHistory
        .slice(-12)
        .map((item) => ({
          role: item.role,
          text: item.text,
        })),
      attachments: attachments.map(toAiAttachmentPayload),
      documents: draft.documents.slice(-8).map(toAiAttachmentPayload),
      debug: import.meta.env.DEV,
    });

    const currentDraft = entityInfoModal.value;
    if (!currentDraft || currentDraft.entityId !== draft.entityId) {
      return;
    }

    if (response.suggestion?.status === 'ready') {
      if (response.suggestion.description) {
        currentDraft.description = response.suggestion.description;
      }

      const fields = response.suggestion.fields || {};
      for (const field of ENTITY_CONTEXT_FIELDS[currentDraft.type] || []) {
        const rawValues = fields[field.key];
        const nextValues = Array.isArray(rawValues)
          ? rawValues.filter((value): value is string => typeof value === 'string')
          : [];
        currentDraft.metadataValues[field.key] = nextValues
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
          .slice(0, 16);
      }
    }

    const debugAttachments = response.debug ? [buildEntityInfoDebugAttachment(response.debug)] : [];
    pushChatMessage('assistant', response.reply || 'Готово.', debugAttachments);
    scheduleEntityInfoSave();
    await nextTick();
    scrollEntityChatToBottom('auto');
  } catch (error: unknown) {
    pushChatMessage('assistant', `Не удалось получить ответ от LLM. ${parseEntityInfoRequestError(error)}`);
    scheduleEntityInfoSave();
    await nextTick();
    scrollEntityChatToBottom('auto');
  } finally {
    isEntityInfoAiRequestInFlight.value = false;
  }
}

function onChatComposerKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return;
  if (event.shiftKey) return;

  event.preventDefault();
  void onInfoSendInput();
}

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = () => reject(reader.error || new Error('File read error'));
    reader.readAsDataURL(file);
  });
}

async function onInfoDocumentsChange(event: Event) {
  const input = event.target as HTMLInputElement | null;
  const files = input?.files;
  const draft = entityInfoModal.value;
  if (!files || !files.length || !draft) return;

  const attachments = await Promise.all(
    Array.from(files).map(async (file) => {
      const data = await fileToDataUrl(file);
      return {
        id: createLocalAttachmentId(),
        name: file.name,
        mime: file.type,
        size: file.size,
        data,
      };
    }),
  );

  draft.pendingUploads = [...draft.pendingUploads, ...attachments];
  if (!draft.textInput.trim()) {
    draft.textInput = attachments.map((attachment) => `[Файл] ${attachment.name}`).join('\n');
  }
  autoResizeChatInput();
  scheduleEntityInfoSave();

  if (input) {
    input.value = '';
  }
}

function removePendingUpload(attachmentId: string) {
  const draft = entityInfoModal.value;
  if (!draft) return;

  draft.pendingUploads = draft.pendingUploads.filter((attachment) => attachment.id !== attachmentId);
  scheduleEntityInfoSave();
}

function startVoiceCapture() {
  if (typeof window === 'undefined') return;
  if (!entityInfoModal.value) return;

  const speechWindow = window as Window & {
    SpeechRecognition?: new () => {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      onresult: ((event: unknown) => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
    };
    webkitSpeechRecognition?: new () => {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      onresult: ((event: unknown) => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
    };
  };
  const RecognitionCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
  if (!RecognitionCtor) {
    return;
  }

  stopVoiceCapture();

  const recognition = new RecognitionCtor();
  recognition.lang = 'ru-RU';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event: unknown) => {
    const draft = entityInfoModal.value;
    if (!draft) return;

    const eventResults = (event as { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }).results;
    const transcript = Array.from(eventResults || [])
      .map((result) => result?.[0]?.transcript || '')
      .join(' ')
      .trim();

    draft.voiceInput = transcript;
    draft.textInput = transcript;
    autoResizeChatInput();
    scheduleEntityInfoSave();
  };

  recognition.onend = () => {
    isVoiceListening.value = false;
    activeVoiceRecognition.value = null;
  };

  recognition.start();
  isVoiceListening.value = true;
  activeVoiceRecognition.value = {
    stop: () => recognition.stop(),
  };
}

function onVoiceToggle() {
  if (isVoiceListening.value) {
    stopVoiceCapture();
    return;
  }

  startVoiceCapture();
}

function normalizeCanvasData(canvasData: ProjectCanvasData | undefined): ProjectCanvasData {
  const normalizedNodes = Array.isArray(canvasData?.nodes)
    ? canvasData.nodes
        .filter((node): node is CanvasNodeProjection => {
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
        }))
    : [];

  const normalizedEdges = Array.isArray(canvasData?.edges)
    ? canvasData.edges
        .filter((edge): edge is CanvasEdgeProjection => {
          return (
            !!edge &&
            typeof edge.id === 'string' &&
            typeof edge.source === 'string' &&
            typeof edge.target === 'string'
          );
        })
        .map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: edge.label,
          color: typeof edge.color === 'string' && edge.color.trim() ? edge.color : undefined,
          arrowLeft: typeof edge.arrowLeft === 'boolean' ? edge.arrowLeft : undefined,
          arrowRight: typeof edge.arrowRight === 'boolean' ? edge.arrowRight : undefined,
        }))
    : [];

  const background =
    typeof canvasData?.background === 'string' && canvasData.background.trim()
      ? canvasData.background.trim()
      : DEFAULT_CANVAS_BACKGROUND;

  return {
    nodes: normalizedNodes,
    edges: normalizedEdges,
    viewport: normalizeCanvasViewport(canvasData?.viewport),
    background,
  };
}

function clearViewportSyncTimer() {
  if (!viewportSyncTimer.value) return;
  clearTimeout(viewportSyncTimer.value);
  viewportSyncTimer.value = null;
}

function closeContextMenu() {
  contextMenu.value = null;
  contextMenuHoverType.value = null;
}

function closeEdgeMenu() {
  edgeMenu.value = null;
}

function closeLibraryPanel() {
  isLibraryOpen.value = false;
  hoveredLibraryType.value = null;
  libraryQuery.value = '';
}

function closeNodeSearch() {
  nodeSearchOpen.value = false;
  nodeSearchQuery.value = '';
}

async function openNodeSearch() {
  if (isLoading.value || loadError.value) return;

  nodeSearchOpen.value = true;
  nodeSearchQuery.value = '';
  closeLibraryPanel();
  closeContextMenu();
  closeEdgeMenu();
  closeCanvasControlMenus();
  closeResetCanvasConfirm();

  await nextTick();
  nodeSearchInputRef.value?.focus();
}

function focusNodeBySearch(nodeId: string) {
  const node = getNodeById(nodeId);
  if (!node) return;

  centerViewportOn(node.x, node.y);
  selectNodesByIds([node.id], { additive: false });
  closeNodeSearch();
}

function clientToWorld(clientX: number, clientY: number) {
  const viewport = viewportRef.value;
  if (!viewport) {
    return { x: 0, y: 0 };
  }

  const rect = viewport.getBoundingClientRect();
  // Screen -> world conversion with current camera transform.
  return {
    x: (clientX - rect.left - camera.value.x) / camera.value.zoom,
    y: (clientY - rect.top - camera.value.y) / camera.value.zoom,
  };
}

function centerViewportOn(worldX: number, worldY: number) {
  const viewport = viewportRef.value;
  if (!viewport) return false;

  const rect = viewport.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;

  camera.value.x = rect.width / 2 - worldX * camera.value.zoom;
  camera.value.y = rect.height / 2 - worldY * camera.value.zoom;
  pendingCenterTarget.value = null;
  return true;
}

function requestViewportCenter(worldX: number, worldY: number) {
  pendingCenterTarget.value = { x: worldX, y: worldY };
}

function restoreCameraFromViewport(viewport: ProjectCanvasViewport | undefined) {
  if (!viewport) return false;
  const host = viewportRef.value;
  if (!host) return false;

  const rect = host.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;

  const widthScale = rect.width / Math.max(1, viewport.width);
  const heightScale = rect.height / Math.max(1, viewport.height);

  camera.value.zoom = clampZoom(viewport.zoom * Math.min(widthScale, heightScale));
  camera.value.x = viewport.x * widthScale;
  camera.value.y = viewport.y * heightScale;
  pendingCenterTarget.value = null;

  return true;
}

async function flushPendingViewportCenter() {
  if (!pendingCenterTarget.value) return;

  await nextTick();
  const target = pendingCenterTarget.value;
  if (!target) return;

  const centered = centerViewportOn(target.x, target.y);
  if (!centered && pendingCenterTarget.value) {
    requestAnimationFrame(() => {
      void flushPendingViewportCenter();
    });
  }
}

function applyZoomAtClient(clientX: number, clientY: number, zoomDelta: number) {
  const viewport = viewportRef.value;
  if (!viewport) return;

  const rect = viewport.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;

  const oldZoom = camera.value.zoom;
  const nextZoom = clampZoom(oldZoom + zoomDelta);
  if (nextZoom === oldZoom) return;

  // Keep the world point under cursor fixed while zooming.
  const ratio = nextZoom / oldZoom;
  camera.value.x = localX - (localX - camera.value.x) * ratio;
  camera.value.y = localY - (localY - camera.value.y) * ratio;
  camera.value.zoom = nextZoom;
}

function applyZoomAtViewportCenter(zoomDelta: number) {
  const viewport = viewportRef.value;
  if (!viewport) return;

  const rect = viewport.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  applyZoomAtClient(rect.left + rect.width / 2, rect.top + rect.height / 2, zoomDelta);
}

function onZoomOutClick() {
  applyZoomAtViewportCenter(-0.12);
}

function onZoomInClick() {
  applyZoomAtViewportCenter(0.12);
}

function onZoomResetClick() {
  const viewport = viewportRef.value;
  if (!viewport) return;

  const rect = viewport.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const worldCenterX = (rect.width / 2 - camera.value.x) / camera.value.zoom;
  const worldCenterY = (rect.height / 2 - camera.value.y) / camera.value.zoom;
  camera.value.zoom = 1;
  camera.value.x = rect.width / 2 - worldCenterX;
  camera.value.y = rect.height / 2 - worldCenterY;
}

function toggleBackgroundMenu() {
  const next = !isBackgroundMenuOpen.value;
  closeCanvasControlMenus();
  isBackgroundMenuOpen.value = next;
}

function toggleAlignMenu() {
  const next = !isAlignMenuOpen.value;
  closeCanvasControlMenus();
  isAlignMenuOpen.value = next;
}

function toggleArrangeMenu() {
  const next = !isArrangeMenuOpen.value;
  closeCanvasControlMenus();
  isArrangeMenuOpen.value = next;
}

function getCanvasCacheKey(projectId: string) {
  return `${CANVAS_CACHE_PREFIX}:${projectId}`;
}

function getNodeMenuHintStorageKey(projectId: string) {
  return `${NODE_MENU_HINT_STORAGE_PREFIX}:${projectId}`;
}

function getEntityCreatedAtMs(entity: Entity) {
  if (typeof entity.createdAt === 'string') {
    const parsed = Date.parse(entity.createdAt);
    if (Number.isFinite(parsed)) return parsed;
  }

  // Fallback for ObjectId-based documents when createdAt is missing.
  if (typeof entity._id === 'string' && /^[0-9a-fA-F]{24}$/.test(entity._id)) {
    const seconds = Number.parseInt(entity._id.slice(0, 8), 16);
    if (Number.isFinite(seconds)) {
      return seconds * 1000;
    }
  }

  return Number.MAX_SAFE_INTEGER;
}

function resolveEarliestProjectId() {
  const projects = entitiesStore.byType('project');
  if (!projects.length) return null;

  const sorted = [...projects].sort((a, b) => {
    const diff = getEntityCreatedAtMs(a) - getEntityCreatedAtMs(b);
    if (diff !== 0) return diff;
    return a._id.localeCompare(b._id);
  });

  return sorted[0]?._id || null;
}

function resolveNodeHintProjectId() {
  const fallback = resolveEarliestProjectId();
  if (typeof window === 'undefined') return fallback;

  try {
    const stored = window.localStorage.getItem(NODE_MENU_HINT_FIRST_PROJECT_STORAGE_KEY);
    if (stored) return stored;

    if (!fallback) return null;
    window.localStorage.setItem(NODE_MENU_HINT_FIRST_PROJECT_STORAGE_KEY, fallback);
    return fallback;
  } catch {
    return fallback;
  }
}

function canShowNodeMenuHintForProject(projectId: string) {
  if (!projectId) return false;
  const onboardingProjectId = resolveNodeHintProjectId();
  return onboardingProjectId === projectId;
}

function hasSeenNodeMenuHint(projectId: string) {
  if (typeof window === 'undefined') return true;

  try {
    return window.localStorage.getItem(getNodeMenuHintStorageKey(projectId)) === '1';
  } catch {
    return true;
  }
}

function markNodeMenuHintSeen(projectId: string) {
  if (!projectId || typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(getNodeMenuHintStorageKey(projectId), '1');
  } catch {
    // Ignore localStorage write errors; hint fallback is non-critical.
  }
}

function dismissNodeMenuHint(options?: { persist?: boolean }) {
  const persist = options?.persist ?? true;
  if (persist) {
    markNodeMenuHintSeen(routeProjectId.value);
  }

  nodeMenuHint.value = null;
}

function completeNodeOnboardingStep(stepId: NodeOnboardingStepId) {
  const current = nodeMenuHint.value;
  if (!current) return;
  if (current.progress[stepId]) return;

  const nextProgress = {
    ...current.progress,
    [stepId]: true,
  };

  const isCompleted = NODE_ONBOARDING_STEPS.every((step) => nextProgress[step.id]);
  if (isCompleted) {
    dismissNodeMenuHint();
    return;
  }

  nodeMenuHint.value = {
    ...current,
    progress: nextProgress,
  };
}

function skipNodeOnboarding() {
  dismissNodeMenuHint();
}

function maybeShowNodeMenuHint(projectId: string) {
  if (!projectId) return;
  if (!canShowNodeMenuHintForProject(projectId)) return;
  if (hasSeenNodeMenuHint(projectId)) return;

  const hintNode = nodes.value.find((node) => node.x === 0 && node.y === 0) || nodes.value[0];
  if (!hintNode) return;

  nodeMenuHint.value = {
    nodeId: hintNode.id,
    progress: createNodeOnboardingProgress(),
  };
}

function buildCanvasDataSnapshot(): ProjectCanvasData {
  const viewport = viewportRef.value?.getBoundingClientRect();

  return {
    nodes: nodes.value.map((node) => ({
      id: node.id,
      entityId: node.entityId,
      x: node.x,
      y: node.y,
      scale: normalizeNodeScale(node.scale),
    })),
    edges: edges.value.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      color: edge.color,
      arrowLeft: edge.arrowLeft,
      arrowRight: edge.arrowRight,
    })),
    viewport: {
      x: camera.value.x,
      y: camera.value.y,
      zoom: clampZoom(camera.value.zoom),
      width: Math.max(1, viewport?.width || 1),
      height: Math.max(1, viewport?.height || 1),
    },
    background: canvasBackgroundId.value,
  };
}

function writeCanvasCache(projectId: string, canvasData: ProjectCanvasData) {
  if (typeof window === 'undefined') return;

  const snapshot: CanvasCacheSnapshot = {
    savedAt: Date.now(),
    canvas_data: canvasData,
  };

  try {
    window.localStorage.setItem(getCanvasCacheKey(projectId), JSON.stringify(snapshot));
  } catch {
    // Ignore quota and serialization errors; network sync is still active.
  }
}

function readCanvasCache(projectId: string): CanvasCacheSnapshot | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(getCanvasCacheKey(projectId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<CanvasCacheSnapshot>;
    if (!parsed || typeof parsed.savedAt !== 'number') return null;

    return {
      savedAt: parsed.savedAt,
      canvas_data: normalizeCanvasData(parsed.canvas_data as ProjectCanvasData),
    };
  } catch {
    return null;
  }
}

function queueCanvasSync(options?: { immediate?: boolean; projectId?: string }) {
  const projectId = options?.projectId || routeProjectId.value;
  if (!projectId) return;

  const canvasData = buildCanvasDataSnapshot();
  writeCanvasCache(projectId, canvasData);

  entitiesStore.queueEntityUpdate(
    projectId,
    {
      canvas_data: canvasData,
    },
    { delay: options?.immediate ? 0 : CANVAS_SYNC_DELAY },
  );
}

function scheduleViewportSync() {
  if (isLoading.value) return;
  if (!routeProjectId.value) return;

  clearViewportSyncTimer();
  viewportSyncTimer.value = setTimeout(() => {
    viewportSyncTimer.value = null;
    queueCanvasSync();
  }, VIEWPORT_SYNC_DELAY);
}

async function createShapeEntity(name: string) {
  return entitiesStore.createEntity({
    type: 'shape',
    name,
    profile: {},
    ai_metadata: {},
  });
}

async function addNodeAtWorldPosition(worldX: number, worldY: number, name = getNextEntityName('shape')) {
  const created = await createShapeEntity(name);
  const localNodeId = createLocalNodeId();

  nodes.value.push({
    id: localNodeId,
    entityId: created._id,
    x: snap(worldX),
    y: snap(worldY),
    scale: 1,
  });
  selectNodesByIds([localNodeId], { additive: false });
  nameEditingNodeId.value = localNodeId;
  connectNodeToNearest(localNodeId);

  queueCanvasSync();
}

async function loadProjectCanvas(projectId: string) {
  clearViewportSyncTimer();
  const currentVersion = ++loadVersion;
  isLoading.value = true;
  loadError.value = null;
  nameEditingNodeId.value = null;
  dismissNodeMenuHint({ persist: false });
  closeEntityInfoModal();
  closeNodeSearch();
  closeContextMenu();
  closeEdgeMenu();
  clearSelectionRect();
  clearSelectedNodes();
  closeCanvasControlMenus();
  closeResetCanvasConfirm();

  try {
    if (!authStore.isAuthenticated) {
      throw new Error('Требуется вход через Google');
    }

    if (!entitiesStore.initialized) {
      await entitiesStore.bootstrap();
    }

    const project = entitiesStore.byId(projectId);
    if (!project || project.type !== 'project') {
      throw new Error('Проект не найден');
    }

    const serverCanvasData = normalizeCanvasData(project.canvas_data);
    const cached = readCanvasCache(projectId);
    const serverUpdatedAt = project.updatedAt ? Date.parse(project.updatedAt) : 0;
    const shouldUseCache = Boolean(cached && cached.savedAt >= serverUpdatedAt);

    const canvasData = shouldUseCache ? cached!.canvas_data : serverCanvasData;
    if (!shouldUseCache) {
      writeCanvasCache(projectId, canvasData);
    }
    nodes.value = canvasData.nodes;
    edges.value = canvasData.edges;
    canvasBackgroundId.value =
      typeof canvasData.background === 'string' && canvasData.background.trim()
        ? canvasData.background
        : DEFAULT_CANVAS_BACKGROUND;

    await nextTick();

    if (!nodes.value.length) {
      // Auto-init for new project: create central node at world origin.
      const centralEntity = await createShapeEntity(getNextEntityName('shape'));

      camera.value.zoom = 1;
      nodes.value = [
        {
          id: createLocalNodeId(),
          entityId: centralEntity._id,
          x: 0,
          y: 0,
          scale: 1,
        },
      ];
      edges.value = [];
      queueCanvasSync({ immediate: true });
      requestViewportCenter(0, 0);
    } else if (currentVersion === loadVersion) {
      const restored = restoreCameraFromViewport(canvasData.viewport);
      if (!restored) {
        const firstNode = nodes.value[0];
        if (firstNode) {
          requestViewportCenter(firstNode.x, firstNode.y);
        }
      }
    }

    if (currentVersion === loadVersion) {
      maybeShowNodeMenuHint(projectId);
    }
  } catch (error) {
    const fallback = 'Не удалось загрузить холст проекта';
    loadError.value = error instanceof Error ? error.message || fallback : fallback;
    nodes.value = [];
    edges.value = [];
    canvasBackgroundId.value = DEFAULT_CANVAS_BACKGROUND;
  } finally {
    if (currentVersion === loadVersion) {
      isLoading.value = false;
    }
  }
}

function patchActiveEdge(patch: Partial<CanvasEdgeProjection>) {
  const edgeId = edgeMenu.value?.edgeId;
  if (!edgeId) return;

  const edgeIndex = edges.value.findIndex((edge) => edge.id === edgeId);
  if (edgeIndex < 0) {
    closeEdgeMenu();
    return;
  }

  const currentEdge = edges.value[edgeIndex];
  if (!currentEdge) {
    closeEdgeMenu();
    return;
  }

  edges.value[edgeIndex] = {
    ...currentEdge,
    ...patch,
  };
  queueCanvasSync();
}

function onEdgeToggleArrowLeft() {
  const edge = activeEdge.value;
  if (!edge) return;

  patchActiveEdge({
    arrowLeft: !edge.arrowLeft,
  });
}

function onEdgeToggleArrowRight() {
  const edge = activeEdge.value;
  if (!edge) return;

  patchActiveEdge({
    arrowRight: !edge.arrowRight,
  });
}

function onEdgeColorChange(payload: { color: string }) {
  patchActiveEdge({
    color: payload.color,
  });
}

function onEdgeLabelChange(payload: { label: string }) {
  patchActiveEdge({
    label: payload.label.trim().slice(0, 60),
  });
}

async function onEdgeCreateRelationOption(payload: { label: string }) {
  const normalized = normalizeRelationOption(payload.label);
  if (!normalized) return;
  if (normalized.toLowerCase() === EMPTY_CONNECTION_RELATION_LABEL.toLowerCase()) return;

  const alreadyKnown = connectionRelationOptions.value.some(
    (option) => option.toLowerCase() === normalized.toLowerCase(),
  );
  if (alreadyKnown) return;
  if (!authStore.isAuthenticated) return;

  const currentCustom = getCustomConnectionRelationOptions(authStore.user?.settings);
  const nextCustom = [...currentCustom, normalized];

  try {
    await authStore.updateSettings({
      connectionRelationOptions: nextCustom,
    });
  } catch (error) {
    console.error('Failed to save custom connection relation option', error);
  }
}

function onEdgeDelete() {
  const edgeId = edgeMenu.value?.edgeId;
  if (!edgeId) return;

  edges.value = edges.value.filter((edge) => edge.id !== edgeId);
  queueCanvasSync();
  closeEdgeMenu();
}

async function onEdgeAddNode() {
  const edge = activeEdge.value;
  const pair = activeEdgeNodes.value;
  if (!edge || !pair) return;

  const created = await createShapeEntity(getNextEntityName('shape'));
  const newNodeId = createLocalNodeId();
  const midpointX = snap((pair.sourceNode.x + pair.targetNode.x) / 2);
  const midpointY = snap((pair.sourceNode.y + pair.targetNode.y) / 2);

  nodes.value.push({
    id: newNodeId,
    entityId: created._id,
    x: midpointX,
    y: midpointY,
    scale: 1,
  });

  const leftEdge = createEdge(edge.source, newNodeId, {
    color: edge.color || EDGE_DEFAULT_COLOR,
    arrowLeft: edge.arrowLeft,
  });
  const rightEdge = createEdge(newNodeId, edge.target, {
    color: edge.color || EDGE_DEFAULT_COLOR,
    arrowRight: edge.arrowRight,
  });

  edges.value = edges.value.filter((item) => item.id !== edge.id);
  edges.value.push(leftEdge, rightEdge);
  nameEditingNodeId.value = newNodeId;
  edgeMenu.value = { edgeId: rightEdge.id };

  queueCanvasSync();
}

function onViewportWheel(event: WheelEvent) {
  // Critical: block browser back/forward swipe gestures on trackpads.
  event.preventDefault();
  event.stopPropagation();

  const pinchZoom = event.ctrlKey || event.metaKey;
  const classicMouseWheel =
    Math.abs(event.deltaX) < 1 && Math.abs(event.deltaY) >= 40;

  if (pinchZoom || classicMouseWheel) {
    const direction = event.deltaY > 0 ? -1 : 1;
    const zoomDelta = (pinchZoom ? 0.04 : 0.12) * direction;
    applyZoomAtClient(event.clientX, event.clientY, zoomDelta);
    return;
  }

  // Trackpad two-finger scroll = camera pan.
  camera.value.x -= event.deltaX;
  camera.value.y -= event.deltaY;
}

function onViewportPointerDown(event: PointerEvent) {
  if (event.button === 0) {
    closeNodeSearch();
    closeLibraryPanel();
    closeContextMenu();
    closeEdgeMenu();
    closeCanvasControlMenus();
    closeResetCanvasConfirm();
  }

  const canPanByMiddleButton = event.button === 1;

  if (canPanByMiddleButton) {
    event.preventDefault();
    closeContextMenu();
    closeEdgeMenu();

    isPanning.value = true;
    suppressMenuOpenUntil.value = Date.now() + 180;
    panStart.value = {
      clientX: event.clientX,
      clientY: event.clientY,
      cameraX: camera.value.x,
      cameraY: camera.value.y,
    };
    return;
  }

  if (event.button !== 0) return;

  const target = event.target as HTMLElement | null;
  const startedOnNode = Boolean(target?.closest('.canvas-node'));

  if (startedOnNode) return;

  event.preventDefault();
  const world = clientToWorld(event.clientX, event.clientY);
  selectionRect.value = {
    startX: world.x,
    startY: world.y,
    currentX: world.x,
    currentY: world.y,
    additive: event.shiftKey,
    moved: false,
  };
}

function onViewportClick(event: MouseEvent) {
  if (event.defaultPrevented) return;
  if (Date.now() < suppressMenuOpenUntil.value) return;
  if (isPanning.value) return;
  if (selectionRect.value) return;

  const target = event.target as HTMLElement | null;
  if (
    target?.closest(
      '.canvas-library, .canvas-node, .canvas-controls, .menu-backdrop, .canvas-node-search',
    )
  ) {
    return;
  }

  const hit = findEdgeAtClientPosition(event.clientX, event.clientY);
  if (!hit) {
    closeEdgeMenu();
    return;
  }

  nameEditingNodeId.value = null;
  closeContextMenu();
  edgeMenu.value = { edgeId: hit.edgeId };
}

function onWindowPointerMove(event: PointerEvent) {
  if (selectionRect.value) {
    const world = clientToWorld(event.clientX, event.clientY);
    const deltaX = world.x - selectionRect.value.startX;
    const deltaY = world.y - selectionRect.value.startY;
    const moveThresholdWorld = SELECTION_MOVE_THRESHOLD_PX / Math.max(camera.value.zoom, 0.0001);
    if (Math.abs(deltaX) >= moveThresholdWorld || Math.abs(deltaY) >= moveThresholdWorld) {
      selectionRect.value.moved = true;
    }
    selectionRect.value.currentX = world.x;
    selectionRect.value.currentY = world.y;
    return;
  }

  const groupDrag = draggingGroup.value;
  if (groupDrag) {
    const world = clientToWorld(event.clientX, event.clientY);
    const deltaX = world.x - groupDrag.startPointerX;
    const deltaY = world.y - groupDrag.startPointerY;

    if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
      groupDrag.moved = true;
    }

    for (const nodeId of groupDrag.nodeIds) {
      const node = getNodeById(nodeId);
      const start = groupDrag.startPositions[nodeId];
      if (!node || !start) continue;

      node.x = start.x + deltaX;
      node.y = start.y + deltaY;
    }
    return;
  }

  if (isPanning.value) {
    camera.value.x = panStart.value.cameraX + (event.clientX - panStart.value.clientX);
    camera.value.y = panStart.value.cameraY + (event.clientY - panStart.value.clientY);
    return;
  }

  const dragState = draggingNode.value;
  if (!dragState) return;

  const node = nodes.value.find((item) => item.id === dragState.nodeId);
  if (!node) return;
  if (isNodeLocked(node)) {
    draggingNode.value = null;
    return;
  }

  const world = clientToWorld(event.clientX, event.clientY);
  const nextX = world.x - dragState.offsetX;
  const nextY = world.y - dragState.offsetY;

  if (Math.abs(nextX - node.x) > 0.5 || Math.abs(nextY - node.y) > 0.5) {
    dragState.moved = true;
  }

  node.x = nextX;
  node.y = nextY;
}

function onWindowPointerUp() {
  if (selectionRect.value) {
    const applied = finalizeSelectionRect();
    if (applied) {
      suppressMenuOpenUntil.value = Date.now() + 140;
    }
    return;
  }

  if (isPanning.value) {
    isPanning.value = false;
  }

  const groupDrag = draggingGroup.value;
  if (groupDrag) {
    for (const nodeId of groupDrag.nodeIds) {
      const node = getNodeById(nodeId);
      if (!node) continue;
      node.x = snap(node.x);
      node.y = snap(node.y);
    }

    if (groupDrag.moved) {
      for (const nodeId of groupDrag.nodeIds) {
        connectNodeToNearest(nodeId);
      }
      queueCanvasSync();
      suppressMenuOpenUntil.value = Date.now() + 140;
    }

    draggingGroup.value = null;
    return;
  }

  const dragState = draggingNode.value;
  if (!dragState) return;

  const node = nodes.value.find((item) => item.id === dragState.nodeId);
  if (node) {
    node.x = snap(node.x);
    node.y = snap(node.y);

    if (dragState.moved) {
      connectNodeToNearest(node.id);
      queueCanvasSync();
      suppressMenuOpenUntil.value = Date.now() + 140;
    }
  }

  draggingNode.value = null;
}

function resetTransientStates() {
  isPanning.value = false;
  draggingNode.value = null;
  draggingGroup.value = null;
  isCanvasDropActive.value = false;
  viewportDragDepth.value = 0;
  clearSelectionRect();
  closeNodeSearch();
  closeCanvasControlMenus();
  closeResetCanvasConfirm();
}

function onWindowKeyDown(event: KeyboardEvent) {
  if (event.code === 'Space') {
    if (isEditableElement(event.target)) return;
    if (event.repeat) return;

    event.preventDefault();
    void openNodeSearch();
    return;
  }

  if (event.key === 'Escape' && nodeSearchOpen.value) {
    event.preventDefault();
    closeNodeSearch();
    return;
  }

  if (event.key === 'Enter' && nodeSearchOpen.value && !isEditableElement(event.target)) {
    const first = nodeSearchResults.value[0];
    if (!first) return;

    event.preventDefault();
    focusNodeBySearch(first.nodeId);
  }
}

async function onCanvasDoubleClick(event: MouseEvent) {
  if (event.defaultPrevented) return;

  closeEdgeMenu();
  const world = clientToWorld(event.clientX, event.clientY);
  await addNodeAtWorldPosition(world.x, world.y, getNextEntityName('shape'));
}

function onLibraryCategoryHover(type: EntityType | null) {
  hoveredLibraryType.value = type;
}

function onLibraryCategoryClick(type: EntityType) {
  if (activeLibraryType.value === type) {
    isLibraryOpen.value = !isLibraryOpen.value;
  } else {
    activeLibraryType.value = type;
    isLibraryOpen.value = true;
  }

  libraryQuery.value = '';
  closeContextMenu();
  closeEdgeMenu();
  nameEditingNodeId.value = null;
}

function onLibraryItemDragStart(event: DragEvent, item: MenuSearchItem) {
  if (!event.dataTransfer) return;

  event.dataTransfer.setData(LIBRARY_DRAG_MIME, item.id);
  event.dataTransfer.setData('text/plain', item.id);
  event.dataTransfer.effectAllowed = 'copy';
}

function getDraggedEntityId(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return '';

  const fromMime = dataTransfer.getData(LIBRARY_DRAG_MIME).trim();
  if (fromMime) return fromMime;

  const fromText = dataTransfer.getData('text/plain').trim();
  return fromText;
}

function isEntityDragPayload(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return false;
  return dataTransfer.types.includes(LIBRARY_DRAG_MIME) || dataTransfer.types.includes('text/plain');
}

function onViewportDragEnter(event: DragEvent) {
  if (!isEntityDragPayload(event.dataTransfer)) return;
  event.preventDefault();
  viewportDragDepth.value += 1;
  isCanvasDropActive.value = true;
}

function onViewportDragOver(event: DragEvent) {
  if (!isEntityDragPayload(event.dataTransfer)) return;

  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy';
  }
  isCanvasDropActive.value = true;
}

function onViewportDragLeave(event: DragEvent) {
  if (!isEntityDragPayload(event.dataTransfer)) return;

  event.preventDefault();
  viewportDragDepth.value = Math.max(0, viewportDragDepth.value - 1);
  if (viewportDragDepth.value === 0) {
    isCanvasDropActive.value = false;
  }
}

function onViewportDrop(event: DragEvent) {
  if (!isEntityDragPayload(event.dataTransfer)) return;

  event.preventDefault();
  viewportDragDepth.value = 0;
  isCanvasDropActive.value = false;

  const entityId = getDraggedEntityId(event.dataTransfer);
  if (!entityId) return;

  const draggedEntity = entitiesStore.byId(entityId);
  if (!draggedEntity) return;

  const world = clientToWorld(event.clientX, event.clientY);
  closeContextMenu();
  closeEdgeMenu();
  nameEditingNodeId.value = null;

  const localNodeId = createLocalNodeId();
  nodes.value.push({
    id: localNodeId,
    entityId: draggedEntity._id,
    x: snap(world.x),
    y: snap(world.y),
    scale: 1,
  });
  selectNodesByIds([localNodeId], { additive: false });
  connectNodeToNearest(localNodeId);
  queueCanvasSync();
}

function onNodeDragStart(payload: {
  nodeId: string;
  pointerEvent: PointerEvent;
}) {
  if (payload.pointerEvent.shiftKey) return;

  const node = nodes.value.find((item) => item.id === payload.nodeId);
  if (!node) return;
  if (isNodeLocked(node)) return;

  const draggableSelectedIds = selectedNodeIds.value.filter((id) => {
    const selectedNode = getNodeById(id);
    return Boolean(selectedNode && !isNodeLocked(selectedNode));
  });
  const canGroupDrag =
    draggableSelectedIds.length > 1 && selectedNodeIdSet.value.has(payload.nodeId);

  if (canGroupDrag) {
    draggingNode.value = null;
    nameEditingNodeId.value = null;
    closeContextMenu();
    closeEdgeMenu();

    const world = clientToWorld(payload.pointerEvent.clientX, payload.pointerEvent.clientY);
    const startPositions: Record<string, { x: number; y: number }> = {};
    for (const nodeId of draggableSelectedIds) {
      const selectedNode = getNodeById(nodeId);
      if (!selectedNode) continue;
      startPositions[nodeId] = { x: selectedNode.x, y: selectedNode.y };
    }

    draggingGroup.value = {
      nodeIds: draggableSelectedIds,
      startPointerX: world.x,
      startPointerY: world.y,
      startPositions,
      moved: false,
    };
    return;
  }

  const shouldKeepSelection =
    selectedNodeIdSet.value.has(payload.nodeId) && selectedNodeIds.value.length > 1;
  if (!shouldKeepSelection && selectedNodeIds.value.length) {
    clearSelectedNodes();
  }
  nameEditingNodeId.value = null;
  closeContextMenu();
  closeEdgeMenu();
  draggingGroup.value = null;

  const world = clientToWorld(payload.pointerEvent.clientX, payload.pointerEvent.clientY);
  draggingNode.value = {
    nodeId: payload.nodeId,
    offsetX: world.x - node.x,
    offsetY: world.y - node.y,
    moved: false,
  };
}

function onNodeOpenMenu(payload: { nodeId: string; shiftKey?: boolean }) {
  if (Date.now() < suppressMenuOpenUntil.value) return;
  closeCanvasControlMenus();
  closeResetCanvasConfirm();

  if (payload.shiftKey) {
    selectNodesByIds([payload.nodeId], { additive: true });
    closeContextMenu();
    closeEdgeMenu();
    return;
  }

  clearSelectedNodes();
  closeEdgeMenu();

  if (contextMenu.value?.nodeId === payload.nodeId) {
    const node = nodes.value.find((item) => item.id === payload.nodeId);
    const entity = node ? entitiesStore.byId(node.entityId) : null;
    if (entity && isCategoryLocked(entity)) {
      completeNodeOnboardingStep('open-menu');
      completeNodeOnboardingStep('open-context');
      openEntityInfoModal(entity._id);
      return;
    }
  }

  nameEditingNodeId.value = null;
  contextMenuHoverType.value = null;
  contextMenu.value = { nodeId: payload.nodeId };
  completeNodeOnboardingStep('open-menu');
}

function onNodeOpenPortal(payload: { projectId: string }) {
  const entity = entitiesStore.byId(payload.projectId);
  if (isEntityLocked(entity)) return;

  router.push({ name: 'project-canvas', params: { id: payload.projectId } });
}

async function onMenuTypeChange(payload: { type: EntityType }) {
  if (activeMenuLocked.value) return;

  const node = activeMenuNode.value;
  if (!node) return;
  const nextName = getNextEntityName(payload.type);

  const currentEntity = entitiesStore.byId(node.entityId);
  if (activeMenuCategoryLocked.value && currentEntity && currentEntity.type !== payload.type) {
    return;
  }

  const lockedProfile = withCategoryLock(activeMenuEntity.value?.profile, true);
  if (!currentEntity) {
    const replacement = await entitiesStore.createEntity({
      type: payload.type,
      name: nextName,
      profile: lockedProfile,
      ai_metadata: {},
      ...(payload.type === 'project'
        ? {
            canvas_data: {
              nodes: [],
              edges: [],
            },
          }
        : {}),
    });
    node.entityId = replacement._id;
    queueCanvasSync();
    closeContextMenu();
    return;
  }

  if (currentEntity.type === payload.type) {
    closeContextMenu();
    return;
  }

  if (currentEntity.type === 'project' && payload.type !== 'project') {
    // Не меняем тип существующего проекта: создаем новую сущность и перепривязываем узел.
    const replacement = await entitiesStore.createEntity({
      type: payload.type,
      name: nextName,
      profile: withCategoryLock(currentEntity.profile, true),
      ai_metadata: {},
    });
    node.entityId = replacement._id;
    entitiesStore.triggerFlash(payload.type);
  } else {
    entitiesStore.queueEntityUpdate(
      currentEntity._id,
      {
        type: payload.type,
        name: nextName,
        profile: withCategoryLock(currentEntity.profile, true),
        canvas_data:
          payload.type === 'project'
            ? currentEntity.canvas_data || {
                nodes: [],
                edges: [],
              }
            : undefined,
      },
      { delay: ENTITY_SYNC_DELAY },
    );

    // При смене категории существующей ноды вручную запускаем flash-счетчик в хедере.
    entitiesStore.triggerFlash(payload.type);
  }

  queueCanvasSync();
  closeContextMenu();
}

function onMenuHoverType(payload: { type: EntityType | null }) {
  contextMenuHoverType.value = payload.type;
}

async function onMenuResetNode() {
  if (activeMenuLocked.value) return;

  const node = activeMenuNode.value;
  if (!node) return;
  const resetName = getNextEntityName('shape');

  const currentEntity = entitiesStore.byId(node.entityId);

  if (!currentEntity || currentEntity.type === 'project') {
    const replacement = await entitiesStore.createEntity(
      {
        type: 'shape',
        name: resetName,
        profile: withCategoryLock(activeMenuEntity.value?.profile, false),
        ai_metadata: {},
      },
      { flash: false },
    );
    node.entityId = replacement._id;
  } else {
    entitiesStore.queueEntityUpdate(
      currentEntity._id,
      {
        type: 'shape',
        name: resetName,
        profile: withCategoryLock(currentEntity.profile, false),
        ai_metadata: {},
        canvas_data: undefined,
      },
      { delay: ENTITY_SYNC_DELAY },
    );
  }

  queueCanvasSync();
  closeContextMenu();
}

function onMenuDeleteNode() {
  if (activeMenuLocked.value) return;

  const nodeId = contextMenu.value?.nodeId;
  if (!nodeId) return;

  nodes.value = nodes.value.filter((node) => node.id !== nodeId);
  edges.value = edges.value.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
  selectedNodeIds.value = selectedNodeIds.value.filter((id) => id !== nodeId);
  queueCanvasSync();
  closeEdgeMenu();
  closeContextMenu();
}

function onNodeNameCommit(payload: {
  entityId: string;
  name: string;
}) {
  const nextName = payload.name.trim();
  if (!nextName) return;

  const currentEntity = entitiesStore.byId(payload.entityId);
  if (!currentEntity) return;
  if (isEntityLocked(currentEntity)) return;

  if ((currentEntity.name || '').trim() === nextName) {
    return;
  }

  entitiesStore.queueEntityUpdate(
    payload.entityId,
    {
      name: nextName,
    },
    { delay: ENTITY_SYNC_DELAY },
  );
}

function onMenuColorChange(payload: { color: string }) {
  const entityId = activeMenuEntity.value?._id;
  if (!entityId || activeMenuLocked.value) return;

  queueEntityProfileUpdate(entityId, {
    color: payload.color,
  });
}

function onMenuImageChange(payload: { image: string }) {
  const entityId = activeMenuEntity.value?._id;
  if (!entityId || activeMenuLocked.value) return;

  queueEntityProfileUpdate(entityId, {
    image: payload.image,
    ...(payload.image ? { emoji: '' } : {}),
    logo: undefined,
  });
}

function normalizeAutoName(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return `${trimmed.slice(0, 1).toUpperCase()}${trimmed.slice(1)}`;
}

function queueEntityNameUpdate(entityId: string, nextName: string) {
  const normalized = normalizeAutoName(nextName);
  if (!normalized) return;

  entitiesStore.queueEntityUpdate(
    entityId,
    {
      name: normalized,
    },
    { delay: ENTITY_SYNC_DELAY },
  );
}

function onMenuEmojiChange(payload: { emoji: string; name?: string }) {
  const entityId = activeMenuEntity.value?._id;
  if (!entityId || activeMenuLocked.value) return;

  queueEntityProfileUpdate(entityId, {
    emoji: payload.emoji,
    ...(payload.emoji ? { image: '' } : {}),
    logo: undefined,
  });

  if (payload.emoji) {
    queueEntityNameUpdate(entityId, payload.name || payload.emoji);
  }
}

function onMenuLogoChange(payload: { logo: LogoLibraryItem | null }) {
  const entityId = activeMenuEntity.value?._id;
  if (!entityId || activeMenuLocked.value) return;

  if (!payload.logo) {
    queueEntityProfileUpdate(entityId, {
      logo: undefined,
      image: '',
    });
    return;
  }

  queueEntityProfileUpdate(entityId, {
    logo: {
      id: payload.logo.id,
      name: payload.logo.name,
      background: payload.logo.background,
      source: payload.logo.source,
      image: payload.logo.image,
      keywords: Array.isArray(payload.logo.keywords) ? [...payload.logo.keywords] : [],
    },
    color: payload.logo.background,
    image: payload.logo.image,
    emoji: '',
  });
  queueEntityNameUpdate(entityId, payload.logo.name);
}

function onMenuToggleLock() {
  const node = activeMenuNode.value;
  const entityId = activeMenuEntity.value?._id;
  if (!node || !entityId) return;

  contextMenuHoverType.value = null;
  const currentLocked = activeMenuLocked.value;
  queueEntityProfileUpdate(entityId, {
    locked: !currentLocked,
  });

  if (!currentLocked) {
    if (draggingNode.value?.nodeId === node.id) {
      draggingNode.value = null;
    }
    if (nameEditingNodeId.value === node.id) {
      nameEditingNodeId.value = null;
    }
  }
}

function onMenuOpenEntityInfo() {
  const entityId = activeMenuEntity.value?._id;
  if (!entityId) return;
  if (!activeMenuCategoryLocked.value) return;

  completeNodeOnboardingStep('open-context');
  openEntityInfoModal(entityId);
}

function onMenuScaleChange(payload: { scalePercent: number }) {
  const node = activeMenuNode.value;
  if (!node || activeMenuLocked.value) return;

  const numeric = Number(payload.scalePercent);
  if (!Number.isFinite(numeric)) return;
  const nextScale = clampNodeScale(numeric / 100);
  if (Math.abs(normalizeNodeScale(node.scale) - nextScale) < 0.001) return;

  node.scale = nextScale;
  queueCanvasSync();
}

function onMenuSelectEntity(payload: { entityId: string }) {
  if (activeMenuLocked.value) return;

  const node = activeMenuNode.value;
  if (!node) return;

  const selectedEntity = entitiesStore.byId(payload.entityId);
  if (!selectedEntity) return;

  // Search is category-bound: allow binding only to entities of the same type.
  if (selectedEntity.type !== activeMenuEntityType.value) return;

  node.entityId = selectedEntity._id;
  queueCanvasSync();
  closeContextMenu();
}

function onNodeNameEditFinished(payload: { nodeId: string }) {
  if (nameEditingNodeId.value === payload.nodeId) {
    nameEditingNodeId.value = null;
  }
}

watch(
  [isLoading, viewportRef],
  async ([loading]) => {
    if (loading) return;
    await flushPendingViewportCenter();
  },
  { immediate: true },
);

watch(
  () => [camera.value.x, camera.value.y, camera.value.zoom],
  () => {
    scheduleViewportSync();
  },
);

watch(
  routeProjectId,
  async (projectId, previousProjectId) => {
    clearViewportSyncTimer();
    if (previousProjectId && previousProjectId !== projectId) {
      queueCanvasSync({ immediate: false, projectId: previousProjectId });
    }

    if (!projectId) {
      isLoading.value = false;
      loadError.value = 'Некорректный идентификатор проекта';
      return;
    }

    await loadProjectCanvas(projectId);
  },
  { immediate: true },
);

watch(
  activeEdgeNodes,
  (pair) => {
    if (!pair && edgeMenu.value) {
      closeEdgeMenu();
    }
  },
);

watch(
  () => nodes.value.map((node) => node.id),
  (nextNodeIds) => {
    const availableIds = new Set(nextNodeIds);
    const filtered = selectedNodeIds.value.filter((id) => availableIds.has(id));
    if (filtered.length !== selectedNodeIds.value.length) {
      selectedNodeIds.value = filtered;
    }
  },
);

watch(
  () => selectedNodes.value.length,
  (count) => {
    if (count >= 2) return;
    isAlignMenuOpen.value = false;
    isArrangeMenuOpen.value = false;
  },
);

onMounted(() => {
  window.addEventListener('pointermove', onWindowPointerMove);
  window.addEventListener('pointerup', onWindowPointerUp);
  window.addEventListener('pointercancel', onWindowPointerUp);
  window.addEventListener('keydown', onWindowKeyDown);
  window.addEventListener('blur', resetTransientStates);
});

onBeforeUnmount(() => {
  clearViewportSyncTimer();
  queueCanvasSync({ immediate: false });
  dismissNodeMenuHint({ persist: false });
  closeEntityInfoModal();

  window.removeEventListener('pointermove', onWindowPointerMove);
  window.removeEventListener('pointerup', onWindowPointerUp);
  window.removeEventListener('pointercancel', onWindowPointerUp);
  window.removeEventListener('keydown', onWindowKeyDown);
  window.removeEventListener('blur', resetTransientStates);
});
</script>

<template>
  <section class="canvas-page">
    <div v-if="isLoading" class="canvas-state">Загрузка холста...</div>
    <div v-else-if="loadError" class="canvas-state state-error">{{ loadError }}</div>

    <div
      v-else
      ref="viewportRef"
      class="canvas-viewport"
      :style="canvasViewportStyle"
      :class="{
        'is-panning': isPanning,
        'is-drop-ready': isCanvasDropActive,
      }"
      @pointerdown="onViewportPointerDown"
      @click="onViewportClick"
      @wheel="onViewportWheel"
      @dblclick="onCanvasDoubleClick"
      @dragenter="onViewportDragEnter"
      @dragover="onViewportDragOver"
      @dragleave="onViewportDragLeave"
      @drop="onViewportDrop"
    >
      <aside class="canvas-library" @pointerdown.stop @wheel.stop>
        <div class="library-rail">
          <button
            v-for="category in libraryCategories"
            :key="category.type"
            type="button"
            class="library-rail-btn"
            :class="{ active: isLibraryOpen && activeLibraryType === category.type }"
            :aria-label="category.label"
            @mouseenter="onLibraryCategoryHover(category.type)"
            @mouseleave="onLibraryCategoryHover(null)"
            @click="onLibraryCategoryClick(category.type)"
          >
            <AppIcon :name="category.type" />
            <span class="library-rail-label" :class="{ visible: hoveredLibraryType === category.type }">
              {{ category.label }}
            </span>
          </button>
        </div>

        <div v-if="isLibraryOpen" class="library-panel">
          <div class="library-search-row">
            <AppIcon name="search" />
            <input
              v-model.trim="libraryQuery"
              type="search"
              class="library-search-input"
              :placeholder="`Поиск по ${activeLibraryLabel.toLowerCase()}`"
            />
          </div>

          <div class="library-list">
            <div v-if="!filteredLibraryItems.length" class="library-empty">
              Сущности не найдены
            </div>

            <template v-else>
              <button
                v-for="item in filteredLibraryItems"
                :key="item.id"
                type="button"
                class="library-item"
                draggable="true"
                @dragstart="onLibraryItemDragStart($event, item)"
              >
                <span class="library-item-node-wrap">
                  <ProfileProgressRing class="library-item-progress" :value="item.progress" :size="40" :stroke-width="3" />
                  <span
                    class="library-item-node"
                    :style="{ background: item.color, borderColor: item.color }"
                  >
                    <img v-if="item.image && !item.hasLogo" class="library-item-image" :src="item.image" alt="" />
                    <img v-else-if="item.hasLogo" class="library-item-logo" :src="item.image" alt="" />
                    <span v-else-if="item.emoji" class="library-item-emoji">{{ item.emoji }}</span>
                    <AppIcon v-else :name="item.type" class="library-item-icon" />
                  </span>
                </span>
                <span class="library-item-name">{{ item.name }}</span>
              </button>
            </template>
          </div>
        </div>
      </aside>

      <div class="canvas-grid" :style="gridStyle" />
      <EdgeLayerCanvas
        :nodes="nodes"
        :edges="edges"
        :camera="camera"
        :active-edge-id="edgeMenu?.edgeId || null"
      />

      <div class="canvas-world" :style="worldStyle">
        <CanvasNode
          v-for="node in nodes"
          :key="node.id"
          :node="node"
          :active="contextMenu?.nodeId === node.id"
          :selected="isNodeSelected(node.id)"
          :dragging="
            draggingNode?.nodeId === node.id ||
            Boolean(draggingGroup?.nodeIds.includes(node.id))
          "
          :is-name-editing="nameEditingNodeId === node.id"
          :preview-type="contextMenu?.nodeId === node.id ? contextMenuHoverType : null"
          @start-drag="onNodeDragStart"
          @open-menu="onNodeOpenMenu"
          @open-portal="onNodeOpenPortal"
          @name-commit="onNodeNameCommit"
          @name-edit-finished="onNodeNameEditFinished"
        />
      </div>

      <div
        v-if="selectionRectStyle"
        class="canvas-selection-rect"
        :style="selectionRectStyle"
      />

      <div
        v-if="nodeMenuHintPosition && activeNodeOnboardingStep"
        class="node-menu-hint"
        :class="`hint-place-${nodeMenuHintPosition.placement}`"
        :style="{ left: `${nodeMenuHintPosition.x}px`, top: `${nodeMenuHintPosition.y}px` }"
        @pointerdown.stop
        @click.stop
      >
        <div class="node-menu-hint-header">
          <span class="node-menu-hint-counter">
            Подсказка {{ activeNodeOnboardingStepIndex }} / {{ NODE_ONBOARDING_STEPS.length }}
          </span>
          <button type="button" class="node-menu-hint-skip" @click="skipNodeOnboarding">
            Пропустить
          </button>
        </div>
        <div class="node-menu-hint-text">{{ activeNodeOnboardingStep.description }}</div>
      </div>

      <div
        v-if="nodeSearchOpen"
        class="canvas-node-search-overlay"
        @pointerdown.self.stop="closeNodeSearch"
      >
        <div class="canvas-node-search" @pointerdown.stop @click.stop>
          <label class="canvas-node-search-input-wrap">
            <AppIcon name="search" />
            <input
              ref="nodeSearchInputRef"
              v-model.trim="nodeSearchQuery"
              type="search"
              class="canvas-node-search-input"
              placeholder="Поиск по нодам проекта"
              autocomplete="off"
            />
            <button
              type="button"
              class="canvas-node-search-close"
              @click="closeNodeSearch"
            >
              Esc
            </button>
          </label>

          <div v-if="nodeSearchQuery.trim().length" class="canvas-node-search-results">
            <div v-if="!nodeSearchResults.length" class="canvas-node-search-empty">
              Ничего не найдено
            </div>

            <button
              v-for="item in nodeSearchResults"
              :key="item.nodeId"
              type="button"
              class="canvas-node-search-item"
              @click="focusNodeBySearch(item.nodeId)"
            >
              <span
                class="canvas-node-search-item-node"
                :style="{ background: item.color, borderColor: item.color }"
              >
                <img
                  v-if="item.image && !item.hasLogo"
                  class="canvas-node-search-item-image"
                  :src="item.image"
                  alt=""
                />
                <img
                  v-else-if="item.hasLogo"
                  class="canvas-node-search-item-logo"
                  :src="item.logoImage"
                  alt=""
                />
                <span v-else-if="item.emoji" class="canvas-node-search-item-emoji">{{ item.emoji }}</span>
                <AppIcon v-else class="canvas-node-search-item-icon" :name="item.type" />
              </span>
              <span class="canvas-node-search-item-text">
                <span class="canvas-node-search-item-name">{{ item.name }}</span>
              <span class="canvas-node-search-item-type">{{ ENTITY_TYPE_LABELS[item.type] }}</span>
              </span>
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="contextMenu"
        class="menu-backdrop"
        :style="menuBackdropStyle"
        @pointerdown="closeContextMenu"
      />

      <div class="canvas-controls" @pointerdown.stop @wheel.stop>
        <div class="canvas-control-menu-wrap">
          <button
            type="button"
            class="canvas-control-btn canvas-icon-btn"
            aria-label="Фон холста"
            title="Фон холста"
            @click="toggleBackgroundMenu"
          >
            <svg class="canvas-control-icon" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3.5" y="4.5" width="17" height="13" rx="2.5" />
              <path d="M7 14.5 10.5 11l2.5 2.5 3.5-3.5 3 3" />
              <circle cx="8.5" cy="8.5" r="1.25" />
            </svg>
          </button>
          <div v-if="isBackgroundMenuOpen" class="canvas-control-dropdown">
            <button
              v-for="preset in CANVAS_BACKGROUND_PRESETS"
              :key="preset.id"
              type="button"
              class="canvas-control-dropdown-btn"
              :class="{ active: canvasBackgroundId === preset.id }"
              @click="onBackgroundChange(preset.id)"
            >
              <span
                class="canvas-bg-dot"
                :style="{ background: preset.appBackground, borderColor: preset.gridColor }"
              />
              {{ preset.label }}
            </button>
          </div>
        </div>

        <div class="canvas-control-menu-wrap">
          <button
            type="button"
            class="canvas-control-btn canvas-icon-btn"
            :disabled="selectedNodes.length < 2"
            aria-label="Выравнивание"
            title="Выравнивание"
            @click="toggleAlignMenu"
          >
            <svg class="canvas-control-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16" />
              <rect x="6" y="8" width="4" height="3" rx="0.8" />
              <rect x="14" y="8" width="4" height="3" rx="0.8" />
              <path d="M4 18h16" />
              <rect x="9" y="13" width="6" height="3" rx="0.8" />
            </svg>
          </button>
          <div v-if="isAlignMenuOpen" class="canvas-control-dropdown">
            <div class="canvas-align-grid">
              <button
                type="button"
                class="canvas-control-dropdown-btn compact"
                title="Выровнять по левому краю"
                aria-label="Выровнять по левому краю"
                @click="onAlignSelected('left')"
              >
                <svg class="canvas-align-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 5v14" />
                  <rect x="8" y="7" width="10" height="3" rx="0.8" />
                  <rect x="8" y="13" width="7" height="3" rx="0.8" />
                </svg>
              </button>
              <button
                type="button"
                class="canvas-control-dropdown-btn compact"
                title="Выровнять по центру по горизонтали"
                aria-label="Выровнять по центру по горизонтали"
                @click="onAlignSelected('center')"
              >
                <svg class="canvas-align-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14" />
                  <rect x="6" y="7" width="12" height="3" rx="0.8" />
                  <rect x="8" y="13" width="8" height="3" rx="0.8" />
                </svg>
              </button>
              <button
                type="button"
                class="canvas-control-dropdown-btn compact"
                title="Выровнять по правому краю"
                aria-label="Выровнять по правому краю"
                @click="onAlignSelected('right')"
              >
                <svg class="canvas-align-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 5v14" />
                  <rect x="8" y="7" width="10" height="3" rx="0.8" />
                  <rect x="11" y="13" width="7" height="3" rx="0.8" />
                </svg>
              </button>
              <button
                type="button"
                class="canvas-control-dropdown-btn compact"
                title="Выровнять по верхнему краю"
                aria-label="Выровнять по верхнему краю"
                @click="onAlignSelected('top')"
              >
                <svg class="canvas-align-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 6h14" />
                  <rect x="7" y="8" width="3" height="10" rx="0.8" />
                  <rect x="13" y="8" width="3" height="7" rx="0.8" />
                </svg>
              </button>
              <button
                type="button"
                class="canvas-control-dropdown-btn compact"
                title="Выровнять по центру по вертикали"
                aria-label="Выровнять по центру по вертикали"
                @click="onAlignSelected('middle')"
              >
                <svg class="canvas-align-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12h14" />
                  <rect x="7" y="6" width="3" height="12" rx="0.8" />
                  <rect x="13" y="8" width="3" height="8" rx="0.8" />
                </svg>
              </button>
              <button
                type="button"
                class="canvas-control-dropdown-btn compact"
                title="Выровнять по нижнему краю"
                aria-label="Выровнять по нижнему краю"
                @click="onAlignSelected('bottom')"
              >
                <svg class="canvas-align-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 18h14" />
                  <rect x="7" y="8" width="3" height="10" rx="0.8" />
                  <rect x="13" y="11" width="3" height="7" rx="0.8" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div class="canvas-control-menu-wrap">
          <button
            type="button"
            class="canvas-control-btn canvas-icon-btn"
            :disabled="selectedNodes.length < 2"
            aria-label="Траектория объектов"
            title="Траектория объектов"
            @click="toggleArrangeMenu"
          >
            <svg class="canvas-control-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="6.5" cy="6.5" r="2.2" />
              <circle cx="17.5" cy="6.5" r="2.2" />
              <circle cx="6.5" cy="17.5" r="2.2" />
              <circle cx="17.5" cy="17.5" r="2.2" />
              <path d="M8.7 6.5h6.6" />
              <path d="M6.5 8.7v6.6" />
              <path d="M8.7 17.5h6.6" />
              <path d="M17.5 8.7v6.6" />
            </svg>
          </button>
          <div v-if="isArrangeMenuOpen" class="canvas-control-dropdown">
            <button type="button" class="canvas-control-dropdown-btn" @click="onArrangeSelected('line')">Линия</button>
            <button type="button" class="canvas-control-dropdown-btn" @click="onArrangeSelected('circle')">Круг</button>
            <button type="button" class="canvas-control-dropdown-btn" @click="onArrangeSelected('square')">Квадрат</button>
            <button type="button" class="canvas-control-dropdown-btn" @click="onArrangeSelected('rectangle')">Прямоугольник</button>
          </div>
        </div>

        <button
          type="button"
          class="canvas-control-btn canvas-reset-btn canvas-icon-btn"
          aria-label="Очистить холст"
          title="Очистить холст"
          @click="openResetCanvasConfirm"
        >
          <svg class="canvas-control-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 12a8 8 0 1 0 2.7-5.9" />
            <path d="M4 5v4h4" />
          </svg>
        </button>

        <span class="canvas-controls-divider" />

        <button
          type="button"
          class="canvas-control-btn zoom-btn"
          :disabled="camera.zoom <= MIN_ZOOM"
          aria-label="Уменьшить масштаб"
          @click="onZoomOutClick"
        >
          -
        </button>
        <button
          type="button"
          class="canvas-control-btn zoom-value"
          aria-label="Сбросить масштаб"
          @click="onZoomResetClick"
        >
          {{ zoomPercent }}%
        </button>
        <button
          type="button"
          class="canvas-control-btn zoom-btn"
          :disabled="camera.zoom >= MAX_ZOOM"
          aria-label="Увеличить масштаб"
          @click="onZoomInClick"
        >
          +
        </button>
      </div>
    </div>

    <div
      v-if="isResetCanvasConfirmOpen"
      class="canvas-reset-overlay"
      @pointerdown.self="closeResetCanvasConfirm"
    >
      <div class="canvas-reset-card" @pointerdown.stop>
        <h3 class="canvas-reset-title">Очистить холст?</h3>
        <p class="canvas-reset-text">
          Все элементы холста будут очищены.
        </p>
        <p class="canvas-reset-text">
          Действие необратимо.
        </p>
        <div class="canvas-reset-actions">
          <button type="button" class="canvas-reset-cancel" @click="closeResetCanvasConfirm">
            Отмена
          </button>
          <button type="button" class="canvas-reset-confirm" @click="onConfirmResetCanvas">
            Очистить
          </button>
        </div>
      </div>
    </div>

    <CanvasContextMenu
      v-if="contextMenu && activeMenuNode && contextMenuPosition"
      :x="contextMenuPosition.x"
      :y="contextMenuPosition.y"
      :zoom="camera.zoom"
      :current-type="activeMenuEntityType"
      :locked="activeMenuLocked"
      :category-locked="activeMenuCategoryLocked"
      :current-color="activeMenuColor"
      :has-image="activeMenuHasImage"
      :has-emoji="activeMenuHasEmoji"
      :has-logo="activeMenuHasLogo"
      :current-scale-percent="activeMenuScalePercent"
      :search-items="menuSearchItems"
      @type-change="onMenuTypeChange"
      @hover-type="onMenuHoverType"
      @reset-node="onMenuResetNode"
      @delete-node="onMenuDeleteNode"
      @color-change="onMenuColorChange"
      @image-change="onMenuImageChange"
      @emoji-change="onMenuEmojiChange"
      @logo-change="onMenuLogoChange"
      @scale-change="onMenuScaleChange"
      @select-entity="onMenuSelectEntity"
      @open-entity-info="onMenuOpenEntityInfo"
      @toggle-lock="onMenuToggleLock"
    />

    <ConnectionContextMenu
      v-if="edgeMenu && activeEdge && edgeMenuPosition"
      :x="edgeMenuPosition.x"
      :y="edgeMenuPosition.y"
      :zoom="camera.zoom"
      :label="activeEdge.label || ''"
      :options="connectionRelationOptions"
      :color="activeEdge.color || EDGE_DEFAULT_COLOR"
      :arrow-left="Boolean(activeEdge.arrowLeft)"
      :arrow-right="Boolean(activeEdge.arrowRight)"
      @close="closeEdgeMenu"
      @toggle-arrow-left="onEdgeToggleArrowLeft"
      @toggle-arrow-right="onEdgeToggleArrowRight"
      @add-node="onEdgeAddNode"
      @delete-edge="onEdgeDelete"
      @color-change="onEdgeColorChange"
      @label-change="onEdgeLabelChange"
      @create-option="onEdgeCreateRelationOption"
    />

    <div
      v-if="entityInfoModal"
      class="entity-info-overlay"
      @pointerdown.self="closeEntityInfoModal"
    >
      <div class="entity-info-modal" @pointerdown.stop>
        <header class="entity-info-header">
          <div v-if="entityInfoModalIcon" class="entity-info-progress-avatar">
            <svg
              class="entity-info-progress-ring"
              :width="PROFILE_PROGRESS_RING_SIZE"
              :height="PROFILE_PROGRESS_RING_SIZE"
              :viewBox="`0 0 ${PROFILE_PROGRESS_RING_SIZE} ${PROFILE_PROGRESS_RING_SIZE}`"
            >
              <circle
                class="entity-info-progress-track"
                :cx="PROFILE_PROGRESS_RING_SIZE / 2"
                :cy="PROFILE_PROGRESS_RING_SIZE / 2"
                :r="PROFILE_PROGRESS_RADIUS"
                :stroke-width="PROFILE_PROGRESS_STROKE_WIDTH"
              />
              <circle
                class="entity-info-progress-value"
                :cx="PROFILE_PROGRESS_RING_SIZE / 2"
                :cy="PROFILE_PROGRESS_RING_SIZE / 2"
                :r="PROFILE_PROGRESS_RADIUS"
                :stroke-width="PROFILE_PROGRESS_STROKE_WIDTH"
                :stroke-dasharray="PROFILE_PROGRESS_CIRCUMFERENCE"
                :stroke-dashoffset="entityInfoProfileProgressDashoffset"
                :transform="`rotate(-90 ${PROFILE_PROGRESS_RING_SIZE / 2} ${PROFILE_PROGRESS_RING_SIZE / 2})`"
              />
            </svg>

            <span
              class="entity-info-icon"
              :style="{ background: entityInfoModalIcon.color, borderColor: entityInfoModalIcon.color }"
            >
              <img
                v-if="entityInfoModalIcon.image && !entityInfoModalIcon.hasLogo"
                class="entity-info-icon-image"
                :src="entityInfoModalIcon.image"
                alt=""
              />
              <img
                v-else-if="entityInfoModalIcon.hasLogo"
                class="entity-info-icon-logo"
                :src="entityInfoModalIcon.image"
                alt=""
              />
              <span
                v-else-if="entityInfoModalIcon.emoji"
                class="entity-info-icon-emoji"
              >
                {{ entityInfoModalIcon.emoji }}
              </span>
              <AppIcon
                v-else
                :name="entityInfoModalIcon.type"
                class="entity-info-icon-symbol"
              />
            </span>
          </div>

          <div class="entity-info-title">
            <input
              v-model="entityInfoModal.name"
              type="text"
              maxlength="64"
              class="entity-info-name-input"
              @input="onInfoNameInput"
            />
            <div class="entity-info-progress-meta">
              <span class="entity-info-progress-level">{{ entityInfoProfileProgressLevel }}</span>
              <span class="entity-info-progress-percent">{{ entityInfoProfileProgress }}%</span>
            </div>
          </div>
        </header>

        <div class="entity-info-fixed">
          <section class="entity-info-section">
            <textarea
              id="entity-description"
              v-model="entityInfoModal.description"
              class="entity-info-textarea entity-info-description"
              rows="2"
              placeholder="Описание"
              @input="onInfoDescriptionInput"
            />

            <div class="entity-info-fields-list">
              <div
                v-for="field in entityInfoActiveFields"
                :key="field.key"
                class="entity-info-field-row"
              >
                <div class="entity-info-field-scroll">
                  <input
                    :value="getModalFieldDraft(field.key)"
                    type="text"
                    class="entity-info-tag-input"
                    maxlength="32"
                    :placeholder="field.label"
                    @input="onModalFieldDraftInput(field.key, $event)"
                    @keydown.enter.prevent="addModalFieldValue(field.key)"
                  />
                  <button
                    v-for="value in getModalFieldValues(field.key)"
                    :key="`${field.key}:${value}`"
                    type="button"
                    class="entity-info-tag"
                    @click="removeModalFieldValue(field.key, value)"
                  >
                    {{ value }}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>

        <section ref="entityInfoChatFeedRef" class="entity-info-chat-feed">
          <article
            v-for="message in entityInfoModal.chatHistory"
            :key="message.id"
            class="entity-chat-message"
            :class="{ user: message.role === 'user', assistant: message.role === 'assistant' }"
          >
            <div class="entity-chat-bubble">
              <p class="entity-chat-text">{{ message.text }}</p>
              <div v-if="message.attachments.length" class="entity-chat-attachments">
                <button
                  v-for="attachment in message.attachments"
                  :key="attachment.id"
                  type="button"
                  class="entity-chat-attachment-chip"
                  @click="openEntityInfoAttachment(attachment)"
                >
                  {{ attachment.name }}
                </button>
              </div>
            </div>
            <time class="entity-chat-time">{{ toDisplayTime(message.createdAt) }}</time>
          </article>
          <article v-if="isEntityInfoAiRequestInFlight" class="entity-chat-message assistant">
            <div class="entity-chat-bubble thinking">
              <span class="entity-chat-thinking-text">Думаю...</span>
            </div>
          </article>
        </section>

        <section class="entity-info-chat-composer">
          <div v-if="entityInfoModal.pendingUploads.length" class="entity-info-pending-uploads">
            <span
              v-for="attachment in entityInfoModal.pendingUploads"
              :key="attachment.id"
              class="entity-info-upload-chip"
            >
              {{ attachment.name }}
              <button
                type="button"
                class="entity-info-upload-chip-remove"
                @click="removePendingUpload(attachment.id)"
              >
                ×
              </button>
            </span>
          </div>

          <div class="entity-info-chat-bar">
            <textarea
              ref="entityInfoChatInputRef"
              v-model="entityInfoModal.textInput"
              class="entity-info-chat-input"
              :placeholder="entityInfoChatPlaceholder"
              :disabled="isEntityInfoAiRequestInFlight"
              rows="1"
              @input="onInfoTextInput"
              @keydown="onChatComposerKeydown"
            />
          </div>

          <div class="entity-info-chat-tools">
            <div class="entity-info-chat-tools-left">
            <button
              type="button"
              class="entity-info-chat-icon-btn"
              title="Загрузка документа"
              :disabled="isEntityInfoAiRequestInFlight"
              @click="entityInfoDocInputRef?.click()"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M21 11.5V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8.5" />
                <path d="M15 3h6v6" />
                <path d="M10 14 21 3" />
              </svg>
            </button>
            <input
              ref="entityInfoDocInputRef"
              type="file"
              class="entity-info-hidden-input"
              multiple
              @change="onInfoDocumentsChange"
            />

            <button
              type="button"
              class="entity-info-chat-icon-btn"
              :class="{ active: isVoiceListening }"
              title="Голосовой ввод"
              :disabled="isEntityInfoAiRequestInFlight"
              @click="onVoiceToggle"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <path d="M12 18v3" />
                <path d="M8 21h8" />
              </svg>
            </button>
            </div>

            <button
              type="button"
              class="entity-info-chat-icon-btn send"
              title="Ввод"
              :disabled="isEntityInfoAiRequestInFlight"
              @click="onInfoSendInput"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 11.5 21 3l-7.5 18-2.6-7.1L3 11.5Z" />
              </svg>
            </button>
          </div>
        </section>

      </div>
    </div>
  </section>
</template>

<style scoped>
.canvas-page {
  height: 100%;
  min-height: 0;
  position: relative;
}

.canvas-state {
  margin: 18px 24px;
  border-radius: 12px;
  border: 1px dashed var(--border-color);
  background: #fff;
  color: var(--text-muted);
  padding: 16px;
}

.state-error {
  color: #dc2626;
}

.canvas-viewport {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--canvas-bg-color, var(--bg-app));
  touch-action: none;
  cursor: default;
}

.canvas-viewport.is-panning {
  cursor: grabbing;
}

.canvas-viewport.is-drop-ready::after {
  content: '';
  position: absolute;
  inset: 0;
  border: 2px dashed rgba(16, 88, 255, 0.28);
  background: rgba(16, 88, 255, 0.04);
  pointer-events: none;
  z-index: 20;
}

.canvas-library {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 40;
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.library-rail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border-radius: 18px;
  border: 1px solid rgba(226, 232, 240, 0.85);
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(8px);
  box-shadow: 0 10px 24px rgba(112, 144, 176, 0.16);
}

.library-rail-btn {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  border: 1px solid transparent;
  background: #ffffff;
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  cursor: pointer;
  transition:
    color 0.16s ease,
    border-color 0.16s ease,
    background-color 0.16s ease,
    box-shadow 0.16s ease;
}

.library-rail-btn :deep(svg) {
  width: 18px;
  height: 18px;
}

.library-rail-btn:hover,
.library-rail-btn.active {
  color: #1058ff;
  border-color: #cfe0ff;
  background: #eef4ff;
  box-shadow: 0 4px 12px rgba(16, 88, 255, 0.14);
}

.library-rail-label {
  position: absolute;
  left: 48px;
  top: 50%;
  transform: translateY(-50%);
  white-space: nowrap;
  border-radius: 999px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  color: #334155;
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 600;
  box-shadow: 0 6px 16px rgba(112, 144, 176, 0.18);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.14s ease;
}

.library-rail-label.visible {
  opacity: 1;
}

.library-panel {
  width: 300px;
  max-height: min(70vh, 620px);
  border-radius: 16px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(10px);
  box-shadow: 0 16px 36px rgba(112, 144, 176, 0.2);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
}

.library-search-row {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid #dbe4f3;
  border-radius: 999px;
  background: #ffffff;
  color: #64748b;
  padding: 8px 12px;
}

.library-search-row :deep(svg) {
  width: 15px;
  height: 15px;
}

.library-search-input {
  border: none;
  outline: none;
  background: transparent;
  width: 100%;
  color: #334155;
  font-size: 13px;
  font-weight: 500;
}

.library-search-input::placeholder {
  color: #94a3b8;
}

.library-list {
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 2px;
}

.library-empty {
  color: var(--text-muted);
  font-size: 13px;
  text-align: center;
  padding: 16px 6px;
}

.library-item {
  width: 100%;
  border: 1px solid transparent;
  border-radius: 12px;
  background: #ffffff;
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  padding: 8px 10px;
  color: #334155;
  cursor: grab;
  box-shadow: 0 3px 10px rgba(112, 144, 176, 0.11);
  transition:
    border-color 0.16s ease,
    transform 0.16s ease,
    box-shadow 0.16s ease;
}

.library-item:hover {
  border-color: #cfe0ff;
  transform: translateY(-1px);
  box-shadow: 0 8px 18px rgba(112, 144, 176, 0.17);
}

.library-item:active {
  cursor: grabbing;
}

.library-item-node-wrap {
  width: 40px;
  height: 40px;
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.library-item-progress {
  position: absolute;
  inset: 0;
}

.library-item-node {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 1px solid #1058ff;
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
  z-index: 1;
}

.library-item-icon {
  width: 62%;
  height: 62%;
}

.library-item-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.library-item-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.library-item-logo {
  width: 62%;
  height: 62%;
  object-fit: contain;
}

.library-item-emoji {
  font-size: 21px;
  line-height: 1;
}

.library-item-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 700;
}

.canvas-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(var(--canvas-grid-color, rgba(112, 144, 176, 0.08)) 1px, transparent 1px),
    linear-gradient(90deg, var(--canvas-grid-color, rgba(112, 144, 176, 0.08)) 1px, transparent 1px);
}

.canvas-world {
  position: absolute;
  inset: 0;
  z-index: 25;
  transform-origin: 0 0;
  will-change: transform;
}

.canvas-selection-rect {
  position: absolute;
  z-index: 42;
  border: 1px solid rgba(16, 88, 255, 0.86);
  background: rgba(16, 88, 255, 0.14);
  border-radius: 6px;
  pointer-events: none;
}

.node-menu-hint {
  position: absolute;
  transform: translate(-50%, -100%);
  z-index: 145;
  border: 1px solid #dbe4f3;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.96);
  color: #334155;
  box-shadow: 0 10px 24px rgba(112, 144, 176, 0.2);
  padding: 10px 12px;
  width: 280px;
  max-width: min(280px, calc(100vw - 28px));
  line-height: 1.3;
  pointer-events: auto;
  animation: nodeMenuHintIn 0.2s ease-out;
}

.node-menu-hint.hint-place-bottom {
  transform: translate(-50%, 0);
}

.node-menu-hint.hint-place-left {
  transform: translate(-100%, -50%);
}

.node-menu-hint.hint-place-right {
  transform: translate(0, -50%);
}

.node-menu-hint::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 100%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 6px solid rgba(255, 255, 255, 0.96);
}

.node-menu-hint.hint-place-bottom::after {
  top: auto;
  bottom: 100%;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: none;
  border-bottom: 6px solid rgba(255, 255, 255, 0.96);
}

.node-menu-hint.hint-place-left::after {
  left: 100%;
  top: 50%;
  transform: translateY(-50%);
  border-top: 6px solid transparent;
  border-bottom: 6px solid transparent;
  border-left: 6px solid rgba(255, 255, 255, 0.96);
  border-right: none;
}

.node-menu-hint.hint-place-right::after {
  left: auto;
  right: 100%;
  top: 50%;
  transform: translateY(-50%);
  border-top: 6px solid transparent;
  border-bottom: 6px solid transparent;
  border-right: 6px solid rgba(255, 255, 255, 0.96);
  border-left: none;
}

.node-menu-hint-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}

.node-menu-hint-counter {
  font-size: 11px;
  font-weight: 700;
  color: #64748b;
}

.node-menu-hint-skip {
  border: 1px solid #dbe4f3;
  border-radius: 8px;
  background: #ffffff;
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  padding: 5px 8px;
  cursor: pointer;
}

.node-menu-hint-skip:hover {
  border-color: #c7d8f9;
  color: #334155;
}

.node-menu-hint-title {
  font-size: 13px;
  font-weight: 800;
  color: #1e293b;
  margin-bottom: 4px;
}

.node-menu-hint-text {
  font-size: 12px;
  font-weight: 600;
  color: #475569;
}

@keyframes nodeMenuHintIn {
  from {
    opacity: 0;
    transform: translate(-50%, -92%);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -100%);
  }
}

.canvas-node-search-overlay {
  position: absolute;
  inset: 0;
  z-index: 146;
  pointer-events: auto;
}

.canvas-node-search {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  width: min(340px, calc(100% - 24px));
  border-radius: 12px;
  border: 1px solid #dbe4f3;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 10px 18px rgba(112, 144, 176, 0.18);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  pointer-events: auto;
}

.canvas-node-search-input-wrap {
  height: 34px;
  border-radius: 9px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 10px;
  color: #64748b;
}

.canvas-node-search-input-wrap:focus-within {
  border-color: #bfd5ff;
  box-shadow: 0 0 0 2px rgba(16, 88, 255, 0.12);
}

.canvas-node-search-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  background: transparent;
  color: #334155;
  font-size: 13px;
  font-weight: 600;
  outline: none;
}

.canvas-node-search-close {
  height: 22px;
  min-width: 30px;
  border-radius: 7px;
  border: 1px solid #dbe4f3;
  background: #f8fafc;
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.canvas-node-search-close:hover {
  border-color: #bfd5ff;
  background: #eef4ff;
  color: #1058ff;
}

.canvas-node-search-results {
  max-height: min(210px, 36vh);
  overflow-y: auto;
  padding-right: 2px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.canvas-node-search-item {
  width: 100%;
  min-height: 36px;
  border-radius: 9px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 7px;
  text-align: left;
  cursor: pointer;
}

.canvas-node-search-item:hover {
  border-color: #bfd5ff;
  background: #eef4ff;
}

.canvas-node-search-item-node {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1px solid #1058ff;
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}

.canvas-node-search-item-icon {
  width: 62%;
  height: 62%;
}

.canvas-node-search-item-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.canvas-node-search-item-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.canvas-node-search-item-logo {
  width: 62%;
  height: 62%;
  object-fit: contain;
}

.canvas-node-search-item-emoji {
  font-size: 15px;
  line-height: 1;
}

.canvas-node-search-item-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.canvas-node-search-item-name {
  font-size: 12px;
  font-weight: 700;
  color: #334155;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.canvas-node-search-item-type {
  font-size: 10px;
  font-weight: 700;
  color: #64748b;
}

.canvas-node-search-empty {
  min-height: 32px;
  border-radius: 9px;
  border: 1px dashed #dbe4f3;
  background: #f8fafc;
  color: #64748b;
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 10px;
}

.canvas-controls {
  position: absolute;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  z-index: 45;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border-radius: 999px;
  border: 1px solid rgba(226, 232, 240, 0.92);
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(10px);
  padding: 7px;
  box-shadow: 0 10px 22px rgba(112, 144, 176, 0.22);
  max-width: calc(100% - 28px);
}

.canvas-control-btn {
  height: 36px;
  min-width: 36px;
  border-radius: 11px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  color: #475569;
  font-size: 14px;
  font-weight: 600;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    color 0.16s ease,
    border-color 0.16s ease,
    background-color 0.16s ease;
}

.canvas-control-btn:hover:not(:disabled) {
  color: #1058ff;
  border-color: #bfd5ff;
  background: #eef4ff;
}

.canvas-control-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.canvas-control-btn.zoom-btn {
  width: 36px;
  min-width: 36px;
  padding: 0;
  font-size: 20px;
  line-height: 1;
}

.canvas-control-btn.zoom-value {
  min-width: 74px;
  font-size: 13px;
  font-weight: 700;
}

.canvas-controls-divider {
  width: 1px;
  height: 20px;
  background: #e2e8f0;
}

.canvas-icon-btn {
  width: 36px;
  min-width: 36px;
  padding: 0;
}

.canvas-control-icon {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.canvas-control-btn.active {
  color: #1058ff;
  border-color: #bfd5ff;
  background: #eef4ff;
}

.canvas-reset-btn {
  border-color: #fecaca;
  background: #fff1f2;
  color: #b91c1c;
}

.canvas-reset-btn:hover:not(:disabled) {
  border-color: #fca5a5;
  background: #ffe4e6;
  color: #991b1b;
}

.canvas-control-menu-wrap {
  position: relative;
}

.canvas-control-dropdown {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  transform: translateX(-50%);
  min-width: 150px;
  border-radius: 12px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  box-shadow: 0 12px 24px rgba(112, 144, 176, 0.18);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 58;
}

.canvas-control-dropdown-btn {
  width: 100%;
  height: 30px;
  border-radius: 9px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  color: #334155;
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  padding: 0 9px;
  cursor: pointer;
  transition:
    color 0.16s ease,
    border-color 0.16s ease,
    background-color 0.16s ease;
}

.canvas-control-dropdown-btn:hover,
.canvas-control-dropdown-btn.active {
  color: #1058ff;
  border-color: #bfd5ff;
  background: #eef4ff;
}

.canvas-control-dropdown-btn.compact {
  justify-content: center;
  padding: 0;
}

.canvas-align-icon {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.canvas-align-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.canvas-bg-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid #dbe4f3;
  flex-shrink: 0;
}

.canvas-reset-overlay {
  position: fixed;
  inset: 0;
  z-index: 182;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.36);
  padding: 20px;
}

.canvas-reset-card {
  width: min(360px, 100%);
  border-radius: 14px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  box-shadow: 0 20px 36px rgba(15, 23, 42, 0.28);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.canvas-reset-title {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  color: #0f172a;
}

.canvas-reset-text {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  color: #475569;
}

.canvas-reset-actions {
  margin-top: 4px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.canvas-reset-cancel,
.canvas-reset-confirm {
  height: 32px;
  border-radius: 10px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.canvas-reset-cancel {
  border: 1px solid #dbe4f3;
  background: #f8fafc;
  color: #334155;
}

.canvas-reset-cancel:hover {
  border-color: #bfd5ff;
  background: #eef4ff;
  color: #1058ff;
}

.canvas-reset-confirm {
  border: 1px solid #fecaca;
  background: #fff1f2;
  color: #b91c1c;
}

.canvas-reset-confirm:hover {
  border-color: #fca5a5;
  background: #ffe4e6;
}

.menu-backdrop {
  position: absolute;
  inset: 0;
  z-index: 130;
  background: radial-gradient(
    circle 58px at var(--focus-x, 50%) var(--focus-y, 50%),
    rgba(241, 245, 249, 0) 0 52px,
    rgba(241, 245, 249, 0.95) 88px
  );
  animation: menuBackdropIn 0.14s ease-out;
}

@keyframes menuBackdropIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.entity-info-overlay {
  position: fixed;
  inset: 0;
  z-index: 180;
  display: flex;
  justify-content: center;
  align-items: center;
  background: rgba(15, 23, 42, 0.34);
  padding: 24px;
}

.entity-info-modal {
  width: min(560px, 96vw);
  height: min(90vh, 980px);
  max-height: 94vh;
  overflow: hidden;
  border-radius: 18px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  box-shadow: 0 28px 52px rgba(15, 23, 42, 0.3);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.entity-info-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.entity-info-progress-avatar {
  position: relative;
  width: 72px;
  height: 72px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.entity-info-progress-ring {
  position: absolute;
  inset: 0;
}

.entity-info-progress-track {
  fill: none;
  stroke: #dbe4f3;
}

.entity-info-progress-value {
  fill: none;
  stroke: #1058ff;
  stroke-linecap: round;
  transition: stroke-dashoffset 240ms ease-in-out;
}

.entity-info-icon {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 1px solid #1058ff;
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
  position: relative;
  z-index: 1;
}

.entity-info-icon-symbol {
  width: 56%;
  height: 56%;
}

.entity-info-icon-symbol :deep(svg) {
  width: 100%;
  height: 100%;
}

.entity-info-icon-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.entity-info-icon-logo {
  width: 56%;
  height: 56%;
  object-fit: contain;
}

.entity-info-icon-emoji {
  font-size: 31px;
  line-height: 1;
}

.entity-info-title {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.entity-info-name-input {
  width: 100%;
  border: 1px solid #dbe4f3;
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
  outline: none;
}

.entity-info-name-input:focus {
  border-color: #bfdbfe;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.14);
}

.entity-info-progress-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 16px;
}

.entity-info-progress-level {
  color: #64748b;
  font-size: 11px;
  font-weight: 600;
}

.entity-info-progress-percent {
  color: #1058ff;
  font-size: 12px;
  font-weight: 700;
}

.entity-info-fixed {
  flex-shrink: 0;
}

.entity-info-section {
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  background: #f8fafc;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.entity-info-textarea {
  width: 100%;
  border: 1px solid #dbe4f3;
  border-radius: 10px;
  background: #ffffff;
  color: #0f172a;
  font-size: 13px;
  line-height: 1.4;
  outline: none;
  padding: 9px 10px;
  resize: vertical;
}

.entity-info-textarea:focus {
  border-color: #bfdbfe;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.14);
}

.entity-info-description {
  min-height: 48px;
  max-height: 156px;
}

.entity-info-fields-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 170px;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 2px;
}

.entity-info-fields-list::-webkit-scrollbar {
  width: 6px;
}

.entity-info-field-row {
  border: 1px solid #dbe4f3;
  border-radius: 10px;
  background: #ffffff;
}

.entity-info-field-scroll {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 6px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 6px 8px;
}

.entity-info-field-scroll::-webkit-scrollbar {
  height: 6px;
}

.entity-info-tag {
  flex-shrink: 0;
  border: 1px solid #bfd5ff;
  border-radius: 999px;
  background: #eff6ff;
  color: #1e40af;
  font-size: 11px;
  font-weight: 700;
  padding: 5px 9px;
  cursor: pointer;
}

.entity-info-tag-input {
  flex: 0 0 140px;
  min-width: 120px;
  max-width: 200px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #0f172a;
  font-size: 12px;
  font-weight: 600;
  outline: none;
  padding: 6px 8px;
  order: -1;
}

.entity-info-tag-input:focus {
  background: #f8fafc;
}

.entity-info-chat-feed {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  background: #f8fafc;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.entity-chat-message {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 88%;
}

.entity-chat-message.user {
  align-self: flex-end;
  align-items: flex-end;
}

.entity-chat-message.assistant {
  align-self: flex-start;
  align-items: flex-start;
}

.entity-chat-bubble {
  border-radius: 12px;
  padding: 8px 10px;
  background: #ffffff;
  border: 1px solid #dbe4f3;
  box-shadow: 0 4px 12px rgba(112, 144, 176, 0.14);
}

.entity-chat-message.user .entity-chat-bubble {
  background: #1058ff;
  border-color: #1058ff;
  color: #ffffff;
}

.entity-chat-text {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.35;
  font-size: 12px;
}

.entity-chat-time {
  color: #94a3b8;
  font-size: 10px;
  font-weight: 600;
}

.entity-chat-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 6px;
}

.entity-chat-attachment-chip {
  appearance: none;
  border-radius: 999px;
  border: 1px solid rgba(219, 228, 243, 0.9);
  background: rgba(255, 255, 255, 0.9);
  color: #334155;
  font-size: 10px;
  font-weight: 700;
  padding: 3px 8px;
  cursor: pointer;
}

.entity-chat-attachment-chip:hover {
  border-color: #bfd5ff;
  color: #1058ff;
}

.entity-chat-bubble.thinking {
  display: inline-flex;
  align-items: center;
}

.entity-chat-thinking-text {
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1px;
  animation: entityThinkingPulse 1.1s ease-in-out infinite;
}

@keyframes entityThinkingPulse {
  0%,
  100% {
    opacity: 0.45;
  }
  50% {
    opacity: 1;
  }
}

.entity-info-chat-composer {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.entity-info-pending-uploads {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.entity-info-upload-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  border: 1px solid #dbe4f3;
  background: #f8fafc;
  color: #334155;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
}

.entity-info-upload-chip-remove {
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  line-height: 1;
}

.entity-info-chat-bar {
  display: flex;
  align-items: stretch;
  border: 1px solid #dbe4f3;
  border-radius: 12px;
  background: #ffffff;
  padding: 4px 8px;
}

.entity-info-chat-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-top: 1px solid #e8edf7;
  padding-top: 7px;
}

.entity-info-chat-tools-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.entity-info-chat-icon-btn {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  color: #6b7a91;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    color 0.16s ease,
    border-color 0.16s ease,
    background-color 0.16s ease;
}

.entity-info-chat-icon-btn svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.entity-info-chat-icon-btn:hover {
  color: #1058ff;
  border-color: #bfd5ff;
  background: #eef4ff;
}

.entity-info-chat-icon-btn.active,
.entity-info-chat-icon-btn.send {
  color: #ffffff;
  background: #1058ff;
  border-color: #1058ff;
}

.entity-info-chat-icon-btn.send:hover,
.entity-info-chat-icon-btn.active:hover {
  filter: brightness(1.04);
}

.entity-info-chat-icon-btn:disabled,
.entity-info-chat-icon-btn:disabled:hover {
  cursor: wait;
  opacity: 0.6;
  color: #9aa9c2;
  border-color: #dbe4f3;
  background: #f5f8ff;
  filter: none;
}

.entity-info-chat-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: #0f172a;
  font-size: 13px;
  line-height: 1.35;
  padding: 6px 6px;
  resize: none;
  max-height: 176px;
  overflow-y: auto;
}

.entity-info-chat-input::placeholder {
  color: #94a3b8;
}

.entity-info-chat-input:disabled {
  cursor: wait;
}

.entity-info-hidden-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

</style>
