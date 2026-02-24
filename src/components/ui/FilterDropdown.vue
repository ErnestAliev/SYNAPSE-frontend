<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{
  modelValue: string;
  options: readonly string[];
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void;
}>();

const rootRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const menuRef = ref<HTMLElement | null>(null);
const isOpen = ref(false);
const menuTop = ref(0);
const menuLeft = ref(0);
const menuMinWidth = ref(0);

const currentValue = computed(() => {
  if (props.options.includes(props.modelValue)) {
    return props.modelValue;
  }

  return props.options[0] || '';
});

function updateMenuPosition() {
  if (!triggerRef.value) return;

  const rect = triggerRef.value.getBoundingClientRect();
  menuTop.value = rect.bottom + 6;
  menuLeft.value = rect.left;
  menuMinWidth.value = rect.width;
}

function openMenu() {
  isOpen.value = true;
}

function closeMenu() {
  isOpen.value = false;
}

function toggleMenu() {
  isOpen.value = !isOpen.value;
}

function selectOption(option: string) {
  emit('update:modelValue', option);
  closeMenu();
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node | null;
  if (!target) return;

  if (rootRef.value?.contains(target)) return;
  if (menuRef.value?.contains(target)) return;

  closeMenu();
}

function onDocumentKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    closeMenu();
  }
}

function onWindowScroll() {
  if (isOpen.value) {
    updateMenuPosition();
  }
}

watch(isOpen, async (open) => {
  if (!open) return;

  await nextTick();
  updateMenuPosition();
});

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown);
  document.addEventListener('keydown', onDocumentKeyDown);
  window.addEventListener('resize', onWindowScroll);
  window.addEventListener('scroll', onWindowScroll, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown);
  document.removeEventListener('keydown', onDocumentKeyDown);
  window.removeEventListener('resize', onWindowScroll);
  window.removeEventListener('scroll', onWindowScroll, true);
});
</script>

<template>
  <div ref="rootRef" class="dropdown">
    <button
      ref="triggerRef"
      type="button"
      class="dropdown-trigger"
      :class="{ open: isOpen }"
      :aria-expanded="isOpen"
      aria-haspopup="listbox"
      @click="toggleMenu"
      @keydown.down.prevent="openMenu"
    >
      <span class="dropdown-label">{{ currentValue }}</span>
      <svg class="dropdown-arrow" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="6 9 12 15 18 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
    </button>

    <Teleport to="body">
      <ul
        v-if="isOpen"
        ref="menuRef"
        class="dropdown-menu"
        role="listbox"
        :style="{
          top: `${menuTop}px`,
          left: `${menuLeft}px`,
          minWidth: `${menuMinWidth}px`,
        }"
      >
        <li v-for="option in options" :key="option">
          <button
            type="button"
            class="dropdown-option"
            :class="{ selected: option === currentValue }"
            @click="selectOption(option)"
          >
            {{ option }}
          </button>
        </li>
      </ul>
    </Teleport>
  </div>
</template>

<style scoped>
.dropdown {
  position: relative;
  flex-shrink: 0;
}

.dropdown-trigger {
  height: 30px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: var(--bg-card);
  color: var(--text-main);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  min-width: 120px;
  box-shadow: var(--shadow-base);
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  transition: all 0.2s;
}

.dropdown-trigger:hover {
  box-shadow: var(--shadow-hover);
}

.dropdown-trigger.open {
  border-color: var(--border-color);
  color: var(--primary);
}

.dropdown-label {
  max-width: 132px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  line-height: 1;
}

.dropdown-arrow {
  color: var(--text-muted);
  flex-shrink: 0;
  transition: transform 0.18s ease;
}

.dropdown-trigger.open .dropdown-arrow {
  transform: rotate(180deg);
}

.dropdown-menu {
  position: fixed;
  z-index: 220;
  list-style: none;
  margin: 0;
  padding: 4px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  box-shadow: var(--shadow-hover);
  max-height: 220px;
  overflow-y: auto;
}

.dropdown-option {
  width: 100%;
  border: none;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  padding: 7px 9px;
  cursor: pointer;
  color: var(--text-main);
  font-size: 12px;
  line-height: 1.2;
  white-space: nowrap;
}

.dropdown-option:hover {
  background: var(--primary-soft);
}

.dropdown-option.selected {
  color: var(--primary);
  background: var(--primary-soft);
}
</style>
