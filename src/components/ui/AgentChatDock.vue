<script setup lang="ts">
import axios from 'axios';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useEntitiesStore } from '../../stores/entities';
import type { Entity, EntityType } from '../../types/entity';
import { apiClient } from '../../services/api';

type ChatRole = 'user' | 'assistant';

interface EntityAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  data: string;
}

interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: string;
  attachments: EntityAttachment[];
}

interface AgentChatRequestScope {
  type: 'collection' | 'project';
  entityType?: EntityType;
  projectId?: string;
}

interface AgentChatResponse {
  reply: string;
  debug?: Record<string, unknown>;
}

interface AgentChatHistoryResponse {
  scopeKey?: string;
  messages?: unknown;
  updatedAt?: string | null;
}

const STORAGE_KEY = 'synapse12.agent-chat.v2';
const PANEL_SIZE_STORAGE_KEY = 'synapse12.agent-chat.panel-size.v1';
const PANEL_TOP_OFFSET_PX = 60;
const AI_ATTACHMENT_MAX_INLINE_BYTES = 2_000_000;
const AI_ATTACHMENT_MAX_INLINE_DATA_URL_LENGTH = 2_800_000;
const AGENT_CHAT_REQUEST_TIMEOUT_MS = 130_000;
const MAX_MESSAGES_PER_SCOPE = 140;
const REMOTE_HISTORY_POLL_INTERVAL_MS = 4500;
const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  project: 'Проекты',
  connection: 'Подключение',
  person: 'Персоны',
  company: 'Компании',
  event: 'События',
  resource: 'Ресурсы',
  goal: 'Цели',
  result: 'Результаты',
  task: 'Задачи',
  shape: 'Элементы',
};
const PROJECT_PROFILE_FIELD_CONFIGS = [
  { key: 'tags', label: 'Теги' },
  { key: 'markers', label: 'Метки' },
  { key: 'roles', label: 'Роли' },
  { key: 'skills', label: 'Навыки' },
  { key: 'risks', label: 'Риски' },
  { key: 'priority', label: 'Приоритеты' },
  { key: 'status', label: 'Статусы' },
  { key: 'tasks', label: 'Задачи' },
  { key: 'metrics', label: 'Метрики' },
  { key: 'owners', label: 'Ответственные' },
  { key: 'participants', label: 'Участники' },
  { key: 'resources', label: 'Ресурсы' },
  { key: 'outcomes', label: 'Результаты' },
  { key: 'industry', label: 'Отрасли' },
  { key: 'departments', label: 'Отделы' },
  { key: 'stage', label: 'Стадии' },
  { key: 'date', label: 'Даты' },
  { key: 'location', label: 'Локации' },
  { key: 'phones', label: 'Телефоны' },
  { key: 'links', label: 'Ссылки' },
  { key: 'importance', label: 'Значимость' },
  { key: 'ignoredNoise', label: 'Шум' },
] as const;
type ProjectProfileFieldKey = (typeof PROJECT_PROFILE_FIELD_CONFIGS)[number]['key'];
const PROJECT_PROFILE_FIELD_KEYS = PROJECT_PROFILE_FIELD_CONFIGS.map((item) => item.key) as ProjectProfileFieldKey[];
const PROJECT_PROFILE_SYNC_DELAY = 420;
const PROJECT_DESCRIPTION_MAX_LENGTH = 3000;
const PROJECT_FIELD_DEFAULT_MAX_LENGTH = 96;
const PROJECT_FIELD_LINK_MAX_LENGTH = 2048;

const route = useRoute();
const entitiesStore = useEntitiesStore();

const isOpen = ref(false);
const messageDraft = ref('');
const pendingUploads = ref<EntityAttachment[]>([]);
const isVoiceListening = ref(false);
const isSending = ref(false);
const isResizingPanel = ref(false);
const isClearHistoryConfirmOpen = ref(false);
const isProjectProfileExpanded = ref(false);
const projectFieldDrafts = ref<Record<ProjectProfileFieldKey, string>>(buildProjectFieldDrafts());
const projectFieldInputRefs = ref<Partial<Record<ProjectProfileFieldKey, HTMLInputElement | null>>>({});
const projectEditingFieldValue = ref<{ fieldKey: ProjectProfileFieldKey; originalValue: string } | null>(null);

const chatFeedRef = ref<HTMLElement | null>(null);
const chatInputRef = ref<HTMLTextAreaElement | null>(null);
const docInputRef = ref<HTMLInputElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const activeVoiceRecognition = ref<{ stop: () => void } | null>(null);
const voiceRestartTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const voiceShouldRestart = ref(false);
const voiceCaptureSessionId = ref(0);
const voiceSessionBaseText = ref('');
const voiceCommittedText = ref('');
const pendingComposerHeightReset = ref(false);
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1366);
const viewportHeight = ref(typeof window !== 'undefined' ? window.innerHeight : 768);
const panelSize = ref<{ width: number; height: number } | null>(loadStoredPanelSize());
const panelSizeBeforeMaximize = ref<{ width: number; height: number } | null>(null);
const isPanelMaximized = ref(false);
const lastTitleTapAt = ref(0);
const touchResizeMoved = ref(false);
const resizePointerId = ref<number | null>(null);
const resizeStart = ref<{
  clientX: number;
  clientY: number;
  width: number;
  height: number;
} | null>(null);
const shouldAutoScrollToBottom = ref(true);
const historyPollingTimer = ref<ReturnType<typeof setInterval> | null>(null);
const activeSyncVersion = ref(0);
const isRemoteHistoryResetting = ref(false);

const messagesByScope = ref<Record<string, ChatMessage[]>>(loadStoredMessages());
const pendingSaveTimersByScope = new Map<string, ReturnType<typeof setTimeout>>();
const saveInFlightScopes = new Set<string>();
const queuedResaveScopes = new Set<string>();
const saveControllersByScope = new Map<string, AbortController>();

function toProfile(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

function createAttachmentId() {
  return `doc-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

function createMessageId() {
  return `chat-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

function getIsoNow() {
  return new Date().toISOString();
}

function buildProjectFieldDrafts() {
  const drafts = {} as Record<ProjectProfileFieldKey, string>;
  for (const fieldKey of PROJECT_PROFILE_FIELD_KEYS) {
    drafts[fieldKey] = '';
  }
  return drafts;
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

function normalizeProjectImportanceValue(rawValue: unknown) {
  const normalized = typeof rawValue === 'string' ? rawValue.trim().toLowerCase() : '';
  if (!normalized) return '';
  if (normalized === 'низкая' || normalized === 'low' || normalized === 'l') return 'Низкая';
  if (normalized === 'средняя' || normalized === 'medium' || normalized === 'med' || normalized === 'm') return 'Средняя';
  if (normalized === 'высокая' || normalized === 'high' || normalized === 'h' || normalized === 'critical' || normalized === 'критично') {
    return 'Высокая';
  }
  return '';
}

function normalizeProjectLinkValue(rawValue: unknown) {
  const raw = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    if (!url.hostname || !url.protocol.startsWith('http')) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function normalizeProjectProfileFieldValues(fieldKey: ProjectProfileFieldKey, rawValue: unknown) {
  const source = Array.isArray(rawValue) ? rawValue : [rawValue];
  const dedup = new Set<string>();
  const values: string[] = [];
  const maxItems = fieldKey === 'importance' ? 1 : fieldKey === 'links' ? 24 : 40;
  const maxLength = fieldKey === 'links' ? 240 : fieldKey === 'tasks' ? 120 : PROJECT_FIELD_DEFAULT_MAX_LENGTH;

  for (const item of source) {
    const value =
      fieldKey === 'importance'
        ? normalizeProjectImportanceValue(item)
        : fieldKey === 'links'
          ? normalizeProjectLinkValue(item).slice(0, maxLength)
          : typeof item === 'string'
            ? item.trim().slice(0, maxLength)
            : '';
    if (!value) continue;
    const key = value.toLowerCase();
    if (dedup.has(key)) continue;
    dedup.add(key);
    values.push(value);
    if (values.length >= maxItems) break;
  }

  return values;
}

function mergeProjectProfileValues(fieldKey: ProjectProfileFieldKey, ...lists: string[][]) {
  const dedup = new Set<string>();
  const values: string[] = [];
  const maxItems = fieldKey === 'importance' ? 1 : fieldKey === 'links' ? 24 : 40;

  for (const list of lists) {
    for (const item of normalizeProjectProfileFieldValues(fieldKey, list)) {
      const key = item.toLowerCase();
      if (dedup.has(key)) continue;
      dedup.add(key);
      values.push(item);
      if (values.length >= maxItems) return values;
    }
  }

  return values;
}

function normalizeProjectFieldInputValue(fieldKey: ProjectProfileFieldKey, rawValue: string) {
  const raw = rawValue.trim();
  if (!raw) return '';
  if (fieldKey === 'importance') return normalizeProjectImportanceValue(raw);
  if (fieldKey === 'links') return normalizeProjectLinkValue(raw).slice(0, PROJECT_FIELD_LINK_MAX_LENGTH);
  const maxLength = fieldKey === 'tasks' ? 120 : PROJECT_FIELD_DEFAULT_MAX_LENGTH;
  return raw.slice(0, maxLength);
}

function getProjectFieldMaxLength(fieldKey: ProjectProfileFieldKey) {
  if (fieldKey === 'links') return PROJECT_FIELD_LINK_MAX_LENGTH;
  if (fieldKey === 'tasks') return 120;
  return PROJECT_FIELD_DEFAULT_MAX_LENGTH;
}

function getProjectLinkChipLabel(value: string) {
  const raw = value.trim();
  if (!raw) return 'Website';

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const host = new URL(withProtocol).hostname.toLowerCase();
    if (host.includes('instagram')) return 'Instagram';
    if (host.includes('facebook') || host.includes('fb.com')) return 'Facebook';
    if (host.includes('linkedin')) return 'LinkedIn';
    if (host.includes('telegram') || host.includes('t.me')) return 'Telegram';
    if (host.includes('whatsapp') || host.includes('wa.me')) return 'WhatsApp';
    if (host.includes('youtube') || host.includes('youtu.be')) return 'YouTube';
    if (host.includes('tiktok')) return 'TikTok';
    if (host.includes('twitter') || host.includes('x.com')) return 'X';
    if (host.includes('vk.com') || host.includes('vkontakte')) return 'VK';
    if (host.includes('github')) return 'GitHub';
  } catch {
    // noop
  }

  return 'Website';
}

function normalizeChatMessage(rawMessage: unknown): ChatMessage | null {
  const record = toProfile(rawMessage);
  const id = typeof record.id === 'string' ? record.id : createMessageId();
  const role = record.role === 'assistant' ? 'assistant' : 'user';
  const text = typeof record.text === 'string' ? record.text : '';
  const createdAtRaw = typeof record.createdAt === 'string' ? record.createdAt : getIsoNow();
  const createdAtMs = Date.parse(createdAtRaw);
  const createdAt = Number.isFinite(createdAtMs) ? new Date(createdAtMs).toISOString() : getIsoNow();
  const rawAttachments = Array.isArray(record.attachments) ? record.attachments : [];

  const attachments: EntityAttachment[] = rawAttachments
    .map((rawAttachment) => {
      const attachment = toProfile(rawAttachment);
      const data = typeof attachment.data === 'string' ? attachment.data : '';
      if (!data) return null;
      return {
        id: typeof attachment.id === 'string' ? attachment.id : createAttachmentId(),
        name: typeof attachment.name === 'string' ? attachment.name : 'Файл',
        mime: typeof attachment.mime === 'string' ? attachment.mime : '',
        size: typeof attachment.size === 'number' ? attachment.size : 0,
        data,
      };
    })
    .filter((item): item is EntityAttachment => Boolean(item));

  if (!text.trim() && !attachments.length) {
    return null;
  }

  return {
    id,
    role,
    text,
    createdAt,
    attachments,
  };
}

function normalizeChatMessages(rawMessages: unknown): ChatMessage[] {
  if (!Array.isArray(rawMessages)) return [];

  const dedup = new Set<string>();
  const normalized = rawMessages
    .map((rawMessage) => normalizeChatMessage(rawMessage))
    .filter((message): message is ChatMessage => Boolean(message))
    .filter((message) => {
      if (dedup.has(message.id)) return false;
      dedup.add(message.id);
      return true;
    })
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  return normalized.slice(-MAX_MESSAGES_PER_SCOPE);
}

function normalizeStoredMessages(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, ChatMessage[]>;
  }

  const result: Record<string, ChatMessage[]> = {};
  for (const [scope, rawMessages] of Object.entries(value as Record<string, unknown>)) {
    result[scope] = normalizeChatMessages(rawMessages);
  }

  return result;
}

function loadStoredMessages() {
  if (typeof window === 'undefined') {
    return {} as Record<string, ChatMessage[]>;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {} as Record<string, ChatMessage[]>;
    }

    return normalizeStoredMessages(JSON.parse(raw));
  } catch {
    return {} as Record<string, ChatMessage[]>;
  }
}

function persistMessages() {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messagesByScope.value));
  } catch {
    // Ignore localStorage write errors.
  }
}

function loadStoredPanelSize() {
  if (typeof window === 'undefined') {
    return null as { width: number; height: number } | null;
  }

  try {
    const raw = window.localStorage.getItem(PANEL_SIZE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { width?: number; height?: number };
    const width = Number(parsed.width);
    const height = Number(parsed.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    return {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height)),
    };
  } catch {
    return null;
  }
}

function persistPanelSize() {
  if (typeof window === 'undefined' || !panelSize.value) return;
  try {
    window.localStorage.setItem(PANEL_SIZE_STORAGE_KEY, JSON.stringify(panelSize.value));
  } catch {
    // Ignore localStorage write errors.
  }
}

const isPhoneViewport = computed(() => viewportWidth.value <= 700);
const canResizePanel = computed(() => true);
const panelEdgeMarginPx = computed(() => (isPhoneViewport.value ? 10 : 18));

const panelConstraints = computed(() => {
  const maxWidth = Math.max(280, viewportWidth.value - panelEdgeMarginPx.value * 2);
  const maxHeight = Math.max(260, viewportHeight.value - PANEL_TOP_OFFSET_PX - panelEdgeMarginPx.value);
  const minWidth = isPhoneViewport.value ? 280 : 320;
  const minHeight = isPhoneViewport.value ? 320 : 360;

  return {
    maxWidth,
    maxHeight,
    minWidth: Math.min(minWidth, maxWidth),
    minHeight: Math.min(minHeight, maxHeight),
  };
});

function getDefaultPanelSize() {
  const constraints = panelConstraints.value;
  const width = Math.min(isPhoneViewport.value ? constraints.maxWidth : 420, constraints.maxWidth);
  const heightTarget = Math.round(viewportHeight.value * (isPhoneViewport.value ? 0.68 : 0.76));
  const height = Math.min(heightTarget, constraints.maxHeight);
  return {
    width: Math.max(constraints.minWidth, width),
    height: Math.max(constraints.minHeight, height),
  };
}

function clampPanelSize(size: { width: number; height: number }) {
  const constraints = panelConstraints.value;
  return {
    width: Math.min(constraints.maxWidth, Math.max(constraints.minWidth, Math.round(size.width))),
    height: Math.min(constraints.maxHeight, Math.max(constraints.minHeight, Math.round(size.height))),
  };
}

const resolvedPanelSize = computed(() => {
  const fallback = getDefaultPanelSize();
  const raw = panelSize.value || fallback;
  return clampPanelSize(raw);
});

const panelStyle = computed(() => {
  if (isPanelMaximized.value) {
    if (isPhoneViewport.value) {
      return {
        inset: '0px',
        width: 'auto',
        height: 'auto',
        maxWidth: '100vw',
        maxHeight: '100dvh',
        borderRadius: '0px',
      };
    }

    return {
      width: `${panelConstraints.value.maxWidth}px`,
      height: `${panelConstraints.value.maxHeight}px`,
      maxWidth: `${panelConstraints.value.maxWidth}px`,
      maxHeight: `${panelConstraints.value.maxHeight}px`,
    };
  }

  return {
    width: `${resolvedPanelSize.value.width}px`,
    height: `${resolvedPanelSize.value.height}px`,
    maxWidth: `${panelConstraints.value.maxWidth}px`,
    maxHeight: `${panelConstraints.value.maxHeight}px`,
  };
});

function updateViewportSize() {
  if (typeof window === 'undefined') return;
  viewportWidth.value = window.innerWidth;
  viewportHeight.value = window.innerHeight;
}

function stopPanelResize() {
  if (typeof window === 'undefined') return;
  isResizingPanel.value = false;
  resizeStart.value = null;
  resizePointerId.value = null;
  window.removeEventListener('pointermove', onPanelResizePointerMove);
  window.removeEventListener('pointerup', onPanelResizePointerUp);
  window.removeEventListener('pointercancel', onPanelResizePointerUp);
  window.removeEventListener('touchmove', onPanelResizeTouchMove);
  window.removeEventListener('touchend', onPanelResizeTouchEnd);
  window.removeEventListener('touchcancel', onPanelResizeTouchEnd);
}

function onPanelResizePointerMove(event: PointerEvent) {
  if (!isResizingPanel.value || !resizeStart.value) return;
  isPanelMaximized.value = false;

  const deltaX = event.clientX - resizeStart.value.clientX;
  const deltaY = event.clientY - resizeStart.value.clientY;
  const nextWidth = resizeStart.value.width - deltaX;
  const nextHeight = resizeStart.value.height - deltaY;
  panelSize.value = clampPanelSize({
    width: nextWidth,
    height: nextHeight,
  });
}

function onPanelResizePointerUp() {
  if (!isResizingPanel.value) return;
  stopPanelResize();
  persistPanelSize();
}

function togglePanelMaximize() {
  if (!canResizePanel.value || isResizingPanel.value) return;

  if (isPanelMaximized.value) {
    isPanelMaximized.value = false;
    if (panelSizeBeforeMaximize.value) {
      panelSize.value = clampPanelSize(panelSizeBeforeMaximize.value);
    }
    persistPanelSize();
    return;
  }

  panelSizeBeforeMaximize.value = resolvedPanelSize.value;
  isPanelMaximized.value = true;
  panelSize.value = {
    width: panelConstraints.value.maxWidth,
    height: panelConstraints.value.maxHeight,
  };
  persistPanelSize();
}

function onPanelResizeHandlePointerDown(event: PointerEvent) {
  if (!canResizePanel.value) return;
  if (event.pointerType === 'touch') return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();

  const panel = panelRef.value;
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  resizeStart.value = {
    clientX: event.clientX,
    clientY: event.clientY,
    width: rect.width,
    height: rect.height,
  };
  isResizingPanel.value = true;
  resizePointerId.value = event.pointerId;

  window.addEventListener('pointermove', onPanelResizePointerMove, { passive: true });
  window.addEventListener('pointerup', onPanelResizePointerUp);
  window.addEventListener('pointercancel', onPanelResizePointerUp);
}

function onPanelResizeTouchMove(event: TouchEvent) {
  if (!isResizingPanel.value || !resizeStart.value) return;
  const touch = event.touches?.[0];
  if (!touch) return;

  event.preventDefault();
  isPanelMaximized.value = false;

  const deltaX = touch.clientX - resizeStart.value.clientX;
  const deltaY = touch.clientY - resizeStart.value.clientY;
  if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
    touchResizeMoved.value = true;
  }
  const nextWidth = resizeStart.value.width - deltaX;
  const nextHeight = resizeStart.value.height - deltaY;
  panelSize.value = clampPanelSize({
    width: nextWidth,
    height: nextHeight,
  });
}

function onPanelResizeTouchEnd() {
  if (!isResizingPanel.value) return;
  const wasTap = !touchResizeMoved.value;
  stopPanelResize();
  persistPanelSize();

  if (!wasTap) return;

  const now = Date.now();
  if (now - lastTitleTapAt.value <= 320) {
    lastTitleTapAt.value = 0;
    togglePanelMaximize();
    return;
  }
  lastTitleTapAt.value = now;
}

function onPanelResizeHandleTouchStart(event: TouchEvent) {
  if (!canResizePanel.value) return;
  const touch = event.touches?.[0];
  if (!touch) return;
  event.preventDefault();
  event.stopPropagation();

  const panel = panelRef.value;
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  resizeStart.value = {
    clientX: touch.clientX,
    clientY: touch.clientY,
    width: rect.width,
    height: rect.height,
  };
  touchResizeMoved.value = false;
  isResizingPanel.value = true;

  window.addEventListener('touchmove', onPanelResizeTouchMove, { passive: false });
  window.addEventListener('touchend', onPanelResizeTouchEnd);
  window.addEventListener('touchcancel', onPanelResizeTouchEnd);
}

function onTitleWrapDoubleClick(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  togglePanelMaximize();
}

const routeScopeType = computed<'collection' | 'project-canvas'>(() => {
  return route.name === 'project-canvas' ? 'project-canvas' : 'collection';
});

const collectionType = computed<EntityType>(() => {
  const routeType = normalizeType(route.params.type);
  if (route.name === 'projects') {
    return 'project';
  }
  if (route.name === 'entities-by-type') {
    return routeType;
  }
  return 'project';
});

const scopeKey = computed(() => {
  if (routeScopeType.value === 'project-canvas') {
    const projectId = typeof route.params.id === 'string' ? route.params.id : 'unknown';
    return `project-canvas:${projectId}`;
  }
  return `collection:${collectionType.value}`;
});

const scopeTitle = computed(() => {
  if (routeScopeType.value === 'project-canvas') {
    return 'LLM Агент проекта';
  }
  return `LLM Агент: ${ENTITY_TYPE_LABELS[collectionType.value]}`;
});

const projectDashboardEntityCount = computed(() => {
  if (routeScopeType.value !== 'project-canvas') {
    return 0;
  }

  const projectId = typeof route.params.id === 'string' ? route.params.id : '';
  if (!projectId) {
    return 0;
  }

  const project = entitiesStore.byId(projectId);
  if (!project || project.type !== 'project') {
    return 0;
  }

  const rawCanvas = toProfile(project.canvas_data);
  const rawNodes = Array.isArray(rawCanvas.nodes) ? rawCanvas.nodes : [];

  return rawNodes.filter((rawNode) => {
    const node = toProfile(rawNode);
    return typeof node.entityId === 'string' && node.entityId.trim().length > 0;
  }).length;
});

const scopeSummary = computed(() => {
  if (routeScopeType.value === 'project-canvas') {
    return `Доступ: сущности текущего проекта (${projectDashboardEntityCount.value})`;
  }
  const count = entitiesStore.countByType(collectionType.value);
  return `Доступ: ${ENTITY_TYPE_LABELS[collectionType.value].toLowerCase()} (${count})`;
});

const activeProjectEntity = computed<Entity | null>(() => {
  if (routeScopeType.value !== 'project-canvas') return null;
  const projectId = typeof route.params.id === 'string' ? route.params.id.trim() : '';
  if (!projectId) return null;
  const entity = entitiesStore.byId(projectId);
  if (!entity || entity.type !== 'project') return null;
  return entity;
});

const projectProfileDescription = computed(() => {
  const project = activeProjectEntity.value;
  if (!project) return '';
  const metadata = toProfile(project.ai_metadata);
  return typeof metadata.description === 'string' ? metadata.description.trim() : '';
});

const projectProfileFields = computed(() => {
  const project = activeProjectEntity.value;
  const metadata = toProfile(project?.ai_metadata);

  return PROJECT_PROFILE_FIELD_CONFIGS.map((field) => {
    const values = normalizeProjectProfileFieldValues(field.key, metadata[field.key]);
    return {
      key: field.key,
      label: field.label,
      values,
      count: values.length,
    };
  });
});

function getProjectFieldPlaceholder(fieldKey: ProjectProfileFieldKey, label: string) {
  const count = getProjectFieldValues(fieldKey).length;
  return `${label}: ${count}`;
}

const projectProfileFilledFieldCount = computed(
  () => projectProfileFields.value.filter((field) => field.count > 0).length,
);

function getProjectFieldValues(fieldKey: ProjectProfileFieldKey) {
  const project = activeProjectEntity.value;
  if (!project) return [] as string[];
  const metadata = toProfile(project.ai_metadata);
  return normalizeProjectProfileFieldValues(fieldKey, metadata[fieldKey]);
}

function getProjectFieldDraft(fieldKey: ProjectProfileFieldKey) {
  return projectFieldDrafts.value[fieldKey] || '';
}

function setProjectFieldInputRef(fieldKey: ProjectProfileFieldKey, element: unknown) {
  if (typeof HTMLInputElement !== 'undefined' && element instanceof HTMLInputElement) {
    projectFieldInputRefs.value[fieldKey] = element;
    return;
  }

  if (element === null) {
    delete projectFieldInputRefs.value[fieldKey];
  }
}

function focusProjectFieldInput(fieldKey: ProjectProfileFieldKey, selectAll = false) {
  void nextTick(() => {
    const input = projectFieldInputRefs.value[fieldKey];
    if (!input) return;
    input.focus();
    if (selectAll) {
      input.select();
    }
  });
}

function queueProjectMetadataUpdate(patch: Record<string, unknown>) {
  const project = activeProjectEntity.value;
  if (!project) return;

  const nextMetadata = {
    ...toProfile(project.ai_metadata),
    ...patch,
  };

  entitiesStore.queueEntityUpdate(
    project._id,
    {
      ai_metadata: nextMetadata,
    },
    { delay: PROJECT_PROFILE_SYNC_DELAY },
  );
}

function applyProjectFieldValues(fieldKey: ProjectProfileFieldKey, values: string[]) {
  const patch: Record<string, unknown> = {
    [fieldKey]: values,
  };

  if (fieldKey === 'importance') {
    patch.importance_source = values.length ? 'manual' : 'auto';
  }

  queueProjectMetadataUpdate(patch);
}

function onProjectDescriptionInput(event: Event) {
  const input = event.target as HTMLTextAreaElement | null;
  if (!input) return;
  queueProjectMetadataUpdate({
    description: input.value.slice(0, PROJECT_DESCRIPTION_MAX_LENGTH),
  });
}

function onProjectFieldDraftInput(fieldKey: ProjectProfileFieldKey, event: Event) {
  const input = event.target as HTMLInputElement | null;
  if (!input) return;
  projectFieldDrafts.value[fieldKey] = input.value.slice(0, getProjectFieldMaxLength(fieldKey));
}

function onProjectFieldDraftKeydown(fieldKey: ProjectProfileFieldKey, event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  projectFieldDrafts.value[fieldKey] = '';
  if (projectEditingFieldValue.value?.fieldKey === fieldKey) {
    projectEditingFieldValue.value = null;
  }
}

function startEditProjectFieldValue(fieldKey: ProjectProfileFieldKey, value: string) {
  projectEditingFieldValue.value = {
    fieldKey,
    originalValue: value,
  };
  projectFieldDrafts.value[fieldKey] = value.slice(0, getProjectFieldMaxLength(fieldKey));
  focusProjectFieldInput(fieldKey, true);
}

function addProjectFieldValue(fieldKey: ProjectProfileFieldKey) {
  const rawDraft = getProjectFieldDraft(fieldKey);
  const normalizedValue = normalizeProjectFieldInputValue(fieldKey, rawDraft);
  if (!normalizedValue) return;

  let baseValues = getProjectFieldValues(fieldKey);
  const editing = projectEditingFieldValue.value;

  if (editing && editing.fieldKey === fieldKey) {
    const originalKey = editing.originalValue.trim().toLowerCase();
    baseValues = baseValues.filter((item) => item.trim().toLowerCase() !== originalKey);
  }

  const nextValues = mergeProjectProfileValues(fieldKey, baseValues, [normalizedValue]);
  applyProjectFieldValues(fieldKey, nextValues);
  projectFieldDrafts.value[fieldKey] = '';
  if (editing?.fieldKey === fieldKey) {
    projectEditingFieldValue.value = null;
  }
}

function removeProjectFieldValue(fieldKey: ProjectProfileFieldKey, value: string) {
  const removeKey = value.trim().toLowerCase();
  const nextValues = getProjectFieldValues(fieldKey).filter((item) => item.trim().toLowerCase() !== removeKey);
  applyProjectFieldValues(fieldKey, nextValues);

  const editing = projectEditingFieldValue.value;
  if (editing && editing.fieldKey === fieldKey && editing.originalValue.trim().toLowerCase() === removeKey) {
    projectEditingFieldValue.value = null;
    projectFieldDrafts.value[fieldKey] = '';
  }
}

function openProjectFieldLink(value: string) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeProjectLinkValue(value);
  if (!normalized) return;
  window.open(normalized, '_blank', 'noopener,noreferrer');
}

function buildProjectMetadataResetPatch() {
  const clearedFields = Object.fromEntries(PROJECT_PROFILE_FIELD_KEYS.map((fieldKey) => [fieldKey, []]));
  return {
    ...clearedFields,
    description: '',
    text_input: '',
    voice_input: '',
    documents: [],
    chat_history: [],
    description_history: [],
    description_meta: {},
    importance_history: [],
    ai_last_analysis: {},
    importance_source: 'auto',
  } as Record<string, unknown>;
}

const inputPlaceholder = computed(() => {
  if (routeScopeType.value === 'project-canvas') {
    return 'Запрос для анализа проекта...';
  }
  return `Запрос по категории "${ENTITY_TYPE_LABELS[collectionType.value]}"...`;
});

const clearConfirmTitle = computed(() =>
  routeScopeType.value === 'project-canvas' ? 'Очистить чат и профиль проекта?' : 'Удалить историю чата?',
);

const clearConfirmText = computed(() =>
  routeScopeType.value === 'project-canvas'
    ? 'Будут удалены история этого чата, описание проекта и все поля профиля. Действие необратимо.'
    : 'История общего LLM-чата будет удалена безвозвратно для текущего аккаунта.',
);

const scopedMessages = computed(() => {
  return messagesByScope.value[scopeKey.value] || [];
});

function formatApiError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const responseMessage =
      (error.response?.data as { message?: string } | undefined)?.message || error.message;
    return status ? `${responseMessage} (HTTP ${status})` : responseMessage;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'AI request failed';
}

function buildRequestScope(): AgentChatRequestScope | null {
  if (routeScopeType.value === 'project-canvas') {
    const projectId = typeof route.params.id === 'string' ? route.params.id.trim() : '';
    if (!projectId) return null;
    return {
      type: 'project',
      projectId,
    };
  }

  return {
    type: 'collection',
    entityType: collectionType.value,
  };
}

function parseScopeFromScopeKey(key: string): AgentChatRequestScope | null {
  if (typeof key !== 'string' || !key.trim()) return null;

  if (key.startsWith('collection:')) {
    const entityType = normalizeType(key.slice('collection:'.length));
    return {
      type: 'collection',
      entityType,
    };
  }

  if (key.startsWith('project-canvas:')) {
    const projectId = key.slice('project-canvas:'.length).trim();
    if (!projectId) return null;
    return {
      type: 'project',
      projectId,
    };
  }

  return null;
}

function normalizeMessagesForCompare(messages: ChatMessage[]) {
  return normalizeChatMessages(messages).map((message) => ({
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
  }));
}

function areMessagesEqual(left: ChatMessage[], right: ChatMessage[]) {
  const leftNormalized = normalizeMessagesForCompare(left);
  const rightNormalized = normalizeMessagesForCompare(right);
  return JSON.stringify(leftNormalized) === JSON.stringify(rightNormalized);
}

function mergeMessages(local: ChatMessage[], remote: ChatMessage[]) {
  const mergedById = new Map<string, ChatMessage>();
  for (const message of [...remote, ...local]) {
    mergedById.set(message.id, message);
  }

  const merged = Array.from(mergedById.values()).sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
  return normalizeChatMessages(merged).slice(-MAX_MESSAGES_PER_SCOPE);
}

async function fetchRemoteHistory(scope: AgentChatRequestScope) {
  const params: Record<string, string> = {
    scopeType: scope.type,
  };
  if (scope.type === 'collection') {
    params.entityType = normalizeType(scope.entityType);
  } else {
    params.projectId = String(scope.projectId || '').trim();
  }

  const { data } = await apiClient.get<AgentChatHistoryResponse>('/ai/chat-history', {
    params,
  });
  return normalizeChatMessages(data?.messages);
}

async function saveRemoteHistory(scope: AgentChatRequestScope, messages: ChatMessage[], signal?: AbortSignal) {
  await apiClient.put('/ai/chat-history', {
    scope,
    messages: normalizeChatMessages(messages),
  }, {
    signal,
  });
}

async function clearRemoteHistory(scope?: AgentChatRequestScope) {
  if (!scope) {
    await apiClient.delete('/ai/chat-history', {
      params: {
        all: 'true',
      },
    });
    return;
  }

  await apiClient.delete('/ai/chat-history', {
    params: {
      scopeType: scope.type,
      entityType: scope.type === 'collection' ? scope.entityType : undefined,
      projectId: scope.type === 'project' ? scope.projectId : undefined,
    },
  });
}

function setScopeMessages(nextScopeKey: string, nextMessages: ChatMessage[]) {
  messagesByScope.value = {
    ...messagesByScope.value,
    [nextScopeKey]: normalizeChatMessages(nextMessages),
  };
  persistMessages();
}

function hasPendingScopeChanges(targetScopeKey: string) {
  return (
    pendingSaveTimersByScope.has(targetScopeKey) ||
    saveInFlightScopes.has(targetScopeKey) ||
    queuedResaveScopes.has(targetScopeKey)
  );
}

function abortAllRemoteSaves() {
  for (const controller of saveControllersByScope.values()) {
    try {
      controller.abort();
    } catch {
      // Ignore abort errors.
    }
  }
  saveControllersByScope.clear();
}

async function flushRemoteScopeSave(targetScopeKey: string) {
  if (isRemoteHistoryResetting.value) return;

  const scope = parseScopeFromScopeKey(targetScopeKey);
  if (!scope) return;

  if (saveInFlightScopes.has(targetScopeKey)) {
    queuedResaveScopes.add(targetScopeKey);
    return;
  }

  const queuedTimer = pendingSaveTimersByScope.get(targetScopeKey);
  if (queuedTimer) {
    clearTimeout(queuedTimer);
    pendingSaveTimersByScope.delete(targetScopeKey);
  }

  saveInFlightScopes.add(targetScopeKey);
  const controller = new AbortController();
  saveControllersByScope.set(targetScopeKey, controller);

  try {
    const currentMessages = normalizeChatMessages(messagesByScope.value[targetScopeKey] || []);
    await saveRemoteHistory(scope, currentMessages, controller.signal);
  } catch {
    // Remote sync errors should not block local chat usage.
  } finally {
    saveInFlightScopes.delete(targetScopeKey);
    const activeController = saveControllersByScope.get(targetScopeKey);
    if (activeController === controller) {
      saveControllersByScope.delete(targetScopeKey);
    }
    if (queuedResaveScopes.has(targetScopeKey)) {
      queuedResaveScopes.delete(targetScopeKey);
      void flushRemoteScopeSave(targetScopeKey);
    }
  }
}

function scheduleRemoteScopeSave(targetScopeKey: string, delayMs = 380) {
  if (isRemoteHistoryResetting.value) return;

  const scope = parseScopeFromScopeKey(targetScopeKey);
  if (!scope) return;

  const currentTimer = pendingSaveTimersByScope.get(targetScopeKey);
  if (currentTimer) {
    clearTimeout(currentTimer);
  }

  const nextTimer = setTimeout(() => {
    pendingSaveTimersByScope.delete(targetScopeKey);
    void flushRemoteScopeSave(targetScopeKey);
  }, delayMs);

  pendingSaveTimersByScope.set(targetScopeKey, nextTimer);
}

async function syncScopeHistoryFromServer(targetScopeKey = scopeKey.value) {
  if (isRemoteHistoryResetting.value) return;

  const scope = parseScopeFromScopeKey(targetScopeKey);
  if (!scope) return;

  const syncVersion = activeSyncVersion.value + 1;
  activeSyncVersion.value = syncVersion;

  try {
    const remoteMessages = await fetchRemoteHistory(scope);
    if (activeSyncVersion.value !== syncVersion) return;

    const localMessages = normalizeChatMessages(messagesByScope.value[targetScopeKey] || []);
    // Also treat the scope as having pending changes while an AI request is in
    // flight: the user message was already pushed locally but the AI response
    // hasn't arrived yet. Without this guard an SSE from another device could
    // overwrite local state and wipe out the in-progress user message.
    const isSendingInThisScope = isSending.value && targetScopeKey === scopeKey.value;
    const hasPendingChanges = hasPendingScopeChanges(targetScopeKey) || isSendingInThisScope;
    if (!hasPendingChanges) {
      if (!areMessagesEqual(localMessages, remoteMessages)) {
        setScopeMessages(targetScopeKey, remoteMessages);
      }
      return;
    }

    const mergedMessages = mergeMessages(localMessages, remoteMessages);
    if (!areMessagesEqual(localMessages, mergedMessages)) {
      setScopeMessages(targetScopeKey, mergedMessages);
    }

    if (!areMessagesEqual(remoteMessages, mergedMessages)) {
      await saveRemoteHistory(scope, mergedMessages);
    }
  } catch {
    // Ignore sync failures (offline / temporary network issues).
  } finally {
    if (isOpen.value) {
      void nextTick(() => {
        maybeScrollToBottom('auto');
      });
    }
  }
}

function stopHistoryPolling() {
  if (!historyPollingTimer.value) return;
  clearInterval(historyPollingTimer.value);
  historyPollingTimer.value = null;
}

function startHistoryPolling() {
  stopHistoryPolling();
  historyPollingTimer.value = setInterval(() => {
    if (!isOpen.value) return;
    void syncScopeHistoryFromServer(scopeKey.value);
  }, REMOTE_HISTORY_POLL_INTERVAL_MS);
}

function buildHistoryPayload(messages: ChatMessage[]) {
  return messages
    .slice(-12)
    .map((message) => ({
      role: message.role,
      text: message.text,
    }))
    .filter((message) => message.text.trim().length > 0);
}

function buildAttachmentsPayload(attachments: EntityAttachment[]) {
  return attachments.slice(0, 6).map((attachment) => {
    const canInlineData =
      typeof attachment.data === 'string' &&
      attachment.data.length > 0 &&
      attachment.data.length <= AI_ATTACHMENT_MAX_INLINE_DATA_URL_LENGTH &&
      attachment.size <= AI_ATTACHMENT_MAX_INLINE_BYTES;

    return {
      name: attachment.name,
      mime: attachment.mime,
      size: attachment.size,
      ...(canInlineData ? { data: attachment.data } : {}),
    };
  });
}

function buildDebugAttachment(debug: Record<string, unknown>) {
  const fileName = `llm-log-${Date.now()}.json`;
  const json = JSON.stringify(debug, null, 2);
  const encoded = encodeURIComponent(json);
  return {
    id: createAttachmentId(),
    name: fileName,
    mime: 'application/json',
    size: json.length,
    data: `data:application/json;charset=utf-8,${encoded}`,
  } satisfies EntityAttachment;
}

function buildErrorLogAttachment(payload: Record<string, unknown>) {
  const fileName = `llm-error-log-${Date.now()}.json`;
  const json = JSON.stringify(payload, null, 2);
  const encoded = encodeURIComponent(json);
  return {
    id: createAttachmentId(),
    name: fileName,
    mime: 'application/json',
    size: json.length,
    data: `data:application/json;charset=utf-8,${encoded}`,
  } satisfies EntityAttachment;
}

async function requestAssistantReply(args: {
  scope: AgentChatRequestScope;
  message: string;
  history: Array<{ role: ChatRole; text: string }>;
  attachments: EntityAttachment[];
}) {
  const { data } = await apiClient.post<AgentChatResponse>('/ai/agent-chat', {
    scope: args.scope,
    message: args.message,
    history: args.history,
    attachments: buildAttachmentsPayload(args.attachments),
    debug: true,
  }, {
    timeout: AGENT_CHAT_REQUEST_TIMEOUT_MS,
  });

  return {
    reply: typeof data.reply === 'string' ? data.reply.trim() : '',
    debug: data.debug,
  };
}

function pushMessage(role: ChatRole, text: string, attachments: EntityAttachment[] = [], scope?: string) {
  const trimmed = text.trim();
  if (!trimmed && !attachments.length) return;
  const targetScope = scope || scopeKey.value;

  const nextMessage: ChatMessage = {
    id: createMessageId(),
    role,
    text: trimmed,
    createdAt: getIsoNow(),
    attachments: attachments.map((attachment) => ({ ...attachment })),
  };

  messagesByScope.value = {
    ...messagesByScope.value,
    [targetScope]: normalizeChatMessages([...(messagesByScope.value[targetScope] || []), nextMessage]).slice(
      -MAX_MESSAGES_PER_SCOPE,
    ),
  };
  persistMessages();
  scheduleRemoteScopeSave(targetScope);
}

function openChatAttachment(attachment: EntityAttachment) {
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

function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
  const feed = chatFeedRef.value;
  if (!feed) return;
  feed.scrollTo({
    top: feed.scrollHeight,
    behavior,
  });
}

function isFeedNearBottom(thresholdPx = 72) {
  const feed = chatFeedRef.value;
  if (!feed) return true;
  const distanceToBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
  return distanceToBottom <= thresholdPx;
}

function onFeedScroll() {
  if (!isOpen.value) return;
  shouldAutoScrollToBottom.value = isFeedNearBottom();
}

function maybeScrollToBottom(behavior: ScrollBehavior = 'smooth', force = false) {
  if (!force && !shouldAutoScrollToBottom.value) return;
  scrollToBottom(behavior);
  shouldAutoScrollToBottom.value = true;
}

function autoResizeComposer() {
  const input = chatInputRef.value;
  if (!input) return;

  if (pendingComposerHeightReset.value) {
    input.style.height = '0px';
    pendingComposerHeightReset.value = false;
  }

  input.style.height = '0px';
  input.style.height = `${Math.min(176, input.scrollHeight)}px`;
}

function toggleChat() {
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    isClearHistoryConfirmOpen.value = false;
    panelSize.value = resolvedPanelSize.value;
    startHistoryPolling();
    void syncScopeHistoryFromServer(scopeKey.value);
    pendingComposerHeightReset.value = true;
    shouldAutoScrollToBottom.value = true;
    void nextTick(() => {
      autoResizeComposer();
      maybeScrollToBottom('auto', true);
    });
  } else {
    isClearHistoryConfirmOpen.value = false;
    stopHistoryPolling();
    stopVoiceCapture();
    pendingUploads.value = [];
    isPanelMaximized.value = false;
    lastTitleTapAt.value = 0;
    touchResizeMoved.value = false;
  }
}

function openClearHistoryConfirm() {
  isClearHistoryConfirmOpen.value = true;
}

function cancelClearHistoryConfirm() {
  isClearHistoryConfirmOpen.value = false;
}

async function clearCurrentScopeHistoryOnly() {
  const activeScopeKey = scopeKey.value;
  const scope = parseScopeFromScopeKey(activeScopeKey);
  if (!scope) return;

  const pendingTimer = pendingSaveTimersByScope.get(activeScopeKey);
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingSaveTimersByScope.delete(activeScopeKey);
  }
  queuedResaveScopes.delete(activeScopeKey);
  saveInFlightScopes.delete(activeScopeKey);
  const activeController = saveControllersByScope.get(activeScopeKey);
  if (activeController) {
    try {
      activeController.abort();
    } catch {
      // Ignore abort errors.
    }
    saveControllersByScope.delete(activeScopeKey);
  }

  const nextByScope = { ...messagesByScope.value };
  delete nextByScope[activeScopeKey];
  messagesByScope.value = nextByScope;
  persistMessages();

  await clearRemoteHistory(scope);
}

function resetProjectProfileLocally() {
  projectFieldDrafts.value = buildProjectFieldDrafts();
  projectEditingFieldValue.value = null;
}

function clearProjectProfileMetadata() {
  const project = activeProjectEntity.value;
  if (!project) return;

  const resetPatch = buildProjectMetadataResetPatch();
  entitiesStore.queueEntityUpdate(
    project._id,
    {
      ai_metadata: {
        ...toProfile(project.ai_metadata),
        ...resetPatch,
      },
    },
    { delay: 0 },
  );

  resetProjectProfileLocally();
}

async function confirmClearAllChatHistory() {
  isClearHistoryConfirmOpen.value = false;

  isRemoteHistoryResetting.value = true;
  stopHistoryPolling();

  messageDraft.value = '';
  pendingUploads.value = [];

  try {
    if (routeScopeType.value === 'project-canvas') {
      await clearCurrentScopeHistoryOnly();
      clearProjectProfileMetadata();
      isProjectProfileExpanded.value = false;
    } else {
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.removeItem(STORAGE_KEY);
        } catch {
          // Ignore localStorage errors.
        }
      }

      for (const timer of pendingSaveTimersByScope.values()) {
        clearTimeout(timer);
      }
      pendingSaveTimersByScope.clear();
      saveInFlightScopes.clear();
      queuedResaveScopes.clear();
      abortAllRemoteSaves();

      messagesByScope.value = {};
      await clearRemoteHistory();
    }
  } catch {
    // Ignore remote cleanup failures and keep local cleanup result.
  } finally {
    isRemoteHistoryResetting.value = false;
    if (isOpen.value) {
      startHistoryPolling();
      void syncScopeHistoryFromServer(scopeKey.value);
    }
  }

  void nextTick(() => {
    autoResizeComposer();
    maybeScrollToBottom('auto', true);
  });
}

async function sendMessage() {
  if (isSending.value) return;
  if (isVoiceListening.value) {
    stopVoiceCapture();
  }

  const value = messageDraft.value.trim();
  const attachments = [...pendingUploads.value];
  if (!value && !attachments.length) return;
  const activeScope = buildRequestScope();
  if (!activeScope) {
    pushMessage('assistant', 'Не удалось определить контекст анализа.');
    return;
  }

  const activeScopeKey = scopeKey.value;
  const historyPayload = buildHistoryPayload(messagesByScope.value[activeScopeKey] || []);

  pushMessage('user', value, attachments, activeScopeKey);
  messageDraft.value = '';
  pendingUploads.value = [];

  isSending.value = true;

  void nextTick(() => {
    autoResizeComposer();
    shouldAutoScrollToBottom.value = true;
    maybeScrollToBottom('auto', true);
  });

  try {
    const aiResponse = await requestAssistantReply({
      scope: activeScope,
      message: value,
      history: historyPayload,
      attachments,
    });
    const debugAttachments = aiResponse.debug ? [buildDebugAttachment(aiResponse.debug)] : [];
    if (aiResponse.reply) {
      pushMessage('assistant', aiResponse.reply, debugAttachments, activeScopeKey);
    } else {
      pushMessage('assistant', 'Недостаточно данных в текущем контексте.', debugAttachments, activeScopeKey);
    }
  } catch (error) {
    const errorLog = buildErrorLogAttachment({
      timestamp: getIsoNow(),
      scope: activeScope,
      request: {
        message: value,
        history: historyPayload,
        attachments: buildAttachmentsPayload(attachments),
      },
      error: formatApiError(error),
    });
    pushMessage(
      'assistant',
      `Не удалось получить ответ от LLM. ${formatApiError(error)}`,
      [errorLog],
      activeScopeKey,
    );
  } finally {
    isSending.value = false;
    void nextTick(() => {
      maybeScrollToBottom('auto');
    });
  }
}

function onComposerKeydown(event: KeyboardEvent) {
  if (isSending.value) return;
  if (event.key !== 'Enter') return;
  if (event.shiftKey) return;
  event.preventDefault();
  void sendMessage();
}

function onTextInput() {
  autoResizeComposer();
}

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('File read error'));
    reader.readAsDataURL(file);
  });
}

async function onDocumentsChange(event: Event) {
  const input = event.target as HTMLInputElement | null;
  const files = input?.files;
  if (!files || !files.length) return;

  const attachments = await Promise.all(
    Array.from(files).map(async (file) => ({
      id: createAttachmentId(),
      name: file.name,
      mime: file.type,
      size: file.size,
      data: await fileToDataUrl(file),
    })),
  );

  pendingUploads.value = [...pendingUploads.value, ...attachments];
  if (!messageDraft.value.trim()) {
    messageDraft.value = attachments.map((attachment) => `[Файл] ${attachment.name}`).join('\n');
  }

  void nextTick(() => {
    autoResizeComposer();
  });

  if (input) {
    input.value = '';
  }
}

function removePendingUpload(attachmentId: string) {
  pendingUploads.value = pendingUploads.value.filter((attachment) => attachment.id !== attachmentId);
}

function clearVoiceRestartTimer() {
  if (!voiceRestartTimer.value) return;
  clearTimeout(voiceRestartTimer.value);
  voiceRestartTimer.value = null;
}

function mergeVoiceSegments(...parts: string[]) {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function applyVoiceDraft(interimText = '') {
  const merged = mergeVoiceSegments(voiceSessionBaseText.value, voiceCommittedText.value, interimText);
  messageDraft.value = merged;
  void nextTick(() => {
    autoResizeComposer();
  });
}

function stopVoiceCapture() {
  voiceCaptureSessionId.value += 1;
  voiceShouldRestart.value = false;
  clearVoiceRestartTimer();
  isVoiceListening.value = false;
  if (activeVoiceRecognition.value) {
    activeVoiceRecognition.value.stop();
    activeVoiceRecognition.value = null;
  }
  voiceSessionBaseText.value = '';
  voiceCommittedText.value = '';
}

function startVoiceCapture() {
  if (typeof window === 'undefined') return;

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
  if (!RecognitionCtor) return;

  stopVoiceCapture();
  voiceSessionBaseText.value = messageDraft.value.trim();
  voiceCommittedText.value = '';
  voiceShouldRestart.value = true;
  voiceCaptureSessionId.value += 1;
  const sessionId = voiceCaptureSessionId.value;

  const createRecognition = () => {
    const recognition = new RecognitionCtor();
    recognition.lang = 'ru-RU';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: unknown) => {
      if (voiceCaptureSessionId.value !== sessionId || !voiceShouldRestart.value) return;
      const payload = event as {
        resultIndex?: number;
        results?: ArrayLike<ArrayLike<{ transcript?: string }> & { isFinal?: boolean }>;
      };
      const eventResults = payload.results;
      if (!eventResults) return;

      const startIndex = Number.isFinite(Number(payload.resultIndex))
        ? Math.max(0, Number(payload.resultIndex))
        : 0;
      let interim = '';

      for (let index = startIndex; index < eventResults.length; index += 1) {
        const result = eventResults[index];
        const part = typeof result?.[0]?.transcript === 'string' ? result[0].transcript.trim() : '';
        if (!part) continue;
        if (result?.isFinal) {
          voiceCommittedText.value = mergeVoiceSegments(voiceCommittedText.value, part);
        } else {
          interim = mergeVoiceSegments(interim, part);
        }
      }

      applyVoiceDraft(interim);
    };

    recognition.onend = () => {
      if (voiceCaptureSessionId.value !== sessionId) return;
      activeVoiceRecognition.value = null;
      if (!voiceShouldRestart.value) {
        isVoiceListening.value = false;
        return;
      }

      clearVoiceRestartTimer();
      voiceRestartTimer.value = setTimeout(() => {
        if (voiceCaptureSessionId.value !== sessionId || !voiceShouldRestart.value) return;
        try {
          const nextRecognition = createRecognition();
          nextRecognition.start();
          isVoiceListening.value = true;
          activeVoiceRecognition.value = { stop: () => nextRecognition.stop() };
        } catch {
          voiceShouldRestart.value = false;
          isVoiceListening.value = false;
          activeVoiceRecognition.value = null;
        }
      }, 220);
    };

    return recognition;
  };

  try {
    const recognition = createRecognition();
    recognition.start();
    isVoiceListening.value = true;
    activeVoiceRecognition.value = { stop: () => recognition.stop() };
  } catch {
    voiceShouldRestart.value = false;
    isVoiceListening.value = false;
    activeVoiceRecognition.value = null;
  }
}

function onVoiceToggle() {
  if (isVoiceListening.value) {
    stopVoiceCapture();
    return;
  }
  startVoiceCapture();
}

function toDisplayTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

watch(
  scopeKey,
  (nextScopeKey) => {
    messageDraft.value = '';
    pendingUploads.value = [];
    isProjectProfileExpanded.value = false;
    resetProjectProfileLocally();
    stopVoiceCapture();
    pendingComposerHeightReset.value = true;
    if (!isOpen.value) return;
    void syncScopeHistoryFromServer(nextScopeKey);
    void nextTick(() => {
      autoResizeComposer();
      shouldAutoScrollToBottom.value = true;
      maybeScrollToBottom('auto', true);
    });
  },
  { immediate: true },
);

watch(
  activeProjectEntity,
  () => {
    resetProjectProfileLocally();
  },
  { immediate: true },
);

watch(scopedMessages, () => {
  if (!isOpen.value) return;
  void nextTick(() => {
    maybeScrollToBottom('auto');
  });
});

watch(panelConstraints, () => {
  if (isPanelMaximized.value) return;
  panelSize.value = resolvedPanelSize.value;
});

watch(panelSize, () => {
  if (!panelSize.value || isResizingPanel.value) return;
  persistPanelSize();
});

onMounted(() => {
  updateViewportSize();
  panelSize.value = resolvedPanelSize.value;
  if (typeof window === 'undefined') return;
  window.addEventListener('resize', updateViewportSize);
  window.addEventListener('orientationchange', updateViewportSize);
  window.visualViewport?.addEventListener('resize', updateViewportSize);
});

onBeforeUnmount(() => {
  stopPanelResize();
  stopHistoryPolling();
  stopVoiceCapture();
  for (const timer of pendingSaveTimersByScope.values()) {
    clearTimeout(timer);
  }
  pendingSaveTimersByScope.clear();
  saveInFlightScopes.clear();
  queuedResaveScopes.clear();
  if (typeof window === 'undefined') return;
  window.removeEventListener('resize', updateViewportSize);
  window.removeEventListener('orientationchange', updateViewportSize);
  window.visualViewport?.removeEventListener('resize', updateViewportSize);
});
</script>

<template>
  <div class="agent-chat-dock">
    <button
      type="button"
      class="agent-chat-trigger"
      :class="{ active: isOpen }"
      aria-label="Открыть LLM чат"
      @click="toggleChat"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 17 9.5 7 13 17" />
        <path d="M7.4 13.5h4.2" />
        <path d="M16 7h4" />
        <path d="M18 7v10" />
        <path d="M16 17h4" />
      </svg>
    </button>

    <section
      v-if="isOpen"
      ref="panelRef"
      class="agent-chat-panel"
      :style="panelStyle"
      @pointerdown.stop
    >
      <header class="agent-chat-header">
        <div
          class="agent-chat-title-wrap"
          @pointerdown="onPanelResizeHandlePointerDown"
          @touchstart="onPanelResizeHandleTouchStart"
          @dblclick="onTitleWrapDoubleClick"
        >
          <div class="agent-chat-title">{{ scopeTitle }}</div>
          <div class="agent-chat-summary">{{ scopeSummary }}</div>
        </div>
        <div class="agent-chat-header-actions">
          <button type="button" class="agent-chat-close" aria-label="Закрыть чат" @click="toggleChat">
            ×
          </button>
        </div>
      </header>

      <section v-if="routeScopeType === 'project-canvas'" class="agent-project-profile">
        <button
          type="button"
          class="agent-project-profile-toggle"
          :class="{ expanded: isProjectProfileExpanded }"
          @click="isProjectProfileExpanded = !isProjectProfileExpanded"
        >
          <span class="agent-project-profile-title">Профиль проекта</span>
          <span class="agent-project-profile-count">
            {{ projectProfileFilledFieldCount }} / {{ PROJECT_PROFILE_FIELD_KEYS.length }}
          </span>
          <span class="agent-project-profile-chevron" aria-hidden="true"></span>
        </button>

        <div v-show="isProjectProfileExpanded" class="agent-project-profile-body">
          <textarea
            class="agent-project-description-input"
            rows="2"
            maxlength="3000"
            :value="projectProfileDescription"
            placeholder="Описание"
            @input="onProjectDescriptionInput"
          />

          <div class="agent-project-fields-list">
            <div
              v-for="field in projectProfileFields"
              :key="field.key"
              class="agent-project-field-row"
            >
              <div class="agent-project-field-scroll">
                <input
                  :ref="(el) => setProjectFieldInputRef(field.key, el)"
                  :value="getProjectFieldDraft(field.key)"
                  type="text"
                  class="agent-project-field-input"
                  :maxlength="getProjectFieldMaxLength(field.key)"
                  :placeholder="getProjectFieldPlaceholder(field.key, field.label)"
                  @input="onProjectFieldDraftInput(field.key, $event)"
                  @keydown.enter.prevent="addProjectFieldValue(field.key)"
                  @keydown="onProjectFieldDraftKeydown(field.key, $event)"
                />
                <div
                  v-for="value in field.values"
                  :key="`${field.key}:${value}`"
                  class="agent-project-field-chip-wrap"
                >
                  <button
                    type="button"
                    class="agent-project-field-chip-main"
                    :class="{ link: field.key === 'links' }"
                    :title="field.key === 'links' ? value : 'Редактировать'"
                    @click="
                      field.key === 'links'
                        ? openProjectFieldLink(value)
                        : startEditProjectFieldValue(field.key, value)
                    "
                  >
                    {{ field.key === 'links' ? getProjectLinkChipLabel(value) : value }}
                  </button>
                  <button
                    type="button"
                    class="agent-project-field-chip-remove"
                    title="Удалить"
                    @click.stop="removeProjectFieldValue(field.key, value)"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section ref="chatFeedRef" class="agent-chat-feed" @scroll.passive="onFeedScroll">
        <div v-if="!scopedMessages.length" class="agent-chat-empty">
          Сообщений пока нет
        </div>

        <article
          v-for="message in scopedMessages"
          :key="message.id"
          class="agent-chat-message"
          :class="{ user: message.role === 'user', assistant: message.role === 'assistant' }"
        >
          <div class="agent-chat-bubble">
            <p class="agent-chat-text">{{ message.text }}</p>
            <div v-if="message.attachments.length" class="agent-chat-attachments">
              <button
                v-for="attachment in message.attachments"
                :key="attachment.id"
                type="button"
                class="agent-chat-attachment-chip"
                @click="openChatAttachment(attachment)"
              >
                {{ attachment.name }}
              </button>
            </div>
          </div>
          <time class="agent-chat-time">{{ toDisplayTime(message.createdAt) }}</time>
        </article>

        <article v-if="isSending" class="agent-chat-message assistant">
          <div class="agent-chat-bubble thinking">
            <span class="agent-chat-thinking-text">Думаю...</span>
          </div>
        </article>
      </section>

      <section class="agent-chat-composer">
        <div v-if="pendingUploads.length" class="agent-chat-pending-uploads">
          <span
            v-for="attachment in pendingUploads"
            :key="attachment.id"
            class="agent-chat-upload-chip"
          >
            {{ attachment.name }}
            <button
              type="button"
              class="agent-chat-upload-chip-remove"
              @click="removePendingUpload(attachment.id)"
            >
              ×
            </button>
          </span>
        </div>

        <div class="agent-chat-input-wrap">
          <textarea
            ref="chatInputRef"
            v-model="messageDraft"
            class="agent-chat-input"
            rows="1"
            :placeholder="inputPlaceholder"
            :disabled="isSending"
            @input="onTextInput"
            @keydown="onComposerKeydown"
          />
        </div>

        <div class="agent-chat-tools">
          <div class="agent-chat-tools-left">
            <button
              type="button"
              class="agent-chat-tool-btn"
              title="Загрузка документа"
              :disabled="isSending"
              @click="docInputRef?.click()"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M21 11.5V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8.5" />
                <path d="M15 3h6v6" />
                <path d="M10 14 21 3" />
              </svg>
            </button>
            <input
              ref="docInputRef"
              type="file"
              class="agent-chat-hidden-input"
              multiple
              @change="onDocumentsChange"
            />

            <button
              type="button"
              class="agent-chat-tool-btn"
              :class="{ active: isVoiceListening }"
              title="Голосовой ввод"
              :disabled="isSending"
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
            class="agent-chat-clear agent-chat-clear-tool"
            title="Очистить историю"
            aria-label="Очистить историю"
            :disabled="isSending"
            @click="openClearHistoryConfirm"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v4h4" />
            </svg>
          </button>

          <button
            type="button"
            class="agent-chat-tool-btn send agent-chat-tools-send"
            title="Отправить"
            :disabled="isSending"
            @click="void sendMessage()"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 11.5 21 3l-7.5 18-2.6-7.1L3 11.5Z" />
            </svg>
          </button>
        </div>
      </section>

      <div
        v-if="isClearHistoryConfirmOpen"
        class="agent-chat-confirm-overlay"
        @click="cancelClearHistoryConfirm"
      >
        <section class="agent-chat-confirm-dialog" @click.stop @pointerdown.stop>
          <h3 class="agent-chat-confirm-title">{{ clearConfirmTitle }}</h3>
          <p class="agent-chat-confirm-text">
            {{ clearConfirmText }}
          </p>
          <div class="agent-chat-confirm-actions">
            <button
              type="button"
              class="agent-chat-confirm-btn agent-chat-confirm-btn-cancel"
              @click="cancelClearHistoryConfirm"
            >
              Отмена
            </button>
            <button
              type="button"
              class="agent-chat-confirm-btn agent-chat-confirm-btn-danger"
              @click="confirmClearAllChatHistory"
            >
              {{ routeScopeType === 'project-canvas' ? 'Очистить' : 'Удалить' }}
            </button>
          </div>
        </section>
      </div>
    </section>
  </div>
</template>

<style scoped>
.agent-chat-dock {
  position: fixed;
  right: calc(18px + env(safe-area-inset-right, 0px));
  bottom: calc(18px + env(safe-area-inset-bottom, 0px) + var(--synapse-vv-bottom-offset, 0px));
  z-index: 165;
}

.agent-chat-trigger {
  width: 46px;
  height: 46px;
  border-radius: 999px;
  border: 1px solid #bfd5ff;
  background: #1058ff;
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 12px 24px rgba(16, 88, 255, 0.32);
  transition: 0.2s ease;
}

.agent-chat-trigger:hover {
  background: #0b4bdd;
  border-color: #8fb2ff;
  box-shadow: 0 14px 28px rgba(16, 88, 255, 0.36);
  transform: translateY(-1px);
}

.agent-chat-trigger.active {
  background: #0b4bdd;
  border-color: #8fb2ff;
}

.agent-chat-trigger svg {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.agent-chat-panel {
  position: fixed;
  right: calc(18px + env(safe-area-inset-right, 0px));
  bottom: calc(18px + env(safe-area-inset-bottom, 0px) + var(--synapse-vv-bottom-offset, 0px));
  width: min(420px, calc(100vw - 20px));
  height: min(76vh, calc(100vh - 84px));
  border-radius: 16px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  box-shadow: 0 24px 44px rgba(15, 23, 42, 0.24);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 360px;
  min-width: 320px;
}

.agent-chat-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px 10px;
  border-bottom: 1px solid #e8edf7;
}

.agent-chat-title-wrap {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  cursor: nwse-resize;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
}

.agent-chat-title {
  color: #0f172a;
  font-size: 14px;
  font-weight: 700;
}

.agent-chat-summary {
  color: #64748b;
  font-size: 11px;
  font-weight: 600;
}

.agent-chat-close {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  color: #64748b;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.agent-chat-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.agent-chat-clear {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  color: #64748b;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    color 0.16s ease;
}

.agent-chat-clear svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.agent-chat-clear:hover,
.agent-chat-close:hover {
  color: #1058ff;
  border-color: #bfd5ff;
  background: #eef4ff;
}

.agent-project-profile {
  border-bottom: 1px solid #e8edf7;
  background: #ffffff;
}

.agent-project-profile-toggle {
  width: 100%;
  border: none;
  background: #ffffff;
  color: #0f172a;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
}

.agent-project-profile-title {
  font-size: 12px;
  font-weight: 700;
}

.agent-project-profile-count {
  margin-left: auto;
  color: #64748b;
  font-size: 11px;
  font-weight: 600;
}

.agent-project-profile-chevron {
  width: 8px;
  height: 8px;
  border-right: 1.8px solid #64748b;
  border-bottom: 1.8px solid #64748b;
  transform: rotate(45deg);
  transition: transform 0.16s ease;
}

.agent-project-profile-toggle.expanded .agent-project-profile-chevron {
  transform: rotate(225deg);
}

.agent-project-profile-body {
  border-top: 1px solid #eff3fb;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 210px;
  overflow: auto;
}

.agent-project-description-input {
  width: 100%;
  min-height: 54px;
  max-height: none;
  resize: vertical;
  outline: none;
  border: 1px solid #dbe4f3;
  border-radius: 10px;
  background: #ffffff;
  color: #0f172a;
  font-size: 13px;
  line-height: 1.4;
  padding: 9px 10px;
}

.agent-project-description-input:focus {
  border-color: #bfdbfe;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.14);
}

.agent-project-fields-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 170px;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 2px;
}

.agent-project-fields-list::-webkit-scrollbar {
  width: 6px;
}

.agent-project-field-row {
  border: 1px solid #dbe4f3;
  border-radius: 10px;
  background: #ffffff;
}

.agent-project-field-scroll {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 4px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 4px 6px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.agent-project-field-scroll::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

.agent-project-field-input {
  flex: 0 0 126px;
  min-width: 108px;
  max-width: 180px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #0f172a;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.25;
  padding: 4px 6px;
  outline: none;
  order: -1;
}

.agent-project-field-input:focus {
  background: #f8fafc;
}

.agent-project-field-chip-wrap {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: 1px solid #bfd5ff;
  border-radius: 999px;
  background: #eff6ff;
  padding: 1px 3px 1px 6px;
  flex-shrink: 0;
}

.agent-project-field-chip-main {
  border: none;
  background: transparent;
  color: #1e40af;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.25;
  max-width: 220px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 2px 0;
  cursor: pointer;
}

.agent-project-field-chip-main.link {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.agent-project-field-chip-remove {
  width: 14px;
  height: 14px;
  border: none;
  border-radius: 50%;
  background: rgba(30, 64, 175, 0.14);
  color: #1e3a8a;
  font-size: 10px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.agent-project-field-chip-wrap:hover .agent-project-field-chip-remove,
.agent-project-field-chip-wrap:focus-within .agent-project-field-chip-remove {
  opacity: 1;
  pointer-events: auto;
}

.agent-project-field-chip-remove:hover {
  background: rgba(30, 64, 175, 0.24);
}

.agent-chat-feed {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #f8fafc;
}

.agent-chat-empty {
  margin: auto;
  color: #94a3b8;
  font-size: 12px;
  font-weight: 600;
}

.agent-chat-message {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 90%;
}

.agent-chat-message.user {
  align-self: flex-end;
  align-items: flex-end;
}

.agent-chat-message.assistant {
  align-self: flex-start;
  align-items: flex-start;
}

.agent-chat-bubble {
  border-radius: 12px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  color: #1e293b;
  padding: 8px 10px;
  box-shadow: 0 4px 12px rgba(112, 144, 176, 0.14);
}

.agent-chat-message.user .agent-chat-bubble {
  background: #1058ff;
  border-color: #1058ff;
  color: #ffffff;
}

.agent-chat-bubble.thinking {
  display: inline-flex;
  align-items: center;
  padding: 10px 12px;
}

.agent-chat-thinking-text {
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1px;
  animation: agentThinkingPulse 1.1s ease-in-out infinite;
}

.agent-chat-text {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.35;
  font-size: 12px;
}

.agent-chat-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 6px;
}

.agent-chat-attachment-chip {
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

.agent-chat-attachment-chip:hover {
  border-color: #bfd5ff;
  color: #1058ff;
}

.agent-chat-time {
  color: #94a3b8;
  font-size: 10px;
  font-weight: 600;
}

.agent-chat-composer {
  border-top: 1px solid #e8edf7;
  padding: 10px;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.agent-chat-pending-uploads {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.agent-chat-upload-chip {
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

.agent-chat-upload-chip-remove {
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  line-height: 1;
}

.agent-chat-input-wrap {
  display: flex;
  align-items: stretch;
  border: 1px solid #dbe4f3;
  border-radius: 12px;
  background: #ffffff;
  padding: 4px 8px;
}

.agent-chat-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: #0f172a;
  font-size: 13px;
  line-height: 1.35;
  padding: 6px;
  resize: none;
  max-height: 176px;
  overflow-y: auto;
}

.agent-chat-input::placeholder {
  color: #94a3b8;
}

.agent-chat-input:disabled {
  color: #64748b;
  cursor: wait;
}

.agent-chat-tools {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  border-top: 1px solid #e8edf7;
  padding-top: 7px;
}

.agent-chat-tools-left {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-self: start;
}

.agent-chat-clear-tool {
  justify-self: center;
}

.agent-chat-tools-send {
  justify-self: end;
}

.agent-chat-tool-btn {
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

.agent-chat-tool-btn svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.agent-chat-tool-btn:hover {
  color: #1058ff;
  border-color: #bfd5ff;
  background: #eef4ff;
}

.agent-chat-tool-btn.active,
.agent-chat-tool-btn.send {
  color: #ffffff;
  background: #1058ff;
  border-color: #1058ff;
}

.agent-chat-tool-btn:disabled {
  opacity: 0.58;
  cursor: not-allowed;
}

.agent-chat-tool-btn:disabled:hover {
  color: #6b7a91;
  border-color: #dbe4f3;
  background: #ffffff;
}

.agent-chat-tool-btn.send:disabled,
.agent-chat-tool-btn.send:disabled:hover {
  color: #ffffff;
  border-color: #1058ff;
  background: #1058ff;
  opacity: 0.65;
}

.agent-chat-hidden-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

.agent-chat-confirm-overlay {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px;
  z-index: 12;
}

.agent-chat-confirm-dialog {
  width: min(340px, 100%);
  border-radius: 14px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  padding: 14px;
  box-shadow: 0 18px 32px rgba(15, 23, 42, 0.24);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.agent-chat-confirm-title {
  margin: 0;
  color: #0f172a;
  font-size: 14px;
  font-weight: 700;
}

.agent-chat-confirm-text {
  margin: 0;
  color: #475569;
  font-size: 12px;
  line-height: 1.4;
}

.agent-chat-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.agent-chat-confirm-btn {
  min-height: 30px;
  border-radius: 8px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  color: #475569;
  font-size: 12px;
  font-weight: 700;
  padding: 0 12px;
  cursor: pointer;
}

.agent-chat-confirm-btn-cancel:hover {
  border-color: #bfd5ff;
  color: #1058ff;
  background: #eef4ff;
}

.agent-chat-confirm-btn-danger {
  border-color: #f8c6c6;
  color: #b91c1c;
  background: #fff3f3;
}

.agent-chat-confirm-btn-danger:hover {
  border-color: #f39a9a;
  background: #ffe3e3;
}

@keyframes agentThinkingPulse {
  0%,
  100% {
    opacity: 0.45;
  }
  50% {
    opacity: 1;
  }
}

@media (max-width: 700px) {
  .agent-chat-panel {
    right: calc(10px + env(safe-area-inset-right, 0px));
    bottom: calc(10px + env(safe-area-inset-bottom, 0px) + var(--synapse-vv-bottom-offset, 0px));
    width: calc(100vw - 20px);
    min-width: 280px;
    min-height: 320px;
  }

  .agent-chat-dock {
    right: calc(10px + env(safe-area-inset-right, 0px));
    bottom: calc(10px + env(safe-area-inset-bottom, 0px) + var(--synapse-vv-bottom-offset, 0px));
  }
}
</style>
