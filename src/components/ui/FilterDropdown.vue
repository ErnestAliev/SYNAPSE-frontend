<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{
  modelValue: string[];
  options: readonly string[];
  label: string;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: string[]): void;
}>();

const rootRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const menuRef = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
const isOpen = ref(false);
const menuTop = ref(0);
const menuLeft = ref(0);
const menuMinWidth = ref(0);
const query = ref('');
const sortMode = ref<'ru' | 'en'>('ru');

const allOptions = computed(() => {
  const uniq = Array.from(new Set(props.options.map((value) => value.trim()).filter(Boolean)));
  const collator = new Intl.Collator(sortMode.value === 'ru' ? 'ru' : 'en', {
    sensitivity: 'base',
    numeric: true,
  });
  return uniq.sort((a, b) => collator.compare(a, b));
});

const filteredOptions = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return allOptions.value;
  return allOptions.value.filter((option) => option.toLowerCase().includes(q));
});

const selectedValues = computed(() => {
  const selected = Array.isArray(props.modelValue) ? props.modelValue : [];
  const available = new Set(allOptions.value);
  return selected.filter((value) => available.has(value));
});

const selectedSet = computed(() => new Set(selectedValues.value));

const triggerLabel = computed(() => {
  const selected = selectedValues.value;
  if (!selected.length) return props.label;
  if (selected.length === 1) return `${props.label}: ${selected[0]}`;
  return `${props.label}: ${selected.length}`;
});

function updateMenuPosition() {
  if (!triggerRef.value) return;
  const rect = triggerRef.value.getBoundingClientRect();
  menuTop.value = rect.bottom + 6;
  menuLeft.value = rect.left;
  menuMinWidth.value = Math.max(rect.width, 220);
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

function toggleOption(option: string) {
  const next = new Set(selectedSet.value);
  if (next.has(option)) {
    next.delete(option);
  } else {
    next.add(option);
  }
  emit('update:modelValue', Array.from(next));
}

function clearSelection() {
  emit('update:modelValue', []);
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
  if (!open) {
    query.value = '';
    return;
  }
  await nextTick();
  updateMenuPosition();
  searchInputRef.value?.focus();
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
      <span class="dropdown-label">{{ triggerLabel }}</span>
      <svg class="dropdown-arrow" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="6 9 12 15 18 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
    </button>

    <Teleport to="body">
      <div
        v-if="isOpen"
        ref="menuRef"
        class="dropdown-menu"
        :style="{
          top: `${menuTop}px`,
          left: `${menuLeft}px`,
          minWidth: `${menuMinWidth}px`,
        }"
      >
        <div class="dropdown-controls">
          <input
            ref="searchInputRef"
            v-model="query"
            type="search"
            class="dropdown-search"
            placeholder="Поиск..."
          />
          <div class="dropdown-sort-row">
            <button
              type="button"
              class="dropdown-sort-btn"
              :class="{ active: sortMode === 'ru' }"
              @click="sortMode = 'ru'"
            >
              А-Я
            </button>
            <button
              type="button"
              class="dropdown-sort-btn"
              :class="{ active: sortMode === 'en' }"
              @click="sortMode = 'en'"
            >
              A-Z
            </button>
            <button
              type="button"
              class="dropdown-clear-btn"
              :disabled="selectedValues.length === 0"
              @click="clearSelection"
            >
              Сброс
            </button>
          </div>
        </div>

        <ul class="dropdown-list" role="listbox">
          <li v-for="option in filteredOptions" :key="option">
            <button
              type="button"
              class="dropdown-option"
              :class="{ selected: selectedSet.has(option) }"
              @click="toggleOption(option)"
            >
              <span class="checkbox">
                <span v-if="selectedSet.has(option)" class="checkbox-dot" />
              </span>
              <span class="option-label">{{ option }}</span>
            </button>
          </li>
          <li v-if="filteredOptions.length === 0" class="dropdown-empty">Ничего не найдено</li>
        </ul>
      </div>
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
  max-width: 164px;
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
  margin: 0;
  padding: 6px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  box-shadow: var(--shadow-hover);
}

.dropdown-controls {
  display: grid;
  gap: 6px;
  padding: 2px 2px 6px;
}

.dropdown-search {
  height: 30px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 0 10px;
  font-size: 12px;
  color: var(--text-main);
  background: #fff;
}

.dropdown-search:focus {
  outline: none;
  border-color: #9cc4ff;
}

.dropdown-sort-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dropdown-sort-btn,
.dropdown-clear-btn {
  height: 24px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: #fff;
  color: var(--text-main);
  font-size: 11px;
  font-weight: 600;
  padding: 0 8px;
  cursor: pointer;
}

.dropdown-sort-btn.active {
  border-color: #9cc4ff;
  background: #edf4ff;
  color: #1d4ed8;
}

.dropdown-clear-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.dropdown-list {
  list-style: none;
  margin: 0;
  padding: 2px;
  max-height: 240px;
  overflow-y: auto;
}

.dropdown-option {
  width: 100%;
  border: none;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  padding: 7px 8px;
  cursor: pointer;
  color: var(--text-main);
  font-size: 12px;
  line-height: 1.2;
  display: flex;
  align-items: center;
  gap: 8px;
}

.dropdown-option:hover {
  background: var(--primary-soft);
}

.dropdown-option.selected {
  color: var(--primary);
  background: var(--primary-soft);
}

.checkbox {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  border: 1px solid #9fb4d1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: #fff;
}

.checkbox-dot {
  width: 8px;
  height: 8px;
  border-radius: 3px;
  background: #1058ff;
}

.option-label {
  white-space: nowrap;
}

.dropdown-empty {
  color: var(--text-muted);
  font-size: 12px;
  padding: 7px 9px;
}
</style>
