<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { analyzeEntityWithAi, isEntityAiProcessingResponse } from '../../services/entityAi';
import { useEntitiesStore } from '../../stores/entities';

type ChatRole = 'user' | 'assistant';

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
const feedRef = ref<HTMLElement | null>(null);
const messageDraft = ref('');
const chatHistory = ref<ChatMessage[]>([]);
const isSubmitting = ref(false);
const isVoiceListening = ref(false);
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

async function onSubmit() {
  const currentEntity = entity.value;
  if (!currentEntity) return;
  if (isAiRequestInFlight.value) return;

  const message = normalizeChatText(messageDraft.value);
  if (!message) return;

  const entityId = currentEntity._id;
  const historyPayload = chatHistory.value
    .slice(-11)
    .map((item) => ({ role: item.role, text: item.text }));
  historyPayload.push({ role: 'user', text: message });

  stopVoiceCapture();
  messageDraft.value = '';
  isSubmitting.value = true;
  entitiesStore.setEntityAiPending(entityId, true);
  emit('close');

  void (async () => {
    try {
      const response = await analyzeEntityWithAi({
        entityId,
        message,
        history: historyPayload.slice(-12),
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
  stopVoiceCapture();
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
  <div class="quick-voice-overlay" @pointerdown.self="closeModal">
    <section class="quick-voice-modal" :class="{ dictating: isVoiceListening }" @pointerdown.stop>
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

      <p v-if="voiceError" class="quick-voice-error">{{ voiceError }}</p>

      <footer class="quick-voice-actions">
        <span class="quick-voice-actions-spacer" aria-hidden="true" />
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
          :disabled="isAiRequestInFlight || !messageDraft.trim()"
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

.quick-voice-actions {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
}

.quick-voice-actions-spacer {
  justify-self: start;
}

.quick-voice-btn {
  border: 1px solid #dbe4f3;
  background: #ffffff;
  color: #6b7a91;
  border-radius: 9px;
  width: 34px;
  height: 34px;
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
  width: 16px;
  height: 16px;
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
  border-radius: 12px;
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
  cursor: not-allowed;
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
