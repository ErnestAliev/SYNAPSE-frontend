<script setup lang="ts">
import axios from 'axios';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiClient } from '../../services/api';
import { useEntitiesStore } from '../../stores/entities';

interface WebSearchCitation {
  id: string;
  sourceIndex: number;
  title: string;
  url: string;
  domain: string;
  startIndex: number;
  endIndex: number;
}

interface ProjectWebSearchState {
  status: 'idle' | 'searching' | 'ready' | 'failed';
  query: string;
  summary: string;
  citations: WebSearchCitation[];
  errorMessage: string;
  startedAt: string;
  completedAt: string;
  updatedAt: string;
  model: string;
  sourceCount: number;
  searchQueries: string[];
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
const RESERVED_WIDTH_CSS_VAR = '--synapse-web-search-reserved-width';
const PANEL_TOP_OFFSET_PX = 60;
const PANEL_EDGE_MARGIN_PX = 14;
const PANEL_MIN_WIDTH_PX = 360;
const PANEL_MAX_WIDTH_PX = 760;
const PANEL_MIN_HEIGHT_PX = 360;
const PANEL_DEFAULT_WIDTH_PX = 520;
const NARROW_VIEWPORT_PX = 900;
const SEARCH_STEPS = [
  'Ищу релевантные источники',
  'Сверяю даты и факты',
  'Отсекаю шум и дубли',
  'Собираю расширенную сводку',
] as const;

const route = useRoute();
const entitiesStore = useEntitiesStore();

const isOpen = ref(false);
const isSubmitting = ref(false);
const queryDraft = ref('');
const searchInputRef = ref<HTMLInputElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const isQueryFocused = ref(false);
const localErrorMessage = ref('');
const copyNotice = ref('');
const copyNoticeTimer = ref<ReturnType<typeof setTimeout> | null>(null);
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
const animatedStepIndex = ref(0);
const animatedStepTimer = ref<ReturnType<typeof setInterval> | null>(null);

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

function normalizeWebSearchState(rawValue: unknown): ProjectWebSearchState {
  const row = toProfile(rawValue);
  const statusRaw = typeof row.status === 'string' ? row.status.trim().toLowerCase() : '';
  const status: ProjectWebSearchState['status'] = ['searching', 'ready', 'failed'].includes(statusRaw)
    ? (statusRaw as ProjectWebSearchState['status'])
    : 'idle';
  const rawCitations = Array.isArray(row.citations) ? row.citations : [];

  return {
    status,
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

const projectId = computed(() => normalizeRouteParam(route.params.id));
const projectEntity = computed(() => {
  if (!projectId.value) return null;
  const entity = entitiesStore.byId(projectId.value);
  if (!entity || entity.type !== 'project') return null;
  return entity;
});
const projectName = computed(() => projectEntity.value?.name?.trim() || 'Канва проекта');
const isCanvasRoute = computed(() => route.name === 'project-canvas' && Boolean(projectId.value));
const syncedSearchState = computed(() => {
  const metadata = toProfile(projectEntity.value?.ai_metadata);
  return normalizeWebSearchState(metadata.web_search);
});

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
const activeStepLabel = computed(() => SEARCH_STEPS[animatedStepIndex.value] || SEARCH_STEPS[0]);
const effectiveErrorMessage = computed(() => {
  if (localErrorMessage.value.trim()) return localErrorMessage.value.trim();
  if (syncedSearchState.value.status === 'failed') return syncedSearchState.value.errorMessage;
  return '';
});

const syncMetaText = computed(() => {
  const state = syncedSearchState.value;
  if (isBusy.value) {
    return 'Поиск: web -> сверка -> сводка • синхронизация между устройствами';
  }
  if (state.status === 'ready' && state.sourceCount > 0) {
    return `Сводка из ${state.sourceCount} веб-источников • синхронизируется между устройствами`;
  }
  if (state.status === 'failed') {
    return 'Последняя ошибка синхронизирована между устройствами';
  }
  return 'Результаты поиска сохраняются в проекте и доступны на всех устройствах';
});

function stopAnimatedSteps() {
  if (!animatedStepTimer.value) return;
  clearInterval(animatedStepTimer.value);
  animatedStepTimer.value = null;
}

function startAnimatedSteps() {
  stopAnimatedSteps();
  animatedStepIndex.value = 0;
  animatedStepTimer.value = setInterval(() => {
    animatedStepIndex.value = (animatedStepIndex.value + 1) % SEARCH_STEPS.length;
  }, 960);
}

async function copySummary() {
  if (!summaryCopyText.value) return;
  await writeTextToClipboard(summaryCopyText.value);
  showCopyNotice('Сводка скопирована');
}

async function submitSearch() {
  const query = queryDraft.value.trim();
  if (!query || !projectId.value || isSubmitting.value) return;

  isSubmitting.value = true;
  localErrorMessage.value = '';
  try {
    await apiClient.post('/ai/web-search', {
      projectId: projectId.value,
      query,
    });
  } catch (error) {
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
  () => syncedSearchState.value.query,
  (nextQuery) => {
    if (!nextQuery) return;
    if (!queryDraft.value.trim() || !isQueryFocused.value) {
      queryDraft.value = nextQuery;
    }
  },
  { immediate: true },
);

watch(
  isBusy,
  (nextValue) => {
    if (nextValue) {
      startAnimatedSteps();
      return;
    }
    stopAnimatedSteps();
  },
  { immediate: true },
);

watch(panelConstraints, () => {
  if (isResizingPanel.value) return;
  panelSize.value = clampPanelSize(panelSize.value || getDefaultPanelSize());
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
  clearCopyNoticeTimer();
  stopAnimatedSteps();
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
          <div class="web-search-title">Веб-поиск</div>
          <div class="web-search-subtitle">{{ projectName }}</div>
          <div class="web-search-meta">{{ syncMetaText }}</div>
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
          :disabled="isSubmitting"
          placeholder="Компания, человек, событие, тема..."
          @focus="isQueryFocused = true"
          @blur="isQueryFocused = false"
        />
        <button
          type="submit"
          class="web-search-submit"
          :disabled="isSubmitting || !queryDraft.trim()"
        >
          {{ isBusy ? 'Сбор...' : 'Найти' }}
        </button>
      </form>

      <p v-if="copyNotice" class="web-search-copy-notice">{{ copyNotice }}</p>

      <section class="web-search-summary-wrap">
        <div class="web-search-section-head">
          <h3>Сводка</h3>
        </div>

        <div v-if="isBusy" class="web-search-loading-card">
          <div class="web-search-loading-bars" aria-hidden="true">
            <span
              v-for="(step, index) in SEARCH_STEPS"
              :key="step"
              class="web-search-loading-bar"
              :class="{ active: index === animatedStepIndex }"
            />
          </div>
          <p class="web-search-loading-title">{{ activeStepLabel }}</p>
          <p class="web-search-loading-text">
            Ищу веб-источники, сверяю факты, убираю шум и собираю расширенную сводку. Результат автоматически
            синхронизируется между устройствами.
          </p>
        </div>

        <p v-else-if="effectiveErrorMessage" class="web-search-status error">{{ effectiveErrorMessage }}</p>

        <div
          v-else-if="syncedSearchState.summary"
          class="web-search-summary"
          aria-label="Сводка с источниками"
        >
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
        </div>

        <div v-else class="web-search-summary muted">
          Введите запрос и получите одну расширенную сводку. Ссылки останутся внутри текста в виде меток `[1]`, `[2]`,
          `[3]`.
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
  overflow: hidden;
  min-width: 320px;
  min-height: 320px;
  backdrop-filter: blur(10px);
  pointer-events: auto;
}

.web-search-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 0;
}

.web-search-title-wrap {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: nwse-resize;
  user-select: none;
  -webkit-user-select: none;
}

.web-search-title {
  color: #0f172a;
  font-size: 15px;
  font-weight: 800;
}

.web-search-subtitle {
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}

.web-search-meta {
  color: #94a3b8;
  font-size: 11px;
  line-height: 1.35;
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

.web-search-status.error {
  color: #b91c1c;
}

.web-search-summary-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 16px 16px;
}

.web-search-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.web-search-section-head h3 {
  margin: 0;
  color: #0f172a;
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.web-search-loading-card,
.web-search-summary {
  flex: 1;
  min-height: 0;
  border: 1px solid #e5ebf5;
  border-radius: 14px;
  background: #f8fafc;
  color: #1e293b;
  padding: 14px;
}

.web-search-loading-card {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 12px;
}

.web-search-loading-bars {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.web-search-loading-bar {
  height: 8px;
  border-radius: 999px;
  background: rgba(191, 213, 255, 0.6);
  transition:
    background-color 0.2s ease,
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.web-search-loading-bar.active {
  background: linear-gradient(90deg, #1058ff 0%, #4f8dff 100%);
  box-shadow: 0 0 0 1px rgba(16, 88, 255, 0.14);
  transform: scaleY(1.15);
}

.web-search-loading-title,
.web-search-loading-text {
  margin: 0;
}

.web-search-loading-title {
  color: #0f172a;
  font-size: 14px;
  font-weight: 800;
}

.web-search-loading-text {
  color: #64748b;
  font-size: 12px;
  line-height: 1.55;
}

.web-search-summary {
  overflow: auto;
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 1.6;
  user-select: text;
}

.web-search-summary.muted {
  color: #64748b;
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
    top: auto;
    right: calc(10px + env(safe-area-inset-right, 0px));
    bottom: calc(10px + env(safe-area-inset-bottom, 0px) + var(--synapse-vv-bottom-offset, 0px));
    transform: none;
    width: 46px;
    height: 46px;
  }

  .web-search-panel {
    border-radius: 0;
  }

  .web-search-header {
    padding-top: max(12px, env(safe-area-inset-top, 0px));
  }

  .web-search-summary-wrap {
    padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
  }
}
</style>
