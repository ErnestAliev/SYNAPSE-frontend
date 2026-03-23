<script setup lang="ts">
import axios from 'axios';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  WEB_SEARCH_IMAGE_DRAG_MIME,
  type WebSearchDraggedImagePayload,
  type WebSearchImageResult,
} from '../../constants/webSearch';
import { apiClient } from '../../services/api';
import { useEntitiesStore } from '../../stores/entities';
import type { EntityType } from '../../types/entity';

type SearchMetadataFieldKey =
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

interface SearchMetadataFieldConfig {
  key: SearchMetadataFieldKey;
  label: string;
}

const SEARCH_FIELD_MAX_LENGTH = 32;
const SEARCH_LINK_MAX_LENGTH = 2048;
const SEARCH_PHONE_DISPLAY_MAX_LENGTH = 20;
const SEARCH_PHONE_DIGITS_MAX_LENGTH = 15;
const SEARCH_IMPORTANCE_LEVEL_MAP: Record<string, string> = {
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
const SEARCH_LINK_CHIP_FALLBACK_LABEL = 'Website';
const SEARCH_QUERY_PLACEHOLDERS: Record<EntityType, string> = {
  connection: 'Тема + страна + город + контекст',
  person: 'Имя + страна + город + должность',
  company: 'Компания + страна + город + отрасль',
  event: 'Событие + страна + город + дата',
  goal: 'Цель + страна + город + контекст',
  result: 'Результат + страна + город + контекст',
  resource: 'Ресурс + страна + город + контекст',
  shape: 'Название + страна + город + контекст',
  task: 'Задача + страна + город + контекст',
  project: 'Тема + страна + город + контекст',
};
const SEARCH_QUERY_HINTS: Record<EntityType, string> = {
  connection: 'Уточнение через +: тема + страна + город + контекст',
  person: 'Уточнение через +: имя + страна + город + должность',
  company: 'Уточнение через +: компания + страна + город + отрасль',
  event: 'Уточнение через +: событие + страна + город + дата',
  goal: 'Уточнение через +: цель + страна + город + контекст',
  result: 'Уточнение через +: результат + страна + город + контекст',
  resource: 'Уточнение через +: ресурс + страна + город + контекст',
  shape: 'Уточнение через +: название + страна + город + контекст',
  task: 'Уточнение через +: задача + страна + город + контекст',
  project: 'Уточнение через +: тема + страна + город + контекст',
};
const SEARCH_LINK_CHIP_LABELS: Array<{ label: string; domains: string[] }> = [
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
const SEARCH_ENTITY_CONTEXT_FIELDS: Record<EntityType, SearchMetadataFieldConfig[]> = {
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

interface WebSearchCitation {
  id: string;
  sourceIndex: number;
  title: string;
  url: string;
  domain: string;
  startIndex: number;
  endIndex: number;
}

interface WebSearchFieldSuggestion {
  status: 'idle' | 'ready';
  fields: Record<string, string[]>;
  updatedAt: string;
  model: string;
}

interface WebSearchStateEntry {
  status: 'idle' | 'searching' | 'ready' | 'failed';
  phase: '' | 'summary' | 'images' | 'fields' | 'ready' | 'failed';
  query: string;
  summary: string;
  citations: WebSearchCitation[];
  images: WebSearchImageResult[];
  errorMessage: string;
  startedAt: string;
  completedAt: string;
  updatedAt: string;
  model: string;
  sourceCount: number;
  searchQueries: string[];
  fieldSuggestion: WebSearchFieldSuggestion;
}

interface WebSearchState extends WebSearchStateEntry {
  history: WebSearchStateEntry[];
}

type AnswerSegment =
  | {
      key: string;
      type: 'text';
      text: string;
    }
  | {
      key: string;
      type: 'citation';
      citation: WebSearchCitation;
    };

const PANEL_SIZE_STORAGE_KEY = 'synapse12.web-search.panel-size.v3';
const PANEL_CONTEXT_STORAGE_PREFIX = 'synapse12.web-search.context.v1';
const PANEL_FIELDS_DRAFT_STORAGE_PREFIX = 'synapse12.web-search.fields-draft.v1';
const RESERVED_WIDTH_CSS_VAR = '--synapse-web-search-reserved-width';
const PANEL_TOP_OFFSET_PX = 60;
const PANEL_EDGE_MARGIN_PX = 14;
const PANEL_MIN_WIDTH_PX = 360;
const PANEL_MAX_WIDTH_PX = 760;
const PANEL_MIN_HEIGHT_PX = 360;
const PANEL_DEFAULT_WIDTH_PX = 520;
const NARROW_VIEWPORT_PX = 900;

const route = useRoute();
const entitiesStore = useEntitiesStore();
const props = defineProps<{
  activeEntityId?: string;
}>();

const isOpen = ref(false);
const isSubmitting = ref(false);
const isLoadingEntityState = ref(false);
const queryDraft = ref('');
const searchInputRef = ref<HTMLInputElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const isQueryFocused = ref(false);
const localErrorMessage = ref('');
const copyNotice = ref('');
const copyNoticeTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const runtimeTickTimer = ref<ReturnType<typeof setInterval> | null>(null);
const nowTimestamp = ref(Date.now());
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1366);
const viewportHeight = ref(typeof window !== 'undefined' ? window.innerHeight : 768);
const panelSize = ref<{ width: number; height: number } | null>(loadStoredPanelSize());
const isResizingPanel = ref(false);
const resizePointerId = ref<number | null>(null);
const resizeStart = ref<{
  clientX: number;
  clientY: number;
  width: number;
  height: number;
} | null>(null);
const restoredSessionEntityId = ref('');
const pendingStateLoads = new Map<string, Promise<void>>();
const searchFieldValueDrafts = ref<Record<string, string>>({});
const editableSearchFieldValues = ref<Record<string, string[]>>({});
const editingSearchFieldValue = ref<{ fieldKey: string; originalValue: string } | null>(null);
const isFieldsSectionExpanded = ref(true);
const isImagesSectionExpanded = ref(true);
const isSummarySectionExpanded = ref(true);

function toProfile(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

function normalizeRouteParam(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0].trim() : '';
  return '';
}

function normalizeWebUrl(rawValue: unknown) {
  const raw = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!raw) return '';

  try {
    const url = new URL(raw);
    for (const key of Array.from(url.searchParams.keys())) {
      if (key.toLowerCase().startsWith('utm_')) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return '';
  }
}

function getSearchContextFields(type: EntityType) {
  return SEARCH_ENTITY_CONTEXT_FIELDS[type] || [];
}

function buildSearchFieldDrafts(type: EntityType) {
  const drafts: Record<string, string> = {};
  for (const field of getSearchContextFields(type)) {
    drafts[field.key] = '';
  }
  return drafts;
}

function normalizeSearchPhoneDigits(value: string) {
  let digits = value.replace(/\D/g, '');
  if (!digits) return '';

  if (digits.length === 10 && !digits.startsWith('7')) {
    digits = `7${digits}`;
  }
  if (digits.startsWith('8') && digits.length === 11) {
    digits = `7${digits.slice(1)}`;
  }

  const maxLength = digits.startsWith('7') ? 11 : SEARCH_PHONE_DIGITS_MAX_LENGTH;
  return digits.length > maxLength ? digits.slice(0, maxLength) : digits;
}

function formatSearchPhoneValue(value: string) {
  const digits = normalizeSearchPhoneDigits(value);
  if (!digits) return '';

  if (digits.startsWith('7')) {
    const countryCode = digits.slice(0, 1);
    const local = digits.slice(1);
    const parts = [local.slice(0, 3), local.slice(3, 6), local.slice(6, 8), local.slice(8, 10)].filter(Boolean);
    return parts.length ? `+ ${countryCode} ${parts.join(' ')}` : `+ ${countryCode}`;
  }

  return `+${digits}`;
}

function normalizeSearchImportanceLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return '';
  return SEARCH_IMPORTANCE_LEVEL_MAP[normalized] || '';
}

function normalizeSearchLinkValue(rawValue: string) {
  const raw = rawValue.trim();
  if (!raw) return '';
  const hasExplicitScheme = /^https?:\/\//i.test(raw);
  const hasWwwPrefix = /^www\./i.test(raw);
  const hasDotHint = raw.includes('.');
  if (!hasExplicitScheme && !hasWwwPrefix && !hasDotHint) {
    return '';
  }

  const withProtocol = hasExplicitScheme ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    if (!url.hostname || !url.protocol.startsWith('http')) return '';
    const host = url.hostname.toLowerCase();
    if (!host.includes('.') || host === 'localhost' || host.includes(':')) return '';
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return '';

    const hostParts = host.split('.').filter(Boolean);
    const tld = hostParts[hostParts.length - 1] || '';
    const hasLetterTld = /[a-z]/i.test(tld) && tld.length >= 2;
    if (!hasExplicitScheme && !hasWwwPrefix && !hasLetterTld) return '';

    return url.toString().slice(0, SEARCH_LINK_MAX_LENGTH);
  } catch {
    return '';
  }
}

function normalizeSearchFieldValue(fieldKey: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (fieldKey === 'phones') {
    return formatSearchPhoneValue(trimmed);
  }
  if (fieldKey === 'links') {
    return normalizeSearchLinkValue(trimmed);
  }
  if (fieldKey === 'importance') {
    return normalizeSearchImportanceLabel(trimmed);
  }
  return trimmed;
}

function getSearchFieldMaxLength(fieldKey: string) {
  if (fieldKey === 'phones') return SEARCH_PHONE_DISPLAY_MAX_LENGTH;
  if (fieldKey === 'links') return SEARCH_LINK_MAX_LENGTH;
  return SEARCH_FIELD_MAX_LENGTH;
}

function parseSearchTimestamp(value: string) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatSearchDuration(valueMs: number) {
  const durationMs = Math.max(0, Math.floor(valueMs));
  if (!durationMs) return '0 сек';

  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];

  if (hours > 0) parts.push(`${hours} ч`);
  if (minutes > 0) parts.push(`${minutes} мин`);
  if (seconds > 0 && hours === 0) parts.push(`${seconds} сек`);

  return parts.join(' ');
}

function clearRuntimeTickTimer() {
  if (!runtimeTickTimer.value) return;
  clearInterval(runtimeTickTimer.value);
  runtimeTickTimer.value = null;
}

function syncRuntimeTickTimer() {
  const state = syncedSearchState.value;
  const shouldTick = state.status === 'searching' && Boolean(parseSearchTimestamp(state.startedAt));

  if (!shouldTick) {
    clearRuntimeTickTimer();
    return;
  }

  nowTimestamp.value = Date.now();
  if (runtimeTickTimer.value || typeof window === 'undefined') return;
  runtimeTickTimer.value = window.setInterval(() => {
    nowTimestamp.value = Date.now();
  }, 1000);
}

function searchFieldValueDedupeKey(fieldKey: string, value: string) {
  if (fieldKey === 'phones') {
    return normalizeSearchPhoneDigits(value);
  }
  return value.trim().toLowerCase();
}

function normalizeSearchFieldValues(fieldKey: string, values: string[]) {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const rawValue of values) {
    const nextValue = normalizeSearchFieldValue(fieldKey, rawValue);
    if (!nextValue) continue;
    const key = searchFieldValueDedupeKey(fieldKey, nextValue);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(nextValue);
  }

  if (fieldKey === 'importance') {
    return normalized.slice(0, 1);
  }

  return normalized;
}

function formatSearchFieldValueForDisplay(fieldKey: string, value: string) {
  if (fieldKey === 'phones') {
    return formatSearchPhoneValue(value) || value;
  }
  return value;
}

function hasSearchFieldValue(fieldKey: string, values: string[], target: string) {
  const targetKey = searchFieldValueDedupeKey(fieldKey, target);
  if (!targetKey) return false;
  return values.some((item) => searchFieldValueDedupeKey(fieldKey, item) === targetKey);
}

function normalizeSearchFieldSuggestion(rawValue: unknown, entityType: EntityType): WebSearchFieldSuggestion {
  const row = toProfile(rawValue);
  const statusRaw = typeof row.status === 'string' ? row.status.trim().toLowerCase() : '';
  const status: WebSearchFieldSuggestion['status'] = statusRaw === 'ready' ? 'ready' : 'idle';
  const fieldsSource = toProfile(row.fields);
  const fields: Record<string, string[]> = {};

  for (const field of getSearchContextFields(entityType)) {
    const rawValues = Array.isArray(fieldsSource[field.key])
      ? (fieldsSource[field.key] as unknown[]).filter((item): item is string => typeof item === 'string')
      : [];
    fields[field.key] = normalizeSearchFieldValues(field.key, rawValues).slice(0, 24);
  }

  return {
    status,
    fields,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt.trim() : '',
    model: typeof row.model === 'string' ? row.model.trim() : '',
  };
}

function extractSearchPhoneCandidates(rawText: string) {
  const text = rawText.trim();
  if (!text) return [];

  const matches = [];
  const phonePattern = /(?:\+\d[\d\s().-]{7,}\d|\b\d[\d\s().-]{8,}\d\b)/g;
  for (const match of text.matchAll(phonePattern)) {
    matches.push(match[0].replace(/\s+/g, ' ').trim());
  }
  return matches;
}

function getSearchFieldFallbackValues(fieldKey: string, state: WebSearchStateEntry) {
  if (fieldKey === 'links') {
    return state.citations.map((citation) => citation.url).filter(Boolean);
  }
  if (fieldKey === 'phones') {
    return extractSearchPhoneCandidates(state.summary);
  }
  return [];
}

function normalizeSearchLinkForOpen(value: string) {
  const raw = value.trim();
  if (!raw) return '';
  if (/^(https?:\/\/|mailto:|tel:)/i.test(raw)) {
    return raw;
  }
  return `https://${raw}`;
}

function getSearchLinkChipLabel(value: string) {
  const normalized = normalizeSearchLinkForOpen(value);
  if (!normalized) return SEARCH_LINK_CHIP_FALLBACK_LABEL;

  try {
    const host = new URL(normalized).hostname.toLowerCase().replace(/^www\./, '');
    const mapped = SEARCH_LINK_CHIP_LABELS.find(({ domains }) =>
      domains.some((domain) => host === domain || host.endsWith(`.${domain}`)),
    );
    return mapped?.label || SEARCH_LINK_CHIP_FALLBACK_LABEL;
  } catch {
    return SEARCH_LINK_CHIP_FALLBACK_LABEL;
  }
}

function normalizeWebSearchStateEntry(rawValue: unknown, entityType: EntityType): WebSearchStateEntry {
  const row = toProfile(rawValue);
  const statusRaw = typeof row.status === 'string' ? row.status.trim().toLowerCase() : '';
  const status: WebSearchStateEntry['status'] = ['searching', 'ready', 'failed'].includes(statusRaw)
    ? (statusRaw as WebSearchStateEntry['status'])
    : 'idle';
  const rawCitations = Array.isArray(row.citations) ? row.citations : [];
  const rawImages = Array.isArray(row.images) ? row.images : [];

  return {
    status,
    phase:
      typeof row.phase === 'string' && ['summary', 'images', 'fields', 'ready', 'failed'].includes(row.phase.trim().toLowerCase())
        ? (row.phase.trim().toLowerCase() as WebSearchStateEntry['phase'])
        : '',
    query: typeof row.query === 'string' ? row.query.trim() : '',
    summary: typeof row.summary === 'string' ? row.summary.trim() : '',
    citations: rawCitations
      .map((item, index) => {
        const citation = toProfile(item);
        const url = normalizeWebUrl(citation.url);
        if (!url) return null;
        return {
          id: typeof citation.id === 'string' && citation.id.trim() ? citation.id.trim() : `citation-${index + 1}`,
          sourceIndex: Math.max(1, Number(citation.sourceIndex) || index + 1),
          title: typeof citation.title === 'string' ? citation.title.trim() : '',
          url,
          domain: typeof citation.domain === 'string' ? citation.domain.trim() : '',
          startIndex: Math.max(0, Number(citation.startIndex) || 0),
          endIndex: Math.max(0, Number(citation.endIndex) || 0),
        };
      })
      .filter((item): item is WebSearchCitation => Boolean(item))
      .slice(0, 80),
    images: rawImages
      .map((item, index) => {
        const image = toProfile(item);
        const imageUrl = normalizeWebUrl(image.imageUrl);
        const thumbnailUrl = normalizeWebUrl(image.thumbnailUrl || image.imageUrl);
        if (!imageUrl || !thumbnailUrl) return null;
        return {
          id: typeof image.id === 'string' && image.id.trim() ? image.id.trim() : `image-${index + 1}`,
          imageUrl,
          thumbnailUrl,
          title: typeof image.title === 'string' ? image.title.trim() : '',
          domain: typeof image.domain === 'string' ? image.domain.trim() : '',
          sourcePageUrl: typeof image.sourcePageUrl === 'string' ? image.sourcePageUrl.trim() : '',
          width: Math.max(0, Number(image.width) || 0),
          height: Math.max(0, Number(image.height) || 0),
        } satisfies WebSearchImageResult;
      })
      .filter((item): item is WebSearchImageResult => Boolean(item))
      .slice(0, 10),
    errorMessage: typeof row.errorMessage === 'string' ? row.errorMessage.trim() : '',
    startedAt: typeof row.startedAt === 'string' ? row.startedAt.trim() : '',
    completedAt: typeof row.completedAt === 'string' ? row.completedAt.trim() : '',
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt.trim() : '',
    model: typeof row.model === 'string' ? row.model.trim() : '',
    sourceCount: Math.max(0, Number(row.sourceCount) || 0),
    searchQueries: (Array.isArray(row.searchQueries) ? row.searchQueries : [])
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
      .slice(0, 12),
    fieldSuggestion: normalizeSearchFieldSuggestion(row.fieldSuggestion, entityType),
  };
}

function normalizeWebSearchState(rawValue: unknown, entityType: EntityType): WebSearchState {
  const row = toProfile(rawValue);
  return {
    ...normalizeWebSearchStateEntry(row.current || row, entityType),
    history: (Array.isArray(row.history) ? row.history : [])
      .map((item) => normalizeWebSearchStateEntry(item, entityType))
      .filter((item) => item.query || item.summary || item.status !== 'idle')
      .slice(0, 12),
  };
}

function loadStoredPanelSize() {
  if (typeof window === 'undefined') return null;

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
    // Ignore local storage write errors.
  }
}

function buildPanelContextStorageKey(projectIdValue: string) {
  return `${PANEL_CONTEXT_STORAGE_PREFIX}:${projectIdValue}`;
}

function loadStoredPanelContext(projectIdValue: string) {
  if (typeof window === 'undefined' || !projectIdValue) {
    return { entityId: '', isOpen: false };
  }

  try {
    const raw = window.sessionStorage.getItem(buildPanelContextStorageKey(projectIdValue));
    if (!raw) {
      return { entityId: '', isOpen: false };
    }

    const parsed = JSON.parse(raw) as { entityId?: unknown; isOpen?: unknown };
    return {
      entityId: typeof parsed.entityId === 'string' ? parsed.entityId.trim() : '',
      isOpen: Boolean(parsed.isOpen),
    };
  } catch {
    return { entityId: '', isOpen: false };
  }
}

function persistPanelContext(projectIdValue: string, entityIdValue: string, open: boolean) {
  if (typeof window === 'undefined' || !projectIdValue) return;

  try {
    window.sessionStorage.setItem(
      buildPanelContextStorageKey(projectIdValue),
      JSON.stringify({
        entityId: entityIdValue,
        isOpen: open,
      }),
    );
  } catch {
    // Ignore session storage write errors.
  }
}

function buildFieldDraftStorageKey(projectIdValue: string, entityIdValue: string, stateVersion: string) {
  return `${PANEL_FIELDS_DRAFT_STORAGE_PREFIX}:${projectIdValue}:${entityIdValue}:${stateVersion}`;
}

function loadStoredSearchFieldDraft(projectIdValue: string, entityIdValue: string, stateVersion: string) {
  if (typeof window === 'undefined' || !projectIdValue || !entityIdValue || !stateVersion) {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(
      buildFieldDraftStorageKey(projectIdValue, entityIdValue, stateVersion),
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function persistSearchFieldDraft(
  projectIdValue: string,
  entityIdValue: string,
  stateVersion: string,
  fields: Record<string, string[]>,
) {
  if (typeof window === 'undefined' || !projectIdValue || !entityIdValue || !stateVersion) return;

  try {
    window.sessionStorage.setItem(
      buildFieldDraftStorageKey(projectIdValue, entityIdValue, stateVersion),
      JSON.stringify(fields),
    );
  } catch {
    // Ignore session storage write errors.
  }
}

const projectId = computed(() => normalizeRouteParam(route.params.id));
const isCanvasRoute = computed(() => route.name === 'project-canvas' && Boolean(projectId.value));
const explicitActiveEntityId = computed(() => normalizeRouteParam(props.activeEntityId));
const effectiveActiveEntityId = computed(
  () => explicitActiveEntityId.value || restoredSessionEntityId.value,
);
const activeSearchEntity = computed(() => {
  if (!effectiveActiveEntityId.value) return null;
  return entitiesStore.byId(effectiveActiveEntityId.value) || null;
});
const activeSearchEntityType = computed<EntityType>(() => activeSearchEntity.value?.type || 'shape');
const activeSearchEntityName = computed(() => activeSearchEntity.value?.name?.trim() || 'Сущность');
const hasActiveEntityContext = computed(() => Boolean(effectiveActiveEntityId.value));
const syncedSearchState = computed(() =>
  normalizeWebSearchState(
    entitiesStore.getEntityWebSearchState(effectiveActiveEntityId.value),
    activeSearchEntityType.value,
  ),
);
const activeSearchFields = computed(() => getSearchContextFields(activeSearchEntityType.value));
const searchInputPlaceholder = computed(
  () => SEARCH_QUERY_PLACEHOLDERS[activeSearchEntityType.value] || SEARCH_QUERY_PLACEHOLDERS.shape,
);
const searchInputHint = computed(
  () => SEARCH_QUERY_HINTS[activeSearchEntityType.value] || SEARCH_QUERY_HINTS.shape,
);

const isPhoneViewport = computed(() => viewportWidth.value <= NARROW_VIEWPORT_PX);
const panelConstraints = computed(() => {
  const maxWidth = Math.max(
    280,
    Math.min(PANEL_MAX_WIDTH_PX, viewportWidth.value - PANEL_EDGE_MARGIN_PX * 2),
  );
  const maxHeight = Math.max(260, viewportHeight.value - PANEL_TOP_OFFSET_PX - PANEL_EDGE_MARGIN_PX);
  const minWidth = isPhoneViewport.value ? 280 : PANEL_MIN_WIDTH_PX;
  const minHeight = isPhoneViewport.value ? 320 : PANEL_MIN_HEIGHT_PX;

  return {
    maxWidth,
    maxHeight,
    minWidth: Math.min(minWidth, maxWidth),
    minHeight: Math.min(minHeight, maxHeight),
  };
});

function getDefaultPanelSize() {
  const constraints = panelConstraints.value;
  const width = Math.min(isPhoneViewport.value ? constraints.maxWidth : PANEL_DEFAULT_WIDTH_PX, constraints.maxWidth);
  const heightTarget = Math.round(viewportHeight.value * (isPhoneViewport.value ? 0.72 : 0.76));
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
    width: `${resolvedPanelSize.value.width}px`,
    height: `${resolvedPanelSize.value.height}px`,
    maxWidth: `${panelConstraints.value.maxWidth}px`,
    maxHeight: `${panelConstraints.value.maxHeight}px`,
    right: `${PANEL_EDGE_MARGIN_PX}px`,
    top: '50%',
    transform: 'translateY(-50%)',
  };
});

function updateViewportSize() {
  if (typeof window === 'undefined') return;
  viewportWidth.value = window.innerWidth;
  viewportHeight.value = window.innerHeight;
}

function resetReservedWidthVar() {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty(RESERVED_WIDTH_CSS_VAR, '0px');
}

function syncReservedWidthVar() {
  if (typeof document === 'undefined') return;
  if (!isOpen.value || !isCanvasRoute.value || isPhoneViewport.value) {
    resetReservedWidthVar();
    return;
  }

  const reservedWidth = resolvedPanelSize.value.width + PANEL_EDGE_MARGIN_PX + 12;
  document.documentElement.style.setProperty(RESERVED_WIDTH_CSS_VAR, `${reservedWidth}px`);
}

function extractApiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { message?: unknown } | undefined)?.message;
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return fallback;
}

function clearCopyNoticeTimer() {
  if (!copyNoticeTimer.value) return;
  clearTimeout(copyNoticeTimer.value);
  copyNoticeTimer.value = null;
}

function showCopyNotice(message: string) {
  clearCopyNoticeTimer();
  copyNotice.value = message;
  copyNoticeTimer.value = setTimeout(() => {
    copyNotice.value = '';
    copyNoticeTimer.value = null;
  }, 2200);
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

function buildAnswerSegments(answer: string, citations: WebSearchCitation[]) {
  const text = typeof answer === 'string' ? answer : '';
  const safeCitations = Array.isArray(citations)
    ? [...citations].sort((left, right) => {
        if (left.endIndex !== right.endIndex) return left.endIndex - right.endIndex;
        return left.sourceIndex - right.sourceIndex;
      })
    : [];
  const grouped = new Map<number, WebSearchCitation[]>();

  for (const citation of safeCitations) {
    const safeEnd = Math.max(0, Math.min(text.length, Number(citation.endIndex) || 0));
    const bucket = grouped.get(safeEnd) || [];
    bucket.push(citation);
    grouped.set(safeEnd, bucket);
  }

  const segments: AnswerSegment[] = [];
  let cursor = 0;
  for (const endIndex of Array.from(grouped.keys()).sort((left, right) => left - right)) {
    if (endIndex > cursor) {
      segments.push({
        key: `text-${cursor}-${endIndex}`,
        type: 'text',
        text: text.slice(cursor, endIndex),
      });
      cursor = endIndex;
    }

    for (const citation of grouped.get(endIndex) || []) {
      segments.push({
        key: `${citation.id}-${citation.sourceIndex}-${endIndex}`,
        type: 'citation',
        citation,
      });
    }
  }

  if (cursor < text.length || !segments.length) {
    segments.push({
      key: `text-${cursor}-${text.length}`,
      type: 'text',
      text: text.slice(cursor),
    });
  }

  return segments;
}

const answerSegments = computed(() =>
  buildAnswerSegments(syncedSearchState.value.summary, syncedSearchState.value.citations),
);

const summaryCopyText = computed(() => {
  const state = syncedSearchState.value;
  const lines = [];
  if (state.query) {
    lines.push(`Запрос: ${state.query}`);
  }
  if (state.summary) {
    lines.push('', state.summary);
  }
  return lines.join('\n').trim();
});

const isBusy = computed(() => isSubmitting.value || syncedSearchState.value.status === 'searching');
const loadingLabel = computed(() => {
  const query = syncedSearchState.value.query || queryDraft.value.trim();
  const phase = syncedSearchState.value.phase;
  if (phase === 'images') {
    return query ? `Подбираю фото по запросу: ${query}` : 'Подбираю фото';
  }
  if (phase === 'fields') {
    return query ? `Формирую поля из описания: ${query}` : 'Формирую поля из описания';
  }
  if (phase === 'summary' || !syncedSearchState.value.summary) {
    return query ? `Ищу описание по запросу: ${query}` : 'Ищу описание';
  }
  return query ? `Обрабатываю результаты по запросу: ${query}` : 'Обрабатываю результаты';
});
const effectiveErrorMessage = computed(() => {
  if (localErrorMessage.value.trim()) return localErrorMessage.value.trim();
  if (syncedSearchState.value.status === 'failed') return syncedSearchState.value.errorMessage;
  return '';
});
const contextStatusMessage = computed(() => {
  if (!hasActiveEntityContext.value) {
    return 'Откройте сущность или выделите одну ноду, чтобы загрузить ее историю веб-поиска.';
  }
  if (isLoadingEntityState.value) {
    return 'Загружаю историю поиска для выбранной сущности...';
  }
  return '';
});
const searchFieldStateVersion = computed(() => {
  const fieldSignature = activeSearchFields.value
    .map((field) => {
      const values = syncedSearchState.value.fieldSuggestion.fields[field.key] || [];
      return `${field.key}:${values.slice(0, 8).join(',')}`;
    })
    .join('|')
    .slice(0, 320);

  return [
    syncedSearchState.value.fieldSuggestion.updatedAt,
    syncedSearchState.value.fieldSuggestion.model,
    fieldSignature,
    syncedSearchState.value.updatedAt,
    syncedSearchState.value.completedAt,
    syncedSearchState.value.query,
  ]
    .filter(Boolean)
    .join('|');
});
const hasEditableSearchFields = computed(() =>
  activeSearchFields.value.some((field) => (editableSearchFieldValues.value[field.key] || []).length > 0),
);
const editableSearchFieldValueCount = computed(() =>
  activeSearchFields.value.reduce(
    (total, field) => total + (editableSearchFieldValues.value[field.key] || []).length,
    0,
  ),
);
const summarySectionCount = computed(() => {
  if (!syncedSearchState.value.summary) return 0;
  return Math.max(1, syncedSearchState.value.citations.length || syncedSearchState.value.sourceCount || 1);
});
const searchStatsPageCount = computed(() => {
  const state = syncedSearchState.value;
  if (state.sourceCount > 0) return state.sourceCount;

  const citationSourceIndexes = new Set(
    state.citations
      .map((citation) => Number(citation.sourceIndex) || 0)
      .filter((value) => value > 0),
  );
  return citationSourceIndexes.size;
});
const searchStatsDurationLabel = computed(() => {
  const state = syncedSearchState.value;
  const startedAtMs = parseSearchTimestamp(state.startedAt);
  if (!startedAtMs) return '—';

  const completedAtMs = parseSearchTimestamp(state.completedAt);
  const endAtMs =
    completedAtMs ||
    (state.status === 'searching' ? nowTimestamp.value : parseSearchTimestamp(state.updatedAt));
  if (!endAtMs || endAtMs < startedAtMs) return '—';
  return formatSearchDuration(endAtMs - startedAtMs);
});
const shouldShowSearchStats = computed(() => {
  const state = syncedSearchState.value;
  return Boolean(
    state.query ||
    state.summary ||
    state.status === 'searching' ||
    state.status === 'ready' ||
    state.status === 'failed',
  );
});

function areStringListsEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function syncEditableSearchFieldsFromState() {
  const baseFields: Record<string, string[]> = {};
  for (const field of activeSearchFields.value) {
    baseFields[field.key] = normalizeSearchFieldValues(
      field.key,
      [
        ...(syncedSearchState.value.fieldSuggestion.fields[field.key] || []),
        ...getSearchFieldFallbackValues(field.key, syncedSearchState.value),
      ],
    ).slice(0, 24);
  }

  const storedDraft = loadStoredSearchFieldDraft(
    projectId.value,
    effectiveActiveEntityId.value,
    searchFieldStateVersion.value,
  );
  const nextFields: Record<string, string[]> = {};

  for (const field of activeSearchFields.value) {
    const storedValues = Array.isArray(storedDraft?.[field.key])
      ? (storedDraft?.[field.key] as unknown[]).filter((item): item is string => typeof item === 'string')
      : null;
    nextFields[field.key] = storedValues
      ? normalizeSearchFieldValues(field.key, storedValues).slice(0, 24)
      : (baseFields[field.key] || []);
  }

  editableSearchFieldValues.value = nextFields;
  searchFieldValueDrafts.value = buildSearchFieldDrafts(activeSearchEntityType.value);
  editingSearchFieldValue.value = null;
}

function getEditableSearchFieldValues(fieldKey: string) {
  return editableSearchFieldValues.value[fieldKey] || [];
}

function getSearchFieldPlaceholder(field: SearchMetadataFieldConfig) {
  const count = getEditableSearchFieldValues(field.key).length;
  return `${field.label}: ${count}`;
}

function onSearchFieldDraftInput(fieldKey: string, event: Event) {
  const input = event.target as HTMLInputElement | null;
  if (!input) return;
  const rawValue = fieldKey === 'phones' ? formatSearchPhoneValue(input.value) : input.value;
  const nextDraft = rawValue.slice(0, getSearchFieldMaxLength(fieldKey));
  searchFieldValueDrafts.value[fieldKey] = nextDraft;
  if (input.value !== nextDraft) {
    input.value = nextDraft;
  }
}

function onSearchFieldDraftKeydown(fieldKey: string, event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  searchFieldValueDrafts.value[fieldKey] = '';
  if (editingSearchFieldValue.value?.fieldKey === fieldKey) {
    editingSearchFieldValue.value = null;
  }
}

function startEditSearchFieldValue(fieldKey: string, value: string) {
  editingSearchFieldValue.value = { fieldKey, originalValue: value };
  searchFieldValueDrafts.value[fieldKey] = normalizeSearchFieldValue(fieldKey, value).slice(
    0,
    getSearchFieldMaxLength(fieldKey),
  );
}

function addSearchFieldValue(fieldKey: string) {
  const nextValue = normalizeSearchFieldValue(fieldKey, searchFieldValueDrafts.value[fieldKey] || '').slice(
    0,
    getSearchFieldMaxLength(fieldKey),
  );
  const currentValues = [...getEditableSearchFieldValues(fieldKey)];
  const editing = editingSearchFieldValue.value;

  if (editing && editing.fieldKey === fieldKey) {
    if (!nextValue) {
      searchFieldValueDrafts.value[fieldKey] = '';
      editingSearchFieldValue.value = null;
      return;
    }

    if (fieldKey === 'importance') {
      editableSearchFieldValues.value[fieldKey] = nextValue ? [nextValue] : [];
      searchFieldValueDrafts.value[fieldKey] = '';
      editingSearchFieldValue.value = null;
      return;
    }

    const originalIndex = currentValues.findIndex(
      (item) => searchFieldValueDedupeKey(fieldKey, item) === searchFieldValueDedupeKey(fieldKey, editing.originalValue),
    );

    if (originalIndex >= 0) {
      if (hasSearchFieldValue(fieldKey, currentValues, nextValue)) {
        currentValues.splice(originalIndex, 1);
      } else {
        currentValues[originalIndex] = nextValue;
      }
    } else if (!hasSearchFieldValue(fieldKey, currentValues, nextValue)) {
      currentValues.push(nextValue);
    }

    editableSearchFieldValues.value[fieldKey] = normalizeSearchFieldValues(fieldKey, currentValues).slice(0, 24);
    searchFieldValueDrafts.value[fieldKey] = '';
    editingSearchFieldValue.value = null;
    return;
  }

  if (!nextValue) return;
  if (fieldKey === 'importance') {
    editableSearchFieldValues.value[fieldKey] = [nextValue];
    searchFieldValueDrafts.value[fieldKey] = '';
    return;
  }

  if (!hasSearchFieldValue(fieldKey, currentValues, nextValue)) {
    editableSearchFieldValues.value[fieldKey] = normalizeSearchFieldValues(fieldKey, [...currentValues, nextValue]).slice(0, 24);
  }
  searchFieldValueDrafts.value[fieldKey] = '';
}

function removeSearchFieldValue(fieldKey: string, value: string) {
  const removeKey = searchFieldValueDedupeKey(fieldKey, value);
  editableSearchFieldValues.value[fieldKey] = getEditableSearchFieldValues(fieldKey).filter(
    (item) => searchFieldValueDedupeKey(fieldKey, item) !== removeKey,
  );
  if (
    editingSearchFieldValue.value &&
    editingSearchFieldValue.value.fieldKey === fieldKey &&
    editingSearchFieldValue.value.originalValue === value
  ) {
    editingSearchFieldValue.value = null;
    searchFieldValueDrafts.value[fieldKey] = '';
  }
}

function openSearchFieldLink(value: string) {
  if (typeof window === 'undefined') return;
  const url = normalizeSearchLinkForOpen(value);
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function applySearchFieldsToEntity() {
  const entity = activeSearchEntity.value;
  if (!entity) {
    localErrorMessage.value = 'Не удалось определить активную сущность для заполнения полей.';
    return;
  }

  const currentMetadata = toProfile(entity.ai_metadata);
  const nextMetadata: Record<string, unknown> = { ...currentMetadata };
  let hasChanges = false;

  for (const field of activeSearchFields.value) {
    const selectedValues = normalizeSearchFieldValues(field.key, getEditableSearchFieldValues(field.key)).slice(0, 24);
    if (!selectedValues.length) {
      continue;
    }

    if (field.key === 'importance') {
      const importanceSource =
        typeof currentMetadata.importance_source === 'string'
          ? currentMetadata.importance_source.trim().toLowerCase()
          : '';
      if (importanceSource === 'manual') {
        continue;
      }

      const existingImportance = normalizeSearchFieldValues(
        field.key,
        Array.isArray(currentMetadata[field.key])
          ? (currentMetadata[field.key] as unknown[]).filter((item): item is string => typeof item === 'string')
          : [],
      ).slice(0, 1);

      if (!areStringListsEqual(existingImportance, selectedValues.slice(0, 1))) {
        nextMetadata[field.key] = selectedValues.slice(0, 1);
        nextMetadata.importance_source = 'llm';
        hasChanges = true;
      }
      continue;
    }

    const existingValues = normalizeSearchFieldValues(
      field.key,
      Array.isArray(currentMetadata[field.key])
        ? (currentMetadata[field.key] as unknown[]).filter((item): item is string => typeof item === 'string')
        : [],
    ).slice(0, 24);
    const mergedValues = normalizeSearchFieldValues(field.key, [...existingValues, ...selectedValues]).slice(0, 24);

    if (!areStringListsEqual(existingValues, mergedValues)) {
      nextMetadata[field.key] = mergedValues;
      hasChanges = true;
    }
  }

  if (!hasChanges) {
    showCopyNotice('Новых полей для переноса нет');
    return;
  }

  localErrorMessage.value = '';
  await entitiesStore.updateEntity(entity._id, {
    ai_metadata: nextMetadata,
  });
  showCopyNotice('Поля перенесены в сущность');
}

async function loadEntityWebSearchState(entityIdValue: string, force = false) {
  const entityId = normalizeRouteParam(entityIdValue);
  if (!entityId) return;

  if (!force && entitiesStore.hasLoadedEntityWebSearchState(entityId)) {
    return;
  }

  const existingRequest = pendingStateLoads.get(entityId);
  if (existingRequest) {
    await existingRequest;
    return;
  }

  const request = (async () => {
    isLoadingEntityState.value = true;
    try {
      const { data } = await apiClient.get('/ai/web-search-state', {
        params: { entityId },
        timeout: 30000,
      });
      const nextState =
        data?.webSearch && typeof data.webSearch === 'object' && !Array.isArray(data.webSearch)
          ? (data.webSearch as Record<string, unknown>)
          : {};
      entitiesStore.setEntityWebSearchState(entityId, nextState);
      if (effectiveActiveEntityId.value === entityId) {
        localErrorMessage.value = '';
      }
    } catch (error) {
      if (effectiveActiveEntityId.value === entityId) {
        localErrorMessage.value = extractApiErrorMessage(error, 'Не удалось загрузить историю веб-поиска.');
      }
    } finally {
      pendingStateLoads.delete(entityId);
      if (!pendingStateLoads.size) {
        isLoadingEntityState.value = false;
      }
    }
  })();

  pendingStateLoads.set(entityId, request);
  await request;
}

async function copySummary() {
  if (!summaryCopyText.value) return;
  await writeTextToClipboard(summaryCopyText.value);
  showCopyNotice('Сводка скопирована');
}

function onImageDragStart(event: DragEvent, image: WebSearchImageResult) {
  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) return;

  const payload: WebSearchDraggedImagePayload = {
    id: image.id,
    imageUrl: image.imageUrl,
    thumbnailUrl: image.thumbnailUrl,
    title: image.title,
    domain: image.domain,
    sourcePageUrl: image.sourcePageUrl,
  };

  dataTransfer.setData(WEB_SEARCH_IMAGE_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData('text/plain', image.imageUrl || image.sourcePageUrl || image.title || 'image');
  dataTransfer.effectAllowed = 'copy';
}

async function submitSearch() {
  const query = queryDraft.value.trim();
  const entityId = effectiveActiveEntityId.value;
  if (!query || !projectId.value || !entityId || isSubmitting.value || isLoadingEntityState.value) return;

  isSubmitting.value = true;
  localErrorMessage.value = '';
  try {
    await apiClient.post(
      '/ai/web-search',
      {
        projectId: projectId.value,
        entityId,
        query,
      },
      {
        timeout: 0,
      },
    );
  } catch (error) {
    if (axios.isAxiosError(error) && error.code === 'ECONNABORTED' && syncedSearchState.value.status === 'searching') {
      localErrorMessage.value = '';
      return;
    }
    localErrorMessage.value = extractApiErrorMessage(error, 'Не удалось выполнить веб-поиск.');
  } finally {
    isSubmitting.value = false;
  }
}

function stopPanelResize() {
  if (typeof window === 'undefined') return;
  isResizingPanel.value = false;
  resizeStart.value = null;
  resizePointerId.value = null;
  window.removeEventListener('pointermove', onPanelResizePointerMove);
  window.removeEventListener('pointerup', onPanelResizePointerUp);
  window.removeEventListener('pointercancel', onPanelResizePointerUp);
}

function onPanelResizePointerMove(event: PointerEvent) {
  if (!isResizingPanel.value || !resizeStart.value) return;
  const deltaX = event.clientX - resizeStart.value.clientX;
  const deltaY = event.clientY - resizeStart.value.clientY;
  panelSize.value = clampPanelSize({
    width: resizeStart.value.width - deltaX,
    height: resizeStart.value.height - deltaY,
  });
}

function onPanelResizePointerUp() {
  if (!isResizingPanel.value) return;
  stopPanelResize();
  persistPanelSize();
}

function onPanelResizeHandlePointerDown(event: PointerEvent) {
  if (isPhoneViewport.value) return;
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

async function togglePanel() {
  if (!isCanvasRoute.value) return;
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    await nextTick();
    searchInputRef.value?.focus();
  }
}

function closePanel() {
  isOpen.value = false;
}

watch(
  projectId,
  (nextProjectId) => {
    const context = loadStoredPanelContext(nextProjectId);
    restoredSessionEntityId.value = context.entityId;
    if (isCanvasRoute.value) {
      isOpen.value = context.isOpen;
    }
  },
  { immediate: true },
);

watch(
  [projectId, explicitActiveEntityId, isOpen],
  ([nextProjectId, nextEntityId, nextIsOpen]) => {
    if (!nextProjectId) return;
    const entityId = nextEntityId || restoredSessionEntityId.value;
    persistPanelContext(nextProjectId, entityId, nextIsOpen);
    if (nextEntityId) {
      restoredSessionEntityId.value = nextEntityId;
    }
  },
  { immediate: true },
);

watch(
  [isOpen, isCanvasRoute, resolvedPanelSize, isPhoneViewport],
  () => {
    syncReservedWidthVar();
  },
  { immediate: true },
);

watch(
  () => syncedSearchState.value.status,
  (nextStatus) => {
    if (nextStatus === 'ready') {
      localErrorMessage.value = '';
    }
    if (nextStatus === 'searching') {
      localErrorMessage.value = '';
    }
  },
  { immediate: true },
);

watch(
  effectiveActiveEntityId,
  (nextEntityId) => {
    localErrorMessage.value = '';
    clearCopyNoticeTimer();
    copyNotice.value = '';
    queryDraft.value = normalizeWebSearchState(
      entitiesStore.getEntityWebSearchState(nextEntityId),
      activeSearchEntityType.value,
    ).query;

    if (!nextEntityId) {
      isLoadingEntityState.value = false;
      return;
    }

    void loadEntityWebSearchState(nextEntityId, true);
  },
  { immediate: true },
);

watch(
  [effectiveActiveEntityId, activeSearchEntityType, searchFieldStateVersion],
  () => {
    syncEditableSearchFieldsFromState();
  },
  { immediate: true },
);

watch(
  () => syncedSearchState.value.query,
  (nextQuery) => {
    if (!isQueryFocused.value) {
      queryDraft.value = nextQuery;
    }
  },
  { immediate: true },
);

watch(
  editableSearchFieldValues,
  (nextValue) => {
    if (!projectId.value || !effectiveActiveEntityId.value || !searchFieldStateVersion.value) return;
    persistSearchFieldDraft(
      projectId.value,
      effectiveActiveEntityId.value,
      searchFieldStateVersion.value,
      nextValue,
    );
  },
  { deep: true },
);

watch(panelConstraints, () => {
  if (isResizingPanel.value) return;
  panelSize.value = clampPanelSize(panelSize.value || getDefaultPanelSize());
});

watch(panelSize, () => {
  if (!panelSize.value || isResizingPanel.value) return;
  persistPanelSize();
});

watch(
  () => [syncedSearchState.value.status, syncedSearchState.value.startedAt, syncedSearchState.value.completedAt],
  () => {
    syncRuntimeTickTimer();
  },
  { immediate: true },
);

onMounted(() => {
  updateViewportSize();
  panelSize.value = resolvedPanelSize.value;
  syncRuntimeTickTimer();
  if (typeof window === 'undefined') return;
  window.addEventListener('resize', updateViewportSize);
  window.addEventListener('orientationchange', updateViewportSize);
  window.visualViewport?.addEventListener('resize', updateViewportSize);
});

onBeforeUnmount(() => {
  clearCopyNoticeTimer();
  clearRuntimeTickTimer();
  stopPanelResize();
  resetReservedWidthVar();
  if (typeof window === 'undefined') return;
  window.removeEventListener('resize', updateViewportSize);
  window.removeEventListener('orientationchange', updateViewportSize);
  window.visualViewport?.removeEventListener('resize', updateViewportSize);
});
</script>

<template>
  <div v-if="isCanvasRoute" class="web-search-dock">
    <button
      type="button"
      class="web-search-trigger"
      :class="{ active: isOpen }"
      aria-label="Открыть веб-поиск"
      title="Веб-поиск"
      @click="void togglePanel()"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10" cy="10" r="4.8" />
        <path d="M10 5.2c1.6 1.2 2.5 3 2.5 4.8s-.9 3.6-2.5 4.8" />
        <path d="M10 5.2C8.4 6.4 7.5 8.2 7.5 10s.9 3.6 2.5 4.8" />
        <path d="M5.2 10h9.6" />
        <circle cx="16.6" cy="16.6" r="3.1" />
        <path d="m18.9 18.9 2.1 2.1" />
      </svg>
    </button>

    <section
      v-if="isOpen"
      ref="panelRef"
      class="web-search-panel"
      :style="panelStyle"
      @pointerdown.stop
    >
      <header class="web-search-header">
        <div
          class="web-search-title-wrap"
          @pointerdown="onPanelResizeHandlePointerDown"
        >
          <div class="web-search-title">Веб-поиск: <span>{{ activeSearchEntityName }}</span></div>
        </div>
        <div class="web-search-header-actions">
          <button
            type="button"
            class="web-search-icon-btn"
            :disabled="!summaryCopyText"
            aria-label="Копировать сводку"
            title="Копировать сводку"
            @click="void copySummary()"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="9" width="10" height="10" rx="2" />
              <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
          <button
            type="button"
            class="web-search-icon-btn close"
            aria-label="Закрыть веб-поиск"
            title="Закрыть"
            @click="closePanel"
          >
            ×
          </button>
        </div>
      </header>

      <form class="web-search-form" @submit.prevent="void submitSearch()">
        <input
          ref="searchInputRef"
          v-model.trim="queryDraft"
          type="search"
          class="web-search-input"
          :disabled="isSubmitting || isLoadingEntityState || !hasActiveEntityContext"
          :placeholder="searchInputPlaceholder"
          @focus="isQueryFocused = true"
          @blur="isQueryFocused = false"
        />
        <button
          type="submit"
          class="web-search-submit"
          :disabled="isSubmitting || isLoadingEntityState || !hasActiveEntityContext || !queryDraft.trim()"
        >
          {{ isBusy ? 'Сбор...' : 'Найти' }}
        </button>
      </form>
      <p class="web-search-query-hint">{{ searchInputHint }}</p>

      <p v-if="isBusy" class="web-search-status loading">
        <span class="web-search-loading-glow">{{ loadingLabel }}</span>
      </p>
      <p v-else-if="contextStatusMessage" class="web-search-status">{{ contextStatusMessage }}</p>
      <p v-else-if="effectiveErrorMessage" class="web-search-status error">{{ effectiveErrorMessage }}</p>
      <p v-else-if="copyNotice" class="web-search-copy-notice">{{ copyNotice }}</p>

      <section class="web-search-fields-wrap">
        <button
          type="button"
          class="web-search-section-toggle"
          :class="{ expanded: isFieldsSectionExpanded }"
          @click="isFieldsSectionExpanded = !isFieldsSectionExpanded"
        >
          <span class="web-search-section-toggle-label">Поля из поиска</span>
          <span class="web-search-section-toggle-count">{{ editableSearchFieldValueCount }}</span>
          <span class="web-search-section-toggle-chevron" aria-hidden="true"></span>
        </button>

        <div v-show="isFieldsSectionExpanded" class="web-search-section-body">
          <div class="web-search-section-head">
            <span class="web-search-section-note">Очистите лишнее перед переносом в сущность</span>
            <button
              type="button"
              class="web-search-apply-fields-btn"
              :disabled="!hasEditableSearchFields || !activeSearchEntity"
              @click="void applySearchFieldsToEntity()"
            >
              Заполнить поля сущности
            </button>
          </div>

          <div v-if="!hasActiveEntityContext" class="web-search-fields-empty">
            Выберите сущность на канве, чтобы готовить для нее поля.
          </div>
          <template v-else>
            <div class="web-search-fields-list">
              <div
                v-for="field in activeSearchFields"
                :key="field.key"
                class="web-search-field-row"
              >
                <div class="web-search-field-scroll">
                  <input
                    v-model="searchFieldValueDrafts[field.key]"
                    type="text"
                    class="web-search-field-input"
                    :maxlength="getSearchFieldMaxLength(field.key)"
                    :placeholder="getSearchFieldPlaceholder(field)"
                    @input="onSearchFieldDraftInput(field.key, $event)"
                    @keydown.enter.prevent="addSearchFieldValue(field.key)"
                    @keydown="onSearchFieldDraftKeydown(field.key, $event)"
                  />
                  <div
                    v-for="value in getEditableSearchFieldValues(field.key)"
                    :key="`${field.key}:${value}`"
                    class="web-search-field-chip"
                  >
                    <button
                      type="button"
                      class="web-search-field-chip-main"
                      :class="{ link: field.key === 'links' }"
                      :title="field.key === 'links' ? value : 'Редактировать'"
                      @click="field.key === 'links' ? openSearchFieldLink(value) : startEditSearchFieldValue(field.key, value)"
                    >
                      {{ field.key === 'links' ? getSearchLinkChipLabel(value) : formatSearchFieldValueForDisplay(field.key, value) }}
                    </button>
                    <button
                      type="button"
                      class="web-search-field-chip-remove"
                      title="Удалить"
                      @click.stop="removeSearchFieldValue(field.key, value)"
                    >
                      ×
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="isBusy && !hasEditableSearchFields" class="web-search-fields-empty">
              Собираю кандидаты для полей сущности...
            </div>
            <div v-else-if="!hasEditableSearchFields" class="web-search-fields-empty">
              По этому поиску пока нет подтвержденных значений. Можно добавить свои вручную или повторить запрос.
            </div>
          </template>
        </div>
      </section>

      <section class="web-search-images-wrap">
        <button
          type="button"
          class="web-search-section-toggle"
          :class="{ expanded: isImagesSectionExpanded }"
          @click="isImagesSectionExpanded = !isImagesSectionExpanded"
        >
          <span class="web-search-section-toggle-label">Фото</span>
          <span class="web-search-section-toggle-count">{{ syncedSearchState.images.length }}</span>
          <span class="web-search-section-toggle-chevron" aria-hidden="true"></span>
        </button>

        <div v-show="isImagesSectionExpanded" class="web-search-section-body">
          <div class="web-search-section-head">
            <span class="web-search-section-note">Перетащите в аватарку</span>
          </div>

          <div class="web-search-images-grid">
            <template v-if="syncedSearchState.images.length">
              <div
                v-for="image in syncedSearchState.images"
                :key="image.id"
                class="web-search-image-card"
              >
                <div
                  class="web-search-image-drag-zone"
                  draggable="true"
                  :title="image.title || 'Перетащите фото в аватарку сущности'"
                  @dragstart="onImageDragStart($event, image)"
                >
                  <img
                    class="web-search-image-thumb"
                    :src="image.thumbnailUrl"
                    :alt="image.title || 'Фото по запросу'"
                    loading="lazy"
                    decoding="async"
                    referrerpolicy="no-referrer"
                    draggable="false"
                  />
                </div>
                <a
                  class="web-search-image-link"
                  :href="image.sourcePageUrl || image.imageUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  :title="image.title || image.sourcePageUrl || image.imageUrl"
                  @dragstart.stop
                >
                  {{ image.domain || 'Открыть источник' }}
                </a>
              </div>
            </template>
            <div v-else-if="isBusy" class="web-search-images-empty">
              Подбираю релевантные фото...
            </div>
            <div v-else-if="!hasActiveEntityContext" class="web-search-images-empty">
              Выберите сущность на канве, чтобы увидеть ее подборку фото.
            </div>
            <div v-else class="web-search-images-empty">
              Фото по запросу появятся здесь.
            </div>
          </div>
        </div>
      </section>

      <section class="web-search-summary-wrap">
        <button
          type="button"
          class="web-search-section-toggle"
          :class="{ expanded: isSummarySectionExpanded }"
          @click="isSummarySectionExpanded = !isSummarySectionExpanded"
        >
          <span class="web-search-section-toggle-label">Сводка</span>
          <span class="web-search-section-toggle-count">{{ summarySectionCount }}</span>
          <span class="web-search-section-toggle-chevron" aria-hidden="true"></span>
        </button>

        <div v-show="isSummarySectionExpanded" class="web-search-section-body">
          <div v-if="shouldShowSearchStats" class="web-search-stats-panel" aria-label="Статистика веб-поиска">
            <div class="web-search-stats-item">
              <span class="web-search-stats-label">Страниц изучено</span>
              <strong class="web-search-stats-value">{{ searchStatsPageCount }}</strong>
            </div>
            <div class="web-search-stats-item">
              <span class="web-search-stats-label">Время сбора</span>
              <strong class="web-search-stats-value">{{ searchStatsDurationLabel }}</strong>
            </div>
          </div>

          <div class="web-search-summary" aria-label="Сводка с источниками">
            <template v-if="syncedSearchState.summary">
              <template v-for="segment in answerSegments" :key="segment.key">
                <span v-if="segment.type === 'text'">{{ segment.text }}</span>
                <a
                  v-else
                  class="web-search-citation"
                  :href="segment.citation.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  :title="segment.citation.title || segment.citation.url"
                >
                  [{{ segment.citation.sourceIndex }}]
                </a>
              </template>
            </template>
            <div v-else-if="isBusy" class="web-search-summary-empty">
              Идет поиск и сборка сводки...
            </div>
            <div v-else-if="!hasActiveEntityContext" class="web-search-summary-empty">
              Откройте карточку сущности или выделите одну ноду. Для каждой сущности хранится собственная история веб-поиска.
            </div>
            <div v-else class="web-search-summary-empty">
              Введите запрос и получите одну сводку. Ссылки останутся внутри текста в виде меток `[1]`, `[2]`, `[3]`.
            </div>
          </div>
        </div>
      </section>

    </section>
  </div>
</template>

<style scoped>
.web-search-dock {
  position: absolute;
  inset: 0;
  z-index: 205;
  pointer-events: none;
}

.web-search-trigger {
  position: absolute;
  top: 50%;
  right: 14px;
  transform: translateY(-50%);
  width: 44px;
  height: 44px;
  border-radius: 999px;
  border: 1px solid #bfd5ff;
  background: linear-gradient(180deg, #1058ff 0%, #0b4bdd 100%);
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  box-shadow: 0 18px 34px rgba(16, 88, 255, 0.28);
  cursor: pointer;
  pointer-events: auto;
  transition:
    background 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.web-search-trigger:hover,
.web-search-trigger.active {
  background: linear-gradient(180deg, #0b4bdd 0%, #083bb2 100%);
  box-shadow: 0 22px 42px rgba(16, 88, 255, 0.34);
}

.web-search-trigger svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.web-search-panel {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-radius: 18px;
  border: 1px solid #dbe4f3;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 26px 52px rgba(15, 23, 42, 0.24);
  overflow-x: hidden;
  overflow-y: auto;
  min-width: 320px;
  min-height: 320px;
  box-sizing: border-box;
  padding-bottom: 16px;
  backdrop-filter: blur(10px);
  pointer-events: auto;
}

.web-search-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 0;
}

.web-search-title-wrap {
  flex: 1;
  min-width: 0;
  cursor: nwse-resize;
  user-select: none;
  -webkit-user-select: none;
}

.web-search-title {
  color: #0f172a;
  font-size: 15px;
  font-weight: 800;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.web-search-title span {
  color: #475569;
  font-weight: 700;
}

.web-search-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.web-search-icon-btn {
  width: 30px;
  height: 30px;
  border: 1px solid #dbe4f3;
  border-radius: 9px;
  background: #ffffff;
  color: #64748b;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    color 0.16s ease,
    background-color 0.16s ease;
}

.web-search-icon-btn svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.web-search-icon-btn.close {
  font-size: 18px;
  line-height: 1;
}

.web-search-icon-btn:hover:not(:disabled),
.web-search-submit:hover:not(:disabled) {
  border-color: #bfd5ff;
  color: #1058ff;
  background: #eef4ff;
}

.web-search-icon-btn:disabled {
  opacity: 0.56;
  cursor: default;
}

.web-search-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  padding: 0 16px;
}

.web-search-query-hint {
  margin: 6px 0 0;
  padding: 0 16px;
  font-size: 11px;
  line-height: 1.35;
  color: #64748b;
}

.web-search-input {
  width: 100%;
  min-width: 0;
  border: 1px solid #dbe4f3;
  border-radius: 12px;
  background: #ffffff;
  color: #0f172a;
  font-size: 13px;
  line-height: 1.35;
  padding: 12px 13px;
  outline: none;
}

.web-search-input:focus {
  border-color: #bfdbfe;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.14);
}

.web-search-submit {
  min-width: 84px;
  border: 1px solid #dbe4f3;
  border-radius: 12px;
  background: #ffffff;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
  padding: 0 14px;
  cursor: pointer;
}

.web-search-submit:disabled {
  opacity: 0.56;
  cursor: default;
}

.web-search-copy-notice,
.web-search-status {
  margin: 0;
  padding: 0 16px;
  font-size: 12px;
  line-height: 1.4;
}

.web-search-copy-notice {
  color: #15803d;
  font-weight: 600;
}

.web-search-status {
  color: #475569;
}

.web-search-status.loading {
  min-height: 18px;
}

.web-search-status.error {
  color: #b91c1c;
}

.web-search-summary-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 16px;
  flex: 0 0 auto;
  min-height: 0;
}

.web-search-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.web-search-section-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-height: 30px;
  border: 1px solid #dbe4f3;
  border-radius: 10px;
  background: #ffffff;
  color: #334155;
  font-size: 11px;
  font-weight: 700;
  padding: 6px 10px;
  cursor: pointer;
}

.web-search-section-toggle-label {
  line-height: 1;
}

.web-search-section-toggle-count {
  margin-left: auto;
  color: #64748b;
  font-size: 10px;
  font-weight: 700;
}

.web-search-section-toggle-chevron {
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 6px solid #64748b;
  transition: transform 0.16s ease;
}

.web-search-section-toggle.expanded .web-search-section-toggle-chevron {
  transform: rotate(180deg);
}

.web-search-section-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 4px;
}

.web-search-stats-panel {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.web-search-stats-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  border: 1px solid #dbe4f3;
  border-radius: 12px;
  background: #f8fbff;
  padding: 10px 11px;
}

.web-search-stats-label {
  color: #64748b;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
}

.web-search-stats-value {
  color: #0f172a;
  font-size: 13px;
  font-weight: 800;
  line-height: 1.2;
}

.web-search-section-head h3 {
  margin: 0;
  color: #0f172a;
  font-size: 14px;
  font-weight: 800;
}

.web-search-section-note {
  color: #94a3b8;
  font-size: 11px;
  font-weight: 600;
}

.web-search-images-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 16px;
  flex: 0 0 auto;
  min-height: 0;
}

.web-search-images-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 10px;
}

.web-search-image-card {
  border: 1px solid #e5ebf5;
  border-radius: 12px;
  background: #f8fafc;
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-width: 0;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;
}

.web-search-image-card:hover {
  border-color: #bfd5ff;
  box-shadow: 0 8px 18px rgba(16, 88, 255, 0.12);
}

.web-search-image-drag-zone {
  cursor: grab;
}

.web-search-image-drag-zone:active {
  cursor: grabbing;
}

.web-search-image-thumb {
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  display: block;
  background: #e2e8f0;
}

.web-search-image-link {
  display: block;
  padding: 6px 7px 7px;
  color: #64748b;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
  text-decoration: none;
}

.web-search-image-link:hover {
  color: #1058ff;
  text-decoration: underline;
}

.web-search-images-empty {
  grid-column: 1 / -1;
  border: 1px dashed #dbe4f3;
  border-radius: 12px;
  background: #f8fafc;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
  padding: 12px;
}

.web-search-loading-glow {
  display: inline-block;
  background-image: linear-gradient(
    90deg,
    rgba(100, 116, 139, 0.45) 0%,
    rgba(100, 116, 139, 0.45) 38%,
    rgba(16, 88, 255, 0.95) 50%,
    rgba(100, 116, 139, 0.45) 62%,
    rgba(100, 116, 139, 0.45) 100%
  );
  background-size: 180% 100%;
  background-position: 100% 0;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: web-search-glow-sweep 1.9s linear infinite;
}

@keyframes web-search-glow-sweep {
  0% {
    background-position: 100% 0;
  }

  100% {
    background-position: -120% 0;
  }
}

.web-search-summary {
  flex: 0 0 auto;
  min-height: 0;
  border: 1px solid #e5ebf5;
  border-radius: 14px;
  background: #f8fafc;
  color: #1e293b;
  padding: 14px;
  overflow: visible;
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 1.6;
  user-select: text;
}

.web-search-summary-empty {
  color: #64748b;
}

.web-search-fields-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 16px;
  min-height: 0;
  flex: 0 0 auto;
}

.web-search-apply-fields-btn {
  border: 1px solid #dbe4f3;
  border-radius: 10px;
  background: #ffffff;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
  padding: 7px 10px;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    color 0.16s ease,
    background-color 0.16s ease;
}

.web-search-apply-fields-btn:hover:not(:disabled) {
  border-color: #bfd5ff;
  color: #1058ff;
  background: #eef4ff;
}

.web-search-apply-fields-btn:disabled {
  opacity: 0.56;
  cursor: default;
}

.web-search-fields-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 170px;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 2px;
}

.web-search-fields-list::-webkit-scrollbar {
  width: 6px;
}

.web-search-field-row {
  border: 1px solid #dbe4f3;
  border-radius: 10px;
  background: #ffffff;
}

.web-search-field-scroll {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 4px;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 4px 6px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.web-search-field-scroll::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

.web-search-field-input {
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

.web-search-field-input:focus {
  background: #f8fafc;
}

.web-search-field-chip {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: 1px solid #bfd5ff;
  border-radius: 999px;
  background: #eff6ff;
  padding: 1px 3px 1px 6px;
}

.web-search-field-chip-main {
  border: none;
  background: transparent;
  color: #1e40af;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.25;
  max-width: 220px;
  padding: 2px 0;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.web-search-field-chip-main.link {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.web-search-field-chip-remove {
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

.web-search-field-chip:hover .web-search-field-chip-remove,
.web-search-field-chip:focus-within .web-search-field-chip-remove {
  opacity: 1;
  pointer-events: auto;
}

.web-search-field-chip-remove:hover {
  background: rgba(30, 64, 175, 0.24);
}

.web-search-fields-empty {
  border: 1px dashed #dbe4f3;
  border-radius: 12px;
  background: #f8fafc;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
  padding: 12px;
}

.web-search-citation {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  margin-left: 2px;
  color: #1058ff;
  font-size: 11px;
  font-weight: 800;
  text-decoration: none;
}

.web-search-citation:hover {
  text-decoration: underline;
}

@media (max-width: 900px) {
  .web-search-trigger {
    top: 50%;
    right: calc(10px + env(safe-area-inset-right, 0px));
    bottom: auto;
    transform: translateY(-50%);
    width: 46px;
    height: 46px;
  }

  .web-search-panel {
    border-radius: 0;
    padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
  }

  .web-search-header {
    padding-top: max(12px, env(safe-area-inset-top, 0px));
  }

  .web-search-images-grid {
    grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
  }

  .web-search-images-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
