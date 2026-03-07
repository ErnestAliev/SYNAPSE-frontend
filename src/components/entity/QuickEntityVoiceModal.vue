<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { analyzeEntityWithAi, isEntityAiProcessingResponse } from '../../services/entityAi';
import { useEntitiesStore } from '../../stores/entities';

type ChatRole = 'user' | 'assistant';

interface ChatAttachment {
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
}

const props = defineProps<{
  entityId: string;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
}>();

const entitiesStore = useEntitiesStore();
const messageInputRef = ref<HTMLTextAreaElement | null>(null);
const docInputRef = ref<HTMLInputElement | null>(null);
const feedRef = ref<HTMLElement | null>(null);
const messageDraft = ref('');
const pendingUploads = ref<ChatAttachment[]>([]);
const chatHistory = ref<ChatMessage[]>([]);
const isSubmitting = ref(false);
const isVoiceListening = ref(false);
const isToolsMenuOpen = ref(false);
const voiceError = ref('');
const activeVoiceRecognition = ref<{ stop: () => void } | null>(null);
const voiceRestartTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const voiceShouldRestart = ref(false);
const voiceSessionBaseText = ref('');
const voiceCommittedText = ref('');
const VOICE_RESTART_DELAY_MS = 120;

const entity = computed(() => entitiesStore.byId(props.entityId) || null);
const entityName = computed(() => entity.value?.name?.trim() || 'Без названия');
const isAiRequestInFlight = computed(() => {
  const current = entity.value;
  const pending = Boolean((toRecord(current?.ai_metadata) as Record<string, unknown>).analysis_pending);
  return isSubmitting.value || entitiesStore.isEntityAiPending(props.entityId) || pending;
});

function toRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {} as Record<string, unknown>;
  return value as Record<string, unknown>;
}

function createLocalMessageId() {
  return `qv-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

function createLocalAttachmentId() {
  return `qv-doc-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

function getIsoNow() {
  return new Date().toISOString();
}

function normalizeChatText(value: string) {
  return value.replace(/\r\n/g, '\n').trim();
}

function normalizeChatHistory(value: unknown) {
  if (!Array.isArray(value)) return [] as ChatMessage[];
  return value
    .map((row) => {
      const record = toRecord(row);
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
      const role = record.role === 'assistant' ? 'assistant' : 'user';
      if (!text.trim()) return null;
      return {
        id: typeof record.id === 'string' ? record.id : createLocalMessageId(),
        role,
        text,
        createdAt,
      } satisfies ChatMessage;
    })
    .filter((row): row is ChatMessage => Boolean(row));
}

function stopVoiceRestartTimer() {
  if (!voiceRestartTimer.value) return;
  clearTimeout(voiceRestartTimer.value);
  voiceRestartTimer.value = null;
}

function mergeVoiceSegments(base: string, committed: string, interim: string) {
  const clean = (value: string) => value.trim().replace(/\s+/g, ' ');
  const parts = [clean(base), clean(committed), clean(interim)].filter(Boolean);
  return parts.join(' ').trim();
}

function applyVoiceDraft(interimText = '') {
  messageDraft.value = mergeVoiceSegments(
    voiceSessionBaseText.value,
    voiceCommittedText.value,
    interimText,
  );
}

function stopVoiceCapture() {
  voiceShouldRestart.value = false;
  stopVoiceRestartTimer();
  if (activeVoiceRecognition.value) {
    activeVoiceRecognition.value.stop();
    activeVoiceRecognition.value = null;
  }
  isVoiceListening.value = false;
  voiceSessionBaseText.value = '';
  voiceCommittedText.value = '';
}

function startVoiceCapture() {
  if (typeof window === 'undefined') return;
  if (isVoiceListening.value) return;

  const speechWindow = window as unknown as {
    SpeechRecognition?: new () => {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      maxAlternatives: number;
      onresult: ((event: unknown) => void) | null;
      onerror: ((event: unknown) => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
    };
    webkitSpeechRecognition?: new () => {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      maxAlternatives: number;
      onresult: ((event: unknown) => void) | null;
      onerror: ((event: unknown) => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
    };
  };

  const RecognitionCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
  if (!RecognitionCtor) {
    voiceError.value = 'Голосовой ввод не поддерживается в этом браузере.';
    return;
  }

  voiceError.value = '';
  voiceSessionBaseText.value = messageDraft.value.trim();
  voiceCommittedText.value = '';
  voiceShouldRestart.value = true;

  const recognition = new RecognitionCtor();
  recognition.lang = 'ru-RU';
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event: unknown) => {
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
    for (let i = startIndex; i < eventResults.length; i += 1) {
      const result = eventResults[i];
      const transcript = result?.[0]?.transcript?.trim() || '';
      if (!transcript) continue;
      if (result?.isFinal) {
        voiceCommittedText.value = mergeVoiceSegments(voiceCommittedText.value, transcript, '');
      } else {
        interim = mergeVoiceSegments(interim, transcript, '');
      }
    }
    applyVoiceDraft(interim);
  };

  recognition.onerror = () => {
    voiceError.value = 'Не удалось распознать речь.';
  };

  recognition.onend = () => {
    activeVoiceRecognition.value = null;
    if (!voiceShouldRestart.value) {
      isVoiceListening.value = false;
      return;
    }

    stopVoiceRestartTimer();
    voiceRestartTimer.value = setTimeout(() => {
      if (!voiceShouldRestart.value) return;
      startVoiceCapture();
    }, VOICE_RESTART_DELAY_MS);
  };

  try {
    recognition.start();
    activeVoiceRecognition.value = recognition;
    isVoiceListening.value = true;
  } catch {
    voiceShouldRestart.value = false;
    isVoiceListening.value = false;
    voiceError.value = 'Не удалось запустить голосовой ввод.';
  }
}

function scrollToBottom() {
  const feed = feedRef.value;
  if (!feed) return;
  feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
}

function closeToolsMenu() {
  isToolsMenuOpen.value = false;
}

function toggleToolsMenu() {
  if (isAiRequestInFlight.value) return;
  isToolsMenuOpen.value = !isToolsMenuOpen.value;
}

function onMenuImportDocuments() {
  closeToolsMenu();
  docInputRef.value?.click();
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
  if (!files?.length) return;

  const attachments = await Promise.all(
    Array.from(files).map(async (file) => ({
      id: createLocalAttachmentId(),
      name: file.name,
      mime: file.type,
      size: file.size,
      data: await fileToDataUrl(file),
    })),
  );

  pendingUploads.value = [...pendingUploads.value, ...attachments];
  if (!messageDraft.value.trim()) {
    messageDraft.value = attachments.map((item) => `[Файл] ${item.name}`).join('\n');
  }

  if (input) {
    input.value = '';
  }
}

function removePendingUpload(attachmentId: string) {
  pendingUploads.value = pendingUploads.value.filter((item) => item.id !== attachmentId);
}

async function onSubmit() {
  const currentEntity = entity.value;
  if (!currentEntity) return;
  if (isAiRequestInFlight.value) return;

  const message = normalizeChatText(messageDraft.value);
  const attachments = [...pendingUploads.value];
  if (!message && !attachments.length) return;
  closeToolsMenu();

  const entityId = currentEntity._id;
  const historyText = message || attachments.map((item) => `[Файл] ${item.name}`).join('\n');
  const messageForAi = message || historyText;
  const historyPayload = chatHistory.value
    .slice(-11)
    .map((item) => ({ role: item.role, text: item.text }));
  historyPayload.push({ role: 'user', text: historyText });

  stopVoiceCapture();
  messageDraft.value = '';
  pendingUploads.value = [];
  isSubmitting.value = true;
  entitiesStore.setEntityAiPending(entityId, true);
  emit('close');

  void (async () => {
    try {
      const response = await analyzeEntityWithAi({
        entityId,
        message: messageForAi,
        history: historyPayload.slice(-12),
        attachments: attachments.map((item) => ({
          name: item.name,
          mime: item.mime,
          size: item.size,
          data: item.data,
        })),
        documents: attachments.map((item) => ({
          name: item.name,
          mime: item.mime,
          size: item.size,
          data: item.data,
        })),
        debug: true,
      });

      if (!isEntityAiProcessingResponse(response)) {
        entitiesStore.setEntityAiPending(entityId, false);
      }
    } catch (error) {
      console.error('[QuickVoice] analyzeEntityWithAi failed', error);
      entitiesStore.setEntityAiPending(entityId, false);
    } finally {
      isSubmitting.value = false;
    }
  })();
}

function onComposerKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return;
  if (event.shiftKey) return;
  event.preventDefault();
  void onSubmit();
}

function closeModal() {
  closeToolsMenu();
  stopVoiceCapture();
  pendingUploads.value = [];
  isSubmitting.value = false;
  emit('close');
}

watch(
  entity,
  (nextEntity) => {
    if (!nextEntity) {
      closeModal();
      return;
    }
    const meta = toRecord(nextEntity.ai_metadata);
    const localLen = chatHistory.value.length;
    const remoteHistory = normalizeChatHistory(meta.chat_history);

    if (remoteHistory.length > localLen) {
      chatHistory.value = remoteHistory;
      void nextTick(() => scrollToBottom());
    }
  },
  { immediate: true },
);

watch(
  () => props.entityId,
  async () => {
    closeToolsMenu();
    pendingUploads.value = [];
    messageDraft.value = '';
    voiceError.value = '';
    await nextTick();
    messageInputRef.value?.focus();
    startVoiceCapture();
  },
  { immediate: true },
);

onMounted(() => {
  void nextTick(() => {
    scrollToBottom();
    messageInputRef.value?.focus();
  });
});

onBeforeUnmount(() => {
  stopVoiceCapture();
});
</script>

<template>
  <div
    class="quick-voice-overlay"
    @pointerdown.stop
    @touchstart.stop.prevent
    @touchend.stop.prevent
    @click.stop.prevent
    @click.self.prevent="closeModal"
  >
    <section
      class="quick-voice-modal"
      :class="{ dictating: isVoiceListening }"
      @pointerdown.stop
      @touchstart.stop
      @click.stop
    >
      <header class="quick-voice-header">
        <h3 class="quick-voice-title">{{ entityName }}</h3>
        <button type="button" class="quick-voice-close" @click="closeModal">×</button>
      </header>

      <section ref="feedRef" class="quick-voice-feed">
        <article
          v-for="message in chatHistory"
          :key="message.id"
          class="quick-voice-message"
          :class="{ user: message.role === 'user', assistant: message.role === 'assistant' }"
        >
          <p class="quick-voice-message-text">{{ message.text }}</p>
        </article>
        <article v-if="isAiRequestInFlight" class="quick-voice-message assistant">
          <p class="quick-voice-message-text thinking">Думаю...</p>
        </article>
      </section>

      <div class="entity-info-chat-bar quick-voice-composer">
        <textarea
          ref="messageInputRef"
          v-model="messageDraft"
          class="entity-info-chat-input quick-voice-input"
          rows="10"
          placeholder="Скажите или напишите сообщение"
          :disabled="isAiRequestInFlight"
          @keydown="onComposerKeydown"
        />
      </div>

      <div v-if="pendingUploads.length" class="quick-voice-pending-uploads">
        <span v-for="attachment in pendingUploads" :key="attachment.id" class="quick-voice-upload-chip">
          {{ attachment.name }}
          <button type="button" class="quick-voice-upload-chip-remove" @click="removePendingUpload(attachment.id)">
            ×
          </button>
        </span>
      </div>

      <p v-if="voiceError" class="quick-voice-error">{{ voiceError }}</p>

      <footer class="quick-voice-actions">
        <div class="quick-voice-actions-left">
          <button
            type="button"
            class="quick-voice-menu-btn"
            :class="{ open: isToolsMenuOpen }"
            :disabled="isAiRequestInFlight"
            @click="toggleToolsMenu"
          >
            <span>Меню</span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m7 10 5 5 5-5" />
            </svg>
          </button>
          <input
            ref="docInputRef"
            type="file"
            class="quick-voice-hidden-input"
            multiple
            @change="onDocumentsChange"
          />

          <template v-if="isToolsMenuOpen">
            <div class="quick-voice-menu-backdrop" @click="closeToolsMenu" />
            <div class="quick-voice-menu-dropdown" @pointerdown.stop @click.stop>
              <p class="quick-voice-menu-label">Действия</p>
              <button
                type="button"
                class="quick-voice-menu-item"
                :disabled="isAiRequestInFlight"
                @click="onMenuImportDocuments"
              >
                Импорт документов
              </button>
            </div>
          </template>
        </div>
        <button
          type="button"
          class="quick-voice-btn mic"
          :class="{ active: isVoiceListening }"
          :title="isVoiceListening ? 'Остановить запись' : 'Включить микрофон'"
          :aria-label="isVoiceListening ? 'Остановить запись' : 'Включить микрофон'"
          @click="isVoiceListening ? stopVoiceCapture() : startVoiceCapture()"
        >
          <svg v-if="!isVoiceListening" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 4a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3Z" />
            <path d="M19 11a7 7 0 0 1-14 0" />
            <path d="M12 18v3" />
            <path d="M8 21h8" />
          </svg>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true">
            <rect x="7" y="7" width="10" height="10" rx="2" />
          </svg>
        </button>
        <button
          type="button"
          class="quick-voice-btn send"
          title="Отправить"
          aria-label="Отправить"
          :disabled="isAiRequestInFlight || (!messageDraft.trim() && !pendingUploads.length)"
          @click="onSubmit"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m3 11 17-8-4 18-5-6-8-4Z" />
          </svg>
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.quick-voice-overlay {
  position: fixed;
  inset: 0;
  background: rgba(10, 18, 35, 0.38);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 5200;
  padding: 16px;
}

.quick-voice-modal {
  width: min(520px, 100%);
  max-height: min(86vh, 740px);
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 18px;
  box-shadow: 0 24px 48px rgba(15, 23, 42, 0.24);
  display: grid;
  grid-template-rows: auto minmax(190px, 1fr) auto auto auto;
  gap: 10px;
  padding: 14px;
}

.quick-voice-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.quick-voice-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
}

.quick-voice-close {
  border: 0;
  background: transparent;
  color: #5b6475;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.quick-voice-feed {
  overflow: auto;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #f8fafc;
  min-height: 190px;
  max-height: 42vh;
}

.quick-voice-modal.dictating .quick-voice-feed {
  min-height: 86px;
  max-height: 132px;
}

.quick-voice-message {
  max-width: 84%;
  border-radius: 12px;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.35;
}

.quick-voice-message.user {
  margin-left: auto;
  background: #1058ff;
  color: #ffffff;
}

.quick-voice-message.assistant {
  margin-right: auto;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  color: #0f172a;
}

.quick-voice-message-text {
  margin: 0;
  white-space: pre-wrap;
}

.quick-voice-message-text.thinking {
  opacity: 0.8;
}

.quick-voice-composer {
  display: flex;
  align-items: stretch;
  border: 1px solid #dbe4f3;
  border-radius: 12px;
  background: #ffffff;
  padding: 4px 8px;
}

.quick-voice-input {
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
  min-height: min(36vh, 320px);
  max-height: 56vh;
  overflow-y: auto;
}

.quick-voice-modal.dictating .quick-voice-input {
  min-height: min(48vh, 420px);
}

.quick-voice-input::placeholder {
  color: #94a3b8;
}

.quick-voice-input:disabled {
  cursor: wait;
}

.quick-voice-error {
  margin: 0;
  font-size: 12px;
  color: #b42318;
}

.quick-voice-pending-uploads {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.quick-voice-upload-chip {
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

.quick-voice-upload-chip-remove {
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  line-height: 1;
}

.quick-voice-actions {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
  position: relative;
}

.quick-voice-actions-left {
  position: relative;
  justify-self: start;
}

.quick-voice-menu-btn {
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

.quick-voice-menu-btn svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 0.16s ease;
}

.quick-voice-menu-btn:hover,
.quick-voice-menu-btn.open {
  color: #1058ff;
  border-color: #bfd5ff;
  background: #eef4ff;
}

.quick-voice-menu-btn.open svg {
  transform: rotate(180deg);
}

.quick-voice-menu-btn:disabled,
.quick-voice-menu-btn:disabled:hover {
  opacity: 0.6;
  cursor: wait;
  color: #9aa9c2;
  border-color: #dbe4f3;
  background: #f5f8ff;
}

.quick-voice-hidden-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

.quick-voice-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1099;
}

.quick-voice-menu-dropdown {
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

.quick-voice-menu-label {
  margin: 0;
  padding: 5px 8px 6px;
  font-size: 10px;
  line-height: 1;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #94a3b8;
}

.quick-voice-menu-item {
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

.quick-voice-menu-item:hover:not(:disabled) {
  background: #eef4ff;
  color: #1058ff;
}

.quick-voice-menu-item:disabled,
.quick-voice-menu-item:disabled:hover {
  cursor: wait;
  opacity: 0.55;
  background: transparent;
  color: #94a3b8;
}

.quick-voice-btn {
  border: 1px solid #dbe4f3;
  background: #ffffff;
  color: #6b7a91;
  border-radius: 999px;
  width: 40px;
  height: 40px;
  padding: 0;
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

.quick-voice-btn svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.quick-voice-btn.mic {
  justify-self: center;
  position: relative;
  color: #ffffff;
  background: #1058ff;
  border-color: #1058ff;
}

.quick-voice-btn.mic.active {
  background: #d92d20;
  border-color: #d92d20;
}

.quick-voice-btn.mic.active::after {
  content: '';
  position: absolute;
  inset: -5px;
  border-radius: 999px;
  border: 2px solid rgba(217, 45, 32, 0.45);
  animation: quick-voice-record-pulse 1.2s ease-out infinite;
}

.quick-voice-btn:hover {
  transform: translateY(-1px);
}

.quick-voice-btn.send {
  justify-self: end;
  background: #1058ff;
  border-color: #1058ff;
  color: #ffffff;
}

.quick-voice-btn.send svg {
  fill: currentColor;
  stroke: none;
}

.quick-voice-btn:disabled {
  opacity: 0.5;
  cursor: wait;
  transform: none;
}

@keyframes quick-voice-record-pulse {
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
</style>
