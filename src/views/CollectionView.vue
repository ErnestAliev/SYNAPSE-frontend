<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useEntitiesStore } from '../stores/entities';
import { useAuthStore } from '../stores/auth';
import { apiClient } from '../services/api';
import AppIcon from '../components/ui/AppIcon.vue';
import FilterDropdown from '../components/ui/FilterDropdown.vue';
import ProfileProgressRing from '../components/ui/ProfileProgressRing.vue';
import EntityInfoModal from '../components/entity/EntityInfoModal.vue';
import type { Entity, EntityType } from '../types/entity';
import { calculateEntityProfileProgress } from '../utils/profileProgress';

const props = defineProps<{
  type?: string;
}>();

const entitiesStore = useEntitiesStore();
const authStore = useAuthStore();
const router = useRouter();

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
  connection: [
    { key: 'tags', label: 'Теги' },
    { key: 'markers', label: 'Метки' },
    { key: 'links', label: 'Ссылки' },
    { key: 'roles', label: 'Роли' },
    { key: 'status', label: 'Статусы' },
  ],
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
const projectDeleteTarget = ref<Entity | null>(null);
const isProjectDeleteBusy = ref(false);
const isCreateBusy = ref(false);
const isConnectionImportModalOpen = ref(false);
const isConnectionImportBusy = ref(false);
const connectionImportMessage = ref('');
const connectionImportError = ref('');
const connectionMoveBusyById = ref<Record<string, boolean>>({});

interface ProjectPreviewPoint {
  id: string;
  x: number;
  y: number;
  r: number;
  color: string;
  image: string;
  emoji: string;
  glyph: string;
  clipId: string;
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

const PROJECT_PREVIEW_WIDTH = 180;
const PROJECT_PREVIEW_HEIGHT = 112;
const PROJECT_NODE_BASE_RADIUS = 36;

function normalizeNodeScale(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(1.2, Math.max(0.8, value));
  }
  return 1;
}

function parseProfile(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {} as Record<string, unknown>;
  }
  return raw as Record<string, unknown>;
}

function parseLogoImage(profile: Record<string, unknown>) {
  const raw = profile.logo;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return '';
  }
  const logo = raw as Record<string, unknown>;
  return typeof logo.image === 'string' ? logo.image.trim() : '';
}

function getNodeGlyph(type: EntityType) {
  const glyphMap: Record<EntityType, string> = {
    project: 'П',
    connection: 'К',
    person: 'Л',
    company: 'К',
    event: 'С',
    resource: 'Р',
    goal: 'Ц',
    result: 'И',
    task: 'З',
    shape: 'Э',
  };
  return glyphMap[type] || '•';
}

function normalizeType(value: unknown): EntityType {
  const allowed: EntityType[] = [
    'project',
    'connection',
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

function normalizeProjectPreview(entity: Entity): ProjectPreview | null {
  const rawCanvas = entity.canvas_data;
  if (!rawCanvas || typeof rawCanvas !== 'object') return null;

  const rawNodes = Array.isArray(rawCanvas.nodes) ? rawCanvas.nodes : [];
  const rawEdges = Array.isArray(rawCanvas.edges) ? rawCanvas.edges : [];
  const rawViewport =
    rawCanvas.viewport && typeof rawCanvas.viewport === 'object' ? rawCanvas.viewport : null;

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
      scale: normalizeNodeScale(node.scale),
    }));

  if (!nodes.length) return null;

  const viewportIsValid =
    rawViewport &&
    Number.isFinite(rawViewport.x) &&
    Number.isFinite(rawViewport.y) &&
    Number.isFinite(rawViewport.zoom) &&
    rawViewport.zoom > 0 &&
    Number.isFinite(rawViewport.width) &&
    rawViewport.width > 0 &&
    Number.isFinite(rawViewport.height) &&
    rawViewport.height > 0;

  let worldMinX = 0;
  let worldMinY = 0;
  let sourceWidth = PROJECT_PREVIEW_WIDTH;
  let sourceHeight = PROJECT_PREVIEW_HEIGHT;
  let sourceZoom = 1;
  let sourceOffsetX = 0;
  let sourceOffsetY = 0;

  if (viewportIsValid && rawViewport) {
    sourceWidth = rawViewport.width;
    sourceHeight = rawViewport.height;
    sourceZoom = rawViewport.zoom;
    sourceOffsetX = rawViewport.x;
    sourceOffsetY = rawViewport.y;
  } else {
    worldMinX = Math.min(...nodes.map((node) => node.x - PROJECT_NODE_BASE_RADIUS * node.scale));
    const worldMaxX = Math.max(...nodes.map((node) => node.x + PROJECT_NODE_BASE_RADIUS * node.scale));
    worldMinY = Math.min(...nodes.map((node) => node.y - PROJECT_NODE_BASE_RADIUS * node.scale));
    const worldMaxY = Math.max(...nodes.map((node) => node.y + PROJECT_NODE_BASE_RADIUS * node.scale));

    sourceWidth = Math.max(1, worldMaxX - worldMinX);
    sourceHeight = Math.max(1, worldMaxY - worldMinY);
  }

  const previewScale = Math.min(
    PROJECT_PREVIEW_WIDTH / Math.max(1, sourceWidth),
    PROJECT_PREVIEW_HEIGHT / Math.max(1, sourceHeight),
  );
  const previewOffsetX = (PROJECT_PREVIEW_WIDTH - sourceWidth * previewScale) / 2;
  const previewOffsetY = (PROJECT_PREVIEW_HEIGHT - sourceHeight * previewScale) / 2;

  const previewNodes = nodes.map((node) => {
    const linkedEntity = entitiesStore.byId(node.entityId);
    const linkedProfile = parseProfile(linkedEntity?.profile);
    const nodeColor =
      typeof linkedProfile.color === 'string' && linkedProfile.color.trim()
        ? linkedProfile.color.trim()
        : '#1058ff';
    const nodeImageRaw =
      typeof linkedProfile.image === 'string' && linkedProfile.image.trim()
        ? linkedProfile.image.trim()
        : parseLogoImage(linkedProfile);
    const nodeEmoji =
      typeof linkedProfile.emoji === 'string' && linkedProfile.emoji.trim()
        ? linkedProfile.emoji.trim()
        : '';
    const nodeType = linkedEntity?.type || 'shape';

    const sourceX = viewportIsValid
      ? sourceOffsetX + node.x * sourceZoom
      : node.x - worldMinX;
    const sourceY = viewportIsValid
      ? sourceOffsetY + node.y * sourceZoom
      : node.y - worldMinY;
    const sourceRadius = PROJECT_NODE_BASE_RADIUS * node.scale * (viewportIsValid ? sourceZoom : 1);
    const previewRadius = Math.max(2, sourceRadius * previewScale);

    return {
      id: node.id,
      x: previewOffsetX + sourceX * previewScale,
      y: previewOffsetY + sourceY * previewScale,
      r: previewRadius,
      color: nodeColor,
      image: nodeImageRaw,
      emoji: nodeEmoji,
      glyph: getNodeGlyph(nodeType),
      clipId: `project-preview-${entity._id}-${node.id}`,
    };
  });
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

function projectPreviewNodes(entity: Entity) {
  const preview = projectPreview(entity);
  if (!preview || !Array.isArray(preview.nodes)) return [] as ProjectPreviewPoint[];
  return preview.nodes.filter((node): node is ProjectPreviewPoint => Boolean(node));
}

function projectPreviewEdges(entity: Entity) {
  const preview = projectPreview(entity);
  if (!preview || !Array.isArray(preview.edges)) return [] as ProjectPreviewEdge[];
  return preview.edges.filter((edge): edge is ProjectPreviewEdge => Boolean(edge));
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
  if (!authStore.isAuthenticated) {
    return;
  }

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
  isConnectionImportModalOpen.value = false;
  connectionImportMessage.value = '';
  connectionImportError.value = '';
});

async function createEntity() {
  if (activeType.value === 'connection') {
    connectionImportError.value = '';
    connectionImportMessage.value = '';
    isConnectionImportModalOpen.value = true;
    return;
  }

  if (isCreateBusy.value) return;
  isCreateBusy.value = true;

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

  try {
    await entitiesStore.createEntity(payload);

    // Keep the just-created card visible near "Создать".
    searchQuery.value = '';
    await nextTick();
    collectionViewRef.value?.scrollTo({ top: 0, behavior: 'auto' });
  } catch (error) {
    entitiesStore.error = entitiesStore.formatApiError(error);
  } finally {
    isCreateBusy.value = false;
  }
}

function closeConnectionImportModal() {
  if (isConnectionImportBusy.value) return;
  isConnectionImportModalOpen.value = false;
  connectionImportError.value = '';
  connectionImportMessage.value = '';
}

function openWhatsAppWeb() {
  if (typeof window === 'undefined') return;
  window.open('https://web.whatsapp.com', '_blank', 'noopener,noreferrer');
}

async function importWhatsAppContacts() {
  if (isConnectionImportBusy.value) return;

  isConnectionImportBusy.value = true;
  connectionImportError.value = '';
  connectionImportMessage.value = '';

  try {
    const { data } = await apiClient.post<{
      imported: number;
      skipped: number;
      total: number;
      mode?: string;
    }>('/integrations/whatsapp/import', {});

    await entitiesStore.fetchEntities({ silent: true });
    entitiesStore.triggerFlash('connection');

    const imported = Number(data.imported) || 0;
    const skipped = Number(data.skipped) || 0;
    connectionImportMessage.value =
      imported > 0
        ? `Импортировано: ${imported}. Пропущено дублей: ${skipped}.`
        : `Новых контактов не найдено. Пропущено дублей: ${skipped}.`;

    await nextTick();
    collectionViewRef.value?.scrollTo({ top: 0, behavior: 'auto' });
  } catch (error) {
    connectionImportError.value = entitiesStore.formatApiError(error);
  } finally {
    isConnectionImportBusy.value = false;
  }
}

function connectionPhone(entity: Entity) {
  const profile = toProfile(entity);
  const phone = profile.phone;
  if (typeof phone !== 'string') return '';
  return phone.trim();
}

function connectionSource(entity: Entity) {
  const profile = toProfile(entity);
  const source = profile.source;
  if (typeof source !== 'string') return '';
  return source.trim().toLowerCase();
}

function connectionMeta(entity: Entity) {
  const source = connectionSource(entity);
  const phone = connectionPhone(entity);
  const sourceLabel = source === 'whatsapp' ? 'WhatsApp' : source || 'Источник не указан';
  if (phone) {
    return `${sourceLabel} · ${phone}`;
  }
  return sourceLabel;
}

function setConnectionMoveBusy(entityId: string, busy: boolean) {
  connectionMoveBusyById.value = {
    ...connectionMoveBusyById.value,
    [entityId]: busy,
  };
}

function isConnectionMoveBusy(entityId: string) {
  return Boolean(connectionMoveBusyById.value[entityId]);
}

async function moveConnectionTo(entity: Entity, targetType: 'person' | 'company', event: MouseEvent) {
  event.stopPropagation();

  if (isConnectionMoveBusy(entity._id)) return;
  setConnectionMoveBusy(entity._id, true);

  try {
    await entitiesStore.updateEntity(entity._id, {
      type: targetType,
      canvas_data: undefined,
    });
    entitiesStore.triggerFlash(targetType);
  } catch (error) {
    entitiesStore.error = entitiesStore.formatApiError(error);
  } finally {
    setConnectionMoveBusy(entity._id, false);
  }
}

function getProjectInputElement(projectId: string) {
  if (typeof document === 'undefined') return null;
  const escapedId =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(projectId)
      : projectId.replace(/"/g, '\\"');
  return document.querySelector<HTMLInputElement>(`input[data-project-name-id="${escapedId}"]`);
}

function openProjectRename(project: Entity) {
  activeProjectRenameId.value = project._id;
  projectRenameDraft.value = project.name || '';

  void nextTick(() => {
    const input = getProjectInputElement(project._id);
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
    projectDeleteTarget.value = null;
  } finally {
    isProjectDeleteBusy.value = false;
  }
}

function onCardClick(entity: Entity) {
  if (entity.type === 'project') {
    router.push({ name: 'project-canvas', params: { id: entity._id } });
    return;
  }

  entityInfoEntityId.value = entity._id;
}

function toProfile(entity: Entity | null | undefined) {
  const raw = entity?.profile;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {} as Record<string, unknown>;
  }
  return raw as Record<string, unknown>;
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
      <div v-if="entitiesStore.loading" class="state">Загрузка...</div>
      <div v-else-if="entitiesStore.error" class="state state-error">{{ entitiesStore.error }}</div>
      <div v-else class="grid-layout">
        <button class="create-card" :disabled="isCreateBusy" @click="createEntity">
          <AppIcon name="plus" />
          <span class="create-card-label">{{ activeType === 'connection' ? 'Добавить' : 'Создать' }}</span>
        </button>

        <template v-if="firstEntity">
          <article
            v-if="activeType === 'project'"
            class="project-card"
            @click="onCardClick(firstEntity)"
          >
            <span class="project-progress">
              <ProfileProgressRing :value="entityProgress(firstEntity)" :size="28" :stroke-width="2.5">
                <span class="project-progress-dot" />
              </ProfileProgressRing>
            </span>
            <div class="project-thumbnail">
              <svg
                v-if="projectPreview(firstEntity)"
                class="project-preview-svg"
                viewBox="0 0 180 112"
                preserveAspectRatio="xMidYMid meet"
                aria-hidden="true"
              >
                <defs>
                  <clipPath
                    v-for="node in projectPreviewNodes(firstEntity)"
                    :id="node.clipId"
                    :key="`clip-${node.id}`"
                  >
                    <circle :cx="node.x" :cy="node.y" :r="node.r" />
                  </clipPath>
                </defs>
                <line
                  v-for="edge in projectPreviewEdges(firstEntity)"
                  :key="edge.id"
                  :x1="edge.x1"
                  :y1="edge.y1"
                  :x2="edge.x2"
                  :y2="edge.y2"
                  class="project-preview-edge"
                />
                <circle
                  v-for="node in projectPreviewNodes(firstEntity)"
                  :key="`bg-${node.id}`"
                  :cx="node.x"
                  :cy="node.y"
                  :r="node.r"
                  class="project-preview-node"
                  :style="{ fill: node.color }"
                />
                <template v-for="node in projectPreviewNodes(firstEntity)" :key="`content-${node.id}`">
                  <image
                    v-if="node && node.image"
                    :href="node.image"
                    :x="node.x - node.r"
                    :y="node.y - node.r"
                    :width="node.r * 2"
                    :height="node.r * 2"
                    preserveAspectRatio="xMidYMid slice"
                    :clip-path="`url(#${node.clipId})`"
                  />
                  <text
                    v-else-if="node && node.emoji"
                    :x="node.x"
                    :y="node.y"
                    class="project-preview-emoji"
                  >
                    {{ node.emoji }}
                  </text>
                  <text
                    v-else
                    :x="node.x"
                    :y="node.y"
                    class="project-preview-glyph"
                  >
                    {{ node.glyph }}
                  </text>
                </template>
              </svg>
            </div>
            <div class="project-info">
              <input
                class="project-name-input"
                type="text"
                :value="projectNameValue(firstEntity)"
                maxlength="64"
                :data-project-name-id="firstEntity._id"
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

          <article
            v-else-if="activeType === 'connection'"
            class="entity-card connection-card"
            @click="onCardClick(firstEntity)"
          >
            <div class="card-cycle-wrap">
              <ProfileProgressRing class="card-progress-ring" :value="entityProgress(firstEntity)" :size="84" :stroke-width="4" />
              <div class="card-cycle" :style="{ background: entityColor(firstEntity), borderColor: entityColor(firstEntity) }">
                <img v-if="entityImage(firstEntity)" class="card-image" :src="entityImage(firstEntity)" alt="" />
                <span v-else-if="entityEmoji(firstEntity)" class="card-emoji">{{ entityEmoji(firstEntity) }}</span>
                <AppIcon v-else :name="firstEntity.type" class="card-icon" />
              </div>
            </div>
            <div class="card-name">{{ firstEntity.name }}</div>
            <div v-if="activeType === 'connection'" class="connection-meta">
              {{ connectionMeta(firstEntity) }}
            </div>
            <div v-if="activeType === 'connection'" class="connection-actions">
              <button
                type="button"
                class="connection-action-btn"
                :disabled="isConnectionMoveBusy(firstEntity._id)"
                @click="moveConnectionTo(firstEntity, 'person', $event)"
              >
                В Персоны
              </button>
              <button
                type="button"
                class="connection-action-btn"
                :disabled="isConnectionMoveBusy(firstEntity._id)"
                @click="moveConnectionTo(firstEntity, 'company', $event)"
              >
                В Компании
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
                <img v-if="entityImage(firstEntity)" class="card-image" :src="entityImage(firstEntity)" alt="" />
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
            @click="onCardClick(entity)"
          >
            <span class="project-progress">
              <ProfileProgressRing :value="entityProgress(entity)" :size="28" :stroke-width="2.5">
                <span class="project-progress-dot" />
              </ProfileProgressRing>
            </span>
            <div class="project-thumbnail">
              <svg
                v-if="projectPreview(entity)"
                class="project-preview-svg"
                viewBox="0 0 180 112"
                preserveAspectRatio="xMidYMid meet"
                aria-hidden="true"
              >
                <defs>
                  <clipPath
                    v-for="node in projectPreviewNodes(entity)"
                    :id="node.clipId"
                    :key="`clip-${node.id}`"
                  >
                    <circle :cx="node.x" :cy="node.y" :r="node.r" />
                  </clipPath>
                </defs>
                <line
                  v-for="edge in projectPreviewEdges(entity)"
                  :key="edge.id"
                  :x1="edge.x1"
                  :y1="edge.y1"
                  :x2="edge.x2"
                  :y2="edge.y2"
                  class="project-preview-edge"
                />
                <circle
                  v-for="node in projectPreviewNodes(entity)"
                  :key="`bg-${node.id}`"
                  :cx="node.x"
                  :cy="node.y"
                  :r="node.r"
                  class="project-preview-node"
                  :style="{ fill: node.color }"
                />
                <template v-for="node in projectPreviewNodes(entity)" :key="`content-${node.id}`">
                  <image
                    v-if="node && node.image"
                    :href="node.image"
                    :x="node.x - node.r"
                    :y="node.y - node.r"
                    :width="node.r * 2"
                    :height="node.r * 2"
                    preserveAspectRatio="xMidYMid slice"
                    :clip-path="`url(#${node.clipId})`"
                  />
                  <text
                    v-else-if="node && node.emoji"
                    :x="node.x"
                    :y="node.y"
                    class="project-preview-emoji"
                  >
                    {{ node.emoji }}
                  </text>
                  <text
                    v-else
                    :x="node.x"
                    :y="node.y"
                    class="project-preview-glyph"
                  >
                    {{ node.glyph }}
                  </text>
                </template>
              </svg>
            </div>
            <div class="project-info">
              <input
                class="project-name-input"
                type="text"
                :value="projectNameValue(entity)"
                maxlength="64"
                :data-project-name-id="entity._id"
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

          <article
            v-else-if="activeType === 'connection'"
            class="entity-card connection-card"
            @click="onCardClick(entity)"
          >
            <div class="card-cycle-wrap">
              <ProfileProgressRing class="card-progress-ring" :value="entityProgress(entity)" :size="84" :stroke-width="4" />
              <div class="card-cycle" :style="{ background: entityColor(entity), borderColor: entityColor(entity) }">
                <img v-if="entityImage(entity)" class="card-image" :src="entityImage(entity)" alt="" />
                <span v-else-if="entityEmoji(entity)" class="card-emoji">{{ entityEmoji(entity) }}</span>
                <AppIcon v-else :name="entity.type" class="card-icon" />
              </div>
            </div>
            <div class="card-name">{{ entity.name }}</div>
            <div v-if="activeType === 'connection'" class="connection-meta">
              {{ connectionMeta(entity) }}
            </div>
            <div v-if="activeType === 'connection'" class="connection-actions">
              <button
                type="button"
                class="connection-action-btn"
                :disabled="isConnectionMoveBusy(entity._id)"
                @click="moveConnectionTo(entity, 'person', $event)"
              >
                В Персоны
              </button>
              <button
                type="button"
                class="connection-action-btn"
                :disabled="isConnectionMoveBusy(entity._id)"
                @click="moveConnectionTo(entity, 'company', $event)"
              >
                В Компании
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
                <img v-if="entityImage(entity)" class="card-image" :src="entityImage(entity)" alt="" />
                <span v-else-if="entityEmoji(entity)" class="card-emoji">{{ entityEmoji(entity) }}</span>
                <AppIcon v-else :name="entity.type" class="card-icon" />
              </div>
            </div>
            <div class="card-name">{{ entity.name }}</div>
          </button>
        </template>
      </div>
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

    <div
      v-if="isConnectionImportModalOpen"
      class="connection-import-overlay"
      @pointerdown.self="closeConnectionImportModal"
    >
      <div class="connection-import-card" @pointerdown.stop>
        <h3 class="connection-import-title">Подключение</h3>
        <p class="connection-import-text">
          Выберите мессенджер для импорта контактов.
        </p>

        <div class="connection-provider-item active">
          <div class="connection-provider-icon">W</div>
          <div class="connection-provider-content">
            <div class="connection-provider-name">WhatsApp</div>
            <div class="connection-provider-hint">Откройте Web, отсканируйте QR и запустите импорт.</div>
          </div>
        </div>

        <div class="connection-import-actions">
          <button type="button" class="connection-link-btn" @click="openWhatsAppWeb">
            Открыть WhatsApp Web
          </button>
          <button
            type="button"
            class="connection-import-btn"
            :disabled="isConnectionImportBusy"
            @click="importWhatsAppContacts"
          >
            {{ isConnectionImportBusy ? 'Импорт...' : 'Импортировать контакты' }}
          </button>
        </div>

        <p v-if="connectionImportMessage" class="connection-import-message">
          {{ connectionImportMessage }}
        </p>
        <p v-if="connectionImportError" class="connection-import-error">
          {{ connectionImportError }}
        </p>
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

.create-card:disabled {
  cursor: wait;
  opacity: 0.72;
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

.entity-card.connection-card {
  padding: 18px 16px 14px;
  justify-content: flex-start;
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

.card-emoji {
  font-size: 36px;
  line-height: 1;
}

.card-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-main);
  text-align: center;
}

.connection-meta {
  margin-top: 4px;
  font-size: 12px;
  color: #4b5f80;
  text-align: center;
}

.connection-actions {
  margin-top: 10px;
  width: 100%;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.connection-action-btn {
  height: 30px;
  border-radius: 9px;
  border: 1px solid #bfd5ff;
  background: #ffffff;
  color: #1058ff;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

.connection-action-btn:hover:not(:disabled) {
  background: #edf4ff;
  border-color: #95b8fb;
  color: #0b45cc;
}

.connection-action-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.project-card {
  background: #e6effc;
  border: 1px solid #d2e1fb;
  border-radius: var(--radius-lg);
  overflow: hidden;
  cursor: pointer;
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
  min-height: 0;
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

.project-preview-svg {
  width: 100%;
  height: 100%;
  display: block;
}

.project-preview-edge {
  stroke: rgba(51, 65, 85, 0.3);
  stroke-width: 1.6;
}

.project-preview-node {
  fill: rgba(16, 88, 255, 0.92);
  stroke: rgba(255, 255, 255, 0.92);
  stroke-width: 1.4;
}

.project-preview-glyph,
.project-preview-emoji {
  fill: #ffffff;
  font-size: 11px;
  font-weight: 700;
  text-anchor: middle;
  dominant-baseline: middle;
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
  flex: 0 0 auto;
  border-radius: 16px;
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

.connection-import-overlay {
  position: fixed;
  inset: 0;
  z-index: 180;
  background: rgba(15, 23, 42, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.connection-import-card {
  width: min(460px, 100%);
  border-radius: 14px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  box-shadow: 0 20px 34px rgba(15, 23, 42, 0.28);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.connection-import-title {
  margin: 0;
  color: #0f172a;
  font-size: 18px;
  font-weight: 800;
}

.connection-import-text {
  margin: 0;
  color: #475569;
  font-size: 13px;
}

.connection-provider-item {
  border-radius: 12px;
  border: 1px solid #dbe7ff;
  background: #f8fbff;
  padding: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.connection-provider-item.active {
  border-color: #98bcff;
  background: #eff5ff;
}

.connection-provider-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #1058ff;
  color: #ffffff;
  font-size: 14px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.connection-provider-content {
  min-width: 0;
}

.connection-provider-name {
  color: #0f172a;
  font-size: 14px;
  font-weight: 700;
}

.connection-provider-hint {
  color: #64748b;
  font-size: 12px;
  line-height: 1.3;
}

.connection-import-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.connection-link-btn,
.connection-import-btn {
  height: 34px;
  border-radius: 10px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
  padding: 0 12px;
  cursor: pointer;
}

.connection-import-btn {
  border-color: #bcd3ff;
  background: #edf4ff;
  color: #1058ff;
}

.connection-link-btn:hover:not(:disabled),
.connection-import-btn:hover:not(:disabled) {
  border-color: #97b9ff;
}

.connection-link-btn:disabled,
.connection-import-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.connection-import-message {
  margin: 0;
  color: #0f766e;
  font-size: 12px;
  font-weight: 600;
}

.connection-import-error {
  margin: 0;
  color: #b91c1c;
  font-size: 12px;
  font-weight: 600;
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
