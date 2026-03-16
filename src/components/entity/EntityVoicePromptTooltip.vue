<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { getEntityVoicePromptSet } from '../../constants/entityVoicePrompts';
import type { EntityType } from '../../types/entity';

const props = defineProps<{
  entityType: EntityType;
  visible: boolean;
}>();

const activeQuestionIndex = ref(0);

const promptSet = computed(() => getEntityVoicePromptSet(props.entityType));
const questions = computed(() => promptSet.value.questions);
const totalQuestions = computed(() => questions.value.length);
const currentQuestion = computed(() => questions.value[activeQuestionIndex.value] || '');
const canShowTooltip = computed(() => props.visible && totalQuestions.value > 0);
const isReadyPromptSet = computed(() => promptSet.value.mode === 'ready');

watch(
  () => [props.visible, props.entityType] as const,
  () => {
    activeQuestionIndex.value = 0;
  },
);

function selectQuestion(index: number) {
  if (index < 0 || index >= totalQuestions.value) return;
  activeQuestionIndex.value = index;
}

function showNextQuestion() {
  if (totalQuestions.value <= 1) return;
  activeQuestionIndex.value = (activeQuestionIndex.value + 1) % totalQuestions.value;
}
</script>

<template>
  <transition name="entity-voice-prompt">
    <div v-if="canShowTooltip" class="entity-voice-prompt-tooltip" :class="{ planned: !isReadyPromptSet }">
      <div class="entity-voice-prompt-head">
        <span class="entity-voice-prompt-badge">{{ promptSet.badge }}</span>
        <span class="entity-voice-prompt-count">{{ activeQuestionIndex + 1 }}/{{ totalQuestions }}</span>
      </div>

      <div class="entity-voice-prompt-body">
        <p class="entity-voice-prompt-text">{{ currentQuestion }}</p>
        <button
          v-if="totalQuestions > 1"
          type="button"
          class="entity-voice-prompt-next"
          :aria-label="`Следующий вопрос: ${((activeQuestionIndex + 1) % totalQuestions) + 1}`"
          @click.stop="showNextQuestion"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </button>
      </div>

      <div class="entity-voice-prompt-progress" :class="{ single: totalQuestions === 1 }">
        <button
          v-for="(_, index) in questions"
          :key="`entity-voice-prompt-${index}`"
          type="button"
          class="entity-voice-prompt-pill"
          :class="{ active: index === activeQuestionIndex }"
          :aria-label="`Показать вопрос ${index + 1}`"
          @click.stop="selectQuestion(index)"
        />
      </div>
    </div>
  </transition>
</template>

<style scoped>
.entity-voice-prompt-tooltip {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 14px);
  transform: translateX(-50%);
  width: min(320px, calc(100vw - 32px));
  border-radius: 18px;
  border: 1px solid rgba(189, 213, 255, 0.95);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(244, 248, 255, 0.98) 100%);
  box-shadow: 0 18px 36px rgba(15, 23, 42, 0.18);
  padding: 12px 12px 14px;
  z-index: 12;
}

.entity-voice-prompt-tooltip::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -8px;
  width: 16px;
  height: 16px;
  border-right: 1px solid rgba(189, 213, 255, 0.95);
  border-bottom: 1px solid rgba(189, 213, 255, 0.95);
  background: rgba(246, 249, 255, 0.98);
  transform: translateX(-50%) rotate(45deg);
}

.entity-voice-prompt-tooltip.planned {
  border-color: rgba(203, 213, 225, 0.98);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 0.98) 100%);
}

.entity-voice-prompt-tooltip.planned::after {
  border-right-color: rgba(203, 213, 225, 0.98);
  border-bottom-color: rgba(203, 213, 225, 0.98);
  background: rgba(248, 250, 252, 0.98);
}

.entity-voice-prompt-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.entity-voice-prompt-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: #eef4ff;
  color: #1058ff;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.entity-voice-prompt-tooltip.planned .entity-voice-prompt-badge {
  background: #f1f5f9;
  color: #475569;
}

.entity-voice-prompt-count {
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.entity-voice-prompt-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.entity-voice-prompt-text {
  margin: 0;
  color: #0f172a;
  font-size: 14px;
  line-height: 1.45;
  font-weight: 600;
}

.entity-voice-prompt-next {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  border: 1px solid #bfd5ff;
  border-radius: 999px;
  background: #1058ff;
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    transform 0.16s ease,
    background-color 0.16s ease,
    border-color 0.16s ease;
}

.entity-voice-prompt-next:hover {
  transform: translateX(1px);
}

.entity-voice-prompt-next svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.entity-voice-prompt-progress {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
  gap: 6px;
  margin-top: 12px;
}

.entity-voice-prompt-progress.single {
  grid-template-columns: 1fr;
}

.entity-voice-prompt-pill {
  width: 100%;
  height: 9px;
  border: none;
  border-radius: 999px;
  background: #dbe7fb;
  cursor: pointer;
  transition:
    background-color 0.16s ease,
    transform 0.16s ease;
}

.entity-voice-prompt-pill:hover {
  transform: translateY(-1px);
}

.entity-voice-prompt-pill.active {
  background: linear-gradient(90deg, #1058ff 0%, #2f7bff 100%);
}

.entity-voice-prompt-tooltip.planned .entity-voice-prompt-pill {
  background: #e2e8f0;
}

.entity-voice-prompt-tooltip.planned .entity-voice-prompt-pill.active {
  background: linear-gradient(90deg, #94a3b8 0%, #64748b 100%);
}

.entity-voice-prompt-enter-active,
.entity-voice-prompt-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.entity-voice-prompt-enter-from,
.entity-voice-prompt-leave-to {
  opacity: 0;
  transform: translate(-50%, 10px);
}

@media (max-width: 720px) {
  .entity-voice-prompt-tooltip {
    width: min(300px, calc(100vw - 28px));
    bottom: calc(100% + 12px);
    padding: 11px 11px 13px;
  }

  .entity-voice-prompt-text {
    font-size: 13px;
  }

  .entity-voice-prompt-next {
    width: 32px;
    height: 32px;
    flex-basis: 32px;
  }
}
</style>
