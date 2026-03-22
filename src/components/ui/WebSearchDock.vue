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

interface WebSearchSource {
  id: string;
  index: number;
  url: string;
  title: string;
  snippet: string;
  domain: string;
}

interface WebSearchResponse {
  query: string;
  answer: string;
  citations: WebSearchCitation[];
  sources: WebSearchSource[];
  searchQueries: string[];
  model: string;
}

interface WebPagePreview {
  sourceUrl: string;
  finalUrl: string;
  hostname: string;
  siteLabel: string;
  sourceKind: string;
  title: string;
  description: string;
  textSnippet: string;
  preparedText: string;
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

const PANEL_WIDTH_STORAGE_KEY = 'synapse12.web-search.panel-width.v1';
const RESERVED_WIDTH_CSS_VAR = '--synapse-web-search-reserved-width';
const PANEL_MIN_WIDTH_PX = 360;
const PANEL_DEFAULT_WIDTH_PX = 480;
const PANEL_MAX_WIDTH_PX = 760;
const PANEL_RIGHT_OFFSET_PX = 14;
const PANEL_TOP_OFFSET_PX = 60;
const PANEL_BOTTOM_OFFSET_PX = 74;
const NARROW_VIEWPORT_PX = 900;

const route = useRoute();
const entitiesStore = useEntitiesStore();

const isOpen = ref(false);
const isSearching = ref(false);
const searchErrorMessage = ref('');
const searchResult = ref<WebSearchResponse | null>(null);
const queryDraft = ref('');
const panelWidth = ref<number | null>(loadStoredPanelWidth());
const isResizing = ref(false);
const resizePointerId = ref<number | null>(null);
const resizeStart = ref<{ clientX: number; width: number } | null>(null);
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1440);
const searchInputRef = ref<HTMLInputElement | null>(null);

const selectedSourceUrl = ref('');
const sourcePreview = ref<WebPagePreview | null>(null);
const isPreviewLoading = ref(false);
const previewErrorMessage = ref('');
const previewRequestToken = ref(0);
const previewCache = new Map<string, WebPagePreview>();

const copyNotice = ref('');
const copyNoticeTimer = ref<ReturnType<typeof setTimeout> | null>(null);

function normalizeRouteParam(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0].trim() : '';
  return '';
}

function loadStoredPanelWidth() {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
    const width = Number(raw);
    if (!Number.isFinite(width)) return null;
    return Math.max(1, Math.round(width));
  } catch {
    return null;
  }
}

function persistPanelWidth() {
  if (typeof window === 'undefined' || !panelWidth.value) return;

  try {
    window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(panelWidth.value));
  } catch {
    // Ignore storage write errors.
  }
}

function updateViewportWidth() {
  if (typeof window === 'undefined') return;
  viewportWidth.value = window.innerWidth;
}

const projectId = computed(() => normalizeRouteParam(route.params.id));
const isCanvasRoute = computed(() => route.name === 'project-canvas' && Boolean(projectId.value));
const activeProject = computed(() => {
  if (!projectId.value) return null;
  return entitiesStore.byId(projectId.value) || null;
});
const projectName = computed(() => activeProject.value?.name?.trim() || 'Канва проекта');
const isNarrowViewport = computed(() => viewportWidth.value <= NARROW_VIEWPORT_PX);

function clampPanelWidth(width: number) {
  const maxWidth = isNarrowViewport.value
    ? Math.max(320, viewportWidth.value)
    : Math.max(PANEL_MIN_WIDTH_PX, Math.min(PANEL_MAX_WIDTH_PX, viewportWidth.value - 120));
  const minWidth = Math.min(PANEL_MIN_WIDTH_PX, maxWidth);
  return Math.max(minWidth, Math.min(maxWidth, Math.round(width)));
}

const resolvedPanelWidth = computed(() => clampPanelWidth(panelWidth.value || PANEL_DEFAULT_WIDTH_PX));

const panelStyle = computed(() => {
  if (isNarrowViewport.value) {
    return {
      inset: '0px',
      width: 'auto',
      borderRadius: '0px',
    };
  }

  return {
    width: `${resolvedPanelWidth.value}px`,
    top: `${PANEL_TOP_OFFSET_PX}px`,
    bottom: `${PANEL_BOTTOM_OFFSET_PX}px`,
    right: `calc(${PANEL_RIGHT_OFFSET_PX}px + env(safe-area-inset-right, 0px))`,
  };
});

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

function resetReservedWidthVar() {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty(RESERVED_WIDTH_CSS_VAR, '0px');
}

function syncReservedWidthVar() {
  if (typeof document === 'undefined') return;
  if (!isOpen.value || !isCanvasRoute.value || isNarrowViewport.value) {
    resetReservedWidthVar();
    return;
  }

  const reservedWidth = resolvedPanelWidth.value + PANEL_RIGHT_OFFSET_PX + 12;
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

function clearPreviewState() {
  selectedSourceUrl.value = '';
  sourcePreview.value = null;
  previewErrorMessage.value = '';
  isPreviewLoading.value = false;
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
  buildAnswerSegments(searchResult.value?.answer || '', searchResult.value?.citations || []),
);

const selectedSource = computed(() => {
  const sources = searchResult.value?.sources || [];
  return sources.find((source) => source.url === selectedSourceUrl.value) || null;
});

const summaryCopyText = computed(() => {
  const result = searchResult.value;
  if (!result) return '';

  const lines = [`Запрос: ${result.query.trim()}`];
  if (result.answer.trim()) {
    lines.push('', result.answer.trim());
  }
  if (result.sources.length) {
    lines.push('', 'Источники:');
    for (const source of result.sources) {
      lines.push(`[${source.index}] ${source.title} — ${source.url}`);
    }
  }
  return lines.join('\n').trim();
});

const previewCopyText = computed(() => {
  const preview = sourcePreview.value;
  if (!preview) return '';

  return [
    preview.title.trim(),
    preview.finalUrl.trim() || preview.sourceUrl.trim(),
    '',
    preview.preparedText.trim() || preview.description.trim() || preview.textSnippet.trim(),
  ]
    .filter(Boolean)
    .join('\n')
    .trim();
});

async function copyText(text: string, successMessage: string) {
  if (!text.trim()) return;
  await writeTextToClipboard(text);
  showCopyNotice(successMessage);
}

async function openSourcePreview(source: WebSearchSource) {
  selectedSourceUrl.value = source.url;
  previewErrorMessage.value = '';

  const cached = previewCache.get(source.url);
  if (cached) {
    sourcePreview.value = cached;
    return;
  }

  isPreviewLoading.value = true;
  const requestToken = previewRequestToken.value + 1;
  previewRequestToken.value = requestToken;

  try {
    const { data } = await apiClient.post<WebPagePreview>('/ai/web-page-preview', {
      url: source.url,
    });
    if (previewRequestToken.value !== requestToken) return;
    previewCache.set(source.url, data);
    sourcePreview.value = data;
  } catch (error) {
    if (previewRequestToken.value !== requestToken) return;
    sourcePreview.value = null;
    previewErrorMessage.value = extractApiErrorMessage(error, 'Не удалось открыть источник внутри панели.');
  } finally {
    if (previewRequestToken.value === requestToken) {
      isPreviewLoading.value = false;
    }
  }
}

function openSourceInNewTab(source: WebSearchSource) {
  if (typeof window === 'undefined') return;
  window.open(source.url, '_blank', 'noopener,noreferrer');
}

async function submitSearch() {
  const query = queryDraft.value.trim();
  if (!query || isSearching.value) return;

  isSearching.value = true;
  searchErrorMessage.value = '';
  searchResult.value = null;
  clearPreviewState();

  try {
    const { data } = await apiClient.post<WebSearchResponse>('/ai/web-search', {
      query,
    });
    searchResult.value = data;
    if (data.sources[0]) {
      void openSourcePreview(data.sources[0]);
    }
  } catch (error) {
    searchErrorMessage.value = extractApiErrorMessage(error, 'Не удалось выполнить веб-поиск.');
  } finally {
    isSearching.value = false;
  }
}

function stopResize() {
  if (typeof window === 'undefined') return;
  isResizing.value = false;
  resizePointerId.value = null;
  resizeStart.value = null;
  window.removeEventListener('pointermove', onResizePointerMove);
  window.removeEventListener('pointerup', onResizePointerUp);
  window.removeEventListener('pointercancel', onResizePointerUp);
}

function onResizePointerMove(event: PointerEvent) {
  if (!isResizing.value || !resizeStart.value) return;
  const deltaX = event.clientX - resizeStart.value.clientX;
  panelWidth.value = clampPanelWidth(resizeStart.value.width - deltaX);
}

function onResizePointerUp() {
  if (!isResizing.value) return;
  stopResize();
  persistPanelWidth();
}

function onResizeHandlePointerDown(event: PointerEvent) {
  if (isNarrowViewport.value) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();

  resizePointerId.value = event.pointerId;
  resizeStart.value = {
    clientX: event.clientX,
    width: resolvedPanelWidth.value,
  };
  isResizing.value = true;

  window.addEventListener('pointermove', onResizePointerMove, { passive: true });
  window.addEventListener('pointerup', onResizePointerUp);
  window.addEventListener('pointercancel', onResizePointerUp);
}

async function togglePanel() {
  if (!isCanvasRoute.value) return;
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    await nextTick();
    searchInputRef.value?.focus();
    return;
  }
  copyNotice.value = '';
}

function closePanel() {
  isOpen.value = false;
  copyNotice.value = '';
}

watch(
  [isOpen, isCanvasRoute, resolvedPanelWidth, isNarrowViewport],
  () => {
    syncReservedWidthVar();
  },
  { immediate: true },
);

watch(
  isCanvasRoute,
  (nextValue) => {
    if (nextValue) return;
    closePanel();
    resetReservedWidthVar();
  },
  { immediate: true },
);

watch(resolvedPanelWidth, () => {
  if (isResizing.value) return;
  panelWidth.value = resolvedPanelWidth.value;
  persistPanelWidth();
});

onMounted(() => {
  updateViewportWidth();
  if (typeof window === 'undefined') return;
  window.addEventListener('resize', updateViewportWidth);
  window.addEventListener('orientationchange', updateViewportWidth);
  window.visualViewport?.addEventListener('resize', updateViewportWidth);
});

onBeforeUnmount(() => {
  clearCopyNoticeTimer();
  stopResize();
  resetReservedWidthVar();
  if (typeof window === 'undefined') return;
  window.removeEventListener('resize', updateViewportWidth);
  window.removeEventListener('orientationchange', updateViewportWidth);
  window.visualViewport?.removeEventListener('resize', updateViewportWidth);
});
</script>

<template>
  <div v-if="isCanvasRoute" class="web-search-dock">
    <button
      type="button"
      class="web-search-trigger"
      :class="{ active: isOpen }"
      aria-label="Открыть веб-поиск"
      @click="void togglePanel()"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4 4" />
      </svg>
      <span>Вебпоиск</span>
    </button>

    <section v-if="isOpen" class="web-search-panel" :style="panelStyle" @pointerdown.stop>
      <div
        v-if="!isNarrowViewport"
        class="web-search-resize-handle"
        title="Изменить ширину панели"
        @pointerdown="onResizeHandlePointerDown"
      />

      <header class="web-search-header">
        <div class="web-search-header-copy">
          <div class="web-search-title">Веб-поиск</div>
          <div class="web-search-subtitle">{{ projectName }}</div>
        </div>
        <button type="button" class="web-search-close" aria-label="Закрыть веб-поиск" @click="closePanel">
          ×
        </button>
      </header>

      <form class="web-search-form" @submit.prevent="void submitSearch()">
        <input
          ref="searchInputRef"
          v-model.trim="queryDraft"
          type="search"
          class="web-search-input"
          placeholder="Компания, человек, событие, домен..."
          :disabled="isSearching"
        />
        <button type="submit" class="web-search-submit" :disabled="isSearching || !queryDraft.trim()">
          {{ isSearching ? 'Ищу...' : 'Найти' }}
        </button>
      </form>

      <p v-if="copyNotice" class="web-search-copy-notice">{{ copyNotice }}</p>
      <p v-if="searchErrorMessage" class="web-search-status error">{{ searchErrorMessage }}</p>
      <p v-else-if="isSearching" class="web-search-status">Ищу источники и собираю сводку...</p>

      <div v-if="!searchResult && !isSearching && !searchErrorMessage" class="web-search-empty">
        Ищите компании, людей, события и открывайте источник во встроенном reader-режиме. Текст можно выделять и копировать
        прямо на канве.
      </div>

      <template v-else-if="searchResult">
        <section class="web-search-section">
          <div class="web-search-section-head">
            <h3>Сводка</h3>
            <button
              type="button"
              class="web-search-inline-btn"
              :disabled="!summaryCopyText"
              @click="void copyText(summaryCopyText, 'Сводка скопирована')"
            >
              Копировать
            </button>
          </div>

          <div v-if="searchResult.answer.trim()" class="web-search-answer" aria-label="Сводка с источниками">
            <template v-for="segment in answerSegments" :key="segment.key">
              <span v-if="segment.type === 'text'">{{ segment.text }}</span>
              <a
                v-else
                class="web-search-citation"
                :href="segment.citation.url"
                target="_blank"
                rel="noopener noreferrer"
                :title="segment.citation.title"
              >
                [{{ segment.citation.sourceIndex }}]
              </a>
            </template>
          </div>
          <div v-else class="web-search-answer muted">Сводка пока пустая, но источники доступны ниже.</div>
        </section>

        <section class="web-search-section">
          <div class="web-search-section-head">
            <h3>Источники</h3>
            <span class="web-search-counter">{{ searchResult.sources.length }}</span>
          </div>

          <div v-if="!searchResult.sources.length" class="web-search-answer muted">Источники не вернулись.</div>
          <div v-else class="web-search-sources">
            <article
              v-for="source in searchResult.sources"
              :key="source.id"
              class="web-search-source-card"
              :class="{ active: selectedSourceUrl === source.url }"
            >
              <button type="button" class="web-search-source-main" @click="void openSourcePreview(source)">
                <span class="web-search-source-index">[{{ source.index }}]</span>
                <span class="web-search-source-body">
                  <strong>{{ source.title }}</strong>
                  <span>{{ source.domain || source.url }}</span>
                  <span v-if="source.snippet">{{ source.snippet }}</span>
                </span>
              </button>
              <div class="web-search-source-actions">
                <button type="button" class="web-search-inline-btn" @click="void openSourcePreview(source)">
                  Reader
                </button>
                <button type="button" class="web-search-inline-btn" @click="openSourceInNewTab(source)">
                  Открыть
                </button>
              </div>
            </article>
          </div>
        </section>

        <section class="web-search-section web-search-preview-section">
          <div class="web-search-section-head">
            <h3>Reader</h3>
            <button
              type="button"
              class="web-search-inline-btn"
              :disabled="!previewCopyText"
              @click="void copyText(previewCopyText, 'Текст источника скопирован')"
            >
              Копировать
            </button>
          </div>

          <div v-if="isPreviewLoading" class="web-search-answer muted">Открываю источник...</div>
          <p v-else-if="previewErrorMessage" class="web-search-status error">{{ previewErrorMessage }}</p>
          <div v-else-if="sourcePreview" class="web-search-preview-card">
            <div class="web-search-preview-head">
              <strong>{{ sourcePreview.title || selectedSource?.title || 'Источник' }}</strong>
              <span>{{ sourcePreview.siteLabel || sourcePreview.hostname || selectedSource?.domain || 'web' }}</span>
            </div>
            <a
              class="web-search-preview-link"
              :href="sourcePreview.finalUrl || sourcePreview.sourceUrl"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ sourcePreview.finalUrl || sourcePreview.sourceUrl }}
            </a>
            <p v-if="sourcePreview.description" class="web-search-preview-description">{{ sourcePreview.description }}</p>
            <pre class="web-search-preview-text">{{
              sourcePreview.preparedText || sourcePreview.textSnippet || 'Источник не отдал текст для reader-режима.'
            }}</pre>
          </div>
          <div v-else class="web-search-answer muted">Выберите источник, чтобы открыть его внутри панели.</div>
        </section>
      </template>
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
  min-width: 52px;
  min-height: 138px;
  border: 1px solid #bfd5ff;
  border-right: none;
  border-radius: 16px 0 0 16px;
  background: linear-gradient(180deg, #1058ff 0%, #0b4bdd 100%);
  color: #ffffff;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 14px 10px;
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
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.web-search-trigger span {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
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
  min-width: 360px;
  backdrop-filter: blur(10px);
  pointer-events: auto;
}

.web-search-resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 10px;
  cursor: ew-resize;
  z-index: 2;
}

.web-search-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 0;
}

.web-search-header-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
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

.web-search-close {
  width: 30px;
  height: 30px;
  border: 1px solid #dbe4f3;
  border-radius: 9px;
  background: #ffffff;
  color: #64748b;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.web-search-close:hover,
.web-search-inline-btn:hover,
.web-search-submit:hover:not(:disabled) {
  border-color: #bfd5ff;
  color: #1058ff;
  background: #eef4ff;
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
  padding: 12px 13px;
  outline: none;
}

.web-search-input:focus {
  border-color: #bfdbfe;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.14);
}

.web-search-submit,
.web-search-inline-btn {
  border: 1px solid #dbe4f3;
  border-radius: 10px;
  background: #ffffff;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    color 0.16s ease,
    background-color 0.16s ease;
}

.web-search-submit {
  min-width: 80px;
  padding: 0 14px;
}

.web-search-submit:disabled,
.web-search-inline-btn:disabled {
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

.web-search-empty {
  margin: 0 16px 16px;
  border: 1px dashed #cbd5e1;
  border-radius: 14px;
  background: #f8fafc;
  color: #64748b;
  font-size: 13px;
  line-height: 1.5;
  padding: 16px;
}

.web-search-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  padding: 0 16px;
}

.web-search-preview-section {
  flex: 1;
  padding-bottom: 16px;
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

.web-search-counter {
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
}

.web-search-answer {
  border: 1px solid #e5ebf5;
  border-radius: 14px;
  background: #f8fafc;
  color: #1e293b;
  font-size: 13px;
  line-height: 1.55;
  padding: 14px;
  white-space: pre-wrap;
  user-select: text;
}

.web-search-answer.muted {
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

.web-search-sources {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 220px;
  overflow: auto;
}

.web-search-source-card {
  border: 1px solid #dbe4f3;
  border-radius: 13px;
  background: #ffffff;
  overflow: hidden;
}

.web-search-source-card.active {
  border-color: #a9c6ff;
  box-shadow: 0 0 0 1px rgba(16, 88, 255, 0.08);
}

.web-search-source-main {
  width: 100%;
  border: none;
  background: transparent;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  padding: 11px 12px;
  text-align: left;
  cursor: pointer;
}

.web-search-source-index {
  color: #1058ff;
  font-size: 12px;
  font-weight: 800;
}

.web-search-source-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.web-search-source-body strong {
  color: #0f172a;
  font-size: 13px;
  line-height: 1.35;
}

.web-search-source-body span {
  color: #64748b;
  font-size: 11px;
  line-height: 1.4;
}

.web-search-source-actions {
  display: flex;
  gap: 8px;
  padding: 0 12px 12px;
}

.web-search-preview-card {
  height: 100%;
  min-height: 0;
  border: 1px solid #dbe4f3;
  border-radius: 14px;
  background: #ffffff;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.web-search-preview-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.web-search-preview-head strong {
  color: #0f172a;
  font-size: 14px;
  line-height: 1.35;
}

.web-search-preview-head span,
.web-search-preview-description {
  color: #64748b;
  font-size: 12px;
  line-height: 1.45;
  margin: 0;
}

.web-search-preview-link {
  color: #1058ff;
  font-size: 12px;
  line-height: 1.45;
  text-decoration: none;
  word-break: break-word;
}

.web-search-preview-link:hover {
  text-decoration: underline;
}

.web-search-preview-text {
  flex: 1;
  min-height: 0;
  margin: 0;
  border-radius: 12px;
  background: #f8fafc;
  color: #1e293b;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: auto;
  padding: 12px;
  user-select: text;
}

@media (max-width: 900px) {
  .web-search-dock {
    position: absolute;
    inset: 0;
  }

  .web-search-trigger {
    top: auto;
    right: calc(10px + env(safe-area-inset-right, 0px));
    bottom: calc(10px + env(safe-area-inset-bottom, 0px) + var(--synapse-vv-bottom-offset, 0px));
    transform: none;
    min-width: 46px;
    min-height: 46px;
    width: 46px;
    height: 46px;
    border-radius: 999px;
    border-right: 1px solid #bfd5ff;
    padding: 0;
  }

  .web-search-trigger span {
    display: none;
  }

  .web-search-panel {
    border-radius: 0;
    min-width: 0;
  }

  .web-search-header {
    padding-top: max(12px, env(safe-area-inset-top, 0px));
  }

  .web-search-preview-section {
    padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
  }
}
</style>
