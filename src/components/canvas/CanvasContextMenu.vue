<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import AppIcon from '../ui/AppIcon.vue';
import type { EntityType } from '../../types/entity';
import type { LogoLibraryItem } from '../../data/logoLibrary';
import { getRadialMenuGeometry } from '../../utils/radialMenu';

interface MenuSearchItem {
  id: string;
  name: string;
  type: EntityType;
  color: string;
  image: string;
  emoji: string;
  hasLogo: boolean;
  progress: number;
}

// Retain the canvas contract while its other controls move to the inspector.
// The actual node, including its photo or logo, stays underneath this menu.
const props = defineProps<{
  x: number;
  y: number;
  zoom: number;
  currentType: EntityType;
  locked?: boolean;
  categoryLocked?: boolean;
  currentColor?: string;
  hasImage?: boolean;
  hasEmoji?: boolean;
  hasLogo?: boolean;
  currentScalePercent?: number;
  nodeDiameter?: number;
  searchItems?: MenuSearchItem[];
}>();

const emit = defineEmits<{
  (event: 'type-change', payload: { type: EntityType }): void;
  (event: 'hover-type', payload: { type: EntityType | null }): void;
  (event: 'open-entity-info'): void;
  (event: 'reset-node'): void;
  (event: 'delete-node'): void;
  (event: 'color-change', payload: { color: string }): void;
  (event: 'image-change', payload: { image: string }): void;
  (event: 'emoji-change', payload: { emoji: string; name?: string }): void;
  (event: 'logo-change', payload: { logo: LogoLibraryItem | null }): void;
  (event: 'scale-change', payload: { scalePercent: number }): void;
  (event: 'select-entity', payload: { entityId: string }): void;
  (event: 'toggle-lock'): void;
}>();

const MENU_ITEMS: Array<{ type: EntityType; label: string; column: number; row: number }> = [
  { type: 'shape', label: 'Объект', column: 0, row: -2 },
  { type: 'person', label: 'Персона', column: 1, row: -1 },
  { type: 'company', label: 'Компания', column: 2, row: 0 },
  { type: 'event', label: 'Событие', column: 1, row: 1 },
  { type: 'resource', label: 'Ресурс', column: 0, row: 2 },
  { type: 'goal', label: 'Цель', column: -1, row: 1 },
  { type: 'project', label: 'Проект', column: -2, row: 0 },
  { type: 'result', label: 'Результат', column: -1, row: -1 },
];

const viewportWidth = ref(typeof window === 'undefined' ? 1024 : window.innerWidth);
const coarsePointer = ref(false);
let pointerQuery: MediaQueryList | null = null;

const diameter = computed(() => {
  if (Number.isFinite(props.nodeDiameter) && Number(props.nodeDiameter) > 0) {
    return Number(props.nodeDiameter);
  }
  const scale = Number.isFinite(props.currentScalePercent) ? Number(props.currentScalePercent) / 100 : 1;
  const zoom = Number.isFinite(props.zoom) && props.zoom > 0 ? props.zoom : 1;
  return 78 * scale * zoom;
});
const geometry = computed(() => getRadialMenuGeometry(viewportWidth.value, diameter.value, coarsePointer.value));
const menuStyle = computed(() => ({
  left: props.x + 'px',
  top: props.y + 'px',
  width: geometry.value.width + 'px',
  height: geometry.value.height + 'px',
  '--pill-width': geometry.value.pillWidth + 'px',
  '--pill-height': geometry.value.pillHeight + 'px',
  '--node-diameter': diameter.value + 'px',
}));
const isTypeSelectionLocked = computed(() => Boolean(props.locked || props.categoryLocked));

function itemStyle(item: (typeof MENU_ITEMS)[number]) {
  const { side, middle, row, pole } = geometry.value;
  const horizontal = Math.abs(item.column) === 2 ? middle : side;
  const x = Math.sign(item.column) * horizontal;
  const y = Math.sign(item.row) * (Math.abs(item.row) === 2 ? pole : row);
  return { left: 'calc(50% + ' + x + 'px)', top: 'calc(50% + ' + y + 'px)' };
}

function onTypeHover(type: EntityType | null) {
  if (!isTypeSelectionLocked.value) emit('hover-type', { type });
}

function onTypeClick(type: EntityType) {
  if (!isTypeSelectionLocked.value) emit('type-change', { type });
}

function syncViewport() {
  viewportWidth.value = window.innerWidth;
  coarsePointer.value = pointerQuery?.matches ?? false;
}

onMounted(() => {
  pointerQuery = window.matchMedia('(pointer: coarse)');
  syncViewport();
  window.addEventListener('resize', syncViewport);
  pointerQuery.addEventListener('change', syncViewport);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncViewport);
  pointerQuery?.removeEventListener('change', syncViewport);
});
</script>

<template>
  <div
    class="menu"
    :style="menuStyle"
    aria-label="Тип объекта"
    @pointerdown.stop
    @mousedown.stop
    @click.stop
    @wheel.stop
    @mouseleave="onTypeHover(null)"
  >
    <button
      v-for="item in MENU_ITEMS"
      :key="item.type"
      type="button"
      class="menu-item"
      :class="{ active: currentType === item.type }"
      :style="itemStyle(item)"
      :aria-pressed="currentType === item.type"
      :disabled="isTypeSelectionLocked"
      @mouseenter="onTypeHover(item.type)"
      @mouseleave="onTypeHover(null)"
      @focus="onTypeHover(item.type)"
      @blur="onTypeHover(null)"
      @click="onTypeClick(item.type)"
    >
      <AppIcon :name="item.type" />
      <span>{{ item.label }}</span>
    </button>

    <button
      type="button"
      class="menu-center-trigger"
      aria-label="Открыть досье объекта"
      title="Открыть досье объекта"
      @click="emit('open-entity-info')"
    />
  </div>
</template>

<style scoped>
.menu {
  position: fixed;
  transform: translate(-50%, -50%);
  z-index: 140;
  pointer-events: none;
}

.menu-item {
  position: absolute;
  transform: translate(-50%, -50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  box-sizing: border-box;
  width: var(--pill-width);
  height: var(--pill-height);
  padding: 0 9px;
  border: 1px solid #dbe4f3;
  border-radius: 999px;
  background: #ffffff;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  box-shadow: 0 5px 14px rgba(112, 144, 176, 0.16);
  pointer-events: auto;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

.menu-item :deep(svg) {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.menu-item:hover:not(:disabled),
.menu-item.active {
  background: #1058ff;
  border-color: #1058ff;
  color: #ffffff;
}

.menu-item:disabled {
  cursor: default;
}

.menu-item:disabled:not(.active) {
  opacity: 0.5;
}

.menu-item:focus-visible,
.menu-center-trigger:focus-visible {
  outline: 2px solid #1058ff;
  outline-offset: 3px;
}

.menu-center-trigger {
  position: absolute;
  left: 50%;
  top: 50%;
  width: var(--node-diameter);
  height: var(--node-diameter);
  transform: translate(-50%, -50%);
  padding: 0;
  border-radius: 50%;
  border: 0;
  background: transparent;
  pointer-events: auto;
  cursor: pointer;
}

@media (max-width: 459px) {
  .menu-item {
    gap: 4px;
    padding: 0 4px;
    font-size: 11px;
  }

  .menu-item :deep(svg) {
    width: 13px;
    height: 13px;
  }
}
</style>
