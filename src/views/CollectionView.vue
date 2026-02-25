<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useEntitiesStore } from '../stores/entities';
import AppIcon from '../components/ui/AppIcon.vue';
import FilterDropdown from '../components/ui/FilterDropdown.vue';
import ProfileProgressRing from '../components/ui/ProfileProgressRing.vue';
import EntityInfoModal from '../components/entity/EntityInfoModal.vue';
import type { Entity, EntityType, ProjectCanvasData } from '../types/entity';
import { calculateEntityProfileProgress } from '../utils/profileProgress';

const props = defineProps<{
  type?: string;
}>();

const entitiesStore = useEntitiesStore();
const router = useRouter();
const CANVAS_CACHE_PREFIX = 'synapse12.canvas.v1';

type MetadataFieldKey =
  | 'tags'
  | 'markers'
  | 'skills'
  | 'importance'
  | 'links'
  | 'roles'
  | 'interests'
  | 'industry'
  | 'departments'
  | 'stage'
  | 'risks'
  | 'date'
  | 'location'
  | 'participants'
  | 'outcomes'
  | 'resources'
  | 'priority'
  | 'status'
  | 'owners'
  | 'metrics';

interface MetadataFieldConfig {
  key: MetadataFieldKey;
  label: string;
}

const ENTITY_FILTER_FIELDS: Record<EntityType, MetadataFieldConfig[]> = {
  person: [
    { key: 'tags', label: 'Теги' },
    { key: 'markers', label: 'Метки' },
    { key: 'skills', label: 'Навыки' },
    { key: 'importance', label: 'Значимость' },
    { key: 'links', label: 'Ссылки' },
    { key: 'roles', label: 'Роли' },
  ],
  company: [
    { key: 'tags', label: 'Теги' },
    { key: 'industry', label: 'Отрасли' },
    { key: 'departments', label: 'Отделы' },
    { key: 'stage', label: 'Стадии' },
    { key: 'risks', label: 'Риски' },
    { key: 'links', label: 'Ссылки' },
  ],
  event: [
    { key: 'tags', label: 'Теги' },
    { key: 'date', label: 'Даты' },
    { key: 'location', label: 'Локации' },
    { key: 'participants', label: 'Участники' },
    { key: 'outcomes', label: 'Итоги' },
    { key: 'links', label: 'Ссылки' },
  ],
  resource: [
    { key: 'tags', label: 'Теги' },
    { key: 'resources', label: 'Форматы' },
    { key: 'status', label: 'Статусы' },
    { key: 'importance', label: 'Значимость' },
    { key: 'owners', label: 'Владельцы' },
    { key: 'links', label: 'Ссылки' },
  ],
  goal: [
    { key: 'tags', label: 'Теги' },
    { key: 'priority', label: 'Приоритеты' },
    { key: 'metrics', label: 'Метрики' },
    { key: 'owners', label: 'Ответственные' },
    { key: 'status', label: 'Статусы' },
    { key: 'links', label: 'Ссылки' },
  ],
  result: [
    { key: 'tags', label: 'Теги' },
    { key: 'outcomes', label: 'Результаты' },
    { key: 'metrics', label: 'Метрики' },
    { key: 'importance', label: 'Значимость' },
    { key: 'owners', label: 'Ответственные' },
    { key: 'links', label: 'Ссылки' },
  ],
  task: [
    { key: 'tags', label: 'Теги' },
    { key: 'priority', label: 'Приоритеты' },
    { key: 'status', label: 'Статусы' },
    { key: 'owners', label: 'Ответственные' },
    { key: 'date', label: 'Даты' },
    { key: 'links', label: 'Ссылки' },
  ],
  project: [
    { key: 'tags', label: 'Теги' },
    { key: 'stage', label: 'Стадии' },
    { key: 'priority', label: 'Приоритеты' },
    { key: 'risks', label: 'Риски' },
    { key: 'owners', label: 'Ответственные' },
    { key: 'links', label: 'Ссылки' },
  ],
  shape: [
    { key: 'tags', label: 'Теги' },
    { key: 'markers', label: 'Метки' },
    { key: 'importance', label: 'Значимость' },
    { key: 'status', label: 'Статусы' },
    { key: 'links', label: 'Ссылки' },
  ],
};

const searchQuery = ref('');
const collectionViewRef = ref<HTMLElement | null>(null);
const selectedFieldFilters = ref<Record<string, string>>({});
const entityInfoEntityId = ref<string | null>(null);
const activeProjectRenameId = ref<string | null>(null);
const projectRenameDraft = ref('');
const projectInputRefs = new Map<string, HTMLInputElement>();
const projectDeleteTarget = ref<Entity | null>(null);
const isProjectDeleteBusy = ref(false);

interface ProjectPreviewPoint {
  id: string;
  x: number;
  y: number;
  r: number;
  color: string;
  image: string;
  logo: boolean;
  emoji: string;
  glyph: string;
  stroke: string;
}

interface ProjectPreviewEdge {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface ProjectPreview {
  nodes: ProjectPreviewPoint[];
  edges: ProjectPreviewEdge[];
}

interface ProjectCanvasCacheSnapshot {
  savedAt: number;
  canvas_data: ProjectCanvasData;
}

interface ProjectPreviewViewport {
  x: number;
  y: number;
  zoom: number;
  width: number;
  height: number;
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

const activeType = computed<EntityType>(() => normalizeType(props.type));

const typedEntities = computed(() => entitiesStore.byType(activeType.value));
const MIN_NODE_SCALE = 0.8;
const MAX_NODE_SCALE = 1.2;
const PREVIEW_WIDTH = 180;
const PREVIEW_HEIGHT = 112;
const PREVIEW_NODE_BASE_RADIUS = 36;

function normalizeNodeScaleForPreview(raw: unknown) {
  const parsed =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? Number.parseFloat(raw)
        : Number.NaN;

  if (!Number.isFinite(parsed)) return 1;
  return Math.min(MAX_NODE_SCALE, Math.max(MIN_NODE_SCALE, parsed));
}

function previewTypeGlyph(type: EntityType) {
  const glyphs: Record<EntityType, string> = {
    project: 'П',
    person: 'Ч',
    company: 'К',
    event: 'С',
    resource: 'Р',
    goal: 'Ц',
    result: 'И',
    task: 'З',
    shape: 'Э',
  };

  return glyphs[type] || 'Э';
}

function projectPreviewClipId(projectId: string, nodeId: string) {
  const normalizedProjectId = projectId.replace(/[^a-zA-Z0-9_-]/g, '-');
  const normalizedNodeId = nodeId.replace(/[^a-zA-Z0-9_-]/g, '-');
  return `project-preview-clip-${normalizedProjectId}-${normalizedNodeId}`;
}

function getCanvasCacheKey(projectId: string) {
  return `${CANVAS_CACHE_PREFIX}:${projectId}`;
}

function readProjectCanvasCache(projectId: string): ProjectCanvasCacheSnapshot | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(getCanvasCacheKey(projectId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<ProjectCanvasCacheSnapshot>;
    if (!parsed || typeof parsed.savedAt !== 'number') return null;
    if (!parsed.canvas_data || typeof parsed.canvas_data !== 'object') return null;

    const canvasData = parsed.canvas_data as ProjectCanvasData;
    const nodes = Array.isArray(canvasData.nodes) ? canvasData.nodes : [];
    const edges = Array.isArray(canvasData.edges) ? canvasData.edges : [];

    return {
      savedAt: parsed.savedAt,
      canvas_data: {
        ...canvasData,
        nodes,
        edges,
      },
    };
  } catch {
    return null;
  }
}

function resolveProjectCanvasData(entity: Entity): ProjectCanvasData | undefined {
  const serverCanvasData = entity.canvas_data;
  const cached = readProjectCanvasCache(entity._id);

  if (!cached) return serverCanvasData;

  const serverUpdatedAt = entity.updatedAt ? Date.parse(entity.updatedAt) : 0;
  if (cached.savedAt >= serverUpdatedAt) {
    return cached.canvas_data;
  }

  return serverCanvasData;
}

function normalizeProjectViewport(value: unknown): ProjectPreviewViewport | null {
  if (!value || typeof value !== 'object') return null;

  const raw = value as Partial<ProjectPreviewViewport>;
  const x = typeof raw.x === 'number' && Number.isFinite(raw.x) ? raw.x : null;
  const y = typeof raw.y === 'number' && Number.isFinite(raw.y) ? raw.y : null;
  const zoom = typeof raw.zoom === 'number' && Number.isFinite(raw.zoom) ? raw.zoom : null;
  const width = typeof raw.width === 'number' && Number.isFinite(raw.width) ? raw.width : null;
  const height = typeof raw.height === 'number' && Number.isFinite(raw.height) ? raw.height : null;

  if (x === null || y === null || zoom === null || width === null || height === null) {
    return null;
  }

  if (zoom <= 0 || width <= 0 || height <= 0) return null;
  return { x, y, zoom, width, height };
}

function normalizeProjectPreview(entity: Entity): ProjectPreview | null {
  const rawCanvas = resolveProjectCanvasData(entity);
  if (!rawCanvas || typeof rawCanvas !== 'object') return null;

  const rawNodes = Array.isArray(rawCanvas.nodes) ? rawCanvas.nodes : [];
  const rawEdges = Array.isArray(rawCanvas.edges) ? rawCanvas.edges : [];
  const nodes = rawNodes
    .filter((node) => {
      return (
        !!node &&
        typeof node.id === 'string' &&
        typeof node.entityId === 'string' &&
        Number.isFinite(node.x) &&
        Number.isFinite(node.y)
      );
    })
    .map((node) => ({
      id: node.id,
      entityId: node.entityId,
      x: node.x,
      y: node.y,
      scale: normalizeNodeScaleForPreview(node.scale),
    }));

  if (!nodes.length) return null;

  const viewport = normalizeProjectViewport(rawCanvas.viewport);
  const previewNodes = viewport
    ? (() => {
        const viewportScale = Math.min(
          PREVIEW_WIDTH / viewport.width,
          PREVIEW_HEIGHT / viewport.height,
        );
        const offsetX = (PREVIEW_WIDTH - viewport.width * viewportScale) / 2;
        const offsetY = (PREVIEW_HEIGHT - viewport.height * viewportScale) / 2;

        return nodes.map((node) => {
          const screenX = viewport.x + node.x * viewport.zoom;
          const screenY = viewport.y + node.y * viewport.zoom;
          const entityForNode = entitiesStore.byId(node.entityId);
          const profile = toProfile(entityForNode);
          const color = typeof profile.color === 'string' && profile.color.trim() ? profile.color : '#1058ff';
          const image = typeof profile.image === 'string' ? profile.image : '';
          const emoji = typeof profile.emoji === 'string' ? profile.emoji : '';
          const logo = logoImageFromProfile(profile).trim().length > 0;
          const glyph = previewTypeGlyph(entityForNode?.type || 'shape');
          const projectedRadius = PREVIEW_NODE_BASE_RADIUS * node.scale * viewport.zoom * viewportScale;

          return {
            id: node.id,
            x: offsetX + screenX * viewportScale,
            y: offsetY + screenY * viewportScale,
            r: Math.max(3, Math.min(28, projectedRadius)),
            color,
            image,
            logo,
            emoji,
            glyph,
            stroke: 'rgba(255, 255, 255, 0.95)',
          };
        });
      })()
    : (() => {
        const minX = Math.min(...nodes.map((node) => node.x));
        const maxX = Math.max(...nodes.map((node) => node.x));
        const minY = Math.min(...nodes.map((node) => node.y));
        const maxY = Math.max(...nodes.map((node) => node.y));
        const spanX = Math.max(1, maxX - minX);
        const spanY = Math.max(1, maxY - minY);
        const padding = 10;
        const innerWidth = PREVIEW_WIDTH - padding * 2;
        const innerHeight = PREVIEW_HEIGHT - padding * 2;

        return nodes.map((node) => {
          const entityForNode = entitiesStore.byId(node.entityId);
          const profile = toProfile(entityForNode);
          const color = typeof profile.color === 'string' && profile.color.trim() ? profile.color : '#1058ff';
          const image = typeof profile.image === 'string' ? profile.image : '';
          const emoji = typeof profile.emoji === 'string' ? profile.emoji : '';
          const logo = logoImageFromProfile(profile).trim().length > 0;
          const glyph = previewTypeGlyph(entityForNode?.type || 'shape');

          return {
            id: node.id,
            x: padding + ((node.x - minX) / spanX) * innerWidth,
            y: padding + ((node.y - minY) / spanY) * innerHeight,
            r: Math.max(3, Math.min(20, 6 * node.scale)),
            color,
            image,
            logo,
            emoji,
            glyph,
            stroke: 'rgba(255, 255, 255, 0.95)',
          };
        });
      })();
  const nodeById = new Map(previewNodes.map((node) => [node.id, node]));

  const previewEdges = rawEdges
    .filter((edge) => {
      return (
        !!edge &&
        typeof edge.id === 'string' &&
        typeof edge.source === 'string' &&
        typeof edge.target === 'string'
      );
    })
    .map((edge) => {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) return null;

      return {
        id: edge.id,
        x1: source.x,
        y1: source.y,
        x2: target.x,
        y2: target.y,
      };
    })
    .filter((edge): edge is ProjectPreviewEdge => Boolean(edge));

  return {
    nodes: previewNodes,
    edges: previewEdges,
  };
}

const projectPreviewById = computed<Record<string, ProjectPreview | null>>(() => {
  const map: Record<string, ProjectPreview | null> = {};
  for (const entity of typedEntities.value) {
    if (entity.type !== 'project') continue;
    map[entity._id] = normalizeProjectPreview(entity);
  }
  return map;
});

function projectPreview(entity: Entity) {
  return projectPreviewById.value[entity._id] || null;
}

function toMetadata(entity: Entity) {
  const raw = entity.ai_metadata;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {} as Record<string, unknown>;
  }
  return raw as Record<string, unknown>;
}

function toStringArray(value: unknown) {
  if (typeof value === 'string') {
    return value.trim() ? [value.trim()] : [];
  }
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function metadataList(entity: Entity, key: MetadataFieldKey) {
  return toStringArray(toMetadata(entity)[key]);
}

const activeFilterFields = computed<MetadataFieldConfig[]>(() => {
  return ENTITY_FILTER_FIELDS[activeType.value] || [];
});

function getAllOptionLabel(label: string) {
  return `Все ${label.toLowerCase()}`;
}

const filterOptionsByKey = computed<Record<string, string[]>>(() => {
  const map: Record<string, string[]> = {};

  for (const field of activeFilterFields.value) {
    const values = new Set<string>();
    for (const entity of typedEntities.value) {
      for (const value of metadataList(entity, field.key)) {
        values.add(value);
      }
    }

    map[field.key] = [
      getAllOptionLabel(field.label),
      ...Array.from(values).sort((a, b) => a.localeCompare(b, 'ru')),
    ];
  }

  return map;
});

function getFilterOptions(fieldKey: string) {
  return filterOptionsByKey.value[fieldKey] || [];
}

function getSelectedFilterValue(fieldKey: string) {
  const options = getFilterOptions(fieldKey);
  const selected = selectedFieldFilters.value[fieldKey];
  if (selected && options.includes(selected)) {
    return selected;
  }
  return options[0] || '';
}

function setSelectedFilterValue(fieldKey: string, value: string) {
  selectedFieldFilters.value = {
    ...selectedFieldFilters.value,
    [fieldKey]: value,
  };
}

const filteredEntities = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();

  return typedEntities.value.filter((entity) => {
    if (q && !entity.name.toLowerCase().includes(q)) {
      return false;
    }

    for (const field of activeFilterFields.value) {
      const options = getFilterOptions(field.key);
      const allOption = options[0] || '';
      const selected = getSelectedFilterValue(field.key);

      if (selected !== allOption && !metadataList(entity, field.key).includes(selected)) {
        return false;
      }
    }

    return true;
  });
});

const firstEntity = computed<Entity | null>(() => {
  const entities = filteredEntities.value;
  if (!entities.length) {
    return null;
  }

  const preferredId = entitiesStore.lastCreatedIdByType[activeType.value];
  if (!preferredId) {
    return entities[0]!;
  }

  return entities.find((entity) => entity._id === preferredId) || entities[0]!;
});

const remainingEntities = computed(() => {
  const first = firstEntity.value;

  if (!first) {
    return [] as Entity[];
  }

  return filteredEntities.value.filter((entity) => entity._id !== first._id);
});

onMounted(async () => {
  if (!entitiesStore.initialized) {
    await entitiesStore.bootstrap();
  }
});

watch(
  activeFilterFields,
  (fields) => {
    const next: Record<string, string> = {};
    for (const field of fields) {
      next[field.key] = getSelectedFilterValue(field.key);
    }
    selectedFieldFilters.value = next;
  },
  { immediate: true },
);

watch(filterOptionsByKey, (nextOptions) => {
  const nextSelection: Record<string, string> = { ...selectedFieldFilters.value };

  for (const [fieldKey, options] of Object.entries(nextOptions)) {
    const currentValue = nextSelection[fieldKey];
    if (!currentValue || !options.includes(currentValue)) {
      nextSelection[fieldKey] = options[0] || '';
    }
  }

  selectedFieldFilters.value = nextSelection;
});

watch(activeType, () => {
  activeProjectRenameId.value = null;
  projectRenameDraft.value = '';
  projectDeleteTarget.value = null;
});

async function createEntity() {
  const nextEntityNumber = entitiesStore.countByType(activeType.value) + 1;
  const payload: {
    type: EntityType;
    name: string;
    profile: Record<string, unknown>;
    ai_metadata: Record<string, unknown>;
    canvas_data?: { nodes: []; edges: [] };
  } = {
    type: activeType.value,
    name:
      activeType.value === 'project'
        ? `Новый проект ${nextEntityNumber}`
        : `Новый узел ${nextEntityNumber}`,
    profile: {},
    ai_metadata: {},
  };

  if (activeType.value === 'project') {
    payload.canvas_data = { nodes: [], edges: [] };
  }

  await entitiesStore.createEntity(payload);

  // Keep the just-created card visible near "Создать".
  searchQuery.value = '';
  await nextTick();
  collectionViewRef.value?.scrollTo({ top: 0, behavior: 'auto' });
}

function setProjectInputRef(projectId: string | null | undefined, element: HTMLInputElement | null) {
  if (!projectId) return;

  if (element) {
    projectInputRefs.set(projectId, element);
    return;
  }

  projectInputRefs.delete(projectId);
}

function openProjectRename(project: Entity) {
  activeProjectRenameId.value = project._id;
  projectRenameDraft.value = project.name || '';

  void nextTick(() => {
    const input = projectInputRefs.get(project._id);
    if (!input) return;
    input.focus();
    input.select();
  });
}

function projectNameValue(project: Entity) {
  if (activeProjectRenameId.value === project._id) {
    return projectRenameDraft.value;
  }
  return project.name || '';
}

function onProjectNameInput(event: Event, project: Entity) {
  if (activeProjectRenameId.value !== project._id) {
    openProjectRename(project);
  }

  const input = event.target as HTMLInputElement | null;
  if (!input) return;
  projectRenameDraft.value = input.value.slice(0, 64);
}

function onProjectNameClick(event: MouseEvent, project: Entity) {
  event.stopPropagation();
  if (activeProjectRenameId.value !== project._id) {
    openProjectRename(project);
    return;
  }

  const input = event.target as HTMLInputElement | null;
  if (!input) return;
  requestAnimationFrame(() => {
    input.select();
  });
}

function onProjectNameFocus(event: FocusEvent, project: Entity) {
  const input = event.target as HTMLInputElement | null;
  if (activeProjectRenameId.value !== project._id) {
    openProjectRename(project);
    return;
  }

  if (input) {
    input.select();
  }
}

function commitProjectRename(project: Entity) {
  if (activeProjectRenameId.value !== project._id) return;

  const nextName = projectRenameDraft.value.trim();
  const currentName = (project.name || '').trim();
  activeProjectRenameId.value = null;

  if (!nextName || nextName === currentName) {
    projectRenameDraft.value = '';
    return;
  }

  entitiesStore.queueEntityUpdate(
    project._id,
    {
      name: nextName,
    },
    { delay: 0 },
  );
  projectRenameDraft.value = '';
}

function onProjectNameKeydown(event: KeyboardEvent, project: Entity) {
  if (event.key === 'Enter') {
    event.preventDefault();
    (event.target as HTMLInputElement | null)?.blur();
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    projectRenameDraft.value = project.name || '';
    activeProjectRenameId.value = null;
    (event.target as HTMLInputElement | null)?.blur();
  }
}

function openProjectDeleteConfirm(project: Entity, event: MouseEvent) {
  event.stopPropagation();
  projectDeleteTarget.value = project;
}

function closeProjectDeleteConfirm() {
  if (isProjectDeleteBusy.value) return;
  projectDeleteTarget.value = null;
}

async function confirmProjectDelete() {
  const target = projectDeleteTarget.value;
  if (!target || isProjectDeleteBusy.value) return;

  isProjectDeleteBusy.value = true;
  try {
    await entitiesStore.deleteEntity(target._id);
  } catch (error) {
    entitiesStore.error = entitiesStore.formatApiError(error);
  } finally {
    projectDeleteTarget.value = null;
    isProjectDeleteBusy.value = false;
  }
}

function openProjectCanvas(projectId: string) {
  router.push({ name: 'project-canvas', params: { id: projectId } });
}

function onCardClick(entity: Entity) {
  entityInfoEntityId.value = entity._id;
}

function toProfile(entity: Entity | null | undefined) {
  const raw = entity?.profile;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {} as Record<string, unknown>;
  }
  return raw as Record<string, unknown>;
}

function logoImageFromProfile(profile: Record<string, unknown>) {
  const raw = profile.logo;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '';

  const logo = raw as Record<string, unknown>;
  return typeof logo.image === 'string' ? logo.image : '';
}

function entityColor(entity: Entity) {
  const raw = toProfile(entity).color;
  if (typeof raw === 'string' && raw.trim()) {
    return raw;
  }
  return '#1058ff';
}

function entityImage(entity: Entity) {
  const raw = toProfile(entity).image;
  return typeof raw === 'string' ? raw : '';
}

function entityHasLogo(entity: Entity) {
  return logoImageFromProfile(toProfile(entity)).trim().length > 0;
}

function entityEmoji(entity: Entity) {
  const raw = toProfile(entity).emoji;
  return typeof raw === 'string' ? raw : '';
}

function entityProgress(entity: Entity) {
  return calculateEntityProfileProgress(entity);
}

function closeEntityInfoModal() {
  entityInfoEntityId.value = null;
}
</script>

<template>
  <main class="workspace">
    <div class="tools-header">
      <div class="search-bar">
        <AppIcon name="search" />
        <input v-model="searchQuery" type="search" placeholder="Поиск..." />
      </div>

      <div class="filters-group">
        <FilterDropdown
          v-for="field in activeFilterFields"
          :key="field.key"
          :model-value="getSelectedFilterValue(field.key)"
          :options="getFilterOptions(field.key)"
          @update:model-value="(value) => setSelectedFilterValue(field.key, value)"
        />
      </div>
    </div>

    <section ref="collectionViewRef" class="collection-view">
      <div v-if="entitiesStore.loading && !entitiesStore.items.length" class="state">Загрузка...</div>
      <div v-else-if="entitiesStore.error && !entitiesStore.items.length" class="state state-error">
        {{ entitiesStore.error }}
      </div>
      <div v-else class="grid-layout">
        <button class="create-card" @click="createEntity">
          <AppIcon name="plus" />
          <span class="create-card-label">Создать</span>
        </button>

        <template v-if="firstEntity">
          <article
            v-if="activeType === 'project'"
            class="project-card"
          >
            <span class="project-progress">
              <ProfileProgressRing :value="entityProgress(firstEntity)" :size="28" :stroke-width="2.5">
                <span class="project-progress-dot" />
              </ProfileProgressRing>
            </span>
            <button
              type="button"
              class="project-thumbnail project-thumbnail-btn"
              @click="openProjectCanvas(firstEntity._id)"
            >
              <svg
                v-if="projectPreview(firstEntity)"
                class="project-preview-svg"
                viewBox="0 0 180 112"
                preserveAspectRatio="xMidYMid meet"
                aria-hidden="true"
              >
                <defs>
                  <clipPath
                    v-for="node in projectPreview(firstEntity)?.nodes || []"
                    :id="projectPreviewClipId(firstEntity._id, node.id)"
                    :key="`clip-${node.id}`"
                  >
                    <circle :cx="node.x" :cy="node.y" :r="node.r" />
                  </clipPath>
                </defs>
                <line
                  v-for="edge in projectPreview(firstEntity)?.edges || []"
                  :key="edge.id"
                  :x1="edge.x1"
                  :y1="edge.y1"
                  :x2="edge.x2"
                  :y2="edge.y2"
                  class="project-preview-edge"
                />
                <circle
                  v-for="node in projectPreview(firstEntity)?.nodes || []"
                  :key="`node-bg-${node.id}`"
                  :cx="node.x"
                  :cy="node.y"
                  :r="node.r"
                  :fill="node.color"
                  :stroke="node.stroke"
                  stroke-width="1"
                />
                <image
                  v-for="node in projectPreview(firstEntity)?.nodes || []"
                  v-show="node.image && !node.logo"
                  :key="`node-image-${node.id}`"
                  :href="node.image"
                  :x="node.x - node.r"
                  :y="node.y - node.r"
                  :width="node.r * 2"
                  :height="node.r * 2"
                  preserveAspectRatio="xMidYMid slice"
                  :clip-path="`url(#${projectPreviewClipId(firstEntity._id, node.id)})`"
                />
                <image
                  v-for="node in projectPreview(firstEntity)?.nodes || []"
                  v-show="node.image && node.logo"
                  :key="`node-logo-${node.id}`"
                  :href="node.image"
                  :x="node.x - node.r * 0.6"
                  :y="node.y - node.r * 0.6"
                  :width="node.r * 1.2"
                  :height="node.r * 1.2"
                  preserveAspectRatio="xMidYMid meet"
                />
                <text
                  v-for="node in projectPreview(firstEntity)?.nodes || []"
                  v-show="!node.image && node.emoji"
                  :key="`node-emoji-${node.id}`"
                  :x="node.x"
                  :y="node.y + node.r * 0.12"
                  text-anchor="middle"
                  dominant-baseline="middle"
                  :font-size="Math.max(8, node.r * 0.92)"
                  class="project-preview-emoji"
                >
                  {{ node.emoji }}
                </text>
                <text
                  v-for="node in projectPreview(firstEntity)?.nodes || []"
                  v-show="!node.image && !node.emoji"
                  :key="`node-glyph-${node.id}`"
                  :x="node.x"
                  :y="node.y + node.r * 0.06"
                  text-anchor="middle"
                  dominant-baseline="middle"
                  :font-size="Math.max(6, node.r * 0.8)"
                  class="project-preview-glyph"
                >
                  {{ node.glyph }}
                </text>
              </svg>
            </button>
            <div class="project-info">
              <input
                :ref="(el) => setProjectInputRef(firstEntity?._id, el as HTMLInputElement | null)"
                class="project-name-input"
                type="text"
                :value="projectNameValue(firstEntity)"
                maxlength="64"
                @pointerdown.stop
                @click="onProjectNameClick($event, firstEntity)"
                @focus="onProjectNameFocus($event, firstEntity)"
                @input="onProjectNameInput($event, firstEntity)"
                @keydown="onProjectNameKeydown($event, firstEntity)"
                @blur="commitProjectRename(firstEntity)"
              />
              <button
                type="button"
                class="project-delete-btn"
                title="Удалить"
                @click="openProjectDeleteConfirm(firstEntity, $event)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                </svg>
              </button>
            </div>
          </article>

          <button
            v-else
            class="entity-card"
            @click="onCardClick(firstEntity)"
          >
            <div class="card-cycle-wrap">
              <ProfileProgressRing class="card-progress-ring" :value="entityProgress(firstEntity)" :size="84" :stroke-width="4" />
              <div class="card-cycle" :style="{ background: entityColor(firstEntity), borderColor: entityColor(firstEntity) }">
                <img v-if="entityImage(firstEntity) && !entityHasLogo(firstEntity)" class="card-image" :src="entityImage(firstEntity)" alt="" />
                <img v-else-if="entityHasLogo(firstEntity)" class="card-logo" :src="entityImage(firstEntity)" alt="" />
                <span v-else-if="entityEmoji(firstEntity)" class="card-emoji">{{ entityEmoji(firstEntity) }}</span>
                <AppIcon v-else :name="firstEntity.type" class="card-icon" />
              </div>
            </div>
            <div class="card-name">{{ firstEntity.name }}</div>
          </button>
        </template>

        <template v-for="entity in remainingEntities" :key="entity._id">
          <article
            v-if="activeType === 'project'"
            class="project-card"
          >
            <span class="project-progress">
              <ProfileProgressRing :value="entityProgress(entity)" :size="28" :stroke-width="2.5">
                <span class="project-progress-dot" />
              </ProfileProgressRing>
            </span>
            <button
              type="button"
              class="project-thumbnail project-thumbnail-btn"
              @click="openProjectCanvas(entity._id)"
            >
              <svg
                v-if="projectPreview(entity)"
                class="project-preview-svg"
                viewBox="0 0 180 112"
                preserveAspectRatio="xMidYMid meet"
                aria-hidden="true"
              >
                <defs>
                  <clipPath
                    v-for="node in projectPreview(entity)?.nodes || []"
                    :id="projectPreviewClipId(entity._id, node.id)"
                    :key="`clip-${node.id}`"
                  >
                    <circle :cx="node.x" :cy="node.y" :r="node.r" />
                  </clipPath>
                </defs>
                <line
                  v-for="edge in projectPreview(entity)?.edges || []"
                  :key="edge.id"
                  :x1="edge.x1"
                  :y1="edge.y1"
                  :x2="edge.x2"
                  :y2="edge.y2"
                  class="project-preview-edge"
                />
                <circle
                  v-for="node in projectPreview(entity)?.nodes || []"
                  :key="`node-bg-${node.id}`"
                  :cx="node.x"
                  :cy="node.y"
                  :r="node.r"
                  :fill="node.color"
                  :stroke="node.stroke"
                  stroke-width="1"
                />
                <image
                  v-for="node in projectPreview(entity)?.nodes || []"
                  v-show="node.image && !node.logo"
                  :key="`node-image-${node.id}`"
                  :href="node.image"
                  :x="node.x - node.r"
                  :y="node.y - node.r"
                  :width="node.r * 2"
                  :height="node.r * 2"
                  preserveAspectRatio="xMidYMid slice"
                  :clip-path="`url(#${projectPreviewClipId(entity._id, node.id)})`"
                />
                <image
                  v-for="node in projectPreview(entity)?.nodes || []"
                  v-show="node.image && node.logo"
                  :key="`node-logo-${node.id}`"
                  :href="node.image"
                  :x="node.x - node.r * 0.6"
                  :y="node.y - node.r * 0.6"
                  :width="node.r * 1.2"
                  :height="node.r * 1.2"
                  preserveAspectRatio="xMidYMid meet"
                />
                <text
                  v-for="node in projectPreview(entity)?.nodes || []"
                  v-show="!node.image && node.emoji"
                  :key="`node-emoji-${node.id}`"
                  :x="node.x"
                  :y="node.y + node.r * 0.12"
                  text-anchor="middle"
                  dominant-baseline="middle"
                  :font-size="Math.max(8, node.r * 0.92)"
                  class="project-preview-emoji"
                >
                  {{ node.emoji }}
                </text>
                <text
                  v-for="node in projectPreview(entity)?.nodes || []"
                  v-show="!node.image && !node.emoji"
                  :key="`node-glyph-${node.id}`"
                  :x="node.x"
                  :y="node.y + node.r * 0.06"
                  text-anchor="middle"
                  dominant-baseline="middle"
                  :font-size="Math.max(6, node.r * 0.8)"
                  class="project-preview-glyph"
                >
                  {{ node.glyph }}
                </text>
              </svg>
            </button>
            <div class="project-info">
              <input
                :ref="(el) => setProjectInputRef(entity._id, el as HTMLInputElement | null)"
                class="project-name-input"
                type="text"
                :value="projectNameValue(entity)"
                maxlength="64"
                @pointerdown.stop
                @click="onProjectNameClick($event, entity)"
                @focus="onProjectNameFocus($event, entity)"
                @input="onProjectNameInput($event, entity)"
                @keydown="onProjectNameKeydown($event, entity)"
                @blur="commitProjectRename(entity)"
              />
              <button
                type="button"
                class="project-delete-btn"
                title="Удалить"
                @click="openProjectDeleteConfirm(entity, $event)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                </svg>
              </button>
            </div>
          </article>

          <button
            v-else
            class="entity-card"
            @click="onCardClick(entity)"
          >
            <div class="card-cycle-wrap">
              <ProfileProgressRing class="card-progress-ring" :value="entityProgress(entity)" :size="84" :stroke-width="4" />
              <div class="card-cycle" :style="{ background: entityColor(entity), borderColor: entityColor(entity) }">
                <img v-if="entityImage(entity) && !entityHasLogo(entity)" class="card-image" :src="entityImage(entity)" alt="" />
                <img v-else-if="entityHasLogo(entity)" class="card-logo" :src="entityImage(entity)" alt="" />
                <span v-else-if="entityEmoji(entity)" class="card-emoji">{{ entityEmoji(entity) }}</span>
                <AppIcon v-else :name="entity.type" class="card-icon" />
              </div>
            </div>
            <div class="card-name">{{ entity.name }}</div>
          </button>
        </template>
      </div>
      <p v-if="entitiesStore.error && entitiesStore.items.length" class="state state-error state-inline">
        {{ entitiesStore.error }}
      </p>
    </section>

    <EntityInfoModal
      v-if="entityInfoEntityId"
      :entity-id="entityInfoEntityId"
      @close="closeEntityInfoModal"
    />

    <div
      v-if="projectDeleteTarget"
      class="project-delete-overlay"
      @pointerdown.self="closeProjectDeleteConfirm"
    >
      <div class="project-delete-card" @pointerdown.stop>
        <h3 class="project-delete-title">Удалить проект?</h3>
        <p class="project-delete-text">
          "{{ projectDeleteTarget.name || 'Без названия' }}" будет удален из базы.
        </p>
        <p class="project-delete-text">
          Все ноды этого проекта также будут удалены из базы и из всех других проектов.
        </p>
        <p class="project-delete-warning">Действие необратимо.</p>
        <div class="project-delete-actions">
          <button
            type="button"
            class="project-delete-btn-secondary"
            :disabled="isProjectDeleteBusy"
            @click="closeProjectDeleteConfirm"
          >
            Отмена
          </button>
          <button
            type="button"
            class="project-delete-btn-danger"
            :disabled="isProjectDeleteBusy"
            @click="confirmProjectDelete"
          >
            Удалить
          </button>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.workspace {
  height: 100%;
  min-height: 0;
  flex: 1;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.tools-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 32px;
  background: var(--bg-header);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(226, 232, 240, 0.8);
  z-index: 90;
  flex-wrap: nowrap;
  overflow-x: auto;
  flex-shrink: 0;
}

.tools-header::-webkit-scrollbar {
  display: none;
}

.search-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-card);
  border: 1px solid transparent;
  padding: 6px 12px;
  border-radius: 20px;
  min-width: 220px;
  width: 220px;
  color: var(--text-muted);
  transition: 0.2s;
  box-shadow: var(--shadow-base);
  flex-shrink: 0;
}

.search-bar:focus-within {
  box-shadow: 0 0 0 2px var(--primary-soft), var(--shadow-base);
}

.search-bar input {
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  color: var(--text-main);
  width: 100%;
}

.search-bar input::placeholder {
  color: var(--text-muted);
}

.filters-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
}

.collection-view {
  min-height: 0;
  padding: 8px 32px 40px;
  overflow-y: auto;
  flex: 1;
}

.grid-layout {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 24px;
}

.create-card {
  background: var(--bg-card);
  border: 2px dashed #cbd5e1;
  border-radius: var(--radius-lg);
  min-height: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  cursor: pointer;
  transition: all 0.2s;
  gap: 12px;
}

.create-card:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: #fff;
}

.create-card-label {
  font-weight: 600;
}

.entity-card {
  background: #e6effc;
  border: 1px solid #d2e1fb;
  border-radius: var(--radius-lg);
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  min-height: 180px;
  position: relative;
  box-shadow: var(--shadow-base);
}

.entity-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-hover);
}

.card-cycle-wrap {
  width: 84px;
  height: 84px;
  margin-bottom: 14px;
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.card-progress-ring {
  position: absolute;
  inset: 0;
}

.card-cycle {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: #1058ff;
  border: 1px solid #1058ff;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  overflow: hidden;
  z-index: 1;
}

.card-icon {
  width: 60%;
  height: 60%;
}

.card-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.card-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.card-logo {
  width: 60%;
  height: 60%;
  object-fit: contain;
}

.card-emoji {
  font-size: 43px;
  line-height: 1;
}

.card-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-main);
  text-align: center;
}

.project-card {
  background: #e6effc;
  border: 1px solid #d2e1fb;
  border-radius: var(--radius-lg);
  overflow: hidden;
  cursor: default;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  height: 180px;
  box-shadow: var(--shadow-base);
  position: relative;
}

.project-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-hover);
}

.project-thumbnail {
  flex: 1 1 auto;
  min-height: 92px;
  background: #e6effc;
  background-image: radial-gradient(rgba(148, 163, 184, 0.45) 1px, transparent 1px);
  background-size: 16px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 12px;
  border-bottom: 1px solid var(--border-color);
}

.project-thumbnail-btn {
  width: 100%;
  border: none;
  margin: 0;
  padding: 0;
  cursor: pointer;
}

.project-preview-svg {
  display: block;
  width: 100%;
  height: 100%;
}

.project-preview-edge {
  stroke: rgba(51, 65, 85, 0.3);
  stroke-width: 1.4;
  stroke-linecap: round;
}

.project-preview-emoji {
  user-select: none;
  pointer-events: none;
}

.project-preview-glyph {
  fill: #ffffff;
  font-weight: 700;
  user-select: none;
  pointer-events: none;
}

.project-progress {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
}

.project-progress-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(16, 88, 255, 0.25);
}

.project-info {
  margin-top: auto;
  border-radius: 0;
  padding: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  border-top: 1px solid rgba(226, 232, 240, 0.95);
  background: #f6f9ff;
}

.project-name-input {
  flex: 1;
  min-width: 0;
  border: 1px solid hsl(218, 83%, 91%);
  border-radius: 8px;
  background: #ffffff;
  color: #1e293b;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 8px;
  outline: none;
}

.project-name-input:focus {
  border-color: #a9c5fb;
  box-shadow: 0 0 0 2px rgba(16, 88, 255, 0.14);
}

.project-delete-btn {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid #fecaca;
  background: #fff1f2;
  color: #dc2626;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease;
}

.project-delete-btn svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.project-delete-btn:hover {
  background: #ffe4e6;
  border-color: #fca5a5;
  color: #b91c1c;
}

.project-delete-overlay {
  position: fixed;
  inset: 0;
  z-index: 170;
  background: rgba(15, 23, 42, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.project-delete-card {
  width: min(420px, 100%);
  border-radius: 14px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  box-shadow: 0 18px 34px rgba(15, 23, 42, 0.3);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.project-delete-title {
  margin: 0;
  color: #0f172a;
  font-size: 16px;
  font-weight: 800;
}

.project-delete-text {
  margin: 0;
  color: #334155;
  font-size: 13px;
  line-height: 1.4;
}

.project-delete-warning {
  margin: 0;
  color: #b91c1c;
  font-size: 12px;
  font-weight: 700;
}

.project-delete-actions {
  margin-top: 4px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.project-delete-btn-secondary,
.project-delete-btn-danger {
  height: 32px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 700;
  padding: 0 12px;
  cursor: pointer;
}

.project-delete-btn-secondary {
  border: 1px solid #dbe4f3;
  background: #f8fafc;
  color: #334155;
}

.project-delete-btn-secondary:hover:not(:disabled) {
  border-color: #bfd5ff;
  background: #eef4ff;
  color: #1058ff;
}

.project-delete-btn-danger {
  border: 1px solid #fecaca;
  background: #fff1f2;
  color: #b91c1c;
}

.project-delete-btn-danger:hover:not(:disabled) {
  border-color: #fca5a5;
  background: #ffe4e6;
}

.project-delete-btn-secondary:disabled,
.project-delete-btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.state {
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-md);
  padding: 18px;
  background: #fff;
  color: var(--text-muted);
}

.state-error {
  color: #dc2626;
}

.state-inline {
  margin-top: 14px;
}

@media (max-width: 900px) {
  .tools-header {
    padding: 12px;
    gap: 10px;
  }

  .collection-view {
    padding: 8px 12px 24px;
  }
}
</style>
