<script setup lang="ts">
import { computed, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    x: number;
    y: number;
    zoom: number;
    label?: string;
    options?: string[];
    color?: string;
    sourceLabel?: string;
    targetLabel?: string;
    arrowLeft?: boolean;
    arrowRight?: boolean;
  }>(),
  {
    label: '',
    options: () => [],
    color: '#262626',
    sourceLabel: '',
    targetLabel: '',
    arrowLeft: false,
    arrowRight: false,
  },
);

const emit = defineEmits<{
  (event: 'close'): void;
  (event: 'toggle-arrow-left'): void;
  (event: 'toggle-arrow-right'): void;
  (event: 'add-node'): void;
  (event: 'delete-edge'): void;
  (event: 'color-change', payload: { color: string }): void;
  (event: 'label-change', payload: { label: string }): void;
  (event: 'create-option', payload: { label: string }): void;
}>();

const EMPTY_RELATION_LABEL = 'Связь не указана';

const selectedLabel = ref(props.label || '');
const searchQuery = ref(props.label || '');
const isSearchOpen = ref(false);
const sourceArrowTitle = computed(() =>
  props.sourceLabel?.trim() ? `Стрелка к "${props.sourceLabel.trim()}"` : 'Стрелка к началу связи',
);
const targetArrowTitle = computed(() =>
  props.targetLabel?.trim() ? `Стрелка к "${props.targetLabel.trim()}"` : 'Стрелка к концу связи',
);
const menuStyle = computed(() => ({
  left: `${props.x}px`,
  top: `${props.y}px`,
  transform: `translate(-50%, -50%) scale(${props.zoom})`,
}));
const relationOptions = computed(() => {
  const dedup = new Set<string>();
  const normalized = props.options
    .map((option) => option.trim().slice(0, 60))
    .filter((option) => option.length > 0)
    .filter((option) => {
      const key = option.toLowerCase();
      if (dedup.has(key)) return false;
      dedup.add(key);
      return true;
    });

  if (!normalized.some((option) => option.toLowerCase() === EMPTY_RELATION_LABEL.toLowerCase())) {
    return [EMPTY_RELATION_LABEL, ...normalized];
  }

  return normalized;
});
const relationSearchOptions = computed(() => {
  const current = (props.label || '').trim();
  const options = relationOptions.value;
  if (!current || options.some((option) => option.toLowerCase() === current.toLowerCase())) {
    return options;
  }
  return [current, ...options];
});
const filteredRelationOptions = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  const source = relationSearchOptions.value;

  if (!query) {
    return source.slice(0, Math.max(10, source.length));
  }

  const matched = source.filter((option) => option.toLowerCase().includes(query));
  if (matched.length >= 10) {
    return matched;
  }

  const matchedSet = new Set(matched);
  const supplement = source
    .filter((option) => !matchedSet.has(option))
    .slice(0, Math.max(0, 10 - matched.length));
  return [...matched, ...supplement];
});

watch(
  () => props.label,
  (next) => {
    selectedLabel.value = next || '';
    if (!isSearchOpen.value) {
      searchQuery.value = next || '';
    }
  },
);

function applyLabel(rawLabel: string) {
  const normalized = rawLabel.trim().slice(0, 60);
  const nextLabel = normalized === EMPTY_RELATION_LABEL ? '' : normalized;
  emit('label-change', { label: nextLabel });
  selectedLabel.value = nextLabel;
  searchQuery.value = nextLabel;
  isSearchOpen.value = false;
}

function onSearchFocus() {
  isSearchOpen.value = true;
}

function onSearchBlur() {
  setTimeout(() => {
    isSearchOpen.value = false;
  }, 90);
}

function onSearchInput(event: Event) {
  const input = event.target as HTMLInputElement | null;
  if (!input) return;
  searchQuery.value = input.value.slice(0, 60);
  isSearchOpen.value = true;
}

function onSearchOptionClick(option: string) {
  applyLabel(option);
  emit('close');
}

function onSearchOptionPointerDown(event: PointerEvent) {
  event.preventDefault();
}

function onSearchKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return;
  event.preventDefault();

  const normalized = searchQuery.value.trim().slice(0, 60);
  if (!normalized) {
    applyLabel(EMPTY_RELATION_LABEL);
    emit('close');
    return;
  }

  const hasOption = relationSearchOptions.value.some(
    (option) => option.toLowerCase() === normalized.toLowerCase(),
  );
  const matchedOption = relationSearchOptions.value.find(
    (option) => option.toLowerCase() === normalized.toLowerCase(),
  );

  if (!hasOption && normalized.toLowerCase() !== EMPTY_RELATION_LABEL.toLowerCase()) {
    emit('create-option', { label: normalized });
  }

  applyLabel(matchedOption || normalized);
  emit('close');
}

function onColorInput(event: Event) {
  const input = event.target as HTMLInputElement | null;
  if (!input) return;
  emit('color-change', { color: input.value });
}
</script>

<template>
  <div class="connection-menu" :style="menuStyle" @pointerdown.stop @dblclick.stop>
    <div class="connection-wheel">
    <button
      type="button"
      class="connection-btn vector-btn left"
      :class="{ active: arrowLeft }"
      :title="sourceArrowTitle"
      :aria-label="sourceArrowTitle"
      @click="emit('toggle-arrow-left')"
    >
      ←
    </button>

    <button
      type="button"
      class="connection-btn vector-btn right"
      :class="{ active: arrowRight }"
      :title="targetArrowTitle"
      :aria-label="targetArrowTitle"
      @click="emit('toggle-arrow-right')"
    >
      →
    </button>

    <label class="connection-btn color-btn" title="Цвет связи">
      <input type="color" :value="color" @input="onColorInput" />
      <span class="color-dot" :style="{ background: color }" />
    </label>

    <button
      type="button"
      class="connection-btn add-btn"
      title="Создать сущность в связи"
      @click="emit('add-node')"
    >
      +
    </button>

    <button
      type="button"
      class="connection-btn delete-btn"
      title="Удалить связь"
      @click="emit('delete-edge')"
    >
      🗑
    </button>

      <div class="connection-hole" />
    </div>

    <div class="connection-label-edit">
      <input
        :value="searchQuery"
        type="text"
        class="connection-search-input"
        placeholder="Поиск связи"
        maxlength="60"
        @focus="onSearchFocus"
        @blur="onSearchBlur"
        @input="onSearchInput"
        @keydown="onSearchKeydown"
      />

      <div v-if="isSearchOpen" class="connection-search-dropdown">
        <button
          v-for="option in filteredRelationOptions"
          :key="option"
          type="button"
          class="connection-search-option"
          :class="{ active: (selectedLabel || EMPTY_RELATION_LABEL) === option }"
          @pointerdown="onSearchOptionPointerDown"
          @click="onSearchOptionClick(option)"
        >
          {{ option }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.connection-menu {
  position: fixed;
  z-index: 133;
  width: 140px;
  height: 168px;
  pointer-events: auto;
}

.connection-wheel {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 104px;
  height: 104px;
}

.connection-hole {
  width: 104px;
  height: 104px;
  border-radius: 50%;
  border: 30px solid rgba(255, 255, 255, 0.98);
  box-shadow: 0 10px 22px rgba(112, 144, 176, 0.22);
  pointer-events: none;
}

.connection-btn {
  position: absolute;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  color: #6b7280;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 10px rgba(112, 144, 176, 0.22);
  transition:
    color 0.16s ease,
    border-color 0.16s ease,
    background-color 0.16s ease;
}

.connection-btn:hover {
  color: #1058ff;
  border-color: #bfd5ff;
  background: #eef4ff;
}

.connection-btn.active {
  color: #ffffff;
  border-color: #1058ff;
  background: #1058ff;
}

.vector-btn.left {
  left: 20px;
  top: 8px;
}

.vector-btn.right {
  right: 20px;
  top: 8px;
}

.color-btn {
  left: 8px;
  bottom: 20px;
}

.color-btn input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.color-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid rgba(15, 23, 42, 0.16);
}

.add-btn {
  right: 8px;
  bottom: 20px;
  font-size: 18px;
  line-height: 1;
}

.delete-btn {
  left: 50%;
  bottom: 2px;
  transform: translateX(-50%);
  font-size: 12px;
}

.connection-label-edit {
  position: absolute;
  left: 50%;
  top: calc(100% + 2px);
  transform: translateX(-50%);
  width: 210px;
  padding: 0;
  background: transparent;
  border: none;
  box-shadow: none;
  display: flex;
  flex-direction: column;
  gap: 0;
  z-index: 1;
}

.connection-search-input {
  flex: 1;
  min-width: 0;
  width: 100%;
  border: 1px solid #dbe4f3;
  border-radius: 999px;
  background: #ffffff;
  color: #1e293b;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 10px;
  outline: none;
}

.connection-search-input:focus {
  border-color: #bfd5ff;
  box-shadow: 0 0 0 2px rgba(16, 88, 255, 0.14);
}

.connection-search-dropdown {
  margin-top: 6px;
  width: 100%;
  max-height: 228px;
  overflow-y: auto;
  border-radius: 12px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(112, 144, 176, 0.24);
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.connection-search-option {
  width: 100%;
  border: 1px solid transparent;
  border-radius: 8px;
  background: #ffffff;
  color: #334155;
  text-align: left;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 8px;
  cursor: pointer;
}

.connection-search-option:hover {
  border-color: #bfd5ff;
  background: #eef4ff;
}

.connection-search-option.active {
  color: #ffffff;
  border-color: #1058ff;
  background: #1058ff;
}
</style>
