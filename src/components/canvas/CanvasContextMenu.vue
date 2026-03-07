<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import ruEmojiData from 'emojibase-data/ru/data.json';
import AppIcon from '../ui/AppIcon.vue';
import ProfileProgressRing from '../ui/ProfileProgressRing.vue';
import type { EntityType } from '../../types/entity';
import {
  SYSTEM_SOCIAL_LOGOS,
  addCustomLogo,
  createLogoKeywords,
  readCustomLogos,
  type LogoLibraryItem,
} from '../../data/logoLibrary';

interface EmojiRecord {
  emoji?: string;
  label?: string;
  tags?: string[];
}

interface EmojiItem {
  emoji: string;
  label: string;
  searchLabel: string;
  searchTags: string[];
}

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
  searchItems?: MenuSearchItem[];
}>();

const emit = defineEmits<{
  (
    event: 'type-change',
    payload: {
      type: EntityType;
    },
  ): void;
  (
    event: 'hover-type',
    payload: {
      type: EntityType | null;
    },
  ): void;
  (event: 'reset-node'): void;
  (event: 'delete-node'): void;
  (
    event: 'color-change',
    payload: {
      color: string;
    },
  ): void;
  (
    event: 'image-change',
    payload: {
      image: string;
    },
  ): void;
  (
    event: 'emoji-change',
    payload: {
      emoji: string;
      name?: string;
    },
  ): void;
  (
    event: 'logo-change',
    payload: {
      logo: LogoLibraryItem | null;
    },
  ): void;
  (
    event: 'scale-change',
    payload: {
      scalePercent: number;
    },
  ): void;
  (
    event: 'select-entity',
    payload: {
      entityId: string;
    },
  ): void;
  (event: 'open-entity-info'): void;
  (event: 'toggle-lock'): void;
}>();

const MENU_ITEMS: Array<{ type: EntityType; label: string; className: string }> = [
  { type: 'shape', label: 'Элемент', className: 'menu-item-1' },
  { type: 'person', label: 'Персона', className: 'menu-item-2' },
  { type: 'company', label: 'Компания', className: 'menu-item-3' },
  { type: 'event', label: 'Событие', className: 'menu-item-4' },
  { type: 'resource', label: 'Ресурс', className: 'menu-item-5' },
  { type: 'goal', label: 'Цель', className: 'menu-item-6' },
  { type: 'project', label: 'Проект', className: 'menu-item-7' },
  { type: 'result', label: 'Результат', className: 'menu-item-8' },
];

const colorInputRef = ref<HTMLInputElement | null>(null);
const imageInputRef = ref<HTMLInputElement | null>(null);
const logoInputRef = ref<HTMLInputElement | null>(null);
const zoomTrackRef = ref<HTMLDivElement | null>(null);
const emojiQuery = ref('');
const logoQuery = ref('');
const isEmojiPickerOpen = ref(false);
const isLogoPickerOpen = ref(false);
const isZoomDragging = ref(false);
const nodeSearchQuery = ref('');
const isSearchDropdownOpen = ref(false);
const customLogos = ref<LogoLibraryItem[]>([]);
const customLogoName = ref('');
const logoUploadError = ref('');
const isImageEditorOpen = ref(false);
const imageEditorSrc = ref('');
const imageEditorZoom = ref(1);
const imageEditorOffsetX = ref(0);
const imageEditorOffsetY = ref(0);
const imageEditorNaturalSize = ref({ width: 0, height: 0 });
const imageEditorDragState = ref<{
  startClientX: number;
  startClientY: number;
  startOffsetX: number;
  startOffsetY: number;
} | null>(null);
const imageEditorPointerId = ref<number | null>(null);

const MIN_SCALE_PERCENT = 80;
const MAX_SCALE_PERCENT = 120;
const DEFAULT_SCALE_PERCENT = 100;
const IMAGE_EDITOR_PREVIEW_SIZE = 220;
const IMAGE_EDITOR_OUTPUT_SIZE = 512;
const IMAGE_EDITOR_MIN_ZOOM = 1;
const IMAGE_EDITOR_MAX_ZOOM = 3;

const menuStyle = computed(() => ({
  left: `${props.x}px`,
  top: `${props.y}px`,
  '--menu-scale': `${props.zoom}`,
}));

const resolvedColor = computed(() => {
  if (typeof props.currentColor === 'string' && props.currentColor.trim()) {
    return props.currentColor;
  }
  return '#1058ff';
});

const isTypeSelectionLocked = computed(() => Boolean(props.locked) || Boolean(props.categoryLocked));

const imageEditorPreviewStyle = computed(() => {
  const layout = getImageEditorLayout(imageEditorZoom.value);
  const left = IMAGE_EDITOR_PREVIEW_SIZE / 2 - layout.drawWidth / 2 + imageEditorOffsetX.value;
  const top = IMAGE_EDITOR_PREVIEW_SIZE / 2 - layout.drawHeight / 2 + imageEditorOffsetY.value;

  return {
    width: `${layout.drawWidth}px`,
    height: `${layout.drawHeight}px`,
    transform: `translate(${left}px, ${top}px)`,
  };
});

function clampScalePercent(value: number) {
  return Math.min(MAX_SCALE_PERCENT, Math.max(MIN_SCALE_PERCENT, Math.round(value)));
}

const resolvedScalePercent = computed(() => {
  const raw = Number(props.currentScalePercent);
  if (!Number.isFinite(raw)) {
    return DEFAULT_SCALE_PERCENT;
  }
  return clampScalePercent(raw);
});

const zoomThumbLeft = computed(() => {
  return `${((resolvedScalePercent.value - MIN_SCALE_PERCENT) / (MAX_SCALE_PERCENT - MIN_SCALE_PERCENT)) * 100}%`;
});

const emojiItems = (ruEmojiData as EmojiRecord[])
  .filter((record) => typeof record.emoji === 'string' && record.emoji.trim().length > 0)
  .map<EmojiItem>((record) => ({
    emoji: record.emoji as string,
    label: typeof record.label === 'string' ? record.label.trim() : '',
    searchLabel: record.label?.toLowerCase() || '',
    searchTags: (record.tags || []).map((tag) => tag.toLowerCase()),
  }));

const filteredEmoji = computed(() => {
  const query = emojiQuery.value.trim().toLowerCase();

  if (!query) {
    return emojiItems.slice(0, 240);
  }

  return emojiItems
    .filter((item) => item.searchLabel.includes(query) || item.searchTags.some((tag) => tag.includes(query)))
    .slice(0, 240);
});

const filteredSystemLogos = computed(() => {
  const query = logoQuery.value.trim().toLowerCase();
  if (!query) {
    return SYSTEM_SOCIAL_LOGOS;
  }

  return SYSTEM_SOCIAL_LOGOS.filter((item) => {
    if (item.name.toLowerCase().includes(query)) return true;
    return item.keywords.some((keyword) => keyword.includes(query));
  });
});

const filteredCustomLogos = computed(() => {
  const query = logoQuery.value.trim().toLowerCase();
  const source = customLogos.value;
  if (!query) {
    return source;
  }

  return source.filter((item) => {
    if (item.name.toLowerCase().includes(query)) return true;
    return item.keywords.some((keyword) => keyword.includes(query));
  });
});

const filteredSearchItems = computed(() => {
  const query = nodeSearchQuery.value.trim().toLowerCase();
  const source = props.searchItems || [];

  if (!query) {
    return [];
  }

  return source
    .filter((item) => item.name.toLowerCase().includes(query))
    .slice(0, 80);
});

function closeEmojiPicker() {
  isEmojiPickerOpen.value = false;
}

function closeLogoPicker() {
  isLogoPickerOpen.value = false;
  logoUploadError.value = '';
}

function clampImageEditorZoom(value: number) {
  return Math.min(IMAGE_EDITOR_MAX_ZOOM, Math.max(IMAGE_EDITOR_MIN_ZOOM, value));
}

function getImageEditorLayout(zoomValue: number) {
  const width = imageEditorNaturalSize.value.width;
  const height = imageEditorNaturalSize.value.height;
  if (!width || !height) {
    return {
      drawWidth: IMAGE_EDITOR_PREVIEW_SIZE,
      drawHeight: IMAGE_EDITOR_PREVIEW_SIZE,
      maxOffsetX: 0,
      maxOffsetY: 0,
    };
  }

  const baseScale = Math.max(IMAGE_EDITOR_PREVIEW_SIZE / width, IMAGE_EDITOR_PREVIEW_SIZE / height);
  const scale = baseScale * clampImageEditorZoom(zoomValue);
  const drawWidth = width * scale;
  const drawHeight = height * scale;

  return {
    drawWidth,
    drawHeight,
    maxOffsetX: Math.max(0, (drawWidth - IMAGE_EDITOR_PREVIEW_SIZE) / 2),
    maxOffsetY: Math.max(0, (drawHeight - IMAGE_EDITOR_PREVIEW_SIZE) / 2),
  };
}

function clampImageEditorOffset(offsetX: number, offsetY: number, zoomValue = imageEditorZoom.value) {
  const layout = getImageEditorLayout(zoomValue);
  return {
    x: Math.min(layout.maxOffsetX, Math.max(-layout.maxOffsetX, offsetX)),
    y: Math.min(layout.maxOffsetY, Math.max(-layout.maxOffsetY, offsetY)),
  };
}

function resetImageEditorState() {
  imageEditorSrc.value = '';
  imageEditorZoom.value = IMAGE_EDITOR_MIN_ZOOM;
  imageEditorOffsetX.value = 0;
  imageEditorOffsetY.value = 0;
  imageEditorNaturalSize.value = { width: 0, height: 0 };
  imageEditorDragState.value = null;
  imageEditorPointerId.value = null;
}

function closeImageEditor() {
  isImageEditorOpen.value = false;
  resetImageEditorState();
}

function openImageEditor(src: string) {
  const image = new Image();
  image.onload = () => {
    imageEditorSrc.value = src;
    imageEditorNaturalSize.value = {
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
    };
    imageEditorZoom.value = IMAGE_EDITOR_MIN_ZOOM;
    imageEditorOffsetX.value = 0;
    imageEditorOffsetY.value = 0;
    isImageEditorOpen.value = true;
  };
  image.src = src;
}

function onImageEditorZoomInput(event: Event) {
  const input = event.target as HTMLInputElement | null;
  if (!input) return;

  const nextZoom = clampImageEditorZoom(Number.parseFloat(input.value));
  imageEditorZoom.value = nextZoom;
  const nextOffset = clampImageEditorOffset(imageEditorOffsetX.value, imageEditorOffsetY.value, nextZoom);
  imageEditorOffsetX.value = nextOffset.x;
  imageEditorOffsetY.value = nextOffset.y;
}

function onImageEditorPointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;

  event.preventDefault();
  imageEditorPointerId.value = event.pointerId;
  imageEditorDragState.value = {
    startClientX: event.clientX,
    startClientY: event.clientY,
    startOffsetX: imageEditorOffsetX.value,
    startOffsetY: imageEditorOffsetY.value,
  };

  window.addEventListener('pointermove', onImageEditorPointerMove);
  window.addEventListener('pointerup', onImageEditorPointerUp);
  window.addEventListener('pointercancel', onImageEditorPointerUp);
}

function onImageEditorPointerMove(event: PointerEvent) {
  const dragState = imageEditorDragState.value;
  if (!dragState) return;
  if (imageEditorPointerId.value !== null && event.pointerId !== imageEditorPointerId.value) return;

  const nextOffset = clampImageEditorOffset(
    dragState.startOffsetX + (event.clientX - dragState.startClientX),
    dragState.startOffsetY + (event.clientY - dragState.startClientY),
  );
  imageEditorOffsetX.value = nextOffset.x;
  imageEditorOffsetY.value = nextOffset.y;
}

function onImageEditorPointerUp(event?: PointerEvent) {
  if (event && imageEditorPointerId.value !== null && event.pointerId !== imageEditorPointerId.value) {
    return;
  }

  imageEditorDragState.value = null;
  imageEditorPointerId.value = null;
  window.removeEventListener('pointermove', onImageEditorPointerMove);
  window.removeEventListener('pointerup', onImageEditorPointerUp);
  window.removeEventListener('pointercancel', onImageEditorPointerUp);
}

function applyImageEditorCrop() {
  if (!imageEditorSrc.value) return;

  const image = new Image();
  image.onload = () => {
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = IMAGE_EDITOR_OUTPUT_SIZE;
    outputCanvas.height = IMAGE_EDITOR_OUTPUT_SIZE;
    const context = outputCanvas.getContext('2d');
    if (!context) {
      closeImageEditor();
      return;
    }

    const layout = getImageEditorLayout(imageEditorZoom.value);
    const ratio = IMAGE_EDITOR_OUTPUT_SIZE / IMAGE_EDITOR_PREVIEW_SIZE;
    const drawX =
      (IMAGE_EDITOR_PREVIEW_SIZE / 2 - layout.drawWidth / 2 + imageEditorOffsetX.value) * ratio;
    const drawY =
      (IMAGE_EDITOR_PREVIEW_SIZE / 2 - layout.drawHeight / 2 + imageEditorOffsetY.value) * ratio;
    const drawWidth = layout.drawWidth * ratio;
    const drawHeight = layout.drawHeight * ratio;

    context.clearRect(0, 0, IMAGE_EDITOR_OUTPUT_SIZE, IMAGE_EDITOR_OUTPUT_SIZE);
    context.beginPath();
    context.arc(
      IMAGE_EDITOR_OUTPUT_SIZE / 2,
      IMAGE_EDITOR_OUTPUT_SIZE / 2,
      IMAGE_EDITOR_OUTPUT_SIZE / 2,
      0,
      Math.PI * 2,
    );
    context.closePath();
    context.clip();
    context.drawImage(image, drawX, drawY, drawWidth, drawHeight);

    emit('image-change', { image: outputCanvas.toDataURL('image/png') });
    closeImageEditor();
  };
  image.src = imageEditorSrc.value;
}

function onTypeHover(type: EntityType | null) {
  if (isTypeSelectionLocked.value) return;
  emit('hover-type', { type });
}

function onTypeClick(type: EntityType) {
  if (isTypeSelectionLocked.value) return;
  closeEmojiPicker();
  closeLogoPicker();
  isSearchDropdownOpen.value = false;
  emit('type-change', { type });
}

function onResetClick() {
  if (props.locked) return;
  closeEmojiPicker();
  closeLogoPicker();
  isSearchDropdownOpen.value = false;
  emit('reset-node');
}

function onDeleteClick() {
  if (props.locked) return;
  closeEmojiPicker();
  closeLogoPicker();
  isSearchDropdownOpen.value = false;
  emit('delete-node');
}

function openColorPicker() {
  if (props.locked) return;
  colorInputRef.value?.click();
}

function onColorInput(event: Event) {
  const input = event.target as HTMLInputElement | null;
  if (!input || props.locked) return;
  emit('color-change', { color: input.value });
}

function onImageButtonClick() {
  if (props.locked) return;
  closeEmojiPicker();
  closeLogoPicker();
  if (props.hasImage) {
    emit('image-change', { image: '' });
    return;
  }
  imageInputRef.value?.click();
}

function onImageInputChange(event: Event) {
  if (props.locked) return;

  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const result = typeof reader.result === 'string' ? reader.result : '';
    if (result) {
      openImageEditor(result);
    }
  };
  reader.readAsDataURL(file);

  if (input) {
    input.value = '';
  }
}

function onEmojiButtonClick() {
  if (props.locked) return;
  closeLogoPicker();
  isEmojiPickerOpen.value = !isEmojiPickerOpen.value;
}

function onEmojiSelect(item: EmojiItem) {
  if (props.locked) return;
  emit('emoji-change', { emoji: item.emoji, name: item.label });
  closeEmojiPicker();
}

function onEmojiClear() {
  if (props.locked) return;
  emit('emoji-change', { emoji: '' });
  closeEmojiPicker();
}

function onLogoButtonClick() {
  if (props.locked) return;
  closeEmojiPicker();
  isLogoPickerOpen.value = !isLogoPickerOpen.value;
  logoUploadError.value = '';
}

function onLogoSelect(item: LogoLibraryItem) {
  if (props.locked) return;
  emit('logo-change', { logo: item });
  closeLogoPicker();
}

function onLogoClear() {
  if (props.locked) return;
  emit('logo-change', { logo: null });
  closeLogoPicker();
}

function openLogoFilePicker() {
  if (props.locked) return;
  logoInputRef.value?.click();
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('File read error'));
    reader.readAsDataURL(file);
  });
}

function pickAutoLogoBackground(dataUrl: string) {
  return new Promise<string>((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      const size = 36;
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        resolve('#ffffff');
        return;
      }

      context.clearRect(0, 0, size, size);
      context.drawImage(image, 0, 0, size, size);
      const { data } = context.getImageData(0, 0, size, size);
      let luminanceSum = 0;
      let pixels = 0;

      for (let index = 0; index < data.length; index += 4) {
        const alpha = data[index + 3] || 0;
        if (alpha < 12) continue;

        const r = (data[index] || 0) / 255;
        const g = (data[index + 1] || 0) / 255;
        const b = (data[index + 2] || 0) / 255;
        luminanceSum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
        pixels += 1;
      }

      if (!pixels) {
        resolve('#111827');
        return;
      }

      const avg = luminanceSum / pixels;
      resolve(avg > 0.67 ? '#111827' : '#ffffff');
    };

    image.onerror = () => resolve('#ffffff');
    image.src = dataUrl;
  });
}

async function onLogoInputChange(event: Event) {
  if (props.locked) return;

  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0];
  if (!file) return;

  const trimmedName = customLogoName.value.trim();
  if (!trimmedName) {
    logoUploadError.value = 'Укажите название логотипа перед загрузкой';
    if (input) input.value = '';
    return;
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    if (!dataUrl) {
      logoUploadError.value = 'Не удалось прочитать файл логотипа';
      return;
    }

    customLogos.value = addCustomLogo({
      name: trimmedName,
      image: dataUrl,
      background: await pickAutoLogoBackground(dataUrl),
      keywords: createLogoKeywords(trimmedName),
    });
    customLogoName.value = '';
    logoUploadError.value = '';
  } catch {
    logoUploadError.value = 'Ошибка загрузки логотипа';
  } finally {
    if (input) {
      input.value = '';
    }
  }
}

function onToggleLock() {
  closeEmojiPicker();
  closeLogoPicker();
  isSearchDropdownOpen.value = false;
  emit('toggle-lock');
}

function onCenterTriggerClick() {
  if (!props.categoryLocked) return;
  emit('open-entity-info');
}

function onSearchInput() {
  if (props.locked) return;
  isSearchDropdownOpen.value = nodeSearchQuery.value.trim().length > 0;
}

function onSearchFocus() {
  if (props.locked) return;
  isSearchDropdownOpen.value = nodeSearchQuery.value.trim().length > 0;
}

function onSearchBlur() {
  window.setTimeout(() => {
    isSearchDropdownOpen.value = false;
  }, 160);
}

function onSearchSelect(item: MenuSearchItem) {
  if (props.locked) return;

  isSearchDropdownOpen.value = false;
  nodeSearchQuery.value = '';
  emit('select-entity', { entityId: item.id });
}

function toScalePercentByClientX(clientX: number) {
  const track = zoomTrackRef.value;
  if (!track) {
    return resolvedScalePercent.value;
  }

  const rect = track.getBoundingClientRect();
  if (!rect.width) {
    return resolvedScalePercent.value;
  }

  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return clampScalePercent(MIN_SCALE_PERCENT + ratio * (MAX_SCALE_PERCENT - MIN_SCALE_PERCENT));
}

function emitScalePercent(nextPercent: number) {
  if (props.locked) return;
  emit('scale-change', { scalePercent: clampScalePercent(nextPercent) });
}

function startZoomDragging() {
  isZoomDragging.value = true;
  window.addEventListener('pointermove', onZoomTrackPointerMove);
  window.addEventListener('pointerup', onZoomTrackPointerUp);
  window.addEventListener('pointercancel', onZoomTrackPointerUp);
}

function onZoomTrackPointerDown(event: PointerEvent) {
  if (props.locked) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;

  event.preventDefault();
  event.stopPropagation();

  emitScalePercent(toScalePercentByClientX(event.clientX));
  startZoomDragging();
}

function onZoomThumbPointerDown(event: PointerEvent) {
  if (props.locked) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;

  event.preventDefault();
  event.stopPropagation();

  emitScalePercent(toScalePercentByClientX(event.clientX));
  startZoomDragging();
}

function onZoomTrackPointerMove(event: PointerEvent) {
  if (!isZoomDragging.value || props.locked) return;
  emitScalePercent(toScalePercentByClientX(event.clientX));
}

function onZoomTrackPointerUp() {
  isZoomDragging.value = false;
  window.removeEventListener('pointermove', onZoomTrackPointerMove);
  window.removeEventListener('pointerup', onZoomTrackPointerUp);
  window.removeEventListener('pointercancel', onZoomTrackPointerUp);
}

function onZoomTrackDoubleClick() {
  if (props.locked) return;
  emitScalePercent(DEFAULT_SCALE_PERCENT);
}

onBeforeUnmount(() => {
  onZoomTrackPointerUp();
  onImageEditorPointerUp();
});

onMounted(() => {
  customLogos.value = readCustomLogos();
});
</script>

<template>
  <div
    class="menu"
    :style="menuStyle"
    @pointerdown.stop
    @mousedown.stop
    @wheel.stop
    @mouseleave="onTypeHover(null)"
  >
    <div class="menu-inner">
      <button
        v-for="item in MENU_ITEMS"
        :key="item.type"
        type="button"
        class="menu-item"
        :class="[
          item.className,
          {
            active: currentType === item.type,
            locked: Boolean(locked),
            'category-locked': Boolean(categoryLocked),
          },
        ]"
        :disabled="Boolean(locked) || Boolean(categoryLocked)"
        @mouseenter="onTypeHover(item.type)"
        @mouseleave="onTypeHover(null)"
        @click="onTypeClick(item.type)"
      >
        <AppIcon :name="item.type" />
        <span>{{ item.label }}</span>
      </button>

      <button
        type="button"
        class="menu-center-trigger"
        :class="{ active: Boolean(categoryLocked) }"
        :title="categoryLocked ? 'Открыть данные сущности' : ''"
        :disabled="!categoryLocked"
        @click="onCenterTriggerClick"
      />

      <button
        type="button"
        class="menu-circle-btn action-reset"
        :disabled="Boolean(locked)"
        title="Сбросить узел"
        @click="onResetClick"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 4v4h4" />
        </svg>
      </button>

      <button
        type="button"
        class="menu-circle-btn action-delete"
        :disabled="Boolean(locked)"
        title="Удалить узел"
        @click="onDeleteClick"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M19 6l-1 14H6L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        </svg>
      </button>

      <div class="menu-footer">
        <button
          type="button"
          class="menu-circle-btn action-color"
          :disabled="Boolean(locked)"
          title="Цвет ноды"
          @click="openColorPicker"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3a9 9 0 0 0 0 18h1a3 3 0 0 0 0-6h-1a3 3 0 0 1 0-6h1a3 3 0 0 0 0-6h-1Z" />
            <circle cx="7" cy="10" r="1.5" />
            <circle cx="9.5" cy="6.5" r="1.5" />
            <circle cx="15.5" cy="6.5" r="1.5" />
          </svg>
          <span class="color-dot" :style="{ background: resolvedColor }" />
        </button>

        <input
          ref="colorInputRef"
          type="color"
          class="hidden-input"
          :value="resolvedColor"
          @input="onColorInput"
        />

        <div class="emoji-wrap">
          <button
            type="button"
            class="menu-circle-btn action-emoji"
            :class="{ active: Boolean(hasEmoji) || isEmojiPickerOpen }"
            :disabled="Boolean(locked)"
            title="Эмодзи"
            @click="onEmojiButtonClick"
          >
            <span class="emoji-trigger">😀</span>
          </button>

          <div v-if="isEmojiPickerOpen && !locked" class="emoji-panel" @pointerdown.stop @wheel.stop>
            <input
              v-model.trim="emojiQuery"
              type="search"
              class="emoji-search"
              placeholder="Поиск по русским словам..."
            />

            <div v-if="filteredEmoji.length" class="emoji-grid">
              <button
                v-for="item in filteredEmoji"
                :key="item.emoji"
                type="button"
                class="emoji-btn"
                @click="onEmojiSelect(item)"
              >
                {{ item.emoji }}
              </button>
            </div>
            <div v-else class="emoji-empty">Эмодзи не найдены</div>

            <button
              v-if="hasEmoji"
              type="button"
              class="emoji-clear"
              @click="onEmojiClear"
            >
              Сбросить эмодзи
            </button>
          </div>
        </div>

        <div class="logo-wrap">
          <button
            type="button"
            class="menu-circle-btn action-logo"
            :class="{ active: Boolean(hasLogo) || isLogoPickerOpen }"
            :disabled="Boolean(locked)"
            title="Логотипы"
            @click="onLogoButtonClick"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="5" />
              <path d="M8 15l3-6 2 4 2-3 1 5" />
            </svg>
          </button>

          <div v-if="isLogoPickerOpen && !locked" class="logo-panel" @pointerdown.stop @wheel.stop>
            <input
              v-model.trim="logoQuery"
              type="search"
              class="logo-search"
              placeholder="Поиск логотипов (RU / EN)"
            />

            <div class="logo-results">
              <section v-if="filteredSystemLogos.length" class="logo-group">
                <header class="logo-group-title">Системные</header>
                <button
                  v-for="item in filteredSystemLogos"
                  :key="item.id"
                  type="button"
                  class="logo-item"
                  @click="onLogoSelect(item)"
                >
                  <span class="logo-item-preview" :style="{ background: item.background }">
                    <img :src="item.image" :alt="item.name" />
                  </span>
                  <span class="logo-item-name">{{ item.name }}</span>
                </button>
              </section>

              <section v-if="filteredCustomLogos.length" class="logo-group">
                <header class="logo-group-title">Мои логотипы</header>
                <button
                  v-for="item in filteredCustomLogos"
                  :key="item.id"
                  type="button"
                  class="logo-item"
                  @click="onLogoSelect(item)"
                >
                  <span class="logo-item-preview" :style="{ background: item.background }">
                    <img :src="item.image" :alt="item.name" />
                  </span>
                  <span class="logo-item-name">{{ item.name }}</span>
                </button>
              </section>

              <div
                v-if="!filteredSystemLogos.length && !filteredCustomLogos.length"
                class="logo-empty"
              >
                Логотипы не найдены
              </div>
            </div>

            <div class="logo-upload">
              <input
                v-model.trim="customLogoName"
                type="text"
                maxlength="48"
                class="logo-upload-name"
                placeholder="Название логотипа"
              />
              <div class="logo-upload-actions">
                <button type="button" class="logo-upload-btn" @click="openLogoFilePicker">
                  Загрузить SVG/PNG
                </button>
                <button
                  v-if="hasLogo"
                  type="button"
                  class="logo-upload-btn danger"
                  @click="onLogoClear"
                >
                  Сбросить
                </button>
              </div>
              <div v-if="logoUploadError" class="logo-upload-error">{{ logoUploadError }}</div>
            </div>
          </div>
        </div>

        <button
          type="button"
          class="menu-circle-btn action-image"
          :class="{ active: Boolean(hasImage) }"
          :disabled="Boolean(locked)"
          :title="hasImage ? 'Убрать изображение' : 'Добавить изображение'"
          @click="onImageButtonClick"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <circle cx="9" cy="10" r="1.5" />
            <path d="M3 16l5-4 4 3 3-2 6 5" />
          </svg>
        </button>

        <input
          ref="imageInputRef"
          type="file"
          accept="image/*"
          class="hidden-input"
          @change="onImageInputChange"
        />

        <input
          ref="logoInputRef"
          type="file"
          accept="image/*,.svg"
          class="hidden-input"
          @change="onLogoInputChange"
        />

        <button
          type="button"
          class="menu-circle-btn"
          :class="{ active: Boolean(locked) }"
          title="Заблокировать ноду"
          @click="onToggleLock"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="10" width="14" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 1 1 8 0v3" />
          </svg>
        </button>
      </div>

      <div class="menu__zoom-slider">
        <div
          ref="zoomTrackRef"
          class="range"
          :class="{ locked: Boolean(locked) }"
          @pointerdown="onZoomTrackPointerDown"
          @dblclick="onZoomTrackDoubleClick"
        >
          <div class="range-track" />
          <div
            class="range-thumb"
            :style="{ left: zoomThumbLeft }"
            @pointerdown="onZoomThumbPointerDown"
          >
            <svg viewBox="0 0 12 10" aria-hidden="true">
              <path d="M6.43301 0.75L10.7631 8.25C10.9556 8.58333 10.715 9 10.3301 9H1.66987C1.28497 9 1.04441 8.58333 1.23686 8.25L5.56699 0.75C5.75944 0.416667 6.24056 0.416667 6.43301 0.75Z" />
            </svg>
          </div>
        </div>
      </div>

      <div class="menu__entities-search" @wheel.stop>
        <input
          v-model="nodeSearchQuery"
          type="search"
          class="entities-search-input"
          :disabled="Boolean(locked)"
          placeholder="Поиск по категории..."
          @input="onSearchInput"
          @focus="onSearchFocus"
          @blur="onSearchBlur"
        />

        <div
          v-if="isSearchDropdownOpen && filteredSearchItems.length"
          class="entities-dropdown"
        >
          <button
            v-for="item in filteredSearchItems"
            :key="item.id"
            type="button"
            class="entities-result"
            @mousedown.prevent="onSearchSelect(item)"
          >
            <span class="entities-result-node-wrap">
              <ProfileProgressRing class="entities-result-progress" :value="item.progress" :size="36" :stroke-width="3" />
              <span
                class="entities-result-node"
                :style="{ background: item.color, borderColor: item.color }"
              >
                <img v-if="item.image && !item.hasLogo" class="entities-result-image" :src="item.image" alt="" />
                <img v-else-if="item.hasLogo" class="entities-result-logo" :src="item.image" alt="" />
                <span v-else-if="item.emoji" class="entities-result-emoji">{{ item.emoji }}</span>
                <AppIcon v-else :name="item.type" class="entities-result-icon" />
              </span>
            </span>
            <span class="entities-result-name">{{ item.name }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>

  <div
    v-if="isImageEditorOpen"
    class="image-editor-overlay"
    @pointerdown.stop
    @touchstart.stop.prevent
    @touchend.stop.prevent
    @click.stop.prevent
    @click.self.prevent="closeImageEditor"
  >
    <div class="image-editor-dialog" @pointerdown.stop @touchstart.stop @touchend.stop @click.stop>
      <div class="image-editor-title">Обрезка фото</div>

      <div class="image-editor-preview-wrap">
        <div
          class="image-editor-preview"
          @pointerdown="onImageEditorPointerDown"
        >
          <img
            v-if="imageEditorSrc"
            :src="imageEditorSrc"
            alt=""
            class="image-editor-image"
            :style="imageEditorPreviewStyle"
            draggable="false"
          />
        </div>
      </div>

      <div class="image-editor-zoom">
        <span>Масштаб</span>
        <input
          type="range"
          min="1"
          max="3"
          step="0.01"
          :value="imageEditorZoom"
          @input="onImageEditorZoomInput"
        />
      </div>

      <div class="image-editor-actions">
        <button type="button" class="image-editor-btn muted" @click="closeImageEditor">
          Отмена
        </button>
        <button type="button" class="image-editor-btn primary" @click="applyImageEditorCrop">
          Применить
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.menu {
  position: fixed;
  width: 320px;
  height: 200px;
  transform: translate(-50%, -50%) scale(var(--menu-scale));
  transform-origin: center center;
  z-index: 140;
}

.menu-inner {
  position: relative;
  width: 100%;
  height: 100%;
}

.menu-item {
  position: absolute;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  min-width: 116px;
  height: 30px;
  border: 1px solid #dbe4f3;
  border-radius: 999px;
  background: #ffffff;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
  padding: 0 11px;
  box-shadow: 0 5px 14px rgba(112, 144, 176, 0.16);
  transition:
    color 0.16s ease,
    background-color 0.16s ease,
    border-color 0.16s ease;
  cursor: pointer;
}

.menu-item :deep(svg) {
  width: 18px;
  height: 18px;
}

.menu-item:hover,
.menu-item.active {
  background: #1058ff;
  border-color: #1058ff;
  color: #ffffff;
}

.menu-item.locked {
  opacity: 0.8;
  cursor: default;
}

.menu-item.category-locked:not(.active) {
  opacity: 0.5;
  cursor: not-allowed;
}

.menu-item.category-locked.active {
  cursor: default;
}

.menu-item-1 {
  top: 0;
  left: 50%;
  min-width: 106px;
}

.menu-item-2 {
  top: 17%;
  left: 81%;
}

.menu-item-3 {
  top: 35%;
  left: 89%;
}

.menu-item-4 {
  top: 106px;
  left: 81%;
}

.menu-item-5 {
  top: 69%;
  left: 50%;
}

.menu-item-6 {
  top: 106px;
  left: 19%;
}

.menu-item-7 {
  top: 35%;
  left: 11%;
}

.menu-item-8 {
  top: 17%;
  left: 19%;
}

.menu-center-trigger {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 80px;
  height: 80px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 1px solid transparent;
  background: transparent;
  pointer-events: none;
}

.menu-center-trigger.active {
  pointer-events: auto;
  cursor: pointer;
}

.menu-center-trigger.active:hover {
  border-color: transparent;
  background: transparent;
}

.menu-circle-btn {
  position: absolute;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 31px;
  height: 31px;
  border-radius: 50%;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  color: #6b7280;
  box-shadow: 0 6px 14px rgba(112, 144, 176, 0.18);
  cursor: pointer;
  transition:
    color 0.16s ease,
    background-color 0.16s ease,
    border-color 0.16s ease;
}

.menu-circle-btn:hover:not(:disabled) {
  color: #1058ff;
  border-color: #bfd5ff;
}

.menu-circle-btn.active {
  background: #1058ff;
  border-color: #1058ff;
  color: #ffffff;
}

.menu-circle-btn:disabled {
  cursor: default;
  opacity: 0.75;
}

.menu-circle-btn svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.action-reset {
  bottom: 9%;
  left: 14%;
}

.action-delete {
  bottom: 9%;
  right: 7.8%;
  color: #ef4444;
}

.action-delete:hover:not(:disabled) {
  color: #ef4444;
  border-color: #fecaca;
}

.menu-footer {
  position: absolute;
  left: 50%;
  bottom: -12px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 9px;
}

.menu-footer .menu-circle-btn {
  position: relative;
}

.color-dot {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.85);
  right: 6px;
  bottom: 6px;
}

.hidden-input {
  position: absolute;
  visibility: hidden;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

.emoji-wrap {
  position: relative;
}

.logo-wrap {
  position: relative;
}

.emoji-trigger {
  font-size: 17px;
  line-height: 1;
}

.emoji-panel {
  position: absolute;
  left: 50%;
  bottom: 38px;
  transform: translateX(-50%);
  width: 260px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: #ffffff;
  box-shadow: 0 16px 30px rgba(112, 144, 176, 0.25);
  padding: 8px;
  z-index: 5;
}

.emoji-search {
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-main);
  background: #f8fafc;
  outline: none;
  padding: 6px 9px;
  margin-bottom: 8px;
}

.emoji-search:focus {
  border-color: #bfdbfe;
  background: #ffffff;
}

.emoji-grid {
  max-height: 150px;
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 4px;
}

.emoji-btn {
  width: 100%;
  aspect-ratio: 1 / 1;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.emoji-btn:hover {
  background: #eff6ff;
}

.emoji-empty {
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
  padding: 12px 0;
}

.emoji-clear {
  width: 100%;
  margin-top: 8px;
  border: 1px solid #fecaca;
  border-radius: 8px;
  background: #fff5f5;
  color: #dc2626;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 8px;
  cursor: pointer;
}

.logo-panel {
  position: absolute;
  left: 50%;
  top: 38px;
  transform: translateX(-50%);
  width: 286px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: #ffffff;
  box-shadow: 0 16px 30px rgba(112, 144, 176, 0.25);
  padding: 8px;
  z-index: 6;
}

.logo-search {
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-main);
  background: #f8fafc;
  outline: none;
  padding: 6px 9px;
  margin-bottom: 8px;
}

.logo-search:focus {
  border-color: #bfdbfe;
  background: #ffffff;
}

.logo-results {
  max-height: 180px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;
}

.logo-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.logo-group-title {
  font-size: 11px;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.logo-item {
  width: 100%;
  border: 1px solid #e2e8f0;
  border-radius: 9px;
  background: #ffffff;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 7px;
  cursor: pointer;
  text-align: left;
}

.logo-item:hover {
  border-color: #c7dbff;
  background: #eff6ff;
}

.logo-item-preview {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid #dbe4f3;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px;
  flex-shrink: 0;
  overflow: hidden;
}

.logo-item-preview img {
  width: 66%;
  height: 66%;
  object-fit: contain;
}

.logo-item-name {
  font-size: 12px;
  font-weight: 600;
  color: #334155;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.logo-empty {
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
  padding: 10px 0;
}

.logo-upload {
  margin-top: 8px;
  border-top: 1px solid #e2e8f0;
  padding-top: 8px;
}

.logo-upload-name {
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-main);
  background: #ffffff;
  outline: none;
  padding: 6px 9px;
}

.logo-upload-name:focus {
  border-color: #bfdbfe;
}

.logo-upload-actions {
  margin-top: 7px;
  display: flex;
  gap: 6px;
}

.logo-upload-btn {
  height: 30px;
  border-radius: 8px;
  border: 1px solid #dbe4f3;
  background: #f8fafc;
  color: #334155;
  font-size: 12px;
  font-weight: 600;
  padding: 0 9px;
  cursor: pointer;
}

.logo-upload-btn:hover {
  border-color: #c7dbff;
  background: #eff6ff;
}

.logo-upload-btn.danger {
  border-color: #fecaca;
  background: #fff5f5;
  color: #dc2626;
}

.logo-upload-btn.danger:hover {
  border-color: #fda4af;
  background: #ffe4e6;
}

.logo-upload-error {
  margin-top: 6px;
  color: #dc2626;
  font-size: 11px;
  font-weight: 600;
}

.menu__zoom-slider {
  position: absolute;
  bottom: -50px;
  left: 50%;
  width: 140px;
  transform: translateX(-50%);
}

.menu__entities-search {
  position: absolute;
  left: 50%;
  bottom: -94px;
  width: 260px;
  transform: translateX(-50%);
}

.entities-search-input {
  width: 100%;
  height: 34px;
  border: 1px solid var(--border-color);
  border-radius: 18px;
  background: #ffffff;
  color: var(--text-main);
  font-size: 12px;
  font-weight: 600;
  padding: 0 12px;
  outline: none;
  box-shadow: var(--shadow-base);
}

.entities-search-input:focus {
  border-color: #bfdbfe;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.14), var(--shadow-base);
}

.entities-search-input:disabled {
  opacity: 0.75;
  cursor: default;
}

.entities-dropdown {
  position: absolute;
  top: calc(100% + 7px);
  left: 0;
  z-index: 12;
  width: 100%;
  max-height: 210px;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: #ffffff;
  box-shadow: var(--shadow-hover);
  padding: 5px;
}

.entities-result {
  width: 100%;
  border: none;
  border-radius: 10px;
  background: transparent;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  cursor: pointer;
  text-align: left;
}

.entities-result:hover {
  background: #eff6ff;
}

.entities-result-node-wrap {
  width: 36px;
  height: 36px;
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.entities-result-progress {
  position: absolute;
  inset: 0;
}

.entities-result-node {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid #1058ff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  overflow: hidden;
  position: relative;
  z-index: 1;
}

.entities-result-icon {
  width: 58%;
  height: 58%;
}

.entities-result-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.entities-result-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.entities-result-logo {
  width: 58%;
  height: 58%;
  object-fit: contain;
}

.entities-result-emoji {
  font-size: 17px;
  line-height: 1;
}

.entities-result-name {
  min-width: 0;
  color: var(--text-main);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.range {
  position: relative;
  width: 100%;
  height: 24px;
  cursor: pointer;
  touch-action: none;
}

.range-track {
  position: absolute;
  left: 0;
  top: 0;
  height: 3px;
  width: 100%;
  border-radius: 3px;
  background: #1058ff;
  box-shadow: 8px 9px 9px rgba(16, 88, 255, 0.15);
}

.range-thumb {
  position: absolute;
  top: 10px;
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transform: translateX(-50%);
  color: #1058ff;
  cursor: ew-resize;
  pointer-events: auto;
}

.range-thumb svg {
  width: 12px;
  height: 10px;
  fill: currentColor;
  stroke: currentColor;
}

.range.locked {
  opacity: 0.5;
  cursor: default;
}

.image-editor-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.52);
  z-index: 260;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.image-editor-dialog {
  width: min(360px, 92vw);
  border-radius: 16px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  box-shadow: 0 28px 48px rgba(15, 23, 42, 0.34);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.image-editor-title {
  font-size: 14px;
  font-weight: 700;
  color: #334155;
}

.image-editor-preview-wrap {
  display: flex;
  justify-content: center;
}

.image-editor-preview {
  width: 220px;
  height: 220px;
  border-radius: 50%;
  border: 2px solid #dbe4f3;
  background: #f1f5f9;
  overflow: hidden;
  position: relative;
  cursor: grab;
  touch-action: none;
}

.image-editor-preview:active {
  cursor: grabbing;
}

.image-editor-image {
  position: absolute;
  left: 0;
  top: 0;
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: none;
}

.image-editor-zoom {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #475569;
  font-size: 12px;
  font-weight: 700;
}

.image-editor-zoom input[type='range'] {
  width: 100%;
}

.image-editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.image-editor-btn {
  border-radius: 10px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
  padding: 8px 12px;
  cursor: pointer;
}

.image-editor-btn.primary {
  border-color: #1058ff;
  background: #1058ff;
  color: #ffffff;
}

.image-editor-btn.muted:hover {
  border-color: #cbd5e1;
  background: #f8fafc;
}

.image-editor-btn.primary:hover {
  filter: brightness(1.05);
}

</style>
