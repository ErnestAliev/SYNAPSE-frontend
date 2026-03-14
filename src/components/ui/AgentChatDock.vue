<script setup lang="ts">
import axios from 'axios';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useEntitiesStore } from '../../stores/entities';
import type { Entity, EntityType } from '../../types/entity';
import { apiClient } from '../../services/api';
import { useUnifiedVoiceInput } from '../../composables/useUnifiedVoiceInput';

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

interface ProjectContextBuildPreviewResponse {
  timestamp?: string;
  scope?: Record<string, unknown>;
  input?: Record<string, unknown>;
  prompts?: Record<string, unknown>;
  builderContext?: Record<string, unknown>;
  fallbackPreview?: Record<string, unknown>;
  savedProjectContext?: Record<string, unknown>;
}

interface AgentChatHistoryResponse {
  scopeKey?: string;
  messages?: unknown;
  updatedAt?: string | null;
}

type ProjectContextUiState = 'never_built' | 'building' | 'fresh' | 'stale' | 'failed';

const STORAGE_KEY = 'synapse12.agent-chat.v2';
const PANEL_SIZE_STORAGE_KEY = 'synapse12.agent-chat.panel-size.v1';
const PANEL_TOP_OFFSET_PX = 60;
const AI_ATTACHMENT_MAX_INLINE_BYTES = 2_000_000;
const AI_ATTACHMENT_MAX_INLINE_DATA_URL_LENGTH = 2_800_000;
const AGENT_CHAT_REQUEST_TIMEOUT_MS = 180_000;
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
const PROJECT_DESCRIPTION_MAX_LENGTH = 7000;
const PROJECT_FIELD_DEFAULT_MAX_LENGTH = 96;
const PROJECT_FIELD_LINK_MAX_LENGTH = 2048;

const route = useRoute();
const entitiesStore = useEntitiesStore();

const isOpen = ref(false);
const messageDraft = ref('');
const pendingUploads = ref<EntityAttachment[]>([]);
const isSending = ref(false);
const isPreparingLlmLog = ref(false);
const isResizingPanel = ref(false);
const isClearHistoryConfirmOpen = ref(false);
const isChatToolsMenuOpen = ref(false);
const isProjectProfileExpanded = ref(false);
const isBuildingProjectContext = ref(false);
const projectContextBuildError = ref('');
const projectFieldDrafts = ref<Record<ProjectProfileFieldKey, string>>(buildProjectFieldDrafts());
const projectFieldInputRefs = ref<Partial<Record<ProjectProfileFieldKey, HTMLInputElement | null>>>({});
const projectEditingFieldValue = ref<{ fieldKey: ProjectProfileFieldKey; originalValue: string } | null>(null);
const projectDescriptionHeightPx = ref(0);
const isProjectDescriptionResizing = ref(false);
const projectDescriptionResizePointerId = ref<number | null>(null);
const projectDescriptionResizeStart = ref<{ clientY: number; height: number } | null>(null);

const chatFeedRef = ref<HTMLElement | null>(null);
const chatInputRef = ref<HTMLTextAreaElement | null>(null);
const docInputRef = ref<HTMLInputElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const projectDescriptionTextareaRef = ref<HTMLTextAreaElement | null>(null);
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

const voiceInput = useUnifiedVoiceInput({
  language: 'ru',
  onTextReady: (transcript) => {
    messageDraft.value = voiceInput.mergeWithCurrentDraft(messageDraft.value, transcript);
    void nextTick(() => {
      autoResizeComposer();
    });
  },
});
const voiceState = computed(() => voiceInput.state.value);

function toProfile(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

function buildProjectContextCanvasSignature(project: Entity | null) {
  const canvas = toProfile(project?.canvas_data);
  const nodes = (Array.isArray(canvas.nodes) ? canvas.nodes : [])
    .map((node) => {
      const row = toProfile(node);
      const id = typeof row.id === 'string' ? row.id.trim() : '';
      const entityId = typeof row.entityId === 'string' ? row.entityId.trim() : '';
      if (!id || !entityId) return null;
      return {
        id,
        entityId,
      };
    })
    .filter((row): row is { id: string; entityId: string } => Boolean(row))
    .sort((left, right) => left.id.localeCompare(right.id));
  const edges = (Array.isArray(canvas.edges) ? canvas.edges : [])
    .map((edge) => {
      const row = toProfile(edge);
      const source = typeof row.source === 'string' ? row.source.trim() : '';
      const target = typeof row.target === 'string' ? row.target.trim() : '';
      if (!source || !target) return null;
      return {
        id: typeof row.id === 'string' ? row.id.trim() : '',
        source,
        target,
        label: typeof row.label === 'string' ? row.label.trim() : '',
        color: typeof row.color === 'string' ? row.color.trim() : '',
        arrowLeft: row.arrowLeft === true,
        arrowRight: row.arrowRight === true,
      };
    })
    .filter((row): row is {
      id: string;
      source: string;
      target: string;
      label: string;
      color: string;
      arrowLeft: boolean;
      arrowRight: boolean;
    } => Boolean(row))
    .sort((left, right) => {
      const leftKey = `${left.id}|${left.source}|${left.target}|${left.label}`;
      const rightKey = `${right.id}|${right.source}|${right.target}|${right.label}`;
      return leftKey.localeCompare(rightKey);
    });
  const groups = (Array.isArray(canvas.groups) ? canvas.groups : [])
    .map((group) => {
      const row = toProfile(group);
      const id = typeof row.id === 'string' ? row.id.trim() : '';
      if (!id) return null;
      const nodeIds = (Array.isArray(row.nodeIds) ? row.nodeIds : [])
        .map((nodeId) => (typeof nodeId === 'string' ? nodeId.trim() : ''))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right));
      if (nodeIds.length < 2) return null;
      return { id, nodeIds };
    })
    .filter((row): row is { id: string; nodeIds: string[] } => Boolean(row))
    .sort((left, right) => left.id.localeCompare(right.id));

  const entityIds = nodes
    .map((node) => node.entityId)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  const entities = entityIds
    .map((entityId) => entitiesStore.byId(entityId))
    .filter((entity): entity is Entity => Boolean(entity))
    .map((entity) => {
      const metadata = toProfile(entity.ai_metadata);
      return {
        id: typeof entity._id === 'string' ? entity._id.trim() : '',
        type: typeof entity.type === 'string' ? entity.type.trim() : '',
        name: typeof entity.name === 'string' ? entity.name.trim() : '',
        description: typeof metadata.description === 'string' ? metadata.description.trim() : '',
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    project: {
      id: typeof project?._id === 'string' ? project._id.trim() : '',
      name: typeof project?.name === 'string' ? project.name.trim() : '',
      description: typeof toProfile(project?.ai_metadata).description === 'string'
        ? String(toProfile(project?.ai_metadata).description).trim()
        : '',
    },
    nodes,
    edges,
    groups,
    entities,
  };
}

function buildProjectContextSourceHash(project: Entity | null) {
  const text = JSON.stringify(buildProjectContextCanvasSignature(project));
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `ctx-${(hash >>> 0).toString(16).padStart(8, '0')}`;
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

function extractStandaloneChatLinks(message: string) {
  const normalizedMessage = message.trim();
  if (!normalizedMessage) return [] as string[];

  // Skip LLM only when the whole message is exactly one link token.
  if (/\s/.test(normalizedMessage)) return [] as string[];

  const token = normalizedMessage.replace(/^[('"[\{<]+/, '').replace(/[)\]}'">,.;!?]+$/, '');
  if (!token) return [] as string[];
  const normalizedLink = normalizeProjectLinkValue(token);
  if (!normalizedLink) return [] as string[];

  return [normalizedLink];
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
  if (typeof metadata.project_context_compiled_description === 'string' && metadata.project_context_compiled_description.trim()) {
    return metadata.project_context_compiled_description.trim();
  }
  return typeof metadata.description === 'string' ? metadata.description.trim() : '';
});

const projectAnalysisMap = computed(() => {
  const project = activeProjectEntity.value;
  if (!project) return {} as Record<string, unknown>;
  return toProfile(toProfile(project.ai_metadata).project_analysis_map);
});

const projectAnalysisEntityCount = computed(() => {
  const entities = Array.isArray(projectAnalysisMap.value.entities) ? projectAnalysisMap.value.entities : [];
  return entities.length;
});

const projectAnalysisConnectionCount = computed(() => {
  const connections = Array.isArray(projectAnalysisMap.value.connections) ? projectAnalysisMap.value.connections : [];
  return connections.length;
});

const projectAnalysisConfidence = computed(() => {
  const synthesis = toProfile(projectAnalysisMap.value.project_synthesis);
  const value = Number(synthesis.confidence);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
});

const projectContextCurrentHash = computed(() => {
  const project = activeProjectEntity.value;
  if (!project) return '';
  return buildProjectContextSourceHash(project);
});

const projectContextStoredHash = computed(() => {
  const project = activeProjectEntity.value;
  if (!project) return '';
  const metadata = toProfile(project.ai_metadata);
  return typeof metadata.project_context_source_hash === 'string' ? metadata.project_context_source_hash.trim() : '';
});

const projectContextBuiltAt = computed(() => {
  const project = activeProjectEntity.value;
  if (!project) return '';
  const metadata = toProfile(project.ai_metadata);
  return typeof metadata.project_context_built_at === 'string' ? metadata.project_context_built_at.trim() : '';
});

const projectContextState = computed<ProjectContextUiState>(() => {
  const project = activeProjectEntity.value;
  if (!project) return 'never_built';
  const metadata = toProfile(project.ai_metadata);
  const rawStatus = typeof metadata.project_context_status === 'string' ? metadata.project_context_status.trim() : '';
  if (isBuildingProjectContext.value || rawStatus === 'building') return 'building';
  const storedHash = projectContextStoredHash.value;
  const currentHash = projectContextCurrentHash.value;

  if (!storedHash) {
    return rawStatus === 'failed' ? 'failed' : 'never_built';
  }
  if (rawStatus === 'failed') return 'failed';
  if (storedHash !== currentHash) return 'stale';
  return 'fresh';
});

const projectContextButtonLabel = computed(() => {
  if (projectContextState.value === 'building') return 'Сборка...';
  if (projectContextState.value === 'never_built') return 'Собрать контекст';
  return 'Обновить контекст';
});

const projectContextStatusLabel = computed(() => {
  if (projectContextState.value === 'building') return 'Контекст собирается';
  if (projectContextState.value === 'fresh') return 'Контекст актуален';
  if (projectContextState.value === 'stale') return 'Контекст устарел';
  if (projectContextState.value === 'failed') return 'Сборка не удалась';
  return 'Контекст не собран';
});

const projectDescriptionTextareaStyle = computed(() => {
  if (!projectDescriptionHeightPx.value) return undefined;
  return {
    height: `${projectDescriptionHeightPx.value}px`,
  };
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

function getProjectDescriptionResizeBounds() {
  const minHeight = 54;
  const viewportHeightValue = typeof window !== 'undefined' ? window.innerHeight : 900;
  const maxHeight = Math.max(260, Math.floor(viewportHeightValue * 0.8));
  return { minHeight, maxHeight };
}

function applyProjectDescriptionHeight(nextHeight: number) {
  const { minHeight, maxHeight } = getProjectDescriptionResizeBounds();
  projectDescriptionHeightPx.value = Math.max(minHeight, Math.min(maxHeight, Math.round(nextHeight)));
}

function syncProjectDescriptionHeight(force = false) {
  const textarea = projectDescriptionTextareaRef.value;
  if (!textarea) return;
  if (projectDescriptionHeightPx.value && !force) return;

  const { minHeight } = getProjectDescriptionResizeBounds();
  projectDescriptionHeightPx.value = Math.max(minHeight, Math.round(textarea.getBoundingClientRect().height || minHeight));
}

function stopProjectDescriptionResize() {
  if (!isProjectDescriptionResizing.value && !projectDescriptionResizeStart.value) return;
  isProjectDescriptionResizing.value = false;
  projectDescriptionResizePointerId.value = null;
  projectDescriptionResizeStart.value = null;
  if (typeof window === 'undefined') return;
  window.removeEventListener('pointermove', onProjectDescriptionResizePointerMove);
  window.removeEventListener('pointerup', onProjectDescriptionResizePointerUp);
  window.removeEventListener('pointercancel', onProjectDescriptionResizePointerUp);
}

function onProjectDescriptionResizePointerMove(event: PointerEvent) {
  if (!isProjectDescriptionResizing.value || !projectDescriptionResizeStart.value) return;
  if (
    projectDescriptionResizePointerId.value !== null &&
    event.pointerId !== projectDescriptionResizePointerId.value
  ) {
    return;
  }

  if (event.cancelable) {
    event.preventDefault();
  }

  const deltaY = event.clientY - projectDescriptionResizeStart.value.clientY;
  applyProjectDescriptionHeight(projectDescriptionResizeStart.value.height + deltaY);
}

function onProjectDescriptionResizePointerUp(event: PointerEvent) {
  if (!isProjectDescriptionResizing.value) return;
  if (
    projectDescriptionResizePointerId.value !== null &&
    event.pointerId !== projectDescriptionResizePointerId.value
  ) {
    return;
  }

  stopProjectDescriptionResize();
}

function onProjectDescriptionResizePointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  if (event.cancelable) {
    event.preventDefault();
  }
  event.stopPropagation();

  const textarea = projectDescriptionTextareaRef.value;
  if (!textarea) return;

  const currentHeight =
    projectDescriptionHeightPx.value ||
    Math.max(getProjectDescriptionResizeBounds().minHeight, Math.round(textarea.getBoundingClientRect().height));

  projectDescriptionResizeStart.value = {
    clientY: event.clientY,
    height: currentHeight,
  };
  projectDescriptionResizePointerId.value = event.pointerId;
  isProjectDescriptionResizing.value = true;

  if (typeof window !== 'undefined') {
    window.addEventListener('pointermove', onProjectDescriptionResizePointerMove, { passive: false });
    window.addEventListener('pointerup', onProjectDescriptionResizePointerUp);
    window.addEventListener('pointercancel', onProjectDescriptionResizePointerUp);
  }
}

function onProjectDescriptionViewportResize() {
  if (!projectDescriptionHeightPx.value) return;
  applyProjectDescriptionHeight(projectDescriptionHeightPx.value);
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

void extractStandaloneChatLinks;
void getProjectLinkChipLabel;
void getProjectFieldPlaceholder;
void projectProfileFilledFieldCount;
void setProjectFieldInputRef;
void onProjectFieldDraftInput;
void onProjectFieldDraftKeydown;
void startEditProjectFieldValue;
void addProjectFieldValue;
void removeProjectFieldValue;
void openProjectFieldLink;

function buildProjectMetadataResetPatch() {
  const clearedFields = Object.fromEntries(PROJECT_PROFILE_FIELD_KEYS.map((fieldKey) => [fieldKey, []]));
  return {
    ...clearedFields,
    description: '',
    project_context_compiled_description: '',
    project_analysis_map: {},
    project_context_last_build_log: {},
    text_input: '',
    voice_input: '',
    documents: [],
    chat_history: [],
    description_history: [],
    description_meta: {},
    importance_history: [],
    ai_last_analysis: {},
    importance_source: 'auto',
    project_context_status: '',
    project_context_source_hash: '',
    project_context_built_at: '',
    project_context_version: 0,
    project_context_error: '',
    project_context_summary: '',
    project_context_change_reason: '',
    project_context_missing: [],
    project_context_build_mode: '',
    project_context_last_llm_error: '',
    project_context_entity_count: 0,
    project_context_connection_count: 0,
    project_context_group_count: 0,
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
    debug: false,
  }, {
    timeout: AGENT_CHAT_REQUEST_TIMEOUT_MS,
  });

  return {
    reply: typeof data.reply === 'string' ? data.reply.trim() : '',
  };
}

async function requestAssistantDebugReply(args: {
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
    monitorMode: true,
  }, {
    timeout: AGENT_CHAT_REQUEST_TIMEOUT_MS,
  });

  return data;
}

async function requestProjectContextBuildPreview(projectId: string) {
  const { data } = await apiClient.post<ProjectContextBuildPreviewResponse>('/ai/project-context/preview', {
    projectId,
  }, {
    timeout: AGENT_CHAT_REQUEST_TIMEOUT_MS,
  });

  return data;
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
    isChatToolsMenuOpen.value = false;
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
    isChatToolsMenuOpen.value = false;
    stopHistoryPolling();
    voiceInput.cancelRecording();
    pendingUploads.value = [];
    isPanelMaximized.value = false;
    lastTitleTapAt.value = 0;
    touchResizeMoved.value = false;
  }
}

type AgentChatToolsActionKey =
  | 'import-documents'
  | 'copy-structure'
  | 'export-txt'
  | 'download-project-context-log'
  | 'download-chat-llm-log'
  | 'clear-history';

function closeChatToolsMenu() {
  isChatToolsMenuOpen.value = false;
}

function toggleChatToolsMenu() {
  if (isSending.value || isPreparingLlmLog.value) return;
  isChatToolsMenuOpen.value = !isChatToolsMenuOpen.value;
}

function onChatToolsAction(actionKey: AgentChatToolsActionKey) {
  closeChatToolsMenu();
  if (actionKey === 'import-documents') {
    docInputRef.value?.click();
    return;
  }
  if (actionKey === 'copy-structure') {
    void copyScopeAsStructuredText().catch(() => {
      // Clipboard access can be blocked by browser policy.
    });
    return;
  }
  if (actionKey === 'export-txt') {
    exportScopeAsTextFile();
    return;
  }
  if (actionKey === 'download-project-context-log') {
    void downloadProjectContextBuildLog();
    return;
  }
  if (actionKey === 'download-chat-llm-log') {
    void downloadChatLlmLog();
    return;
  }
  openClearHistoryConfirm();
}

function openClearHistoryConfirm() {
  closeChatToolsMenu();
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

async function buildProjectContext() {
  const project = activeProjectEntity.value;
  if (!project || isBuildingProjectContext.value) return;

  isProjectProfileExpanded.value = true;
  isBuildingProjectContext.value = true;
  projectContextBuildError.value = '';

  try {
    await entitiesStore.flushQueuedEntityUpdate(project._id);
    const { data } = await apiClient.post<{ entity?: Entity }>('/ai/project-context/build', {
      projectId: project._id,
    }, {
      timeout: AGENT_CHAT_REQUEST_TIMEOUT_MS,
    });

    if (data?.entity?._id) {
      entitiesStore.upsertEntityFromRealtime(data.entity);
    }
  } catch (error) {
    projectContextBuildError.value = formatApiError(error);
  } finally {
    isBuildingProjectContext.value = false;
  }
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
  closeChatToolsMenu();

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
  voiceInput.markTextConsumed();
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
    if (aiResponse.reply) {
      pushMessage('assistant', aiResponse.reply, [], activeScopeKey);
    } else {
      pushMessage('assistant', 'Недостаточно данных в текущем контексте.', [], activeScopeKey);
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
  if (voiceInput.state.value === 'recording' || voiceInput.state.value === 'transcribing') return;
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

async function onVoiceToggle() {
  if (voiceInput.state.value === 'transcribing') return;
  if (voiceInput.state.value === 'recording') {
    voiceInput.cancelRecording();
    return;
  }
  await voiceInput.startRecording();
}

async function onVoiceConfirm() {
  if (voiceInput.state.value !== 'recording') return;
  await voiceInput.finishRecording();
}

function toDisplayTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function toDisplayDateTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function sanitizeFileNamePart(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildScopeStructuredText() {
  const lines: string[] = [];

  if (routeScopeType.value === 'project-canvas') {
    const projectName = activeProjectEntity.value?.name?.trim() || 'Без названия';
    lines.push(`Проект - "${projectName}"`);
    lines.push('');
    lines.push('Описание');
    lines.push(projectProfileDescription.value || '—');
    const synthesis = toProfile(projectAnalysisMap.value.project_synthesis);
    const synthesisLines = [
      typeof synthesis.main_goal === 'string' ? synthesis.main_goal.trim() : '',
      typeof synthesis.main_bottleneck === 'string' ? synthesis.main_bottleneck.trim() : '',
      typeof synthesis.next_focus === 'string' ? synthesis.next_focus.trim() : '',
    ].filter(Boolean);
    if (synthesisLines.length) {
      lines.push('');
      lines.push('Синтез');
      for (const line of synthesisLines) {
        lines.push(`- ${line}`);
      }
    }
  } else {
    lines.push(scopeTitle.value);
    lines.push(scopeSummary.value);
  }

  lines.push('');
  lines.push('Чат');
  if (!scopedMessages.value.length) {
    lines.push('—');
    return lines.join('\n');
  }

  for (const message of scopedMessages.value) {
    const roleLabel = message.role === 'assistant' ? 'Ассистент' : 'Пользователь';
    const text = message.text.trim() || (message.attachments.length ? 'Вложение' : '—');
    const timeLabel = toDisplayTime(message.createdAt);
    const prefix = timeLabel ? `[${timeLabel}] ` : '';
    lines.push(`${prefix}${roleLabel}: ${text}`);

    if (message.attachments.length) {
      const files = message.attachments
        .map((attachment) => attachment.name.trim() || 'Файл')
        .join(', ');
      lines.push(`Файлы: ${files}`);
    }
  }

  return lines.join('\n');
}

function buildScopeExportFileName() {
  if (routeScopeType.value === 'project-canvas') {
    const projectName = activeProjectEntity.value?.name?.trim() || 'Без названия';
    return `Проект - ${sanitizeFileNamePart(projectName) || 'Без названия'}.txt`;
  }

  const label = ENTITY_TYPE_LABELS[collectionType.value] || 'Коллекция';
  return `${sanitizeFileNamePart(label) || 'Коллекция'} - LLM чат.txt`;
}

async function writeTextToClipboard(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof window === 'undefined') {
    throw new Error('Clipboard unavailable');
  }

  const textarea = window.document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  window.document.body.appendChild(textarea);
  textarea.select();
  const copied = window.document.execCommand('copy');
  window.document.body.removeChild(textarea);
  if (!copied) {
    throw new Error('Clipboard unavailable');
  }
}

async function copyScopeAsStructuredText() {
  const text = buildScopeStructuredText();
  if (!text.trim()) return;
  await writeTextToClipboard(text);
}

function exportScopeAsTextFile() {
  if (typeof window === 'undefined') return;
  const text = buildScopeStructuredText();
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = buildScopeExportFileName();
  window.document.body.appendChild(anchor);
  anchor.click();
  window.document.body.removeChild(anchor);
  window.URL.revokeObjectURL(objectUrl);
}

function downloadJsonFile(fileName: string, payload: unknown) {
  if (typeof window === 'undefined') return;
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  window.document.body.appendChild(anchor);
  anchor.click();
  window.document.body.removeChild(anchor);
  window.URL.revokeObjectURL(objectUrl);
}

function buildLlmLogFileName() {
  if (routeScopeType.value === 'project-canvas') {
    const projectName = sanitizeFileNamePart(activeProjectEntity.value?.name?.trim() || 'project');
    return `llm-context-log-${projectName || 'project'}-${Date.now()}.json`;
  }
  const label = sanitizeFileNamePart(ENTITY_TYPE_LABELS[collectionType.value] || 'collection');
  return `llm-context-log-${label || 'collection'}-${Date.now()}.json`;
}

function buildProjectContextLogFileName() {
  const projectName = sanitizeFileNamePart(activeProjectEntity.value?.name?.trim() || 'project');
  return `project-context-build-log-${projectName || 'project'}-${Date.now()}.json`;
}

async function downloadProjectContextBuildLog() {
  const project = activeProjectEntity.value;
  if (!project || isPreparingLlmLog.value || isSending.value) return;

  isPreparingLlmLog.value = true;
  try {
    await entitiesStore.flushQueuedEntityUpdate(project._id);
    const latestProject = entitiesStore.byId(project._id);
    const metadata = toProfile(latestProject?.ai_metadata);
    const savedBuildLog = toProfile(metadata.project_context_last_build_log);
    const hasSavedBuildLog = Object.keys(savedBuildLog).length > 0;

    if (hasSavedBuildLog) {
      downloadJsonFile(buildProjectContextLogFileName(), savedBuildLog);
      return;
    }

    const previewData = await requestProjectContextBuildPreview(project._id);
    downloadJsonFile(buildProjectContextLogFileName(), previewData);
  } catch (error) {
    pushMessage('assistant', `Не удалось скачать лог сборки контекста. ${formatApiError(error)}`);
  } finally {
    isPreparingLlmLog.value = false;
  }
}

async function downloadChatLlmLog() {
  if (isPreparingLlmLog.value || isSending.value) return;
  const activeScope = buildRequestScope();
  if (!activeScope) {
    pushMessage('assistant', 'Не удалось определить контекст для LLM-лога.');
    return;
  }

  const activeScopeKey = scopeKey.value;
  const historyPayload = buildHistoryPayload(messagesByScope.value[activeScopeKey] || []);
  const draftMessage = messageDraft.value.trim();
  const attachments = [...pendingUploads.value];
  if (!draftMessage) {
    pushMessage('assistant', 'Введите вопрос в поле чата, чтобы скачать лог чата с полным запросом и ответом.');
    return;
  }

  isPreparingLlmLog.value = true;
  try {
    const debugData = await requestAssistantDebugReply({
      scope: activeScope,
      message: draftMessage,
      history: historyPayload,
      attachments,
    });

    downloadJsonFile(buildLlmLogFileName(), {
      exportedAt: getIsoNow(),
      source: 'agent-chat-menu-dropdown.chat-debug',
      scope: activeScope,
      currentDraft: draftMessage,
      history: historyPayload,
      pendingAttachments: buildAttachmentsPayload(attachments),
      response: debugData,
    });
  } catch (error) {
    pushMessage('assistant', `Не удалось скачать LLM лог. ${formatApiError(error)}`);
  } finally {
    isPreparingLlmLog.value = false;
  }
}

watch(
  scopeKey,
  (nextScopeKey) => {
    isChatToolsMenuOpen.value = false;
    messageDraft.value = '';
    pendingUploads.value = [];
    isProjectProfileExpanded.value = false;
    isBuildingProjectContext.value = false;
    projectContextBuildError.value = '';
    resetProjectProfileLocally();
    voiceInput.cancelRecording();
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
  () => activeProjectEntity.value?._id || '',
  () => {
    isBuildingProjectContext.value = false;
    projectContextBuildError.value = '';
    projectDescriptionHeightPx.value = 0;
    stopProjectDescriptionResize();
    resetProjectProfileLocally();
    void nextTick(() => {
      syncProjectDescriptionHeight(true);
    });
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
  window.addEventListener('resize', onProjectDescriptionViewportResize);
  window.addEventListener('orientationchange', onProjectDescriptionViewportResize);
  window.visualViewport?.addEventListener('resize', onProjectDescriptionViewportResize);
  void nextTick(() => {
    syncProjectDescriptionHeight(true);
  });
});

onBeforeUnmount(() => {
  stopPanelResize();
  stopHistoryPolling();
  voiceInput.cancelRecording();
  stopProjectDescriptionResize();
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
  window.removeEventListener('resize', onProjectDescriptionViewportResize);
  window.removeEventListener('orientationchange', onProjectDescriptionViewportResize);
  window.visualViewport?.removeEventListener('resize', onProjectDescriptionViewportResize);
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
        <div class="agent-project-context-toolbar agent-project-context-toolbar-visible">
          <div
            class="agent-project-context-status"
            :class="[`state-${projectContextState}`]"
          >
            <span class="agent-project-context-status-dot" aria-hidden="true"></span>
            <span>{{ projectContextStatusLabel }}</span>
            <span v-if="projectContextBuiltAt" class="agent-project-context-built-at">
              {{ toDisplayDateTime(projectContextBuiltAt) }}
            </span>
          </div>
          <button
            type="button"
            class="agent-project-context-build-btn"
            :disabled="isBuildingProjectContext"
            @click="void buildProjectContext()"
          >
            {{ projectContextButtonLabel }}
          </button>
        </div>

        <p v-if="projectContextBuildError" class="agent-project-context-error agent-project-context-error-visible">
          {{ projectContextBuildError }}
        </p>

        <button
          type="button"
          class="agent-project-profile-toggle"
          :class="{ expanded: isProjectProfileExpanded }"
          @click="isProjectProfileExpanded = !isProjectProfileExpanded"
        >
          <span class="agent-project-profile-title">Контекст проекта</span>
          <span class="agent-project-profile-count">
            {{ projectAnalysisEntityCount }} сущн. / {{ projectAnalysisConnectionCount }} связей
          </span>
          <span class="agent-project-profile-chevron" aria-hidden="true"></span>
        </button>

        <div v-show="isProjectProfileExpanded" class="agent-project-profile-body">
          <textarea
            ref="projectDescriptionTextareaRef"
            class="agent-project-description-input"
            :style="projectDescriptionTextareaStyle"
            rows="2"
            maxlength="3000"
            :value="projectProfileDescription"
            placeholder="Описание"
            @input="onProjectDescriptionInput"
          />
          <div
            class="agent-project-description-resize-handle"
            title="Изменить высоту описания"
            @pointerdown="onProjectDescriptionResizePointerDown"
          />
          <div class="agent-project-analysis-meta">
            <span v-if="projectAnalysisConfidence > 0">Уверенность синтеза: {{ projectAnalysisConfidence }}%</span>
            <span v-if="projectContextBuiltAt">Последняя сборка: {{ toDisplayDateTime(projectContextBuiltAt) }}</span>
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
              class="agent-chat-menu-btn"
              :class="{ open: isChatToolsMenuOpen }"
              title="Меню действий"
              :disabled="isSending"
              @click="toggleChatToolsMenu"
            >
              <span>Меню</span>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m7 10 5 5 5-5" />
              </svg>
            </button>
            <input
              ref="docInputRef"
              type="file"
              class="agent-chat-hidden-input"
              multiple
              @change="onDocumentsChange"
            />

            <template v-if="isChatToolsMenuOpen">
              <div class="agent-chat-menu-backdrop" @click="closeChatToolsMenu" />
              <div class="agent-chat-menu-dropdown" @pointerdown.stop @click.stop>
                <p class="agent-chat-menu-label">Действия</p>
                <button
                  type="button"
                  class="agent-chat-menu-item"
                  :disabled="isSending"
                  @click="onChatToolsAction('import-documents')"
                >
                  Импорт документов
                </button>
                <button type="button" class="agent-chat-menu-item" @click="onChatToolsAction('copy-structure')">
                  Копировать структуру
                </button>
                <button type="button" class="agent-chat-menu-item" @click="onChatToolsAction('export-txt')">
                  Экспорт в TXT
                </button>
                <button
                  v-if="routeScopeType === 'project-canvas'"
                  type="button"
                  class="agent-chat-menu-item"
                  :disabled="isPreparingLlmLog || isSending"
                  @click="onChatToolsAction('download-project-context-log')"
                >
                  {{ isPreparingLlmLog ? 'Сборка лога...' : 'Скачать лог сборки контекста' }}
                </button>
                <button
                  type="button"
                  class="agent-chat-menu-item"
                  :disabled="isPreparingLlmLog || isSending"
                  @click="onChatToolsAction('download-chat-llm-log')"
                >
                  {{ isPreparingLlmLog ? 'Сборка лога...' : 'Скачать лог чата LLM' }}
                </button>
                <button type="button" class="agent-chat-menu-item" @click="onChatToolsAction('clear-history')">
                  {{ routeScopeType === 'project-canvas' ? 'Сбросить данные и чат' : 'Очистить историю' }}
                </button>
              </div>
            </template>
          </div>

          <button
            type="button"
            class="agent-chat-tool-btn mic"
            :class="{ active: voiceState === 'recording' }"
            :title="voiceState === 'recording' ? 'Остановить запись' : 'Голосовой ввод'"
            :disabled="
              isSending ||
              voiceState === 'transcribing' ||
              !voiceInput.isSupported
            "
            @click="onVoiceToggle"
          >
            <svg v-if="voiceState !== 'recording'" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 4a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3Z" />
              <path d="M19 11a7 7 0 0 1-14 0" />
              <path d="M12 18v3" />
              <path d="M8 21h8" />
            </svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 7l10 10" />
              <path d="M17 7 7 17" />
            </svg>
          </button>

          <div
            v-if="voiceState === 'recording' || voiceState === 'transcribing'"
            class="agent-chat-voice-state"
          >
            <div v-if="voiceState === 'recording'" class="agent-chat-voice-wave" aria-label="Идёт запись">
              <span
                v-for="(bar, index) in voiceInput.waveformBars"
                class="agent-chat-voice-bar"
                :key="`agent-voice-bar-${index}`"
                :style="{ height: `${bar}px` }"
              />
              <span class="agent-chat-voice-listening">Прослушиваю</span>
            </div>
            <div v-else class="agent-chat-voice-transcribing">
              <span class="agent-chat-voice-spinner" />
              Расшифровываю...
            </div>
          </div>

          <button
            type="button"
            class="agent-chat-tool-btn send agent-chat-tools-send"
            :title="voiceState === 'recording' ? 'Завершить запись' : 'Отправить'"
            :disabled="
              isSending ||
              voiceState === 'transcribing' ||
              (voiceState !== 'recording' && !messageDraft.trim() && !pendingUploads.length)
            "
            @click="voiceState === 'recording' ? void onVoiceConfirm() : void sendMessage()"
          >
            <svg
              v-if="voiceState !== 'recording'"
              class="agent-chat-send-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M3 11.5 21 3l-7.5 18-2.6-7.1L3 11.5Z" />
            </svg>
            <svg v-else class="agent-chat-check-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </button>

        </div>
        <p v-if="voiceInput.errorMessage" class="agent-chat-voice-error">{{ voiceInput.errorMessage }}</p>
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

.agent-project-context-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.agent-project-context-toolbar-visible {
  padding: 8px 12px 6px;
  border-bottom: 1px solid #eff3fb;
}

.agent-project-context-status {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #475569;
  font-size: 11px;
  font-weight: 600;
}

.agent-project-context-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: currentColor;
  flex: 0 0 auto;
}

.agent-project-context-status.state-fresh {
  color: #15803d;
}

.agent-project-context-status.state-stale,
.agent-project-context-status.state-never_built {
  color: #b45309;
}

.agent-project-context-status.state-failed {
  color: #b91c1c;
}

.agent-project-context-status.state-building {
  color: #1058ff;
}

.agent-project-context-built-at {
  color: #94a3b8;
  font-weight: 500;
}

.agent-project-context-build-btn {
  border: 1px solid #cfe0ff;
  border-radius: 9px;
  background: #eef4ff;
  color: #1058ff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  padding: 7px 10px;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    color 0.16s ease;
}

.agent-project-context-build-btn:hover:not(:disabled) {
  border-color: #a9c6ff;
  background: #e3eeff;
}

.agent-project-context-build-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.agent-project-context-error {
  margin: 0;
  color: #b91c1c;
  font-size: 11px;
  line-height: 1.35;
}

.agent-project-context-error-visible {
  padding: 0 12px 8px;
}

.agent-project-description-input {
  width: 100%;
  min-height: 54px;
  max-height: none;
  overflow-y: auto;
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

.agent-project-description-resize-handle {
  width: 100%;
  height: 14px;
  margin-top: -6px;
  cursor: ns-resize;
  touch-action: none;
}

.agent-project-description-resize-handle::before {
  content: '';
  display: block;
  width: 44px;
  height: 4px;
  margin: 4px auto 0;
  border-radius: 999px;
  background: #cbd5e1;
}

.agent-project-analysis-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: #64748b;
  font-size: 11px;
  line-height: 1.35;
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
  grid-template-columns: minmax(0, 1fr) auto minmax(120px, 1fr) auto;
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
  position: relative;
}

.agent-chat-menu-btn {
  min-width: 88px;
  height: 34px;
  border-radius: 10px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  color: #334155;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition:
    color 0.16s ease,
    border-color 0.16s ease,
    background-color 0.16s ease;
}

.agent-chat-menu-btn svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 0.16s ease;
}

.agent-chat-menu-btn:hover,
.agent-chat-menu-btn.open {
  color: #1058ff;
  border-color: #bfd5ff;
  background: #eef4ff;
}

.agent-chat-menu-btn.open svg {
  transform: rotate(180deg);
}

.agent-chat-menu-btn:disabled,
.agent-chat-menu-btn:disabled:hover {
  opacity: 0.58;
  color: #9aa9c2;
  border-color: #dbe4f3;
  background: #f5f8ff;
  cursor: wait;
}

.agent-chat-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
}

.agent-chat-menu-dropdown {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  z-index: 41;
  min-width: 220px;
  max-width: min(280px, calc(100vw - 24px));
  border: 1px solid #dbe4f3;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 16px 32px rgba(15, 23, 42, 0.18);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.agent-chat-menu-label {
  margin: 0;
  padding: 5px 8px 6px;
  font-size: 10px;
  line-height: 1;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #94a3b8;
}

.agent-chat-menu-item {
  width: 100%;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #1e293b;
  text-align: left;
  padding: 8px 9px;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.3;
  cursor: pointer;
  transition: background 0.13s ease, color 0.13s ease;
}

.agent-chat-menu-item:hover:not(:disabled) {
  background: #eef4ff;
  color: #1058ff;
}

.agent-chat-menu-item:disabled,
.agent-chat-menu-item:disabled:hover {
  cursor: wait;
  opacity: 0.55;
  background: transparent;
  color: #94a3b8;
}

.agent-chat-tools-send {
  justify-self: end;
}

.agent-chat-tool-btn {
  width: 40px;
  height: 40px;
  border-radius: 999px;
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
    background-color 0.16s ease,
    transform 0.16s ease;
}

.agent-chat-tool-btn svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.agent-chat-tool-btn:hover {
  transform: translateY(-1px);
}

.agent-chat-tool-btn.mic {
  position: relative;
  justify-self: center;
  color: #ffffff;
  border-color: #1058ff;
  background: #1058ff;
}

.agent-chat-tool-btn.mic.active {
  border-color: #d92d20;
  background: #d92d20;
}

.agent-chat-tool-btn.mic.active::after {
  content: '';
  position: absolute;
  inset: -5px;
  border-radius: 999px;
  border: 2px solid rgba(217, 45, 32, 0.45);
  animation: agent-voice-record-pulse 1.2s ease-out infinite;
}

.agent-chat-tool-btn.send {
  color: #ffffff;
  background: #1058ff;
  border-color: #1058ff;
}

.agent-chat-send-icon {
  fill: currentColor;
  stroke: none;
}

.agent-chat-check-icon {
  fill: none;
  stroke: currentColor;
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.agent-chat-voice-state {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.agent-chat-voice-wave {
  height: 24px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.agent-chat-voice-bar {
  width: 4px;
  border-radius: 999px;
  background: linear-gradient(180deg, #1f6aff 0%, #1058ff 100%);
  transition: height 0.12s ease;
}

.agent-chat-voice-listening {
  margin-left: 4px;
  color: #1058ff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.agent-chat-voice-transcribing {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #475569;
  font-size: 11px;
  font-weight: 700;
}

.agent-chat-voice-spinner {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 2px solid rgba(16, 88, 255, 0.2);
  border-top-color: #1058ff;
  animation: agent-voice-spinner 0.7s linear infinite;
}

.agent-chat-voice-error {
  margin: 6px 0 0;
  color: #b42318;
  font-size: 12px;
}

.agent-chat-tool-btn:disabled {
  opacity: 0.58;
  cursor: wait;
  transform: none;
}

.agent-chat-tool-btn:disabled:hover {
  color: #9aa9c2;
  border-color: #dbe4f3;
  background: #f5f8ff;
}

.agent-chat-tool-btn.send:disabled,
.agent-chat-tool-btn.send:disabled:hover {
  color: #ffffff;
  border-color: #1058ff;
  background: #1058ff;
  opacity: 0.65;
}

@keyframes agent-voice-record-pulse {
  0% {
    opacity: 0.8;
    transform: scale(0.94);
  }
  70% {
    opacity: 0;
    transform: scale(1.15);
  }
  100% {
    opacity: 0;
    transform: scale(1.15);
  }
}

@keyframes agent-voice-spinner {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
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
