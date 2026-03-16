<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import ruEmojiData from 'emojibase-data/ru/data.json';
import AppIcon from '../ui/AppIcon.vue';
import ProfileProgressRing from '../ui/ProfileProgressRing.vue';
import EntityVoicePromptTooltip from './EntityVoicePromptTooltip.vue';
import { useEntitiesStore } from '../../stores/entities';
import { useAuthStore } from '../../stores/auth';
import { calculateEntityProfileProgress } from '../../utils/profileProgress';
import {
  analyzeEntityWithAi,
  isEntityAiProcessingResponse,
  prepareEntityLinkPreview,
  type EntityLinkPreviewResponse,
} from '../../services/entityAi';
import { useUnifiedVoiceInput } from '../../composables/useUnifiedVoiceInput';
import {
  SYSTEM_SOCIAL_LOGOS,
  addCustomLogo,
  createLogoKeywords,
  readCustomLogos,
  type LogoLibraryItem,
} from '../../data/logoLibrary';
import type {
  CanvasEdgeProjection,
  CanvasGroupProjection,
  CanvasNodeProjection,
  Entity,
  EntityType,
  ProjectCanvasData,
} from '../../types/entity';

const props = defineProps<{
  entityId: string;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
}>();

const ENTITY_SYNC_DELAY = 420;
const GRID_STEP = 40;
const PROJECT_INSERT_GAP = GRID_STEP * 3;
const FOOTER_CROP_VIEW_SIZE = 220;
const FOOTER_CROP_OUTPUT_SIZE = 512;
const AI_ATTACHMENT_MAX_INLINE_BYTES = 2_000_000;
const AI_ATTACHMENT_MAX_INLINE_DATA_URL_LENGTH = 2_800_000;
const CHAT_INPUT_MAX_HEIGHT_PX = 360;
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
const ENTITY_MINE_TOGGLE_LABELS: Partial<Record<EntityType, string>> = {
  person: 'Это я',
  company: 'Моя компания',
  project: 'Мой проект',
  resource: 'Мой ресурс',
  goal: 'Моя цель',
  task: 'Моя задача',
  event: 'Моё событие',
  result: 'Мой результат',
  shape: 'Моё',
};
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

interface EmojiRecord {
  emoji?: string;
  label?: string;
  tags?: string[];
}

interface EmojiItem {
  emoji: string;
  label: string;
  searchLabel: string;
  searchTags: string[];
}

interface ResourceLinkPreviewState extends EntityLinkPreviewResponse {
  mode: 'ready' | 'error';
  errorMessage: string;
}

type MetadataFieldKey =
  | 'tags'
  | 'markers'
  | 'phones'
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

const DEFAULT_METADATA_FIELD_MAX_LENGTH = 32;
const LINKS_METADATA_FIELD_MAX_LENGTH = 2048;
const PHONE_DISPLAY_MAX_LENGTH = 20; // + 7 926 123 45 67 = 17; +380501234567 = 13; headroom for intl
const PHONE_DIGITS_MAX_LENGTH = 15;  // ITU-T E.164 max is 15 digits
const LINK_CHIP_FALLBACK_LABEL = 'Website';
const IMPORTANCE_LEVELS = ['Низкая', 'Средняя', 'Высокая'] as const;
const IMPORTANCE_LEVEL_MAP: Record<string, (typeof IMPORTANCE_LEVELS)[number]> = {
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
  критично: 'Высокая',
  critical: 'Высокая',
};
const LINK_CHIP_LABELS: Array<{ label: string; domains: string[] }> = [
  { label: 'Instagram', domains: ['instagram.com'] },
  { label: 'Facebook', domains: ['facebook.com', 'fb.com'] },
  { label: 'LinkedIn', domains: ['linkedin.com'] },
  { label: 'Telegram', domains: ['t.me', 'telegram.me', 'telegram.org'] },
  { label: 'WhatsApp', domains: ['wa.me', 'whatsapp.com', 'chat.whatsapp.com'] },
  { label: 'YouTube', domains: ['youtube.com', 'youtu.be'] },
  { label: 'TikTok', domains: ['tiktok.com'] },
  { label: 'X', domains: ['x.com', 'twitter.com'] },
  { label: 'VK', domains: ['vk.com', 'vkontakte.ru'] },
  { label: 'GitHub', domains: ['github.com'] },
];

const ENTITY_CONTEXT_FIELDS: Record<EntityType, MetadataFieldConfig[]> = {
  connection: [
    { key: 'tags', label: 'Теги' },
    { key: 'markers', label: 'Метки' },
    { key: 'phones', label: 'Телефоны' },
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
    { key: 'resources', label: 'Ресурсы' },
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
const ALL_METADATA_FIELD_KEYS = Array.from(
  new Set(Object.values(ENTITY_CONTEXT_FIELDS).flatMap((fields) => fields.map((field) => field.key))),
) as MetadataFieldKey[];

const entitiesStore = useEntitiesStore();
const authStore = useAuthStore();
const router = useRouter();

const draft = ref<{
  entityId: string;
  name: string;
  type: EntityType;
  description: string;
  importanceSource: 'auto' | 'manual';
  metadataValues: Record<string, string[]>;
  fieldDrafts: Record<string, string>;
  textInput: string;
  voiceInput: string;
  documents: EntityAttachment[];
  pendingUploads: EntityAttachment[];
  chatHistory: EntityChatMessage[];
} | null>(null);

const docInputRef = ref<HTMLInputElement | null>(null);
const nameInputRef = ref<HTMLInputElement | null>(null);
const chatInputRef = ref<HTMLTextAreaElement | null>(null);
const descriptionTextareaRef = ref<HTMLTextAreaElement | null>(null);
const chatFeedRef = ref<HTMLElement | null>(null);
const infoSaveTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const pendingComposerHeightReset = ref(false);
const localAiRequestInFlight = ref(false);
const awaitingAiCompletionEntityId = ref('');
const awaitingAiCompletionStartedAtMs = ref(0);
const isResourceLinkPreviewLoading = ref(false);
const resourceLinkPreview = ref<ResourceLinkPreviewState | null>(null);
const isAiRequestInFlight = computed(() => {
  const entityId = draft.value?.entityId || currentEntity.value?._id;
  if (!entityId) return localAiRequestInFlight.value;
  const awaitingSameEntity = awaitingAiCompletionEntityId.value === entityId;
  const entityPending = Boolean(toProfile(currentEntity.value?.ai_metadata).analysis_pending);
  return (
    isResourceLinkPreviewLoading.value ||
    localAiRequestInFlight.value ||
    awaitingSameEntity ||
    entitiesStore.isEntityAiPending(entityId) ||
    entityPending
  );
});
const shouldShowAiThinking = computed(() => isAiRequestInFlight.value && !isResourceLinkPreviewLoading.value);

const isProjectAddConfirmOpen = ref(false);
const projectActionMessage = ref('');
const isProjectActionBusy = ref(false);
const isMineToggleBusy = ref(false);
const selectedProjectId = ref('');
const isDeleteConfirmOpen = ref(false);
const isChatClearConfirmOpen = ref(false);
const profileFooterOpen = ref(false);
const footerColorInputRef = ref<HTMLInputElement | null>(null);
const footerImageInputRef = ref<HTMLInputElement | null>(null);
const footerLogoInputRef = ref<HTMLInputElement | null>(null);
const footerEmojiOpen = ref(false);
const footerLogoOpen = ref(false);
const footerCropOpen = ref(false);
const footerEmojiQuery = ref('');
const footerLogoQuery = ref('');
const footerCustomLogos = ref<LogoLibraryItem[]>([]);
const footerCustomLogoName = ref('');
const footerLogoUploadError = ref('');
const footerCropError = ref('');
const footerCropImageSrc = ref('');
const footerCropScale = ref(1);
const footerCropOffsetX = ref(0);
const footerCropOffsetY = ref(0);
const footerCropNaturalWidth = ref(0);
const footerCropNaturalHeight = ref(0);
const footerCropPointer = ref<{
  id: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
} | null>(null);
const isFooterCropBusy = ref(false);
const fieldInputRefs = ref<Record<string, HTMLInputElement | null>>({});
const editingFieldValue = ref<{ fieldKey: string; originalValue: string } | null>(null);
const descriptionHeightPx = ref<number | null>(null);
const isDescriptionResizing = ref(false);
const descriptionResizePointerId = ref<number | null>(null);
const descriptionResizeStart = ref<{ clientY: number; height: number } | null>(null);
const isFieldsListExpanded = ref(false);

const voiceInput = useUnifiedVoiceInput({
  language: 'ru',
  onTextReady: (transcript) => {
    if (!draft.value) return;
    const mergedText = voiceInput.mergeWithCurrentDraft(draft.value.textInput, transcript);
    draft.value.textInput = mergedText;
    draft.value.voiceInput = mergedText;
    void nextTick(() => {
      autoResizeChatInput();
    });
    scheduleSave();
  },
});
const isVoiceRecording = computed(() => voiceInput.state.value === 'recording');
const isVoiceTranscribing = computed(() => voiceInput.state.value === 'transcribing');
const isVoiceBusy = computed(() => isVoiceRecording.value || isVoiceTranscribing.value);

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

function imageFromProfile(profile: Record<string, unknown>) {
  const raw = profile.image;
  return typeof raw === 'string' ? raw.trim() : '';
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

function closeFooterPanels() {
  footerEmojiOpen.value = false;
  footerLogoOpen.value = false;
  footerCropOpen.value = false;
  footerCropError.value = '';
  footerCropPointer.value = null;
}

function closeProfileFooter() {
  profileFooterOpen.value = false;
  closeFooterPanels();
}

function toggleProfileFooter() {
  profileFooterOpen.value = !profileFooterOpen.value;
  if (!profileFooterOpen.value) {
    closeFooterPanels();
  }
}

function onModalPointerDown(event: PointerEvent) {
  if (!profileFooterOpen.value) return;

  const target = event.target as HTMLElement | null;
  if (!target) return;

  if (target.closest('.profile-progress-content')) return;
  if (target.closest('.entity-info-menu-footer')) return;

  closeProfileFooter();
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function toMetadataStringArray(value: unknown) {
  if (typeof value === 'string') {
    return value.trim() ? [value.trim()] : [];
  }
  return toStringArray(value);
}

function normalizePhoneDigits(value: string) {
  let digits = value.replace(/\D/g, '');
  if (!digits) return '';

  // Convenience: bare 10-digit Russian local number → prepend country code 7
  if (digits.length === 10 && !digits.startsWith('7')) {
    digits = `7${digits}`;
  }
  // Russian/CIS convention: leading 8 is an alias for country code 7
  if (digits.startsWith('8') && digits.length === 11) {
    digits = `7${digits.slice(1)}`;
  }
  // NOTE: no catch-all "replace first digit with 7" — that was incorrectly
  // corrupting international numbers (e.g. +380…) by dropping the first digit.

  // Russian/Kazakh (7-prefix): strictly 11 digits. The formatter only renders
  // 1 country code + 10 local digits, so capping here prevents silent truncation
  // where extra digits appear in the input but disappear from the formatted value.
  // International numbers: allow up to ITU-T E.164 max of 15 digits.
  const maxLen = digits.startsWith('7') ? 11 : PHONE_DIGITS_MAX_LENGTH;
  if (digits.length > maxLen) {
    digits = digits.slice(0, maxLen);
  }
  return digits;
}

function formatPhoneValue(value: string) {
  const digits = normalizePhoneDigits(value);
  if (!digits) return '';

  // Russian/Kazakhstan (country code 7): format as + 7 XXX XXX XX XX
  if (digits.startsWith('7')) {
    const countryCode = digits.slice(0, 1);
    const local = digits.slice(1);
    const parts = [local.slice(0, 3), local.slice(3, 6), local.slice(6, 8), local.slice(8, 10)].filter(Boolean);
    return parts.length ? `+ ${countryCode} ${parts.join(' ')}` : `+ ${countryCode}`;
  }

  // International numbers: store as +<digits> without reformatting
  return `+${digits}`;
}

function normalizeMetadataValue(fieldKey: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (fieldKey === 'phones') {
    return formatPhoneValue(trimmed);
  }
  if (fieldKey === 'links') {
    return normalizeLinkMetadataValue(trimmed);
  }
  return trimmed;
}

function normalizeLinkMetadataValue(rawValue: string) {
  const raw = rawValue.trim();
  if (!raw) return '';
  const hasExplicitScheme = /^https?:\/\//i.test(raw);
  const hasWwwPrefix = /^www\./i.test(raw);
  const hasDotHint = raw.includes('.');
  if (!hasExplicitScheme && !hasWwwPrefix && !hasDotHint) {
    return '';
  }
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    if (!url.hostname || !url.protocol.startsWith('http')) return '';
    const host = url.hostname.toLowerCase();
    const hasDotHost = host.includes('.');
    if (!hasDotHost) return '';
    if (host === 'localhost') return '';
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return '';
    if (host.includes(':')) return '';

    const hostParts = host.split('.').filter(Boolean);
    const tld = hostParts[hostParts.length - 1] || '';
    const hasLetterTld = /[a-z]/i.test(tld) && tld.length >= 2;
    if (!hasExplicitScheme && !hasWwwPrefix && !hasLetterTld) return '';

    return url.toString().slice(0, LINKS_METADATA_FIELD_MAX_LENGTH);
  } catch {
    return '';
  }
}

function extractStandaloneChatLinks(message: string) {
  const normalizedMessage = message.trim();
  if (!normalizedMessage) return [] as string[];

  // Safety-first: bypass LLM only when the whole message is exactly one link.
  // Any additional text should always go through normal AI flow.
  const hasWhitespace = /\s/.test(normalizedMessage);
  if (hasWhitespace) return [] as string[];

  const token = normalizedMessage.replace(/^[('"[\{<]+/, '').replace(/[)\]}'">,.;!?]+$/, '');
  if (!token) return [] as string[];
  const normalizedLink = normalizeLinkMetadataValue(token);
  if (!normalizedLink) return [] as string[];

  return [normalizedLink];
}

function metadataValueDedupeKey(fieldKey: string, value: string) {
  if (fieldKey === 'phones') {
    return normalizePhoneDigits(value);
  }
  return value.trim().toLowerCase();
}

function normalizeMetadataValues(fieldKey: string, values: string[]) {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const raw of values) {
    const nextValue = normalizeMetadataValue(fieldKey, raw);
    if (!nextValue) continue;
    const key = metadataValueDedupeKey(fieldKey, nextValue);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(nextValue);
  }

  return normalized;
}

function hasMetadataValue(fieldKey: string, values: string[], target: string) {
  const targetKey = metadataValueDedupeKey(fieldKey, target);
  if (!targetKey) return false;
  return values.some((item) => metadataValueDedupeKey(fieldKey, item) === targetKey);
}

function formatMetadataValueForDisplay(fieldKey: string, value: string) {
  if (fieldKey === 'phones') {
    const formatted = formatPhoneValue(value);
    return formatted || value;
  }
  return value;
}

function normalizeImportanceLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return '';
  return IMPORTANCE_LEVEL_MAP[normalized] || '';
}

function normalizeImportanceSource(value: unknown): 'auto' | 'manual' {
  if (typeof value !== 'string') return 'auto';
  return value.trim().toLowerCase() === 'manual' ? 'manual' : 'auto';
}

function normalizeImportanceArray(value: unknown) {
  const list = toMetadataStringArray(value);
  for (const item of list) {
    const normalized = normalizeImportanceLabel(item);
    if (normalized) return [normalized];
  }
  return [] as string[];
}

function getEntityContextFields(type: EntityType) {
  return ENTITY_CONTEXT_FIELDS[type] || [];
}

function buildEntityMetadataValues(type: EntityType, metadata: Record<string, unknown>) {
  const values: Record<string, string[]> = {};
  for (const field of getEntityContextFields(type)) {
    values[field.key] =
      field.key === 'importance'
        ? normalizeImportanceArray(metadata[field.key])
        : normalizeMetadataValues(field.key, toMetadataStringArray(metadata[field.key]));
  }
  return values;
}

function buildEntityFieldDrafts(type: EntityType) {
  const fieldDrafts: Record<string, string> = {};
  for (const field of getEntityContextFields(type)) {
    fieldDrafts[field.key] = '';
  }
  return fieldDrafts;
}

function buildEntityMetadataResetPayload(currentMetadata: Record<string, unknown> = {}) {
  const resetPayload: Record<string, unknown> = {
    description: '',
    text_input: '',
    voice_input: '',
    chat_history: [],
    documents: [],
    description_history: [],
    description_meta: {},
    importance_history: [],
    ai_last_analysis: {},
    importance_source: 'auto',
  };

  const preserved = toProfile(currentMetadata);
  const preservedPhones = normalizeMetadataValues('phones', toStringArray(preserved.phones));

  for (const key of ALL_METADATA_FIELD_KEYS) {
    if (key === 'phones') {
      resetPayload[key] = preservedPhones;
      continue;
    }
    resetPayload[key] = [];
  }

  return resetPayload;
}

function createLocalAttachmentId() {
  return `doc-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

function createLocalChatMessageId() {
  return `msg-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

function createLocalNodeId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

function snap(value: number) {
  return Math.round(value / GRID_STEP) * GRID_STEP;
}

function getIsoNow() {
  return new Date().toISOString();
}

function clearAwaitingAiCompletion(entityId = '') {
  if (entityId && awaitingAiCompletionEntityId.value && awaitingAiCompletionEntityId.value !== entityId) {
    return;
  }
  awaitingAiCompletionEntityId.value = '';
  awaitingAiCompletionStartedAtMs.value = 0;
}

const emojiItems = (ruEmojiData as EmojiRecord[])
  .filter((record) => typeof record.emoji === 'string' && record.emoji.trim().length > 0)
  .map<EmojiItem>((record) => ({
    emoji: record.emoji as string,
    label: typeof record.label === 'string' ? record.label.trim() : '',
    searchLabel: record.label?.toLowerCase() || '',
    searchTags: (record.tags || []).map((tag) => tag.toLowerCase()),
  }));

function normalizeChatHistory(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as EntityChatMessage[];
  }

  return value
    .map((item) => {
      const record = toProfile(item);
      const id = typeof record.id === 'string' ? record.id : createLocalChatMessageId();
      const role = record.role === 'assistant' ? 'assistant' : 'user';
      const text =
        typeof record.text === 'string'
          ? record.text
          : typeof record.content === 'string'
            ? record.content
            : '';
      const createdAt =
        typeof record.createdAt === 'string'
          ? record.createdAt
          : typeof record.created_at === 'string'
            ? record.created_at
            : getIsoNow();
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

function normalizeProjectCanvasData(canvasData: unknown): ProjectCanvasData {
  const raw = toProfile(canvasData);
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : [];
  const rawGroups = Array.isArray(raw.groups) ? raw.groups : [];

  const nodes: CanvasNodeProjection[] = rawNodes.flatMap((node) => {
    const record = toProfile(node);
    const id = typeof record.id === 'string' ? record.id : '';
    const entityId = typeof record.entityId === 'string' ? record.entityId : '';
    const x = typeof record.x === 'number' ? record.x : Number.NaN;
    const y = typeof record.y === 'number' ? record.y : Number.NaN;

    if (!id || !entityId || !Number.isFinite(x) || !Number.isFinite(y)) {
      return [];
    }

    return [{ id, entityId, x, y }];
  });

  const edges: CanvasEdgeProjection[] = rawEdges.flatMap((edge) => {
    const record = toProfile(edge);
    const id = typeof record.id === 'string' ? record.id : '';
    const source = typeof record.source === 'string' ? record.source : '';
    const target = typeof record.target === 'string' ? record.target : '';
    const label = typeof record.label === 'string' ? record.label : undefined;
    const color = typeof record.color === 'string' && record.color.trim() ? record.color : undefined;
    const arrowLeft = typeof record.arrowLeft === 'boolean' ? record.arrowLeft : undefined;
    const arrowRight = typeof record.arrowRight === 'boolean' ? record.arrowRight : undefined;

    if (!id || !source || !target) {
      return [];
    }

    return [{ id, source, target, label, color, arrowLeft, arrowRight }];
  });

  const nodeIdSet = new Set(nodes.map((node) => node.id));
  const groups: CanvasGroupProjection[] = rawGroups.flatMap((group) => {
    const record = toProfile(group);
    const id = typeof record.id === 'string' ? record.id : '';
    const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim().slice(0, 120) : 'Группа';
    const color = typeof record.color === 'string' && record.color.trim() ? record.color.trim().slice(0, 24) : undefined;
    const nodeIds = Array.isArray(record.nodeIds)
      ? Array.from(
        new Set(
          record.nodeIds
            .map((nodeId) => (typeof nodeId === 'string' ? nodeId : ''))
            .filter((nodeId) => nodeId && nodeIdSet.has(nodeId)),
        ),
      )
      : [];

    if (!id || nodeIds.length < 2) {
      return [];
    }

    return [{ id, name, nodeIds, color }];
  });

  return { nodes, edges, groups };
}

function findProjectInsertPosition(nodes: CanvasNodeProjection[]) {
  if (!nodes.length) {
    return {
      x: snap(-GRID_STEP * 6),
      y: snap(-GRID_STEP * 4),
    };
  }

  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const startX = snap(minX - GRID_STEP * 3);
  const targetY = snap(minY - GRID_STEP * 3);
  const occupied = new Set(nodes.map((node) => `${snap(node.x)}:${snap(node.y)}`));

  let nextX = startX;
  let guard = 0;
  while (occupied.has(`${nextX}:${targetY}`) && guard < 2000) {
    nextX = snap(nextX + PROJECT_INSERT_GAP);
    guard += 1;
  }

  return {
    x: nextX,
    y: targetY,
  };
}

function loadDraft(entityId: string) {
  const entity = entitiesStore.byId(entityId);
  if (!entity) return;

  closeProfileFooter();
  isResourceLinkPreviewLoading.value = false;
  clearResourceLinkPreview();

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

  draft.value = {
    entityId: entity._id,
    name: entity.name || '',
    type: entity.type,
    description: typeof aiMetadata.description === 'string' ? aiMetadata.description : '',
    importanceSource: normalizeImportanceSource(aiMetadata.importance_source),
    metadataValues: buildEntityMetadataValues(entity.type, aiMetadata),
    fieldDrafts: buildEntityFieldDrafts(entity.type),
    textInput: '',
    voiceInput: typeof aiMetadata.voice_input === 'string' ? aiMetadata.voice_input : '',
    documents,
    pendingUploads: [],
    chatHistory: normalizeChatHistory(aiMetadata.chat_history),
  };

  isProjectAddConfirmOpen.value = false;
  projectActionMessage.value = '';
  isProjectActionBusy.value = false;
  isMineToggleBusy.value = false;
  editingFieldValue.value = null;
  isFieldsListExpanded.value = false;

  pendingComposerHeightReset.value = true;
  void nextTick(() => {
    syncDescriptionHeightFromContent(true);
    autoResizeChatInput();
    scrollEntityChatToBottom('auto');
  });
}

function persistDraft(entityId: string) {
  const currentDraft = draft.value;
  if (!currentDraft || currentDraft.entityId !== entityId) return;

  const entity = entitiesStore.byId(entityId);
  if (!entity) return;

  const aiMetadata = toProfile(entity.ai_metadata);
  const nextMetadata: Record<string, unknown> = {
    ...aiMetadata,
    description: currentDraft.description.trim(),
    text_input: currentDraft.textInput,
    voice_input: currentDraft.voiceInput.trim(),
    chat_history: currentDraft.chatHistory.map((message) => ({
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
    documents: currentDraft.documents.map((doc) => ({
      id: doc.id,
      name: doc.name,
      mime: doc.mime,
      size: doc.size,
      data: doc.data,
    })),
  };
  for (const field of getEntityContextFields(currentDraft.type)) {
    nextMetadata[field.key] = normalizeMetadataValues(field.key, currentDraft.metadataValues[field.key] || []).slice(
      0,
      24,
    );
  }

  const hasImportanceField = getEntityContextFields(currentDraft.type).some(
    (field) => field.key === 'importance',
  );
  if (hasImportanceField) {
    const normalizedImportance = normalizeImportanceArray(nextMetadata.importance);
    nextMetadata.importance = normalizedImportance;
    nextMetadata.importance_source =
      currentDraft.importanceSource === 'manual' && normalizedImportance.length ? 'manual' : 'auto';
  }

  // Server controls analysis lifecycle flags; do not send client snapshots for these
  // fields to avoid overwriting SSE-driven state with stale autosave payloads.
  delete nextMetadata.analysis_pending;
  delete nextMetadata.analysis_started_at;
  delete nextMetadata.analysis_completed_at;
  delete nextMetadata.analysis_error;

  entitiesStore.queueEntityUpdate(
    entityId,
    {
      name: currentDraft.name.trim() || entity.name,
      ai_metadata: nextMetadata,
    },
    { delay: ENTITY_SYNC_DELAY },
  );
}

function scheduleSave() {
  const currentDraft = draft.value;
  if (!currentDraft) return;

  if (infoSaveTimer.value) {
    clearTimeout(infoSaveTimer.value);
  }

  infoSaveTimer.value = setTimeout(() => {
    persistDraft(currentDraft.entityId);
  }, ENTITY_SYNC_DELAY);
}

function clearSaveTimer() {
  if (!infoSaveTimer.value) return;
  clearTimeout(infoSaveTimer.value);
  infoSaveTimer.value = null;
}

function closeModal() {
  const currentDraft = draft.value;
  if (currentDraft) {
    persistDraft(currentDraft.entityId);
  }
  clearSaveTimer();
  voiceInput.cancelRecording();
  selectedProjectId.value = '';
  isProjectAddConfirmOpen.value = false;
  isDeleteConfirmOpen.value = false;
  isChatClearConfirmOpen.value = false;
  isMineToggleBusy.value = false;
  closeChatToolsMenus();
  closeProfileFooter();
  emit('close');
}

function openProjectAddConfirm() {
  if (!draft.value || isProjectActionBusy.value) return;
  if (!availableProjectOptions.value.length) {
    projectActionMessage.value = 'Нет доступных проектов для добавления.';
    isProjectAddConfirmOpen.value = false;
    return;
  }
  projectActionMessage.value = '';
  selectedProjectId.value = '';
  isDeleteConfirmOpen.value = false;
  isChatClearConfirmOpen.value = false;
  isProjectAddConfirmOpen.value = true;
}

function closeProjectAddConfirm() {
  if (isProjectActionBusy.value) return;
  isProjectAddConfirmOpen.value = false;
  selectedProjectId.value = '';
}

async function confirmProjectAdd() {
  if (!selectedProjectId.value || isProjectActionBusy.value) return;
  await onAddToProject(selectedProjectId.value);
}

async function onAddToProject(projectId: string) {
  const currentDraft = draft.value;
  const entity = currentEntity.value;
  if (!currentDraft || !entity || isProjectActionBusy.value) return;

  if (entity.type === 'project' && entity._id === projectId) {
    projectActionMessage.value = 'Нельзя добавить проект в самого себя.';
    return;
  }

  const project = entitiesStore.byId(projectId);
  if (!project || project.type !== 'project') {
    projectActionMessage.value = 'Проект не найден.';
    return;
  }

  const canvasData = normalizeProjectCanvasData(project.canvas_data);
  if (canvasData.nodes.some((node) => node.entityId === entity._id)) {
    projectActionMessage.value = 'Запись уже добавлена в этот проект.';
    selectedProjectId.value = '';
    isProjectAddConfirmOpen.value = false;
    return;
  }

  persistDraft(currentDraft.entityId);
  const position = findProjectInsertPosition(canvasData.nodes);
  const nextCanvasData: ProjectCanvasData = {
    nodes: [
      ...canvasData.nodes,
      {
        id: createLocalNodeId(),
        entityId: entity._id,
        x: position.x,
        y: position.y,
      },
    ],
    edges: canvasData.edges,
    groups: canvasData.groups,
  };

  isProjectActionBusy.value = true;
  try {
    await entitiesStore.updateEntity(projectId, {
      canvas_data: nextCanvasData,
    });

    const locked = toBooleanFlag(toProfile(entity.profile).locked);
    projectActionMessage.value = locked
      ? `Добавлено в проект "${project.name || 'Без названия'}". Узел заблокирован для перемещения.`
      : `Добавлено в проект "${project.name || 'Без названия'}".`;
    selectedProjectId.value = '';
    isProjectAddConfirmOpen.value = false;
  } catch {
    projectActionMessage.value = 'Не удалось добавить в проект.';
  } finally {
    isProjectActionBusy.value = false;
  }
}

function openDeleteConfirm() {
  if (!draft.value || isProjectActionBusy.value) return;
  isProjectAddConfirmOpen.value = false;
  isChatClearConfirmOpen.value = false;
  isDeleteConfirmOpen.value = true;
}

function closeDeleteConfirm() {
  if (isProjectActionBusy.value) return;
  isDeleteConfirmOpen.value = false;
}

function openClearChatConfirm() {
  if (!draft.value || isProjectActionBusy.value) return;
  isProjectAddConfirmOpen.value = false;
  isDeleteConfirmOpen.value = false;
  isChatClearConfirmOpen.value = true;
}

function closeClearChatConfirm() {
  if (isProjectActionBusy.value) return;
  isChatClearConfirmOpen.value = false;
}

async function confirmClearChatHistory() {
  const currentDraft = draft.value;
  if (!currentDraft || isProjectActionBusy.value) return;
  const entity = entitiesStore.byId(currentDraft.entityId);
  if (!entity) return;

  isProjectActionBusy.value = true;
  clearSaveTimer();
  voiceInput.cancelRecording();

  const resetMetadata = buildEntityMetadataResetPayload(toProfile(entity.ai_metadata));

  try {
    await entitiesStore.updateEntity(currentDraft.entityId, {
      ai_metadata: resetMetadata,
    });

    currentDraft.description = '';
    currentDraft.textInput = '';
    currentDraft.voiceInput = '';
    currentDraft.documents = [];
    currentDraft.pendingUploads = [];
    currentDraft.chatHistory = [];
    currentDraft.importanceSource = 'auto';
    currentDraft.metadataValues = buildEntityMetadataValues(currentDraft.type, resetMetadata);
    currentDraft.fieldDrafts = buildEntityFieldDrafts(currentDraft.type);
    editingFieldValue.value = null;

    isChatClearConfirmOpen.value = false;
    resetChatInputSize();
    syncDescriptionHeightFromContent(true);
    scrollEntityChatToBottom('auto');
    projectActionMessage.value = 'Данные очищены. Сохранены только имя, фото и телефон.';
  } catch {
    projectActionMessage.value = 'Не удалось очистить данные.';
  } finally {
    isProjectActionBusy.value = false;
  }
}

const deleteConfirmName = computed(() => {
  const currentDraft = draft.value;
  if (!currentDraft) return 'это';
  return currentDraft.name.trim() || 'это';
});

async function onDeleteEntity() {
  const currentDraft = draft.value;
  if (!currentDraft || isProjectActionBusy.value) return;

  isProjectActionBusy.value = true;
  clearSaveTimer();
  voiceInput.cancelRecording();

  try {
    await entitiesStore.deleteEntity(currentDraft.entityId);
    isDeleteConfirmOpen.value = false;
    emit('close');
  } catch {
    projectActionMessage.value = 'Не удалось удалить.';
  } finally {
    isProjectActionBusy.value = false;
  }
}

function getFieldValues(fieldKey: string) {
  if (!draft.value) return [] as string[];
  return draft.value.metadataValues[fieldKey] || [];
}

function getFieldDraft(fieldKey: string) {
  if (!draft.value) return '';
  return draft.value.fieldDrafts[fieldKey] || '';
}

function getFieldPlaceholder(field: MetadataFieldConfig) {
  const count = draft.value ? (draft.value.metadataValues[field.key] || []).length : 0;
  return `${field.label}: ${count}`;
}

function getMetadataFieldMaxLength(fieldKey: string) {
  if (fieldKey === 'phones') {
    return PHONE_DISPLAY_MAX_LENGTH;
  }
  return fieldKey === 'links' ? LINKS_METADATA_FIELD_MAX_LENGTH : DEFAULT_METADATA_FIELD_MAX_LENGTH;
}

function onFieldDraftInput(fieldKey: string, event: Event) {
  const input = event.target as HTMLInputElement | null;
  if (!input || !draft.value) return;
  const rawValue = fieldKey === 'phones' ? formatPhoneValue(input.value) : input.value;
  const nextDraft = rawValue.slice(0, getMetadataFieldMaxLength(fieldKey));
  draft.value.fieldDrafts[fieldKey] = nextDraft;
  if (input.value !== nextDraft) {
    input.value = nextDraft;
  }
}

function setFieldInputRef(fieldKey: string, element: unknown) {
  if (typeof HTMLInputElement !== 'undefined' && element instanceof HTMLInputElement) {
    fieldInputRefs.value[fieldKey] = element;
    return;
  }
  if (element === null) {
    delete fieldInputRefs.value[fieldKey];
  }
}

function focusFieldInput(fieldKey: string, selectAll = false) {
  void nextTick(() => {
    const input = fieldInputRefs.value[fieldKey];
    if (!input) return;
    input.focus();
    if (selectAll) {
      input.select();
    }
  });
}

function onFieldDraftKeydown(fieldKey: string, event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  if (!draft.value) return;
  draft.value.fieldDrafts[fieldKey] = '';
  if (editingFieldValue.value?.fieldKey === fieldKey) {
    editingFieldValue.value = null;
  }
}

function startEditFieldValue(fieldKey: string, value: string) {
  if (!draft.value) return;
  editingFieldValue.value = { fieldKey, originalValue: value };
  draft.value.fieldDrafts[fieldKey] = normalizeMetadataValue(fieldKey, value).slice(
    0,
    getMetadataFieldMaxLength(fieldKey),
  );
  focusFieldInput(fieldKey, true);
}

function normalizeLinkForOpen(value: string) {
  const raw = value.trim();
  if (!raw) return '';
  if (/^(https?:\/\/|mailto:|tel:)/i.test(raw)) {
    return raw;
  }
  return `https://${raw}`;
}

function openFieldLink(value: string) {
  if (typeof window === 'undefined') return;
  const url = normalizeLinkForOpen(value);
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function getLinkChipLabel(value: string) {
  const normalized = normalizeLinkForOpen(value);
  if (!normalized) return LINK_CHIP_FALLBACK_LABEL;

  try {
    const host = new URL(normalized).hostname.toLowerCase().replace(/^www\./, '');
    const mapped = LINK_CHIP_LABELS.find(({ domains }) =>
      domains.some((domain) => host === domain || host.endsWith(`.${domain}`)),
    );
    return mapped?.label || LINK_CHIP_FALLBACK_LABEL;
  } catch {
    return LINK_CHIP_FALLBACK_LABEL;
  }
}

function addFieldValue(fieldKey: string) {
  if (!draft.value) return;
  const isImportanceField = fieldKey === 'importance';
  let nextValue = normalizeMetadataValue(fieldKey, draft.value.fieldDrafts[fieldKey] || '').slice(
    0,
    getMetadataFieldMaxLength(fieldKey),
  );
  if (isImportanceField) {
    if (!draft.value.description.trim()) {
      draft.value.metadataValues[fieldKey] = [];
      draft.value.fieldDrafts[fieldKey] = '';
      draft.value.importanceSource = 'auto';
      scheduleSave();
      return;
    }
    nextValue = normalizeImportanceLabel(nextValue);
  }
  const values = [...(draft.value.metadataValues[fieldKey] || [])];
  const editing = editingFieldValue.value;

  if (editing && editing.fieldKey === fieldKey) {
    if (!nextValue) {
      draft.value.fieldDrafts[fieldKey] = '';
      editingFieldValue.value = null;
      return;
    }

    if (isImportanceField) {
      const nextValues = nextValue ? [nextValue] : [];
      const changed =
        values.length !== nextValues.length || (nextValues.length > 0 && values[0] !== nextValues[0]);
      draft.value.metadataValues[fieldKey] = nextValues;
      draft.value.fieldDrafts[fieldKey] = '';
      editingFieldValue.value = null;
      if (changed) {
        draft.value.importanceSource = nextValues.length ? 'manual' : 'auto';
        scheduleSave();
      }
      return;
    }

    const originalIndex = values.findIndex(
      (item) => metadataValueDedupeKey(fieldKey, item) === metadataValueDedupeKey(fieldKey, editing.originalValue),
    );
    let changed = false;

    if (originalIndex >= 0) {
      if (values[originalIndex] !== nextValue) {
        if (hasMetadataValue(fieldKey, values, nextValue)) {
          values.splice(originalIndex, 1);
        } else {
          values[originalIndex] = nextValue;
        }
        changed = true;
      }
    } else if (!hasMetadataValue(fieldKey, values, nextValue)) {
      values.push(nextValue);
      changed = true;
    }

    draft.value.metadataValues[fieldKey] = values;
    draft.value.fieldDrafts[fieldKey] = '';
    editingFieldValue.value = null;
    if (changed) {
      scheduleSave();
    }
    return;
  }

  if (!nextValue) return;
  if (isImportanceField) {
    const currentValue = values[0] || '';
    if (values.length !== 1 || currentValue !== nextValue) {
      draft.value.metadataValues[fieldKey] = [nextValue];
      draft.value.importanceSource = 'manual';
      scheduleSave();
    }
    draft.value.fieldDrafts[fieldKey] = '';
    return;
  }
  if (!hasMetadataValue(fieldKey, values, nextValue)) {
    draft.value.metadataValues[fieldKey] = [...values, nextValue];
    scheduleSave();
  }
  draft.value.fieldDrafts[fieldKey] = '';
}

function removeFieldValue(fieldKey: string, value: string) {
  if (!draft.value) return;
  const removeKey = metadataValueDedupeKey(fieldKey, value);
  draft.value.metadataValues[fieldKey] = (draft.value.metadataValues[fieldKey] || []).filter(
    (item) => metadataValueDedupeKey(fieldKey, item) !== removeKey,
  );
  if (fieldKey === 'importance') {
    draft.value.importanceSource = 'auto';
  }
  if (
    editingFieldValue.value &&
    editingFieldValue.value.fieldKey === fieldKey &&
    editingFieldValue.value.originalValue === value
  ) {
    editingFieldValue.value = null;
    draft.value.fieldDrafts[fieldKey] = '';
  }
  scheduleSave();
}

function onNameInput() {
  scheduleSave();
}

function onDescriptionInput() {
  if (
    draft.value &&
    Object.prototype.hasOwnProperty.call(draft.value.metadataValues, 'importance') &&
    !draft.value.description.trim()
  ) {
    draft.value.metadataValues.importance = [];
    draft.value.fieldDrafts.importance = '';
    draft.value.importanceSource = 'auto';
  }
  scheduleSave();
}

function snapshotMineFlags(entityIds: string[]) {
  const uniqueIds = Array.from(new Set(entityIds.map((id) => id.trim()).filter(Boolean)));
  return uniqueIds
    .map((entityId) => {
      const entity = entitiesStore.byId(entityId);
      if (!entity) return null;
      return {
        entityId,
        is_mine: toBooleanFlag(entity.is_mine),
        is_me: toBooleanFlag(entity.is_me),
      };
    })
    .filter((item): item is { entityId: string; is_mine: boolean; is_me: boolean } => Boolean(item));
}

function restoreMineFlags(snapshot: Array<{ entityId: string; is_mine: boolean; is_me: boolean }>) {
  for (const row of snapshot) {
    entitiesStore.applyLocalEntityPatch(row.entityId, {
      is_mine: row.is_mine,
      is_me: row.is_me,
    });
  }
}

function onMineToggleInput(event: Event) {
  const input = event.target as HTMLInputElement | null;
  if (!input) return;
  void onMineToggleChange(input.checked);
}

async function onMineToggleChange(nextValue: boolean) {
  const entity = currentEntity.value;
  if (!entity || isMineToggleBusy.value || isProjectActionBusy.value) return;

  projectActionMessage.value = '';
  isMineToggleBusy.value = true;

  try {
    if (entity.type === 'person') {
      if (nextValue) {
        const persons = entitiesStore.byType('person');
        const snapshot = snapshotMineFlags(persons.map((item) => item._id));

        for (const person of persons) {
          if (person._id === entity._id) {
            entitiesStore.applyLocalEntityPatch(person._id, { is_me: true, is_mine: true });
            continue;
          }

          if (toBooleanFlag(person.is_me)) {
            entitiesStore.applyLocalEntityPatch(person._id, { is_me: false });
          }
        }

        try {
          await entitiesStore.setPersonAsMe(entity._id);
        } catch (error) {
          restoreMineFlags(snapshot);
          throw error;
        }

        return;
      }

      const snapshot = snapshotMineFlags([entity._id]);
      entitiesStore.applyLocalEntityPatch(entity._id, { is_me: false });
      try {
        await entitiesStore.updateEntity(entity._id, { is_me: false });
      } catch (error) {
        restoreMineFlags(snapshot);
        throw error;
      }
      return;
    }

    const snapshot = snapshotMineFlags([entity._id]);
    entitiesStore.applyLocalEntityPatch(entity._id, { is_mine: nextValue, is_me: false });
    try {
      await entitiesStore.updateEntity(entity._id, { is_mine: nextValue });
    } catch (error) {
      restoreMineFlags(snapshot);
      throw error;
    }
  } catch {
    projectActionMessage.value = 'Не удалось сохранить';
  } finally {
    isMineToggleBusy.value = false;
  }
}

const descriptionTextareaStyle = computed(() => {
  if (!descriptionHeightPx.value) return undefined;
  return {
    height: `${descriptionHeightPx.value}px`,
  };
});

function getDescriptionResizeBounds() {
  const minHeight = 54;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 900;
  const maxHeight = Math.max(180, Math.floor(viewportHeight * 0.55));
  return { minHeight, maxHeight };
}

function applyDescriptionHeight(nextHeight: number) {
  const { minHeight, maxHeight } = getDescriptionResizeBounds();
  descriptionHeightPx.value = Math.max(minHeight, Math.min(maxHeight, Math.round(nextHeight)));
}

function syncDescriptionHeightFromContent(force = false) {
  const textarea = descriptionTextareaRef.value;
  if (!textarea) return;
  if (descriptionHeightPx.value && !force) return;

  const { minHeight } = getDescriptionResizeBounds();
  descriptionHeightPx.value = Math.round(minHeight);
}

function toggleFieldsListExpanded() {
  isFieldsListExpanded.value = !isFieldsListExpanded.value;
}

function stopDescriptionResize() {
  if (!isDescriptionResizing.value && !descriptionResizeStart.value) return;
  isDescriptionResizing.value = false;
  descriptionResizePointerId.value = null;
  descriptionResizeStart.value = null;
  if (typeof window === 'undefined') return;
  window.removeEventListener('pointermove', onDescriptionResizePointerMove);
  window.removeEventListener('pointerup', onDescriptionResizePointerUp);
  window.removeEventListener('pointercancel', onDescriptionResizePointerUp);
}

function onDescriptionResizePointerMove(event: PointerEvent) {
  if (!isDescriptionResizing.value || !descriptionResizeStart.value) return;
  if (
    descriptionResizePointerId.value !== null &&
    event.pointerId !== descriptionResizePointerId.value
  ) {
    return;
  }

  if (event.cancelable) {
    event.preventDefault();
  }

  const deltaY = event.clientY - descriptionResizeStart.value.clientY;
  applyDescriptionHeight(descriptionResizeStart.value.height + deltaY);
}

function onDescriptionResizePointerUp(event: PointerEvent) {
  if (!isDescriptionResizing.value) return;
  if (
    descriptionResizePointerId.value !== null &&
    event.pointerId !== descriptionResizePointerId.value
  ) {
    return;
  }

  stopDescriptionResize();
}

function onDescriptionResizePointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  if (event.cancelable) {
    event.preventDefault();
  }
  event.stopPropagation();

  const textarea = descriptionTextareaRef.value;
  if (!textarea) return;

  const currentHeight =
    descriptionHeightPx.value ||
    Math.max(getDescriptionResizeBounds().minHeight, Math.round(textarea.getBoundingClientRect().height));

  descriptionResizeStart.value = {
    clientY: event.clientY,
    height: currentHeight,
  };
  descriptionResizePointerId.value = event.pointerId;
  isDescriptionResizing.value = true;

  if (typeof window !== 'undefined') {
    window.addEventListener('pointermove', onDescriptionResizePointerMove, { passive: false });
    window.addEventListener('pointerup', onDescriptionResizePointerUp);
    window.addEventListener('pointercancel', onDescriptionResizePointerUp);
  }
}

function onDescriptionViewportResize() {
  if (!descriptionHeightPx.value) return;
  applyDescriptionHeight(descriptionHeightPx.value);
}

function autoResizeChatInput() {
  const input = chatInputRef.value;
  if (!input) return;

  if (pendingComposerHeightReset.value) {
    input.style.height = '0px';
    pendingComposerHeightReset.value = false;
  }

  input.style.height = '0px';
  input.style.height = `${Math.min(CHAT_INPUT_MAX_HEIGHT_PX, input.scrollHeight)}px`;
}

function resetChatInputSize() {
  pendingComposerHeightReset.value = true;
  void nextTick(() => {
    autoResizeChatInput();
  });
}

function scrollEntityChatToBottom(behavior: ScrollBehavior = 'smooth') {
  const feed = chatFeedRef.value;
  if (!feed) return;
  feed.scrollTo({
    top: feed.scrollHeight,
    behavior,
  });
}

function normalizeChatText(value: string) {
  return value.replace(/\r\n/g, '\n').trim();
}

function pushChatMessage(
  role: EntityChatRole,
  text: string,
  attachments: EntityAttachment[] = [],
) {
  if (!draft.value) return;
  const normalized = normalizeChatText(text);
  if (!normalized && !attachments.length) return;

  draft.value.chatHistory = [
    ...draft.value.chatHistory,
    {
      id: createLocalChatMessageId(),
      role,
      text: normalized,
      createdAt: getIsoNow(),
      attachments: attachments.map((attachment) => ({ ...attachment })),
    },
  ];
}

function toAiAttachmentPayload(attachment: EntityAttachment) {
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
}

function buildDebugAttachment(debug: Record<string, unknown>) {
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

function buildLlmErrorDebugPayload(error: unknown, requestPayload: Record<string, unknown>) {
  const payload: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    request: requestPayload,
    error: {
      message: parseRequestError(error),
    },
  };

  if (typeof error === 'object' && error && 'response' in error) {
    const axiosError = error as {
      response?: { status?: number; data?: unknown };
      code?: string;
      message?: string;
      stack?: string;
    };
    payload.error = {
      ...(payload.error as Record<string, unknown>),
      status: axiosError.response?.status ?? null,
      code: axiosError.code || '',
      responseData: axiosError.response?.data ?? null,
      rawMessage: axiosError.message || '',
      stack: axiosError.stack || '',
    };
    return payload;
  }

  if (error instanceof Error) {
    payload.error = {
      ...(payload.error as Record<string, unknown>),
      name: error.name,
      stack: error.stack || '',
    };
    return payload;
  }

  payload.error = {
    ...(payload.error as Record<string, unknown>),
    raw: error,
  };

  return payload;
}

function parseRequestError(error: unknown) {
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

function clearResourceLinkPreview() {
  resourceLinkPreview.value = null;
}

function isResourceLinkPreviewCandidate(message: string, attachments: EntityAttachment[]) {
  return Boolean(draft.value && draft.value.type === 'resource' && attachments.length === 0 && extractStandaloneChatLinks(message).length);
}

async function prepareResourceLinkPreview(message: string, attachments: EntityAttachment[]) {
  const currentDraft = draft.value;
  if (!currentDraft || !isResourceLinkPreviewCandidate(message, attachments)) {
    return false;
  }

  const sourceUrl = extractStandaloneChatLinks(message)[0] || '';
  if (!sourceUrl) return false;

  isResourceLinkPreviewLoading.value = true;
  resourceLinkPreview.value = null;

  try {
    const preview = await prepareEntityLinkPreview({
      entityId: currentDraft.entityId,
      url: sourceUrl,
    });

    if (!draft.value || draft.value.entityId !== currentDraft.entityId) {
      return true;
    }

    draft.value.textInput = preview.preparedText;
    draft.value.voiceInput = '';
    draft.value.metadataValues.links = normalizeMetadataValues('links', [
      ...(draft.value.metadataValues.links || []),
      preview.finalUrl || preview.sourceUrl,
    ]).slice(0, 24);
    resourceLinkPreview.value = {
      ...preview,
      mode: 'ready',
      errorMessage: '',
    };

    scheduleSave();
    await nextTick();
    autoResizeChatInput();
    chatInputRef.value?.focus();
    return true;
  } catch (error: unknown) {
    resourceLinkPreview.value = {
      sourceUrl,
      finalUrl: '',
      hostname: '',
      siteLabel: '',
      sourceKind: '',
      title: '',
      description: '',
      textSnippet: '',
      preparedText: '',
      mode: 'error',
      errorMessage: `Не удалось разобрать ссылку. ${parseRequestError(error)}`,
    };
    return true;
  } finally {
    isResourceLinkPreviewLoading.value = false;
  }
}

async function onSendInput() {
  if (!draft.value) return;
  if (isAiRequestInFlight.value) return;
  if (voiceInput.state.value === 'recording' || voiceInput.state.value === 'transcribing') return;
  closeChatToolsMenus();
  const message = normalizeChatText(draft.value.textInput);
  const attachments = [...draft.value.pendingUploads];
  if (!message && !attachments.length) return;

  if (await prepareResourceLinkPreview(message, attachments)) {
    return;
  }

  pushChatMessage('user', message, attachments);
  draft.value.pendingUploads = [];
  draft.value.documents = Array.from(
    new Map([...draft.value.documents, ...attachments].map((attachment) => [attachment.id, attachment])).values(),
  );
  draft.value.textInput = '';
  draft.value.voiceInput = '';
  clearResourceLinkPreview();
  voiceInput.markTextConsumed();

  resetChatInputSize();
  void nextTick(() => {
    scrollEntityChatToBottom('auto');
  });
  scheduleSave();

  const activeDraft = draft.value;
  if (!activeDraft) return;
  const linkOnlyMessageLinks = attachments.length === 0 ? extractStandaloneChatLinks(message) : [];
  if (linkOnlyMessageLinks.length) {
    const existingLinks = Array.isArray(activeDraft.metadataValues.links)
      ? (activeDraft.metadataValues.links as string[])
      : [];
    activeDraft.metadataValues.links = normalizeMetadataValues('links', [
      ...existingLinks,
      ...linkOnlyMessageLinks,
    ]).slice(0, 24);
    scheduleSave();
    await nextTick();
    scrollEntityChatToBottom('auto');
    return;
  }

  localAiRequestInFlight.value = true;
  awaitingAiCompletionEntityId.value = activeDraft.entityId;
  awaitingAiCompletionStartedAtMs.value = Date.now();
  entitiesStore.setEntityAiPending(activeDraft.entityId, true);
  const requestPayload = {
    entityId: activeDraft.entityId,
    message,
    voiceInput: activeDraft.voiceInput,
    history: activeDraft.chatHistory
      .slice(-12)
      .map((item) => ({
        role: item.role,
        text: item.text,
      })),
    attachments: attachments.map(toAiAttachmentPayload),
    documents: activeDraft.documents.slice(-8).map(toAiAttachmentPayload),
    debug: true,
  };
  console.log('[Modal] submitChatMessage → calling AI', {
    entityId: activeDraft.entityId,
    message: message.slice(0, 120),
  });
  try {
    const response = await analyzeEntityWithAi(requestPayload);
    console.log('[Modal] submitChatMessage → AI returned', {
      isProcessing: isEntityAiProcessingResponse(response),
      hasReply: 'reply' in response,
    });

    if (isEntityAiProcessingResponse(response)) {
      console.log('[Modal] submitChatMessage → background job, waiting for SSE entity.updated');
      localAiRequestInFlight.value = false;
      return;
    }

    const debugAttachments = response.debug ? [buildDebugAttachment(response.debug)] : [];
    const assistantText = response.reply || 'Готово.';
    if (!draft.value || draft.value.entityId !== activeDraft.entityId) {
      clearAwaitingAiCompletion(activeDraft.entityId);
      entitiesStore.setEntityAiPending(activeDraft.entityId, false);
      return;
    }

    if (response.suggestion?.status === 'ready') {
      if (response.suggestion.description) {
        draft.value.description = response.suggestion.description;
      }

      const fields = response.suggestion.fields || {};
      for (const field of getEntityContextFields(draft.value.type)) {
        const rawValues = fields[field.key];
        const nextValues = Array.isArray(rawValues)
          ? rawValues.filter((value): value is string => typeof value === 'string')
          : [];
        draft.value.metadataValues[field.key] = normalizeMetadataValues(
          field.key,
          nextValues.map((value) => value.trim()).filter((value) => value.length > 0),
        ).slice(0, 16);
      }
    }

    pushChatMessage('assistant', assistantText, debugAttachments);
    clearAwaitingAiCompletion(activeDraft.entityId);
    entitiesStore.setEntityAiPending(activeDraft.entityId, false);
    scheduleSave();
    await nextTick();
    scrollEntityChatToBottom('auto');
  } catch (error: unknown) {
    const debugAttachments = [buildDebugAttachment(buildLlmErrorDebugPayload(error, requestPayload))];
    const assistantText = `Не удалось получить ответ от LLM. ${parseRequestError(error)}`;
    if (!draft.value || draft.value.entityId !== activeDraft.entityId) {
      clearAwaitingAiCompletion(activeDraft.entityId);
      entitiesStore.setEntityAiPending(activeDraft.entityId, false);
      return;
    }

    pushChatMessage('assistant', assistantText, debugAttachments);
    clearAwaitingAiCompletion(activeDraft.entityId);
    entitiesStore.setEntityAiPending(activeDraft.entityId, false);
    await nextTick();
    scrollEntityChatToBottom('auto');
    scheduleSave();
  } finally {
    localAiRequestInFlight.value = false;
  }
}

function onChatComposerKeydown(event: KeyboardEvent) {
  if (voiceInput.state.value === 'recording' || voiceInput.state.value === 'transcribing') return;
  if (event.key !== 'Enter') return;
  if (event.shiftKey) return;

  event.preventDefault();
  void onSendInput();
}

function onTextInput() {
  if (resourceLinkPreview.value?.mode === 'error') {
    clearResourceLinkPreview();
  } else if (resourceLinkPreview.value?.mode === 'ready' && !draft.value?.textInput.trim()) {
    clearResourceLinkPreview();
  }
  autoResizeChatInput();
  scheduleSave();
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
  if (!files || !files.length || !draft.value) return;

  const attachments = await Promise.all(
    Array.from(files).map(async (file) => ({
      id: createLocalAttachmentId(),
      name: file.name,
      mime: file.type,
      size: file.size,
      data: await fileToDataUrl(file),
    })),
  );

  draft.value.pendingUploads = [...draft.value.pendingUploads, ...attachments];
  if (!draft.value.textInput.trim()) {
    draft.value.textInput = attachments.map((attachment) => `[Файл] ${attachment.name}`).join('\n');
  }
  autoResizeChatInput();
  scheduleSave();

  if (input) {
    input.value = '';
  }
}

function removePendingUpload(attachmentId: string) {
  if (!draft.value) return;
  draft.value.pendingUploads = draft.value.pendingUploads.filter(
    (attachment) => attachment.id !== attachmentId,
  );
  scheduleSave();
}

async function onVoiceToggle() {
  if (!draft.value) return;
  if (isAiRequestInFlight.value) return;
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

function sanitizeFileNamePart(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildEntityStructuredText() {
  const currentDraft = draft.value;
  if (!currentDraft) return '';

  const entityName = currentDraft.name.trim() || 'Без названия';
  const lines: string[] = [`Сущность - "${entityName}"`, '', 'Описание', currentDraft.description.trim() || '—', '', 'Поля'];

  let hasFields = false;
  for (const field of activeFields.value) {
    const values = normalizeMetadataValues(field.key, currentDraft.metadataValues[field.key] || []);
    if (!values.length) continue;
    hasFields = true;

    const displayValues = values.map((value) =>
      field.key === 'links' ? value : formatMetadataValueForDisplay(field.key, value),
    );
    lines.push(`${field.label}: ${displayValues.join(', ')}`);
  }
  if (!hasFields) {
    lines.push('—');
  }

  lines.push('', 'Чат');
  if (!currentDraft.chatHistory.length) {
    lines.push('—');
    return lines.join('\n');
  }

  for (const message of currentDraft.chatHistory) {
    const roleLabel = message.role === 'assistant' ? 'Ассистент' : 'Пользователь';
    const text = normalizeChatText(message.text) || (message.attachments.length ? 'Вложение' : '—');
    const timeLabel = toDisplayTime(message.createdAt);
    const prefix = timeLabel ? `[${timeLabel}] ` : '';
    lines.push(`${prefix}${roleLabel}: ${text}`);

    if (message.attachments.length) {
      const attachmentNames = message.attachments
        .map((attachment) => attachment.name.trim() || 'Файл')
        .join(', ');
      lines.push(`Файлы: ${attachmentNames}`);
    }
  }

  return lines.join('\n');
}

function buildEntityExportFileName() {
  const currentDraft = draft.value;
  if (!currentDraft) return 'Сущность - Без названия.txt';

  const typeLabel = ENTITY_TYPE_LABELS[currentDraft.type] || 'Сущность';
  const name = currentDraft.name.trim() || 'Без названия';
  const safeType = sanitizeFileNamePart(typeLabel) || 'Сущность';
  const safeName = sanitizeFileNamePart(name) || 'Без названия';
  return `${safeType} - ${safeName}.txt`;
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
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  window.document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = window.document.execCommand('copy');
  window.document.body.removeChild(textarea);

  if (!copied) {
    throw new Error('Copy failed');
  }
}

async function copyEntityAsStructuredText() {
  const text = buildEntityStructuredText();
  if (!text) return;

  try {
    await writeTextToClipboard(text);
    projectActionMessage.value = 'Структурный текст скопирован.';
  } catch {
    projectActionMessage.value = 'Не удалось скопировать текст.';
  }
}

function exportEntityAsTextFile() {
  if (typeof window === 'undefined') return;

  const text = buildEntityStructuredText();
  if (!text) return;

  const fileName = buildEntityExportFileName();
  const blob = new Blob([`\uFEFF${text}`], { type: 'text/plain;charset=utf-8' });
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  window.document.body.appendChild(anchor);
  anchor.click();
  window.document.body.removeChild(anchor);
  window.URL.revokeObjectURL(objectUrl);

  projectActionMessage.value = `Файл "${fileName}" экспортирован.`;
}

const currentEntity = computed(() => entitiesStore.byId(props.entityId) || null);
const voicePromptEntityType = computed<EntityType>(() => currentEntity.value?.type || draft.value?.type || 'shape');
const mineToggleLabel = computed(() => {
  const entityType = currentEntity.value?.type || draft.value?.type || 'shape';
  return ENTITY_MINE_TOGGLE_LABELS[entityType] || 'Моё';
});
const mineToggleChecked = computed(() => {
  const entity = currentEntity.value;
  if (!entity) return false;
  if (entity.type === 'person') {
    return toBooleanFlag(entity.is_me);
  }
  return toBooleanFlag(entity.is_mine);
});
const availableProjectOptions = computed(() => {
  const current = currentEntity.value;
  return entitiesStore
    .byType('project')
    .filter((project) => !(current?.type === 'project' && project._id === current._id))
    .sort((left, right) =>
      (left.name || 'Без названия').localeCompare(right.name || 'Без названия', 'ru'),
    );
});

// Projects that already contain this entity on their canvas
const entityProjects = computed(() => {
  const entityId = props.entityId;
  return entitiesStore
    .byType('project')
    .filter((project) => {
      const canvasData = normalizeProjectCanvasData(project.canvas_data);
      return canvasData.nodes.some((node) => node.entityId === entityId);
    })
    .sort((a, b) => (a.name || 'Без названия').localeCompare(b.name || 'Без названия', 'ru'));
});

const isProjectNavDropdownOpen = ref(false);
const isChatToolsMenuOpen = ref(false);

type ChatToolsActionKey =
  | 'import-documents'
  | 'open-project'
  | 'copy-structure'
  | 'export-txt'
  | 'add-to-project'
  | 'clear-data'
  | 'delete';

function closeChatToolsMenus() {
  isChatToolsMenuOpen.value = false;
  isProjectNavDropdownOpen.value = false;
}

function toggleChatToolsMenu() {
  isProjectNavDropdownOpen.value = false;
  isChatToolsMenuOpen.value = !isChatToolsMenuOpen.value;
}

function onChatToolsAction(actionKey: ChatToolsActionKey) {
  isChatToolsMenuOpen.value = false;

  if (actionKey === 'import-documents') {
    docInputRef.value?.click();
    return;
  }

  if (actionKey === 'open-project') {
    onGoToProjectClick({ forceOpenDropdown: true });
    return;
  }

  if (actionKey === 'copy-structure') {
    void copyEntityAsStructuredText();
    return;
  }

  if (actionKey === 'export-txt') {
    exportEntityAsTextFile();
    return;
  }

  if (actionKey === 'add-to-project') {
    openProjectAddConfirm();
    return;
  }

  if (actionKey === 'clear-data') {
    openClearChatConfirm();
    return;
  }

  if (actionKey === 'delete') {
    openDeleteConfirm();
  }
}

function navigateToProject(projectId: string) {
  isProjectNavDropdownOpen.value = false;
  isChatToolsMenuOpen.value = false;
  emit('close');
  router.push({
    name: 'project-canvas',
    params: { id: projectId },
    query: { focusEntity: props.entityId },
  });
}

function onGoToProjectClick(options?: { forceOpenDropdown?: boolean }) {
  if (entityProjects.value.length === 1) {
    navigateToProject(entityProjects.value[0]!._id);
  } else {
    isProjectNavDropdownOpen.value = options?.forceOpenDropdown
      ? true
      : !isProjectNavDropdownOpen.value;
  }
}

const modalIcon = computed(() => {
  if (!currentEntity.value) return null;

  const profile = toProfile(currentEntity.value.profile);
  const color = typeof profile.color === 'string' && profile.color.trim() ? profile.color : '#1058ff';
  const image = typeof profile.image === 'string' ? profile.image : '';
  const emoji = typeof profile.emoji === 'string' ? profile.emoji : '';
  const hasLogo = logoImageFromProfile(profile).trim().length > 0;

  return {
    type: currentEntity.value.type,
    color,
    image,
    emoji,
    hasLogo,
  };
});

const filteredFooterEmoji = computed(() => {
  const query = footerEmojiQuery.value.trim().toLowerCase();
  if (!query) {
    return emojiItems.slice(0, 180);
  }

  return emojiItems
    .filter((item) => item.searchLabel.includes(query) || item.searchTags.some((tag) => tag.includes(query)))
    .slice(0, 180);
});

const filteredFooterSystemLogos = computed(() => {
  const query = footerLogoQuery.value.trim().toLowerCase();
  if (!query) {
    return SYSTEM_SOCIAL_LOGOS;
  }

  return SYSTEM_SOCIAL_LOGOS.filter((logo) => {
    if (logo.name.toLowerCase().includes(query)) return true;
    return logo.keywords.some((keyword) => keyword.includes(query));
  });
});

const filteredFooterCustomLogos = computed(() => {
  const query = footerLogoQuery.value.trim().toLowerCase();
  if (!query) return footerCustomLogos.value;

  return footerCustomLogos.value.filter((logo) => {
    if (logo.name.toLowerCase().includes(query)) return true;
    return logo.keywords.some((keyword) => keyword.includes(query));
  });
});

const footerCropImageStyle = computed(() => ({
  transform: `translate(calc(-50% + ${footerCropOffsetX.value}px), calc(-50% + ${footerCropOffsetY.value}px)) scale(${footerCropScale.value})`,
}));

const activeFields = computed(() => {
  const type = draft.value?.type || 'shape';
  return getEntityContextFields(type);
});

const entityProfileFilledFieldCount = computed(() => {
  const currentDraft = draft.value;
  if (!currentDraft) return 0;

  let filled = currentDraft.name.trim() ? 1 : 0;
  if (currentDraft.description.trim()) {
    filled += 1;
  }

  const profile = toProfile(currentEntity.value?.profile);
  const image = typeof profile.image === 'string' ? profile.image.trim() : '';
  const logoImage = logoImageFromProfile(profile).trim();
  if (image || logoImage) {
    filled += 1;
  }

  for (const field of activeFields.value) {
    if ((currentDraft.metadataValues[field.key] || []).length > 0) {
      filled += 1;
    }
  }
  return filled;
});

const entityProfileTotalFieldCount = computed(() => activeFields.value.length + 3);

const chatPlaceholder = computed(() => {
  const type = draft.value?.type || 'shape';
  if (type === 'resource') {
    return 'Вставьте ссылку или опишите ресурс';
  }
  return `Опишите ${ENTITY_TYPE_CHAT_TARGET[type]}`;
});

const progressEntity = computed<Entity | null>(() => {
  if (!currentEntity.value || !draft.value) return currentEntity.value;

  const metadata = {
    ...toProfile(currentEntity.value.ai_metadata),
    description: draft.value.description,
    documents: [...draft.value.documents, ...draft.value.pendingUploads].map((doc) => ({
      id: doc.id,
      name: doc.name,
      mime: doc.mime,
      size: doc.size,
      data: doc.data,
    })),
    chat_history: draft.value.chatHistory.map((message) => ({
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
  } as Record<string, unknown>;

  for (const field of activeFields.value) {
    metadata[field.key] = draft.value.metadataValues[field.key] || [];
  }

  return {
    ...currentEntity.value,
    name: draft.value.name,
    ai_metadata: metadata,
  };
});

const profileProgress = computed(() => calculateEntityProfileProgress(progressEntity.value));
const profileProgressLevel = computed(() => {
  if (profileProgress.value >= 85) return 'Высокая заполненность';
  if (profileProgress.value >= 60) return 'Хорошая заполненность';
  if (profileProgress.value >= 35) return 'Средняя заполненность';
  return 'Низкая заполненность';
});

function queueProfilePatch(patch: Record<string, unknown>) {
  const entity = currentEntity.value;
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
    entity._id,
    {
      profile: nextProfile,
    },
    { delay: ENTITY_SYNC_DELAY },
  );
}

function queueEntityNameUpdate(nextName: string) {
  const entity = currentEntity.value;
  if (!entity) return;
  const normalized = nextName.trim();
  if (!normalized) return;

  entitiesStore.queueEntityUpdate(
    entity._id,
    {
      name: normalized,
    },
    { delay: ENTITY_SYNC_DELAY },
  );

  if (draft.value && draft.value.entityId === entity._id) {
    draft.value.name = normalized;
  }
}

async function loadImageElement(src: string) {
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image load failed'));
    image.src = src;
  });
}

function cropBaseSize() {
  const naturalWidth = footerCropNaturalWidth.value;
  const naturalHeight = footerCropNaturalHeight.value;
  const view = FOOTER_CROP_VIEW_SIZE;
  if (!naturalWidth || !naturalHeight) {
    return { width: view, height: view };
  }

  const ratio = naturalWidth / naturalHeight;
  if (ratio >= 1) {
    return { width: view * ratio, height: view };
  }
  return { width: view, height: view / ratio };
}

function clampCropScale(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(4, Math.max(1, value));
}

function clampCropOffsets(
  offsetX: number,
  offsetY: number,
  scaleValue = footerCropScale.value,
) {
  const scale = clampCropScale(scaleValue);
  const view = FOOTER_CROP_VIEW_SIZE;
  const base = cropBaseSize();
  const renderedWidth = base.width * scale;
  const renderedHeight = base.height * scale;
  const maxX = Math.max(0, (renderedWidth - view) / 2);
  const maxY = Math.max(0, (renderedHeight - view) / 2);

  const nextX = Math.max(-maxX, Math.min(maxX, offsetX));
  const nextY = Math.max(-maxY, Math.min(maxY, offsetY));
  return { x: nextX, y: nextY };
}

function resetFooterCropTransform() {
  footerCropScale.value = 1;
  footerCropOffsetX.value = 0;
  footerCropOffsetY.value = 0;
}

async function initFooterCrop(imageSrc: string) {
  const src = imageSrc.trim();
  if (!src) {
    footerCropImageSrc.value = '';
    footerCropNaturalWidth.value = 0;
    footerCropNaturalHeight.value = 0;
    resetFooterCropTransform();
    return;
  }

  const image = await loadImageElement(src);
  footerCropImageSrc.value = src;
  footerCropNaturalWidth.value = image.naturalWidth || 0;
  footerCropNaturalHeight.value = image.naturalHeight || 0;
  resetFooterCropTransform();
}

function toggleFooterCropPanel() {
  if (footerCropOpen.value) {
    footerCropOpen.value = false;
    footerCropPointer.value = null;
    return;
  }

  footerEmojiOpen.value = false;
  footerLogoOpen.value = false;
  footerCropError.value = '';

  const sourceImage = imageFromProfile(toProfile(currentEntity.value?.profile));
  footerCropOpen.value = true;

  if (!sourceImage) {
    footerCropImageSrc.value = '';
    footerCropNaturalWidth.value = 0;
    footerCropNaturalHeight.value = 0;
    footerCropError.value = 'Сначала добавьте фото.';
    return;
  }

  void initFooterCrop(sourceImage).catch(() => {
    footerCropImageSrc.value = '';
    footerCropNaturalWidth.value = 0;
    footerCropNaturalHeight.value = 0;
    footerCropError.value = 'Не удалось открыть фото для обрезки.';
  });
}

function onFooterCropScaleInput(event: Event) {
  const input = event.target as HTMLInputElement | null;
  const nextScale = clampCropScale(Number(input?.value || 1));
  footerCropScale.value = nextScale;
  const clamped = clampCropOffsets(footerCropOffsetX.value, footerCropOffsetY.value, nextScale);
  footerCropOffsetX.value = clamped.x;
  footerCropOffsetY.value = clamped.y;
}

function onFooterCropPointerDown(event: PointerEvent) {
  if (!footerCropImageSrc.value) return;
  const target = event.currentTarget as HTMLElement | null;
  target?.setPointerCapture(event.pointerId);
  footerCropPointer.value = {
    id: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: footerCropOffsetX.value,
    originY: footerCropOffsetY.value,
  };
}

function onFooterCropPointerMove(event: PointerEvent) {
  const pointer = footerCropPointer.value;
  if (!pointer || pointer.id !== event.pointerId) return;

  const deltaX = event.clientX - pointer.startX;
  const deltaY = event.clientY - pointer.startY;
  const clamped = clampCropOffsets(
    pointer.originX + deltaX,
    pointer.originY + deltaY,
    footerCropScale.value,
  );
  footerCropOffsetX.value = clamped.x;
  footerCropOffsetY.value = clamped.y;
}

function onFooterCropPointerUp(event: PointerEvent) {
  const target = event.currentTarget as HTMLElement | null;
  if (target?.hasPointerCapture(event.pointerId)) {
    target.releasePointerCapture(event.pointerId);
  }
  if (footerCropPointer.value?.id === event.pointerId) {
    footerCropPointer.value = null;
  }
}

async function applyFooterCrop() {
  if (isFooterCropBusy.value) return;
  if (!footerCropImageSrc.value) {
    footerCropError.value = 'Сначала добавьте фото.';
    return;
  }

  isFooterCropBusy.value = true;
  footerCropError.value = '';
  try {
    const image = await loadImageElement(footerCropImageSrc.value);
    const canvas = document.createElement('canvas');
    canvas.width = FOOTER_CROP_OUTPUT_SIZE;
    canvas.height = FOOTER_CROP_OUTPUT_SIZE;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas context unavailable');
    }

    const base = cropBaseSize();
    const scale = clampCropScale(footerCropScale.value);
    const renderedWidth = base.width * scale;
    const renderedHeight = base.height * scale;
    const topLeftX = FOOTER_CROP_VIEW_SIZE / 2 - renderedWidth / 2 + footerCropOffsetX.value;
    const topLeftY = FOOTER_CROP_VIEW_SIZE / 2 - renderedHeight / 2 + footerCropOffsetY.value;
    const outputScale = FOOTER_CROP_OUTPUT_SIZE / FOOTER_CROP_VIEW_SIZE;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.beginPath();
    context.arc(
      FOOTER_CROP_OUTPUT_SIZE / 2,
      FOOTER_CROP_OUTPUT_SIZE / 2,
      FOOTER_CROP_OUTPUT_SIZE / 2,
      0,
      Math.PI * 2,
    );
    context.closePath();
    context.clip();
    context.drawImage(
      image,
      topLeftX * outputScale,
      topLeftY * outputScale,
      renderedWidth * outputScale,
      renderedHeight * outputScale,
    );
    context.restore();

    const croppedImage = canvas.toDataURL('image/jpeg', 0.9);
    queueProfilePatch({
      image: croppedImage,
      emoji: '',
      logo: undefined,
    });
    footerCropImageSrc.value = croppedImage;
    footerCropOpen.value = false;
    footerCropPointer.value = null;
  } catch {
    footerCropError.value = 'Не удалось сохранить обрезку фото.';
  } finally {
    isFooterCropBusy.value = false;
  }
}

function onFooterColorClick() {
  footerColorInputRef.value?.click();
}

function onFooterColorInput(event: Event) {
  const input = event.target as HTMLInputElement | null;
  const color = input?.value;
  if (!color) return;
  queueProfilePatch({ color });
}

function onFooterImageClick() {
  footerImageInputRef.value?.click();
}

async function onFooterImageInput(event: Event) {
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0];
  if (!file) return;

  const image = await fileToDataUrl(file);
  if (!image) return;

  queueProfilePatch({
    image,
    emoji: '',
    logo: undefined,
  });

  footerCropError.value = '';
  if (footerCropOpen.value) {
    void initFooterCrop(image).catch(() => {
      footerCropError.value = 'Не удалось открыть фото для обрезки.';
    });
  }

  if (input) {
    input.value = '';
  }
}

function toggleFooterEmojiPanel() {
  if (footerEmojiOpen.value) {
    footerEmojiOpen.value = false;
    return;
  }
  footerLogoOpen.value = false;
  footerCropOpen.value = false;
  footerEmojiOpen.value = true;
}

function onFooterEmojiPick(item: EmojiItem) {
  queueProfilePatch({
    emoji: item.emoji,
    image: '',
    logo: undefined,
  });
  if (item.label) {
    queueEntityNameUpdate(item.label);
  }
  footerEmojiOpen.value = false;
}

function toggleFooterLogoPanel() {
  if (!footerCustomLogos.value.length) {
    footerCustomLogos.value = readCustomLogos();
  }
  if (footerLogoOpen.value) {
    footerLogoOpen.value = false;
    return;
  }
  footerEmojiOpen.value = false;
  footerCropOpen.value = false;
  footerLogoOpen.value = true;
}

function onFooterLogoPick(logo: LogoLibraryItem) {
  queueProfilePatch({
    logo: {
      id: logo.id,
      name: logo.name,
      background: logo.background,
      source: logo.source,
      image: logo.image,
      keywords: Array.isArray(logo.keywords) ? [...logo.keywords] : [],
    },
    color: logo.background,
    image: logo.image,
    emoji: '',
  });
  queueEntityNameUpdate(logo.name);
  footerLogoOpen.value = false;
}

function onFooterLogoUploadClick() {
  footerLogoUploadError.value = '';
  footerLogoInputRef.value?.click();
}

async function onFooterLogoUpload(event: Event) {
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0];
  if (!file) return;

  const name = footerCustomLogoName.value.trim();
  if (!name) {
    footerLogoUploadError.value = 'Введите название логотипа';
    if (input) input.value = '';
    return;
  }

  const image = await fileToDataUrl(file);
  if (!image) {
    footerLogoUploadError.value = 'Не удалось загрузить логотип';
    if (input) input.value = '';
    return;
  }

  footerCustomLogos.value = addCustomLogo({
    name,
    image,
    background: '#ffffff',
    keywords: createLogoKeywords(name),
  });
  footerCustomLogoName.value = '';
  footerLogoUploadError.value = '';

  if (input) {
    input.value = '';
  }
}

watch(
  () => props.entityId,
  async (entityId) => {
    if (!entityId) return;
    if (!authStore.isAuthenticated) {
      closeModal();
      return;
    }
    if (!entitiesStore.initialized) {
      await entitiesStore.bootstrap();
    }
    loadDraft(entityId);
  },
  { immediate: true },
);

watch(
  currentEntity,
  (entity) => {
    if (!entity && draft.value) {
      closeModal();
      return;
    }
    // SSE live-update: when the entity store receives entity.updated from the
    // server, merge the remote chatHistory into the local draft so other devices
    // see new chat messages without a page reload.
    const entityId = entity?._id;
    const draftId = draft.value?.entityId;
    const inFlight = isAiRequestInFlight.value;
    console.log('[Modal] watch(currentEntity) fired', {
      entityId,
      draftId,
      sameEntity: entityId === draftId,
      isAiRequestInFlight: inFlight,
      analysis_pending: entity ? Boolean((toProfile(entity.ai_metadata) as Record<string, unknown>).analysis_pending) : null,
      remote_chat_history_len: entity ? (Array.isArray((toProfile(entity.ai_metadata) as Record<string, unknown>).chat_history) ? ((toProfile(entity.ai_metadata) as Record<string, unknown>).chat_history as unknown[]).length : 0) : null,
      local_chat_history_len: draft.value?.chatHistory.length ?? null,
    });
    if (
      entity &&
      draft.value &&
      entity._id === draft.value.entityId
    ) {
      const remoteMeta = toProfile(entity.ai_metadata);
      const remoteName = typeof entity.name === 'string' ? entity.name : '';
      const remoteRawHistoryLen = Array.isArray(remoteMeta.chat_history) ? remoteMeta.chat_history.length : 0;
      const localHistoryLen = draft.value.chatHistory.length;
      const remoteHistory = normalizeChatHistory(remoteMeta.chat_history);
      const remoteAnalysisPending = Boolean(remoteMeta.analysis_pending);
      const remoteHasNewMessages =
        remoteHistory.length > localHistoryLen || remoteRawHistoryLen > localHistoryLen;
      const canHydrateHistoryFromRemote = remoteHistory.length >= localHistoryLen;
      const shouldHydrateFromRemote = remoteHasNewMessages && canHydrateHistoryFromRemote;
      console.log('[Modal][Sync] before', {
        entityId: entity._id,
        local_chat_history_len: localHistoryLen,
        remote_chat_history_len: remoteRawHistoryLen,
        remote_chat_history_normalized_len: remoteHistory.length,
        isAiRequestInFlight: isAiRequestInFlight.value,
        localAiRequestInFlight: localAiRequestInFlight.value,
        awaitingAiCompletionEntityId: awaitingAiCompletionEntityId.value,
        storePending: entitiesStore.isEntityAiPending(entity._id),
        analysis_pending: remoteAnalysisPending,
      });
      const remoteCompletedAtRaw =
        typeof remoteMeta.analysis_completed_at === 'string' ? remoteMeta.analysis_completed_at : '';
      const remoteCompletedAtMs = Date.parse(remoteCompletedAtRaw);
      const hasTrustedCompletionTimestamp =
        Number.isFinite(remoteCompletedAtMs) && remoteCompletedAtMs >= awaitingAiCompletionStartedAtMs.value;
      const shouldFinalizeInFlightFromRemote =
        awaitingAiCompletionEntityId.value === entity._id
        && !remoteAnalysisPending
        && (hasTrustedCompletionTimestamp || remoteHasNewMessages);
      if (shouldFinalizeInFlightFromRemote) {
        localAiRequestInFlight.value = false;
        clearAwaitingAiCompletion(entity._id);
        entitiesStore.setEntityAiPending(entity._id, false);
      }
      if (
        awaitingAiCompletionEntityId.value === entity._id &&
        !remoteAnalysisPending &&
        (
          (Number.isFinite(remoteCompletedAtMs) &&
            remoteCompletedAtMs >= awaitingAiCompletionStartedAtMs.value) ||
          remoteHasNewMessages
        )
      ) {
        localAiRequestInFlight.value = false;
        clearAwaitingAiCompletion(entity._id);
        entitiesStore.setEntityAiPending(entity._id, false);
      }

      const isNameFocused =
        typeof document !== 'undefined' && nameInputRef.value
          ? document.activeElement === nameInputRef.value
          : false;
      if (!isNameFocused) {
        const nextName = remoteName.trim();
        if (nextName && nextName !== draft.value.name.trim()) {
          draft.value.name = remoteName;
        }
      }

      if (!isAiRequestInFlight.value) {
        const remoteDescription = typeof remoteMeta.description === 'string' ? remoteMeta.description : '';
        const isDescriptionFocused =
          typeof document !== 'undefined' && descriptionTextareaRef.value
            ? document.activeElement === descriptionTextareaRef.value
            : false;

        if (!isDescriptionFocused && !isDescriptionResizing.value) {
          const next = remoteDescription.trim();
          if (next && next !== draft.value.description.trim()) {
            draft.value.description = remoteDescription;
          }
        }

        for (const field of getEntityContextFields(draft.value.type)) {
          if (editingFieldValue.value?.fieldKey === field.key) continue;

          const rawRemote = remoteMeta[field.key];
          const remoteValues = Array.isArray(rawRemote)
            ? normalizeMetadataValues(
                field.key,
                rawRemote.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean),
              )
            : [];

          const localValues = (Array.isArray(draft.value.metadataValues[field.key])
            ? draft.value.metadataValues[field.key]
            : []) as string[];

          if (remoteValues.length >= localValues.length) {
            draft.value.metadataValues[field.key] = remoteValues.slice(0, 24);
          }

          if (field.key === 'importance' && remoteValues.length) {
            draft.value.importanceSource = 'manual';
          }
        }
      }

      // Hydrate from SSE whenever remote history advanced (raw or normalized) so
      // background replies appear even if local in-flight flags are still set.
      if (shouldHydrateFromRemote) {
        draft.value.chatHistory = remoteHistory;
        void nextTick(() => scrollEntityChatToBottom('auto'));
        console.log('[Modal][Sync] decision', {
          action: 'hydrate',
          reason: shouldFinalizeInFlightFromRemote ? 'finalized_by_completion_signal' : 'remote_has_new_messages',
        });
      } else {
        const skipReasons: string[] = [];
        if (!remoteHasNewMessages) skipReasons.push('remote_not_newer');
        if (!shouldFinalizeInFlightFromRemote) skipReasons.push('not_finalized_by_completion_signal');
        if (!canHydrateHistoryFromRemote) skipReasons.push('normalized_remote_shorter_than_local');
        console.log('[Modal][Sync] decision', {
          action: 'skip_hydrate',
          reasons: skipReasons,
        });
      }
      console.log('[Modal][Sync] after', {
        entityId: entity._id,
        local_chat_history_len: draft.value.chatHistory.length,
        isAiRequestInFlight: isAiRequestInFlight.value,
      });
    }
  },
);

onMounted(() => {
  if (typeof window === 'undefined') return;
  window.addEventListener('resize', onDescriptionViewportResize);
  window.addEventListener('orientationchange', onDescriptionViewportResize);
  window.visualViewport?.addEventListener('resize', onDescriptionViewportResize);
});

onBeforeUnmount(() => {
  const currentDraft = draft.value;
  if (currentDraft) {
    persistDraft(currentDraft.entityId);
  }
  clearSaveTimer();
  voiceInput.cancelRecording();
  stopDescriptionResize();
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', onDescriptionViewportResize);
    window.removeEventListener('orientationchange', onDescriptionViewportResize);
    window.visualViewport?.removeEventListener('resize', onDescriptionViewportResize);
  }
});
</script>

<template>
  <div
    class="entity-info-overlay"
    @pointerdown.stop
    @touchstart.stop.prevent
    @touchend.stop.prevent
    @click.stop.prevent
    @click.self.prevent="closeModal"
  >
    <div
      v-if="draft"
      class="entity-info-modal"
      :class="{ 'mobile-footer-open': profileFooterOpen }"
      @pointerdown.stop="onModalPointerDown"
      @touchstart.stop
      @touchend.stop
      @click.stop
    >
      <header class="entity-info-header">
        <div v-if="modalIcon" class="entity-info-progress-avatar">
          <button
            type="button"
            class="profile-progress-content"
            title="Открыть быстрое меню"
            @click="toggleProfileFooter"
          >
            <ProfileProgressRing :value="profileProgress" :size="72" :stroke-width="5">
              <span
                class="entity-info-icon"
                :style="{ background: modalIcon.color, borderColor: modalIcon.color }"
              >
                <img
                  v-if="modalIcon.image && !modalIcon.hasLogo"
                  class="entity-info-icon-image"
                  :src="modalIcon.image"
                  alt=""
                />
                <img
                  v-else-if="modalIcon.hasLogo"
                  class="entity-info-icon-logo"
                  :src="modalIcon.image"
                  alt=""
                />
                <span v-else-if="modalIcon.emoji" class="entity-info-icon-emoji">{{ modalIcon.emoji }}</span>
                <AppIcon v-else :name="modalIcon.type" class="entity-info-icon-symbol" />
              </span>
            </ProfileProgressRing>
          </button>
        </div>

        <div class="entity-info-title">
          <div class="entity-info-title-row">
            <input
              ref="nameInputRef"
              v-model="draft.name"
              type="text"
              maxlength="64"
              class="entity-info-name-input"
              @input="onNameInput"
            />
            <button
              type="button"
              class="entity-info-close-btn entity-info-close-btn-inline"
              title="Закрыть"
              aria-label="Закрыть"
              @click="closeModal"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6 18 18" />
                <path d="M18 6 6 18" />
              </svg>
            </button>
          </div>
          <div class="entity-info-progress-meta">
            <label class="entity-info-mine-switch">
              <input
                type="checkbox"
                class="entity-info-mine-switch-input"
                :checked="mineToggleChecked"
                :disabled="isMineToggleBusy || isProjectActionBusy"
                @change="onMineToggleInput"
              />
              <span class="entity-info-mine-switch-track" aria-hidden="true">
                <span class="entity-info-mine-switch-thumb"></span>
              </span>
              <span class="entity-info-mine-switch-label">{{ mineToggleLabel }}</span>
            </label>
            <span class="entity-info-progress-level">{{ profileProgressLevel }}</span>
            <span class="entity-info-progress-percent">{{ profileProgress }}%</span>
          </div>
        </div>
      </header>

      <p v-if="projectActionMessage" class="entity-info-action-message">
        {{ projectActionMessage }}
      </p>

      <div class="entity-info-fixed">
        <section class="entity-info-section entity-info-profile">
          <button
            type="button"
            class="entity-info-profile-toggle"
            :class="{ expanded: isFieldsListExpanded }"
            @click="toggleFieldsListExpanded"
          >
            <span class="entity-info-profile-toggle-label">Профиль</span>
            <span class="entity-info-profile-toggle-count">
              {{ entityProfileFilledFieldCount }} / {{ entityProfileTotalFieldCount }}
            </span>
            <span class="entity-info-profile-toggle-chevron" aria-hidden="true"></span>
          </button>

          <div v-show="isFieldsListExpanded" class="entity-info-profile-body">
            <textarea
              ref="descriptionTextareaRef"
              v-model="draft.description"
              class="entity-info-textarea entity-info-description"
              :style="descriptionTextareaStyle"
              rows="2"
              placeholder="Описание"
              @input="onDescriptionInput"
            />
            <div
              class="entity-info-description-resize-handle"
              title="Изменить высоту описания"
              @pointerdown="onDescriptionResizePointerDown"
            />

            <div class="entity-info-fields-list">
              <div
                v-for="field in activeFields"
                :key="field.key"
                class="entity-info-field-row"
              >
                <div class="entity-info-field-scroll">
                  <input
                    :ref="(el) => setFieldInputRef(field.key, el)"
                    :value="getFieldDraft(field.key)"
                    type="text"
                    class="entity-info-tag-input"
                    :maxlength="getMetadataFieldMaxLength(field.key)"
                    :placeholder="getFieldPlaceholder(field)"
                    @input="onFieldDraftInput(field.key, $event)"
                    @keydown.enter.prevent="addFieldValue(field.key)"
                    @keydown="onFieldDraftKeydown(field.key, $event)"
                  />
                  <div
                    v-for="value in getFieldValues(field.key)"
                    :key="`${field.key}:${value}`"
                    class="entity-info-tag"
                  >
                    <button
                      type="button"
                      class="entity-info-tag-main"
                      :class="{ link: field.key === 'links' }"
                      :title="field.key === 'links' ? value : 'Редактировать'"
                      @click="field.key === 'links' ? openFieldLink(value) : startEditFieldValue(field.key, value)"
                    >
                      {{ field.key === 'links' ? getLinkChipLabel(value) : formatMetadataValueForDisplay(field.key, value) }}
                    </button>
                    <button
                      type="button"
                      class="entity-info-tag-remove"
                      title="Удалить"
                      @click.stop="removeFieldValue(field.key, value)"
                    >
                      ×
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section ref="chatFeedRef" class="entity-info-chat-feed">
        <article
          v-for="message in draft.chatHistory"
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
                @click="openChatAttachment(attachment)"
              >
                {{ attachment.name }}
              </button>
            </div>
          </div>
          <time class="entity-chat-time">{{ toDisplayTime(message.createdAt) }}</time>
        </article>
        <article v-if="shouldShowAiThinking" class="entity-chat-message assistant">
          <div class="entity-chat-bubble thinking">
            <span class="entity-chat-thinking-text">Думаю...</span>
          </div>
        </article>
      </section>

      <section class="entity-info-chat-composer">
        <div v-if="draft.pendingUploads.length" class="entity-info-pending-uploads">
          <span
            v-for="attachment in draft.pendingUploads"
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

        <div
          v-if="isResourceLinkPreviewLoading || resourceLinkPreview"
          class="entity-info-link-preview"
          :class="{
            loading: isResourceLinkPreviewLoading,
            error: resourceLinkPreview?.mode === 'error',
          }"
        >
          <p v-if="isResourceLinkPreviewLoading" class="entity-info-link-preview-title">
            Разбираю ссылку и готовлю текст для анализа...
          </p>
          <template v-else-if="resourceLinkPreview?.mode === 'ready'">
            <p class="entity-info-link-preview-title">
              Ссылка разобрана. В поле ввода подставлен очищенный блок, его можно проверить и отправить в LLM.
            </p>
            <p class="entity-info-link-preview-meta">
              {{ resourceLinkPreview.siteLabel || resourceLinkPreview.hostname }}
              <span v-if="resourceLinkPreview.title">• {{ resourceLinkPreview.title }}</span>
            </p>
          </template>
          <p v-else class="entity-info-link-preview-title">
            {{ resourceLinkPreview?.errorMessage }}
          </p>
        </div>

        <div class="entity-info-chat-bar">
          <textarea
            ref="chatInputRef"
            v-model="draft.textInput"
            class="entity-info-chat-input"
            :placeholder="chatPlaceholder"
            :disabled="isAiRequestInFlight || isVoiceTranscribing"
            rows="1"
            @input="onTextInput"
            @keydown="onChatComposerKeydown"
          />
        </div>
        <p v-if="voiceInput.errorMessage" class="entity-info-voice-error">{{ voiceInput.errorMessage }}</p>

        <div class="entity-info-chat-tools">
          <div class="entity-info-chat-tools-left">
            <button
              type="button"
              class="entity-info-chat-menu-btn"
              :class="{ open: isChatToolsMenuOpen }"
              title="Меню действий"
              :disabled="isAiRequestInFlight || isVoiceBusy"
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
              class="entity-info-hidden-input"
              multiple
              @change="onDocumentsChange"
            />

            <template v-if="isChatToolsMenuOpen">
              <div class="entity-chat-menu-backdrop" @click="closeChatToolsMenus" />
              <div class="entity-chat-menu-dropdown" @pointerdown.stop @click.stop>
                <p class="entity-chat-menu-label">Действия</p>
                <button
                  type="button"
                  class="entity-chat-menu-item"
                  :disabled="isAiRequestInFlight || isVoiceBusy"
                  @click="onChatToolsAction('import-documents')"
                >
                  Импорт документов
                </button>
                <button
                  v-if="entityProjects.length > 0"
                  type="button"
                  class="entity-chat-menu-item"
                  @click="onChatToolsAction('open-project')"
                >
                  Открыть в проекте
                </button>
                <button type="button" class="entity-chat-menu-item" @click="onChatToolsAction('copy-structure')">
                  Копировать структуру
                </button>
                <button type="button" class="entity-chat-menu-item" @click="onChatToolsAction('export-txt')">
                  Экспорт в TXT
                </button>
                <button type="button" class="entity-chat-menu-item" @click="onChatToolsAction('add-to-project')">
                  Добавить в проект
                </button>
                <button type="button" class="entity-chat-menu-item" @click="onChatToolsAction('clear-data')">
                  Сбросить данные
                </button>
                <button
                  type="button"
                  class="entity-chat-menu-item danger"
                  :disabled="isProjectActionBusy"
                  @click="onChatToolsAction('delete')"
                >
                  Удалить
                </button>
              </div>
            </template>

            <template v-if="entityProjects.length > 1 && isProjectNavDropdownOpen">
              <div class="entity-nav-backdrop" @click="isProjectNavDropdownOpen = false" />
              <div class="entity-nav-dropdown entity-nav-dropdown-chat">
                <p class="entity-nav-dropdown-label">Выберите проект</p>
                <button
                  v-for="project in entityProjects"
                  :key="project._id"
                  type="button"
                  class="entity-nav-dropdown-item"
                  @click="navigateToProject(project._id)"
                >
                  {{ project.name || 'Без названия' }}
                </button>
              </div>
            </template>
          </div>

          <div class="entity-info-chat-mic-anchor">
            <EntityVoicePromptTooltip :entity-type="voicePromptEntityType" :visible="isVoiceRecording" />
            <button
              type="button"
              class="entity-info-chat-icon-btn mic"
              :class="{ active: isVoiceRecording }"
              :title="isVoiceRecording ? 'Остановить запись' : 'Голосовой ввод'"
              :disabled="isAiRequestInFlight || isVoiceTranscribing || !voiceInput.isSupported"
              @click="onVoiceToggle"
            >
              <svg v-if="!isVoiceRecording" viewBox="0 0 24 24" aria-hidden="true">
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
          </div>

          <div v-if="isVoiceBusy" class="entity-info-voice-state">
            <div v-if="isVoiceRecording" class="entity-info-voice-wave">
              <span
                v-for="(bar, index) in voiceInput.waveformBars"
                class="entity-info-voice-bar"
                :key="`entity-voice-bar-${index}`"
                :style="{ height: `${bar}px` }"
              />
              <span class="entity-info-voice-listening">Прослушиваю</span>
            </div>
            <div v-else class="entity-info-voice-transcribing">
              <span class="entity-info-voice-spinner" />
              Расшифровываю...
            </div>
          </div>

          <button
            type="button"
            class="entity-info-chat-icon-btn send entity-info-chat-tools-send"
            :title="isVoiceRecording ? 'Завершить запись' : 'Отправить'"
            :disabled="
              isAiRequestInFlight ||
              isVoiceTranscribing ||
              (!isVoiceRecording && !draft.textInput.trim() && !draft.pendingUploads.length)
            "
            @click="isVoiceRecording ? void onVoiceConfirm() : void onSendInput()"
          >
            <svg v-if="!isVoiceRecording" class="entity-info-send-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 11.5 21 3l-7.5 18-2.6-7.1L3 11.5Z" />
            </svg>
            <svg v-else class="entity-info-check-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </button>
        </div>
      </section>

      <transition name="entity-side-footer">
        <section
          v-if="profileFooterOpen"
          class="entity-info-menu-footer"
          @pointerdown.stop
        >
          <button type="button" class="menu-circle-btn" title="Цвет" @click="onFooterColorClick">
            <input
              ref="footerColorInputRef"
              type="color"
              class="entity-info-hidden-input"
              @input="onFooterColorInput"
            />
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3a9 9 0 1 0 9 9c0-1-.8-1.8-1.8-1.8h-1.6a1.8 1.8 0 0 1 0-3.6h1.2A1.8 1.8 0 0 0 20.6 5 9 9 0 0 0 12 3Z" />
              <circle cx="7.5" cy="11.5" r="1" />
              <circle cx="10.5" cy="8.5" r="1" />
              <circle cx="14.5" cy="8.5" r="1" />
              <circle cx="16.5" cy="12.5" r="1" />
            </svg>
          </button>

          <button type="button" class="menu-circle-btn" title="Фото" @click="onFooterImageClick">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <circle cx="9" cy="10" r="1.7" />
              <path d="m21 16-4.5-4.5-4.2 4.2L10 13.4 5 18.4" />
            </svg>
          </button>
          <input
            ref="footerImageInputRef"
            type="file"
            accept="image/*"
            class="entity-info-hidden-input"
            @change="onFooterImageInput"
          />

          <button
            type="button"
            class="menu-circle-btn"
            :class="{ active: footerCropOpen }"
            title="Обрезать фото"
            @click="toggleFooterCropPanel"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M14 4h6v6" />
              <path d="M10 20H4v-6" />
              <path d="M20 10V4h-6" />
              <path d="M4 14v6h6" />
              <path d="M14 10 7 17" />
            </svg>
          </button>

          <button
            type="button"
            class="menu-circle-btn"
            :class="{ active: footerEmojiOpen }"
            title="Эмодзи"
            @click="toggleFooterEmojiPanel"
          >
            <span class="menu-btn-emoji">🙂</span>
          </button>

          <button
            type="button"
            class="menu-circle-btn"
            :class="{ active: footerLogoOpen }"
            title="Логотипы"
            @click="toggleFooterLogoPanel"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M7 14c0-2.2 1.8-4 4-4h6v8h-6a4 4 0 0 1-4-4Z" />
              <path d="M11 10V6h6v4" />
            </svg>
          </button>

          <div v-if="footerEmojiOpen" class="entity-footer-panel emoji-panel" @pointerdown.stop>
            <input
              v-model="footerEmojiQuery"
              type="text"
              class="entity-footer-search"
              placeholder="Поиск эмодзи..."
            />
            <div class="entity-footer-emoji-grid">
              <button
                v-for="item in filteredFooterEmoji"
                :key="`${item.emoji}-${item.label}`"
                type="button"
                class="entity-footer-emoji-btn"
                @click="onFooterEmojiPick(item)"
              >
                <span>{{ item.emoji }}</span>
              </button>
            </div>
          </div>

          <div v-if="footerLogoOpen" class="entity-footer-panel logo-panel" @pointerdown.stop>
            <input
              v-model="footerLogoQuery"
              type="text"
              class="entity-footer-search"
              placeholder="Поиск логотипа..."
            />

            <div class="entity-footer-logo-upload">
              <input
                v-model="footerCustomLogoName"
                type="text"
                class="entity-footer-upload-input"
                maxlength="32"
                placeholder="Название логотипа"
              />
              <button type="button" class="entity-footer-upload-btn" @click="onFooterLogoUploadClick">
                Загрузить
              </button>
              <input
                ref="footerLogoInputRef"
                type="file"
                accept="image/*,.svg"
                class="entity-info-hidden-input"
                @change="onFooterLogoUpload"
              />
            </div>
            <div v-if="footerLogoUploadError" class="entity-footer-upload-error">{{ footerLogoUploadError }}</div>

            <div class="entity-footer-logo-list">
              <button
                v-for="logo in filteredFooterSystemLogos"
                :key="logo.id"
                type="button"
                class="entity-footer-logo-item"
                @click="onFooterLogoPick(logo)"
              >
                <span class="entity-footer-logo-preview" :style="{ background: logo.background }">
                  <img :src="logo.image" alt="" />
                </span>
                <span class="entity-footer-logo-name">{{ logo.name }}</span>
              </button>
              <button
                v-for="logo in filteredFooterCustomLogos"
                :key="logo.id"
                type="button"
                class="entity-footer-logo-item custom"
                @click="onFooterLogoPick(logo)"
              >
                <span class="entity-footer-logo-preview" :style="{ background: logo.background }">
                  <img :src="logo.image" alt="" />
                </span>
                <span class="entity-footer-logo-name">{{ logo.name }}</span>
              </button>
            </div>
          </div>

          <div v-if="footerCropOpen" class="entity-footer-panel crop-panel" @pointerdown.stop>
            <div
              class="entity-footer-crop-stage"
              @pointerdown="onFooterCropPointerDown"
              @pointermove="onFooterCropPointerMove"
              @pointerup="onFooterCropPointerUp"
              @pointercancel="onFooterCropPointerUp"
            >
              <div
                class="entity-footer-crop-circle"
                :class="{ dragging: Boolean(footerCropPointer) }"
              >
                <img
                  v-if="footerCropImageSrc"
                  :src="footerCropImageSrc"
                  alt=""
                  class="entity-footer-crop-image"
                  :style="footerCropImageStyle"
                  draggable="false"
                />
                <span v-else class="entity-footer-crop-empty">Нет фото</span>
              </div>
            </div>

            <input
              type="range"
              min="1"
              max="4"
              step="0.01"
              :value="footerCropScale"
              class="entity-footer-crop-slider"
              @input="onFooterCropScaleInput"
            />

            <div class="entity-footer-crop-actions">
              <button
                type="button"
                class="entity-footer-upload-btn"
                :disabled="isFooterCropBusy"
                @click="toggleFooterCropPanel"
              >
                Отмена
              </button>
              <button
                type="button"
                class="entity-footer-upload-btn primary"
                :disabled="isFooterCropBusy || !footerCropImageSrc"
                @click="applyFooterCrop"
              >
                {{ isFooterCropBusy ? 'Сохранение...' : 'Сохранить' }}
              </button>
            </div>

            <div v-if="footerCropError" class="entity-footer-upload-error">
              {{ footerCropError }}
            </div>
          </div>
        </section>
      </transition>
    </div>

      <div
        v-if="isProjectAddConfirmOpen"
        class="entity-delete-confirm-overlay"
        @pointerdown.stop
        @touchstart.stop.prevent
        @touchend.stop.prevent
        @click.stop.prevent
        @click.self.prevent="closeProjectAddConfirm"
      >
      <div
        class="entity-delete-confirm-card entity-project-confirm-card"
        @pointerdown.stop
        @touchstart.stop
        @touchend.stop
        @click.stop
      >
        <h3 class="entity-delete-confirm-title">Добавить в проект</h3>
        <p class="entity-delete-confirm-text">Выберите проект для добавления текущей записи.</p>
        <select v-model="selectedProjectId" class="entity-info-project-select" :disabled="isProjectActionBusy">
          <option value="">Выберите проект</option>
          <option v-for="project in availableProjectOptions" :key="project._id" :value="project._id">
            {{ project.name || 'Без названия' }}
          </option>
        </select>
        <div class="entity-delete-confirm-actions">
          <button
            type="button"
            class="entity-delete-confirm-btn secondary"
            :disabled="isProjectActionBusy"
            @click="closeProjectAddConfirm"
          >
            Отмена
          </button>
          <button
            type="button"
            class="entity-delete-confirm-btn primary"
            :disabled="isProjectActionBusy || !selectedProjectId"
            @click="confirmProjectAdd"
          >
            Подтвердить
          </button>
        </div>
        </div>
      </div>

      <div
        v-if="isChatClearConfirmOpen"
        class="entity-delete-confirm-overlay"
        @pointerdown.stop
        @touchstart.stop.prevent
        @touchend.stop.prevent
        @click.stop.prevent
        @click.self.prevent="closeClearChatConfirm"
      >
        <div
          class="entity-delete-confirm-card entity-project-confirm-card"
          @pointerdown.stop
          @touchstart.stop
          @touchend.stop
          @click.stop
        >
          <h3 class="entity-delete-confirm-title">Сбросить данные?</h3>
          <p class="entity-delete-confirm-text">
            Будут удалены описание, чат, документы, метки, теги и остальные поля записи.
          </p>
          <p class="entity-delete-confirm-text">Останутся только имя и фото.</p>
          <div class="entity-delete-confirm-actions">
            <button
              type="button"
              class="entity-delete-confirm-btn secondary"
              :disabled="isProjectActionBusy"
              @click="closeClearChatConfirm"
            >
              Отмена
            </button>
            <button
              type="button"
              class="entity-delete-confirm-btn primary"
              :disabled="isProjectActionBusy"
              @click="confirmClearChatHistory"
            >
              Сбросить
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="isDeleteConfirmOpen"
        class="entity-delete-confirm-overlay"
        @pointerdown.stop
        @touchstart.stop.prevent
        @touchend.stop.prevent
        @click.stop.prevent
        @click.self.prevent="closeDeleteConfirm"
      >
      <div
        class="entity-delete-confirm-card"
        @pointerdown.stop
        @touchstart.stop
        @touchend.stop
        @click.stop
      >
        <h3 class="entity-delete-confirm-title">Удалить?</h3>
        <p class="entity-delete-confirm-text">
          "{{ deleteConfirmName }}" будет удалено из коллекции, базы и всех проектов.
        </p>
        <p class="entity-delete-confirm-warning">Действие необратимо.</p>
        <div class="entity-delete-confirm-actions">
          <button
            type="button"
            class="entity-delete-confirm-btn secondary"
            :disabled="isProjectActionBusy"
            @click="closeDeleteConfirm"
          >
            Отмена
          </button>
          <button
            type="button"
            class="entity-delete-confirm-btn danger"
            :disabled="isProjectActionBusy"
            @click="onDeleteEntity"
          >
            Удалить
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
  position: relative;
  overflow: visible;
  border-radius: 18px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  box-shadow: 0 28px 52px rgba(15, 23, 42, 0.3);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.entity-info-close-btn {
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

.entity-info-close-btn svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.entity-info-close-btn:hover {
  color: #1058ff;
  border-color: #bfd5ff;
  background: #eef4ff;
}

.entity-info-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-right: 0;
}

.entity-info-progress-avatar {
  width: 72px;
  height: 72px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.profile-progress-content {
  width: 72px;
  height: 72px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.16s ease;
}

.profile-progress-content:hover {
  transform: translateY(-1px);
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
  overflow: hidden;
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

.entity-info-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.entity-info-name-input {
  width: 100%;
  max-width: none;
  flex: 1 1 auto;
  min-width: 0;
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

.entity-info-close-btn-inline {
  flex-shrink: 0;
}

.entity-info-title-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.entity-info-title-action-btn {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  border: 1px solid #dbe4f3;
  background: #f8fafc;
  color: #475569;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    color 0.16s ease,
    border-color 0.16s ease,
    background-color 0.16s ease;
}

.entity-info-title-action-btn svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.entity-info-title-action-btn:hover:not(:disabled) {
  color: #1058ff;
  border-color: #bfd5ff;
  background: #eef4ff;
}

.entity-info-title-action-btn.danger {
  color: #b91c1c;
  border-color: #fecaca;
  background: #fff1f2;
}

.entity-info-title-action-btn.danger:hover:not(:disabled) {
  color: #991b1b;
  border-color: #fca5a5;
  background: #ffe4e6;
}

.entity-info-title-action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* ── Navigate-to-project dropdown ───────────────────────────────────────────── */
.entity-nav-projects-wrap {
  position: relative;
  display: inline-flex;
}

.entity-nav-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1100;
}

.entity-nav-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 1101;
  min-width: 180px;
  max-width: 260px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(112, 144, 176, 0.18);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.entity-nav-dropdown.entity-nav-dropdown-chat {
  left: 0;
  right: auto;
  top: auto;
  bottom: calc(100% + 8px);
}

.entity-nav-dropdown-label {
  font-size: 10px;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 4px 8px 6px;
  margin: 0;
}

.entity-nav-dropdown-item {
  width: 100%;
  text-align: left;
  padding: 7px 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #1e293b;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.3;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background 0.13s ease, color 0.13s ease;
}

.entity-nav-dropdown-item:hover {
  background: #eef4ff;
  color: #1058ff;
}

.entity-info-progress-meta {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  min-height: 16px;
  flex-wrap: wrap;
}

.entity-info-mine-switch {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  cursor: pointer;
}

.entity-info-mine-switch-input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  border: 0;
  clip: rect(0, 0, 0, 0);
  overflow: hidden;
  white-space: nowrap;
}

.entity-info-mine-switch-track {
  width: 34px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 999px;
  border: 1px solid #dbe4f3;
  background: #e2e8f0;
  display: inline-flex;
  align-items: center;
  padding: 1px;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease;
}

.entity-info-mine-switch-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.25);
  transition: transform 0.18s ease;
}

.entity-info-mine-switch-input:checked + .entity-info-mine-switch-track {
  background: #1058ff;
  border-color: #1058ff;
}

.entity-info-mine-switch-input:checked + .entity-info-mine-switch-track .entity-info-mine-switch-thumb {
  transform: translateX(14px);
}

.entity-info-mine-switch-input:focus-visible + .entity-info-mine-switch-track {
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.24);
}

.entity-info-mine-switch-input:disabled + .entity-info-mine-switch-track,
.entity-info-mine-switch-input:disabled + .entity-info-mine-switch-track + .entity-info-mine-switch-label {
  opacity: 0.55;
}

.entity-info-mine-switch-label {
  color: #64748b;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.entity-info-progress-level {
  margin-left: auto;
  color: #64748b;
  font-size: 11px;
  font-weight: 600;
}

.entity-info-progress-percent {
  color: #1058ff;
  font-size: 12px;
  font-weight: 700;
}

.entity-info-project-select {
  width: 100%;
  min-width: 0;
  height: 32px;
  border-radius: 10px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  color: #0f172a;
  font-size: 12px;
  font-weight: 600;
  outline: none;
  padding: 0 10px;
}

.entity-info-project-select:focus {
  border-color: #bfdbfe;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.14);
}

.entity-info-action-message {
  margin: -4px 0 0;
  min-height: 14px;
  color: #475569;
  font-size: 11px;
  font-weight: 600;
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
  min-height: 54px;
  max-height: none;
  overflow-y: auto;
}

.entity-info-description-resize-handle {
  width: 100%;
  height: 14px;
  margin-top: -6px;
  cursor: ns-resize;
  touch-action: none;
}

.entity-info-description-resize-handle::before {
  content: '';
  display: block;
  width: 44px;
  height: 4px;
  margin: 4px auto 0;
  border-radius: 999px;
  background: #cbd5e1;
}

.entity-info-profile {
  gap: 8px;
}

.entity-info-profile-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  height: 30px;
  border: 1px solid #dbe4f3;
  border-radius: 10px;
  background: #ffffff;
  color: #334155;
  font-size: 11px;
  font-weight: 700;
  padding: 0 10px;
  cursor: pointer;
}

.entity-info-profile-toggle-label {
  line-height: 1;
}

.entity-info-profile-toggle-count {
  margin-left: auto;
  color: #64748b;
  font-size: 10px;
  font-weight: 700;
}

.entity-info-profile-toggle-chevron {
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 6px solid #64748b;
  transition: transform 0.16s ease;
}

.entity-info-profile-toggle.expanded .entity-info-profile-toggle-chevron {
  transform: rotate(180deg);
}

.entity-info-profile-body {
  border-top: 1px solid #eef3fb;
  padding-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.entity-info-fields-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
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
  gap: 4px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 4px 6px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.entity-info-field-scroll::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

.entity-info-tag {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: 1px solid #bfd5ff;
  border-radius: 999px;
  background: #eff6ff;
  padding: 1px 3px 1px 6px;
}

.entity-info-tag-main {
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

.entity-info-tag-main.link {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.entity-info-tag-remove {
  width: 14px;
  height: 14px;
  border: none;
  border-radius: 50%;
  background: rgba(30, 64, 175, 0.14);
  color: #1e3a8a;
  font-size: 11px;
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

.entity-info-tag:hover .entity-info-tag-remove,
.entity-info-tag:focus-within .entity-info-tag-remove {
  opacity: 1;
  pointer-events: auto;
}

.entity-info-tag-remove:hover {
  background: rgba(30, 64, 175, 0.24);
}

.entity-info-tag-input {
  flex: 0 0 126px;
  min-width: 108px;
  max-width: 180px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #0f172a;
  font-size: 11px;
  font-weight: 600;
  outline: none;
  padding: 4px 6px;
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

.entity-info-link-preview {
  border-radius: 12px;
  border: 1px solid #dbe4f3;
  background: linear-gradient(180deg, #f8fbff 0%, #f1f6ff 100%);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.entity-info-link-preview.loading {
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
}

.entity-info-link-preview.error {
  border-color: rgba(180, 35, 24, 0.2);
  background: linear-gradient(180deg, #fff7f6 0%, #ffefed 100%);
}

.entity-info-link-preview-title,
.entity-info-link-preview-meta {
  margin: 0;
}

.entity-info-link-preview-title {
  color: #0f172a;
  font-size: 12px;
  line-height: 1.45;
}

.entity-info-link-preview-meta {
  color: #64748b;
  font-size: 11px;
  line-height: 1.35;
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
  gap: 6px;
  align-items: stretch;
  border: 1px solid #dbe4f3;
  border-radius: 12px;
  background: #ffffff;
  padding: 4px 8px;
}

.entity-info-chat-tools {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(120px, 1fr) auto;
  align-items: center;
  gap: 8px;
  position: relative;
  border-top: 1px solid #e8edf7;
  padding-top: 7px;
}

.entity-info-voice-error {
  margin: 0;
  color: #b42318;
  font-size: 12px;
}

.entity-info-chat-tools-left {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-self: start;
  position: relative;
}

.entity-info-chat-menu-btn {
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

.entity-info-chat-menu-btn svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 0.16s ease;
}

.entity-info-chat-menu-btn:hover,
.entity-info-chat-menu-btn.open {
  color: #1058ff;
  border-color: #bfd5ff;
  background: #eef4ff;
}

.entity-info-chat-menu-btn.open svg {
  transform: rotate(180deg);
}

.entity-info-chat-menu-btn:disabled,
.entity-info-chat-menu-btn:disabled:hover {
  cursor: wait;
  opacity: 0.6;
  color: #9aa9c2;
  border-color: #dbe4f3;
  background: #f5f8ff;
}

.entity-chat-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1099;
}

.entity-chat-menu-dropdown {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  z-index: 1101;
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

.entity-chat-menu-label {
  margin: 0;
  padding: 5px 8px 6px;
  font-size: 10px;
  line-height: 1;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #94a3b8;
}

.entity-chat-menu-item {
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

.entity-chat-menu-item:hover:not(:disabled) {
  background: #eef4ff;
  color: #1058ff;
}

.entity-chat-menu-item.danger {
  color: #b91c1c;
}

.entity-chat-menu-item.danger:hover:not(:disabled) {
  color: #b91c1c;
  background: #ffe4e6;
}

.entity-chat-menu-item:disabled,
.entity-chat-menu-item:disabled:hover {
  cursor: wait;
  opacity: 0.55;
  background: transparent;
  color: #94a3b8;
}

.entity-info-chat-icon-btn {
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

.entity-info-chat-icon-btn svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.entity-info-chat-icon-btn:hover {
  transform: translateY(-1px);
}

.entity-info-chat-icon-btn.mic {
  position: relative;
  justify-self: center;
  color: #ffffff;
  background: #1058ff;
  border-color: #1058ff;
}

.entity-info-chat-mic-anchor {
  position: relative;
  justify-self: center;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.entity-info-chat-icon-btn.mic.active {
  background: #d92d20;
  border-color: #d92d20;
}

.entity-info-chat-icon-btn.mic.active::after {
  content: '';
  position: absolute;
  inset: -5px;
  border-radius: 999px;
  border: 2px solid rgba(217, 45, 32, 0.45);
  animation: entity-voice-record-pulse 1.2s ease-out infinite;
}

.entity-info-chat-icon-btn.send {
  color: #ffffff;
  background: #1058ff;
  border-color: #1058ff;
}

.entity-info-chat-tools-send {
  justify-self: end;
}

.entity-info-send-icon {
  fill: currentColor;
  stroke: none;
}

.entity-info-check-icon {
  fill: none;
  stroke: currentColor;
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.entity-info-voice-state {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.entity-info-voice-wave {
  height: 24px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.entity-info-voice-bar {
  width: 4px;
  border-radius: 999px;
  background: linear-gradient(180deg, #1f6aff 0%, #1058ff 100%);
  transition: height 0.12s ease;
}

.entity-info-voice-listening {
  margin-left: 4px;
  color: #1058ff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.entity-info-voice-transcribing {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #475569;
  font-size: 11px;
  font-weight: 700;
}

.entity-info-voice-spinner {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 2px solid rgba(16, 88, 255, 0.2);
  border-top-color: #1058ff;
  animation: entity-voice-spinner 0.7s linear infinite;
}

.entity-info-chat-icon-btn:disabled,
.entity-info-chat-icon-btn:disabled:hover {
  cursor: wait;
  opacity: 0.6;
  color: #9aa9c2;
  border-color: #dbe4f3;
  background: #f5f8ff;
  transform: none;
}

.entity-info-chat-icon-btn.send:disabled,
.entity-info-chat-icon-btn.send:disabled:hover {
  color: #ffffff;
  background: #1058ff;
  border-color: #1058ff;
  opacity: 0.58;
}

@keyframes entity-voice-record-pulse {
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

@keyframes entity-voice-spinner {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 900px) {
  .entity-info-overlay {
    align-items: flex-start;
    padding-top: max(8px, env(safe-area-inset-top, 0px));
    padding-right: 10px;
    padding-bottom: max(8px, env(safe-area-inset-bottom, 0px));
    padding-left: 10px;
  }

  .entity-info-modal {
    width: min(560px, 100%);
    height: calc(
      100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 16px
    );
    max-height: calc(
      100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 16px
    );
    border-radius: 14px;
    padding: 12px;
    gap: 8px;
    transition: transform 0.16s ease;
  }

  .entity-info-modal.mobile-footer-open {
    transform: translateX(min(44px, 12vw));
  }

  .entity-info-header {
    gap: 9px;
    padding-right: 0;
  }

  .entity-info-progress-avatar,
  .profile-progress-content {
    width: 66px;
    height: 66px;
  }

  .entity-info-name-input {
    font-size: 14px;
    padding: 7px 9px;
    width: 100%;
    max-width: none;
  }

  .entity-info-progress-level {
    font-size: 10px;
  }

  .entity-info-mine-switch-label {
    font-size: 10px;
  }

  .entity-info-progress-percent {
    font-size: 11px;
  }

  .entity-info-project-select {
    height: 30px;
    font-size: 11px;
  }

  .entity-info-title-action-btn {
    width: 28px;
    height: 28px;
  }

  .entity-info-textarea,
  .entity-info-chat-input {
    font-size: 12px;
  }

  .entity-info-chat-input {
    max-height: 42vh;
  }

  .entity-info-chat-tools {
    grid-template-columns: minmax(0, 1fr) auto auto;
    grid-template-areas:
      'left mic send'
      'state state state';
  }

  .entity-info-chat-tools-left {
    grid-area: left;
  }

  .entity-info-chat-mic-anchor {
    grid-area: mic;
  }

  .entity-info-voice-state {
    grid-area: state;
    justify-self: start;
  }

  .entity-info-chat-tools-send {
    grid-area: send;
  }

  .entity-info-field-scroll {
    padding: 4px 6px;
  }

  .entity-info-tag-input {
    flex-basis: 118px;
    min-width: 96px;
    font-size: 11px;
  }

  .entity-info-tag-main {
    font-size: 10px;
  }

  .entity-info-chat-feed {
    padding: 8px;
    gap: 7px;
  }

  .entity-info-menu-footer {
    left: -52px;
  }
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
  max-height: 360px;
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

.entity-info-menu-footer {
  position: absolute;
  left: -54px;
  top: 18px;
  width: 46px;
  border-radius: 14px;
  border: 1px solid #dbe4f3;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.22);
  padding: 7px 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  z-index: 22;
}

.entity-side-footer-enter-active,
.entity-side-footer-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.entity-side-footer-enter-from,
.entity-side-footer-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}

.menu-circle-btn {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  color: #64748b;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    color 0.16s ease,
    border-color 0.16s ease,
    background-color 0.16s ease;
}

.menu-circle-btn svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.menu-btn-emoji {
  font-size: 16px;
  line-height: 1;
}

.menu-circle-btn:hover,
.menu-circle-btn.active {
  color: #1058ff;
  border-color: #bfd5ff;
  background: #eef4ff;
}

.entity-footer-panel {
  position: absolute;
  left: calc(100% + 10px);
  top: 0;
  width: 290px;
  max-width: min(290px, calc(100vw - 96px));
  border-radius: 12px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  box-shadow: 0 14px 24px rgba(15, 23, 42, 0.2);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.entity-footer-panel.crop-panel {
  width: 306px;
  max-width: min(306px, calc(100vw - 96px));
}

.entity-footer-search {
  width: 100%;
  height: 30px;
  border: 1px solid #dbe4f3;
  border-radius: 8px;
  outline: none;
  padding: 0 10px;
  font-size: 12px;
  color: #0f172a;
}

.entity-footer-search:focus {
  border-color: #bfdbfe;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.14);
}

.entity-footer-emoji-grid {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 6px;
  max-height: 156px;
  overflow-y: auto;
  padding-right: 2px;
}

.entity-footer-emoji-btn {
  height: 30px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}

.entity-footer-emoji-btn:hover {
  border-color: #bfd5ff;
  background: #eef4ff;
}

.entity-footer-logo-upload {
  display: flex;
  align-items: center;
  gap: 6px;
}

.entity-footer-upload-input {
  flex: 1;
  min-width: 0;
  height: 30px;
  border: 1px solid #dbe4f3;
  border-radius: 8px;
  padding: 0 9px;
  font-size: 12px;
  color: #0f172a;
  outline: none;
}

.entity-footer-upload-input:focus {
  border-color: #bfdbfe;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.14);
}

.entity-footer-upload-btn {
  height: 30px;
  border-radius: 8px;
  border: 1px solid #dbe4f3;
  background: #f8fafc;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
  padding: 0 10px;
  cursor: pointer;
}

.entity-footer-upload-btn.primary {
  border-color: #1058ff;
  background: #1058ff;
  color: #ffffff;
}

.entity-footer-upload-btn.primary:hover {
  border-color: #0c46cc;
  background: #0c46cc;
  color: #ffffff;
}

.entity-footer-upload-btn:hover {
  border-color: #bfd5ff;
  background: #eef4ff;
  color: #1058ff;
}

.entity-footer-upload-error {
  color: #b91c1c;
  font-size: 11px;
  font-weight: 600;
}

.entity-footer-logo-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 170px;
  overflow-y: auto;
  padding-right: 2px;
}

.entity-footer-logo-item {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #f8fafc;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  cursor: pointer;
}

.entity-footer-logo-item:hover {
  border-color: #bfd5ff;
  background: #eef4ff;
}

.entity-footer-logo-item.custom {
  border-style: dashed;
}

.entity-footer-logo-preview {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}

.entity-footer-logo-preview img {
  width: 16px;
  height: 16px;
  object-fit: contain;
}

.entity-footer-logo-name {
  color: #334155;
  font-size: 12px;
  font-weight: 700;
}

.entity-footer-crop-stage {
  border: 1px solid #dbe4f3;
  border-radius: 12px;
  background: #f8fafc;
  padding: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.entity-footer-crop-circle {
  width: 220px;
  height: 220px;
  border-radius: 999px;
  border: 1px solid #bfd5ff;
  overflow: hidden;
  position: relative;
  background: radial-gradient(circle at 50% 44%, #eef4ff, #dbeafe);
  touch-action: none;
  user-select: none;
  cursor: grab;
}

.entity-footer-crop-circle.dragging {
  cursor: grabbing;
}

.entity-footer-crop-image {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform-origin: center center;
  pointer-events: none;
}

.entity-footer-crop-empty {
  position: absolute;
  inset: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.entity-footer-crop-slider {
  width: 100%;
}

.entity-footer-crop-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.entity-delete-confirm-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.38);
  border-radius: 18px;
}

.entity-delete-confirm-card {
  width: min(360px, calc(100% - 24px));
  border-radius: 14px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.28);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.entity-delete-confirm-title {
  margin: 0;
  color: #0f172a;
  font-size: 15px;
  font-weight: 800;
}

.entity-delete-confirm-text {
  margin: 0;
  color: #334155;
  font-size: 13px;
  line-height: 1.4;
}

.entity-delete-confirm-warning {
  margin: 0;
  color: #b91c1c;
  font-size: 12px;
  font-weight: 700;
}

.entity-delete-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.entity-delete-confirm-btn {
  height: 32px;
  border-radius: 10px;
  border: 1px solid #dbe4f3;
  background: #f8fafc;
  color: #1e293b;
  font-size: 12px;
  font-weight: 700;
  padding: 0 12px;
  cursor: pointer;
}

.entity-delete-confirm-btn.primary {
  border-color: #1058ff;
  background: #1058ff;
  color: #ffffff;
}

.entity-delete-confirm-btn.primary:hover:not(:disabled) {
  border-color: #0d48d4;
  background: #0d48d4;
}

.entity-delete-confirm-btn.secondary:hover:not(:disabled) {
  border-color: #bfd5ff;
  background: #eef4ff;
  color: #1058ff;
}

.entity-delete-confirm-btn.danger {
  border-color: #fecaca;
  background: #fff1f2;
  color: #b91c1c;
}

.entity-delete-confirm-btn.danger:hover:not(:disabled) {
  border-color: #fca5a5;
  background: #ffe4e6;
}

.entity-delete-confirm-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

</style>
