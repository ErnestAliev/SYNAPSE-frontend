<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useEntitiesStore } from '../../stores/entities';
import type { EntityType } from '../../types/entity';

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

const STORAGE_KEY = 'synapse12.agent-chat.v2';
const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  project: 'Проекты',
  person: 'Персоны',
  company: 'Компании',
  event: 'События',
  resource: 'Ресурсы',
  goal: 'Цели',
  result: 'Результаты',
  task: 'Задачи',
  shape: 'Элементы',
};

const route = useRoute();
const entitiesStore = useEntitiesStore();

const isOpen = ref(false);
const messageDraft = ref('');
const pendingUploads = ref<EntityAttachment[]>([]);
const isVoiceListening = ref(false);

const chatFeedRef = ref<HTMLElement | null>(null);
const chatInputRef = ref<HTMLTextAreaElement | null>(null);
const docInputRef = ref<HTMLInputElement | null>(null);
const activeVoiceRecognition = ref<{ stop: () => void } | null>(null);
const pendingComposerHeightReset = ref(false);

const messagesByScope = ref<Record<string, ChatMessage[]>>(loadStoredMessages());

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

function normalizeType(value: unknown): EntityType {
  const allowed: EntityType[] = [
    'project',
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

function normalizeStoredMessages(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, ChatMessage[]>;
  }

  const result: Record<string, ChatMessage[]> = {};
  for (const [scope, rawMessages] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(rawMessages)) continue;

    const messages = rawMessages
      .map((rawMessage) => {
        const record = toProfile(rawMessage);
        const id = typeof record.id === 'string' ? record.id : createMessageId();
        const role = record.role === 'assistant' ? 'assistant' : 'user';
        const text = typeof record.text === 'string' ? record.text : '';
        const createdAt = typeof record.createdAt === 'string' ? record.createdAt : getIsoNow();
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
        } satisfies ChatMessage;
      })
      .filter((message): message is ChatMessage => Boolean(message));

    result[scope] = messages;
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

const inputPlaceholder = computed(() => {
  if (routeScopeType.value === 'project-canvas') {
    return 'Запрос для анализа проекта...';
  }
  return `Запрос по категории "${ENTITY_TYPE_LABELS[collectionType.value]}"...`;
});

const scopedMessages = computed(() => {
  return messagesByScope.value[scopeKey.value] || [];
});

function pushMessage(role: ChatRole, text: string, attachments: EntityAttachment[] = []) {
  const trimmed = text.trim();
  if (!trimmed && !attachments.length) return;

  const nextMessage: ChatMessage = {
    id: createMessageId(),
    role,
    text: trimmed,
    createdAt: getIsoNow(),
    attachments: attachments.map((attachment) => ({ ...attachment })),
  };

  messagesByScope.value = {
    ...messagesByScope.value,
    [scopeKey.value]: [...scopedMessages.value, nextMessage],
  };
  persistMessages();
}

function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
  const feed = chatFeedRef.value;
  if (!feed) return;
  feed.scrollTo({
    top: feed.scrollHeight,
    behavior,
  });
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
    pendingComposerHeightReset.value = true;
    void nextTick(() => {
      autoResizeComposer();
      scrollToBottom('auto');
    });
  } else {
    stopVoiceCapture();
    pendingUploads.value = [];
  }
}

function sendMessage() {
  const value = messageDraft.value.trim();
  const attachments = [...pendingUploads.value];
  if (!value && !attachments.length) return;

  pushMessage('user', value, attachments);
  messageDraft.value = '';
  pendingUploads.value = [];

  void nextTick(() => {
    autoResizeComposer();
    scrollToBottom('auto');
  });
}

function onComposerKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return;
  if (event.shiftKey) return;
  event.preventDefault();
  sendMessage();
}

function onTextInput() {
  autoResizeComposer();
}

function focusComposer() {
  chatInputRef.value?.focus();
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

function stopVoiceCapture() {
  isVoiceListening.value = false;
  if (activeVoiceRecognition.value) {
    activeVoiceRecognition.value.stop();
    activeVoiceRecognition.value = null;
  }
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

  const recognition = new RecognitionCtor();
  recognition.lang = 'ru-RU';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event: unknown) => {
    const eventResults = (event as { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }).results;
    const transcript = Array.from(eventResults || [])
      .map((result) => result?.[0]?.transcript || '')
      .join(' ')
      .trim();

    messageDraft.value = transcript;
    void nextTick(() => {
      autoResizeComposer();
    });
  };

  recognition.onend = () => {
    isVoiceListening.value = false;
    activeVoiceRecognition.value = null;
  };

  recognition.start();
  isVoiceListening.value = true;
  activeVoiceRecognition.value = { stop: () => recognition.stop() };
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
  () => {
    messageDraft.value = '';
    pendingUploads.value = [];
    stopVoiceCapture();
    pendingComposerHeightReset.value = true;
    if (!isOpen.value) return;
    void nextTick(() => {
      autoResizeComposer();
      scrollToBottom('auto');
    });
  },
  { immediate: true },
);

watch(scopedMessages, () => {
  if (!isOpen.value) return;
  void nextTick(() => {
    scrollToBottom('auto');
  });
});

onBeforeUnmount(() => {
  stopVoiceCapture();
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

    <section v-if="isOpen" class="agent-chat-panel" @pointerdown.stop>
      <header class="agent-chat-header">
        <div class="agent-chat-title-wrap">
          <div class="agent-chat-title">{{ scopeTitle }}</div>
          <div class="agent-chat-summary">{{ scopeSummary }}</div>
        </div>
        <button type="button" class="agent-chat-close" aria-label="Закрыть чат" @click="toggleChat">
          ×
        </button>
      </header>

      <section ref="chatFeedRef" class="agent-chat-feed">
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
              <span
                v-for="attachment in message.attachments"
                :key="attachment.id"
                class="agent-chat-attachment-chip"
              >
                {{ attachment.name }}
              </span>
            </div>
          </div>
          <time class="agent-chat-time">{{ toDisplayTime(message.createdAt) }}</time>
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
              title="Текстовый ввод"
              @click="focusComposer"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 5h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8l-5 4V7a2 2 0 0 1 2-2Z" />
              </svg>
            </button>

            <button
              type="button"
              class="agent-chat-tool-btn"
              :class="{ active: isVoiceListening }"
              title="Голосовой ввод"
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
            class="agent-chat-tool-btn send"
            title="Отправить"
            @click="sendMessage"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 11.5 21 3l-7.5 18-2.6-7.1L3 11.5Z" />
            </svg>
          </button>
        </div>
      </section>
    </section>
  </div>
</template>

<style scoped>
.agent-chat-dock {
  position: fixed;
  right: 18px;
  bottom: 18px;
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
  right: 18px;
  top: 60px;
  bottom: 18px;
  width: min(420px, calc(100vw - 20px));
  border-radius: 16px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  box-shadow: 0 24px 44px rgba(15, 23, 42, 0.24);
  display: flex;
  flex-direction: column;
  overflow: hidden;
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
  border-radius: 999px;
  border: 1px solid rgba(219, 228, 243, 0.9);
  background: rgba(255, 255, 255, 0.9);
  color: #334155;
  font-size: 10px;
  font-weight: 700;
  padding: 3px 8px;
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

.agent-chat-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-top: 1px solid #e8edf7;
  padding-top: 7px;
}

.agent-chat-tools-left {
  display: flex;
  align-items: center;
  gap: 6px;
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

.agent-chat-hidden-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

@media (max-width: 768px) {
  .agent-chat-panel {
    top: 60px;
    right: 10px;
    bottom: 10px;
    width: calc(100vw - 20px);
  }

  .agent-chat-dock {
    right: 10px;
    bottom: 10px;
  }
}
</style>
