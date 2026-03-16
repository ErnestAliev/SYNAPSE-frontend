<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type CSSProperties } from 'vue';
import AppIcon from '../ui/AppIcon.vue';
import ProfileProgressRing from '../ui/ProfileProgressRing.vue';
import { useEntitiesStore } from '../../stores/entities';
import type { CanvasNodeProjection, EntityType } from '../../types/entity';
import { calculateEntityProfileProgress } from '../../utils/profileProgress';

const props = defineProps<{
  node: CanvasNodeProjection;
  active?: boolean;
  selected?: boolean;
  dragging?: boolean;
  interactionLocked?: boolean;
  isNameEditing?: boolean;
  previewType?: EntityType | null;
  playMode?: boolean;
}>();

const emit = defineEmits<{
  (
    event: 'start-drag',
    payload: {
      nodeId: string;
      pointerEvent: PointerEvent;
    },
  ): void;
  (
    event: 'open-menu',
    payload: {
      nodeId: string;
      shiftKey?: boolean;
    },
  ): void;
  (
    event: 'open-portal',
    payload: {
      projectId: string;
    },
  ): void;
  (
    event: 'name-commit',
    payload: {
      entityId: string;
      name: string;
    },
  ): void;
  (
    event: 'name-edit-finished',
    payload: {
      nodeId: string;
    },
  ): void;
  (
    event: 'node-play-enter',
    payload: {
      nodeId: string;
      rect: DOMRect;
    },
  ): void;
  (
    event: 'node-play-leave',
    payload: {
      nodeId: string;
    },
  ): void;
  (
    event: 'node-play-tap',
    payload: {
      nodeId: string;
      rect: DOMRect;
    },
  ): void;
  (
    event: 'node-long-press',
    payload: {
      nodeId: string;
      entityId: string;
    },
  ): void;
}>();

const entitiesStore = useEntitiesStore();
const nameInputRef = ref<HTMLInputElement | null>(null);
const nameDraft = ref('');
const playModePointerDown = ref<{ x: number; y: number; id: number } | null>(null);
const EMPTY_NAME_PLACEHOLDER = 'Без названия';
const BASE_NODE_RING_SIZE = 82;
const LONG_PRESS_DELAY_MS = 1000;
const LONG_PRESS_MOVE_CANCEL_PX = 10;
const LONG_PRESS_CLICK_SUPPRESS_MS = 900;
const holdState = ref<{
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  timer: ReturnType<typeof setTimeout>;
} | null>(null);
const suppressClickUntilMs = ref(0);

const entity = computed(() => entitiesStore.byId(props.node.entityId));
const displayName = computed(() => entity.value?.name?.trim() || 'Без названия');
const entityType = computed<EntityType>(() => entity.value?.type || 'shape');
const renderedType = computed<EntityType>(() => props.previewType || entityType.value);
const profile = computed(() => {
  const raw = entity.value?.profile;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {} as Record<string, unknown>;
  }
  return raw as Record<string, unknown>;
});
const nodeColor = computed(() => {
  const raw = profile.value.color;
  if (typeof raw !== 'string' || !raw.trim()) return '#1058ff';
  return raw;
});
const nodeImage = computed(() => {
  const raw = profile.value.image;
  return typeof raw === 'string' ? raw : '';
});

function logoImageFromProfileRecord(record: Record<string, unknown>) {
  const raw = record.logo;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '';

  const logo = raw as Record<string, unknown>;
  return typeof logo.image === 'string' ? logo.image : '';
}

const hasLogo = computed(() => {
  return logoImageFromProfileRecord(profile.value).trim().length > 0;
});
const nodeEmoji = computed(() => {
  const raw = profile.value.emoji;
  return typeof raw === 'string' ? raw : '';
});
const isLocked = computed(() => {
  const raw = profile.value.locked;
  if (typeof raw === 'boolean') {
    return raw;
  }

  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }

  return false;
});
const nodeScale = computed(() => {
  const raw = props.node.scale;
  const parsed =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? Number.parseFloat(raw)
        : Number.NaN;

  if (Number.isFinite(parsed)) {
    return Math.min(1.2, Math.max(0.8, parsed));
  }

  return 1;
});
const nameInputSize = computed(() => {
  const length = nameDraft.value.trim().length;
  return Math.min(32, Math.max(10, length || 10));
});
const nodeStyle = computed<CSSProperties>(() => ({
  left: `${props.node.x}px`,
  top: `${props.node.y}px`,
  pointerEvents: props.interactionLocked ? 'none' : 'auto',
}));
const nodeCircleStyle = computed(() => ({
  background: nodeColor.value,
  borderColor: nodeColor.value,
}));
const nodeProgress = computed(() => calculateEntityProfileProgress(entity.value));
const nodeCircleWrapStyle = computed(() => ({
  width: `${BASE_NODE_RING_SIZE}px`,
  height: `${BASE_NODE_RING_SIZE}px`,
  transform: `scale(${nodeScale.value})`,
  transformOrigin: 'center center',
}));

watch(
  displayName,
  (nextName) => {
    const trimmedDraft = nameDraft.value.trim();
    const canHydrateWhileEditing =
      !trimmedDraft || trimmedDraft === EMPTY_NAME_PLACEHOLDER;

    if (!props.isNameEditing || canHydrateWhileEditing) {
      nameDraft.value = nextName;
    }
  },
  { immediate: true },
);

watch(
  () => props.isNameEditing,
  async (isEditing) => {
    if (!isEditing) return;

    const trimmedDraft = nameDraft.value.trim();
    if (!trimmedDraft || trimmedDraft === EMPTY_NAME_PLACEHOLDER) {
      nameDraft.value = displayName.value;
    }

    await nextTick();
    if (!nameInputRef.value) return;

    nameInputRef.value.focus();
    nameInputRef.value.select();
  },
  { immediate: true },
);

function normalizeName(rawValue: string) {
  const trimmed = rawValue.trim();
  if (trimmed.length) return trimmed;
  return displayName.value;
}

function commitName() {
  const nextName = normalizeName(nameDraft.value);
  nameDraft.value = nextName;

  const entityId = entity.value?._id || props.node.entityId;
  emit('name-commit', {
    entityId,
    name: nextName,
  });
}

function finishNameEditing() {
  emit('name-edit-finished', { nodeId: props.node.id });
}

function onNodePointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  if (isLocked.value) return;

  if (props.playMode) {
    // Record start position — tap is detected on pointerup (more reliable on mobile)
    playModePointerDown.value = { x: event.clientX, y: event.clientY, id: event.pointerId };
    return;
  }

  const target = event.target as HTMLElement | null;
  if (target?.closest('.node-name-input')) {
    return;
  }

  startHoldTracking(event);

  if (event.pointerType === 'touch') {
    if (event.cancelable) {
      event.preventDefault();
    }
    return;
  }

  emit('start-drag', { nodeId: props.node.id, pointerEvent: event });
}

function onNodePointerUp(event: PointerEvent) {
  clearHoldTracking(event.pointerId);

  if (!props.playMode) return;
  const start = playModePointerDown.value;
  if (!start || start.id !== event.pointerId) return;
  playModePointerDown.value = null;

  // Ignore if finger/pointer moved too much (pan gesture, not a tap)
  const dx = event.clientX - start.x;
  const dy = event.clientY - start.y;
  if (Math.hypot(dx, dy) > 10) return;

  const el = event.currentTarget as HTMLElement;
  emit('node-play-tap', { nodeId: props.node.id, rect: el.getBoundingClientRect() });
}

function onNodeClick(event: MouseEvent) {
  event.stopPropagation();

  if (props.playMode) {
    // Touch taps are fully handled by onNodePointerUp.
    // For mouse, playModePointerDown is cleared in pointerup — skip to avoid double-emit.
    if (playModePointerDown.value === null) return;
    // Fallback: pointerup didn't fire (rare edge-case), handle here.
    const el = (event.currentTarget as HTMLElement).closest('.canvas-node') as HTMLElement | null;
    const rect = el
      ? el.getBoundingClientRect()
      : (event.currentTarget as HTMLElement).getBoundingClientRect();
    emit('node-play-tap', { nodeId: props.node.id, rect });
    return;
  }

  if (Date.now() < suppressClickUntilMs.value) {
    return;
  }

  emit('open-menu', { nodeId: props.node.id, shiftKey: event.shiftKey });
}

function onNodeMouseEnter(event: MouseEvent) {
  if (!props.playMode) return;
  const el = event.currentTarget as HTMLElement;
  emit('node-play-enter', { nodeId: props.node.id, rect: el.getBoundingClientRect() });
}

function onNodeMouseLeave() {
  if (!props.playMode) return;
  emit('node-play-leave', { nodeId: props.node.id });
}

function onNodeDoubleClick(event: MouseEvent) {
  event.stopPropagation();

  if (props.playMode) {
    return;
  }

  if (entityType.value !== 'project' || !entity.value?._id) {
    return;
  }

  emit('open-portal', { projectId: entity.value._id });
}

function onNameBlur() {
  commitName();
  finishNameEditing();
}

function onNameKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault();
    (event.target as HTMLInputElement).blur();
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    nameDraft.value = displayName.value;
    finishNameEditing();
    (event.target as HTMLInputElement).blur();
  }
}

function selectAllNameInput(event: Event) {
  const input = event.target as HTMLInputElement | null;
  if (!input) return;

  input.select();
}

function onNameInputClick(event: MouseEvent) {
  event.stopPropagation();
  const input = event.target as HTMLInputElement | null;
  if (!input) return;

  requestAnimationFrame(() => {
    input.select();
  });
}

function clearHoldTracking(pointerId?: number) {
  const active = holdState.value;
  if (!active) return;
  if (typeof pointerId === 'number' && active.pointerId !== pointerId) return;
  clearTimeout(active.timer);
  holdState.value = null;
}

function onWindowPointerMove(event: PointerEvent) {
  const active = holdState.value;
  if (!active || active.pointerId !== event.pointerId) return;
  const dx = event.clientX - active.startX;
  const dy = event.clientY - active.startY;
  if (Math.hypot(dx, dy) >= LONG_PRESS_MOVE_CANCEL_PX) {
    const shouldStartDrag = active.pointerType === 'touch' && !props.playMode && !isLocked.value;
    clearHoldTracking(event.pointerId);
    if (shouldStartDrag) {
      emit('start-drag', { nodeId: props.node.id, pointerEvent: event });
    }
  }
}

function onWindowPointerEnd(event: PointerEvent) {
  clearHoldTracking(event.pointerId);
}

function startHoldTracking(event: PointerEvent) {
  clearHoldTracking();
  const timer = setTimeout(() => {
    suppressClickUntilMs.value = Date.now() + LONG_PRESS_CLICK_SUPPRESS_MS;
    emit('node-long-press', {
      nodeId: props.node.id,
      entityId: entity.value?._id || props.node.entityId,
    });
    clearHoldTracking();
  }, LONG_PRESS_DELAY_MS);
  holdState.value = {
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    startX: event.clientX,
    startY: event.clientY,
    timer,
  };
}

onBeforeUnmount(() => {
  clearHoldTracking();
});
</script>

<template>
  <div
    class="canvas-node"
    :class="{ active, selected, dragging, 'play-mode': playMode, 'interaction-locked': interactionLocked }"
    :style="nodeStyle"
    @pointerdown.stop="onNodePointerDown"
    @pointerup="onNodePointerUp"
    @pointermove="onWindowPointerMove"
    @pointercancel="onWindowPointerEnd"
    @pointerleave="onWindowPointerEnd"
    @contextmenu.prevent
    @dblclick.stop="onNodeDoubleClick"
    @mouseenter="onNodeMouseEnter"
    @mouseleave="onNodeMouseLeave"
  >
    <div class="node-circle-wrap" :style="nodeCircleWrapStyle">
      <span v-if="selected" class="node-selection-frame" />
      <ProfileProgressRing
        class="node-progress-ring"
        :value="nodeProgress"
        :size="BASE_NODE_RING_SIZE"
        :stroke-width="4"
      />

      <button
        type="button"
        class="node-circle"
        :title="renderedType"
        :style="nodeCircleStyle"
        @click.stop="onNodeClick"
        @dragstart.prevent
      >
        <img
          v-if="!previewType && nodeImage && !hasLogo"
          class="node-image"
          :src="nodeImage"
          alt=""
          draggable="false"
          @dragstart.prevent
        />
        <img
          v-else-if="!previewType && hasLogo"
          class="node-logo"
          :src="nodeImage"
          alt=""
          draggable="false"
          @dragstart.prevent
        />
        <span v-else-if="!previewType && nodeEmoji" class="node-emoji">{{ nodeEmoji }}</span>
        <AppIcon v-else class="node-icon" :name="renderedType" />
      </button>
    </div>

    <input
      ref="nameInputRef"
      v-model="nameDraft"
      type="text"
      class="node-name-input"
      :size="nameInputSize"
      maxlength="32"
      :disabled="isLocked"
      :aria-label="`Имя узла ${displayName}`"
      @click="onNameInputClick"
      @pointerdown.stop
      @focus="selectAllNameInput"
      @blur="onNameBlur"
      @keydown="onNameKeydown"
    />
  </div>
</template>

<style scoped>
.canvas-node {
  position: absolute;
  transform: translate(-50%, -50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  z-index: 1;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}

.canvas-node.interaction-locked {
  opacity: 0.96;
}

.node-circle-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.node-selection-frame {
  position: absolute;
  width: 94px;
  height: 94px;
  border-radius: 16px;
  border: 2px solid rgba(16, 88, 255, 0.8);
  background: rgba(16, 88, 255, 0.08);
  box-shadow: 0 0 0 2px rgba(16, 88, 255, 0.12);
  pointer-events: none;
  z-index: 0;
}

.node-progress-ring {
  position: absolute;
  inset: 0;
}

.node-circle {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  border: 1px solid #1058ff;
  background: #1058ff;
  box-shadow: var(--shadow-base);
  color: #ffffff;
  cursor: pointer;
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.18s ease;
  z-index: 1;
}

.node-circle:hover {
  transform: translateY(-1px);
}

.node-icon {
  width: 60%;
  height: 60%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.node-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.node-image {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  pointer-events: none;
  -webkit-user-drag: none;
  user-select: none;
}

.node-logo {
  width: 60%;
  height: 60%;
  object-fit: contain;
  pointer-events: none;
  -webkit-user-drag: none;
  user-select: none;
}

.node-emoji {
  font-size: 43px;
  line-height: 1;
}

.node-name-input {
  position: absolute;
  left: 50%;
  top: calc(100% + 8px);
  transform: translateX(-50%);
  width: auto;
  min-width: 10ch;
  max-width: 32ch;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-main);
  font-size: 10px;
  line-height: 1;
  font-weight: 700;
  text-align: center;
  padding: 0.5em 0.825em;
  outline: none;
  user-select: text;
}

.node-name-input:focus {
  border-color: var(--border-color);
  background: #ffffff;
  box-shadow: 0 0 0 2px var(--primary-soft);
}

.node-name-input:disabled {
  opacity: 0.7;
  cursor: default;
}

.canvas-node.dragging .node-circle {
  cursor: grabbing;
}

.canvas-node.active .node-name-input {
  opacity: 0;
  pointer-events: none;
}

.canvas-node.active {
  z-index: 131;
}

.canvas-node.selected {
  z-index: 132;
}

.canvas-node.selected .node-circle {
  box-shadow:
    0 0 0 2px rgba(16, 88, 255, 0.28),
    var(--shadow-hover);
}
</style>
