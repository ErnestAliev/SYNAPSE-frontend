<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import AppIcon from '../ui/AppIcon.vue';
import ProfileProgressRing from '../ui/ProfileProgressRing.vue';
import { useEntitiesStore } from '../../stores/entities';
import { calculateEntityProfileProgress } from '../../utils/profileProgress';
import type {
  CanvasEdgeProjection,
  CanvasNodeProjection,
  Entity,
  EntityType,
  ProjectCanvasData,
} from '../../types/entity';

const props = defineProps<{
  entityId: string;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
}>();

const ENTITY_SYNC_DELAY = 420;
const GRID_STEP = 40;
const PROJECT_INSERT_GAP = GRID_STEP * 3;
const ENTITY_TYPE_CHAT_TARGET: Record<EntityType, string> = {
  project: 'проект',
  person: 'персону',
  company: 'компанию',
  event: 'событие',
  resource: 'ресурс',
  goal: 'цель',
  result: 'результат',
  task: 'задачу',
  shape: 'элемент',
};

type EntityChatRole = 'user' | 'assistant';

interface EntityAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  data: string;
}

interface EntityChatMessage {
  id: string;
  role: EntityChatRole;
  text: string;
  createdAt: string;
  attachments: EntityAttachment[];
}

type MetadataFieldKey =
  | 'tags'
  | 'markers'
  | 'skills'
  | 'importance'
  | 'links'
  | 'roles'
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

const ENTITY_CONTEXT_FIELDS: Record<EntityType, MetadataFieldConfig[]> = {
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
    { key: 'resources', label: 'Ресурсы' },
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

const entitiesStore = useEntitiesStore();

const draft = ref<{
  entityId: string;
  name: string;
  type: EntityType;
  description: string;
  metadataValues: Record<string, string[]>;
  fieldDrafts: Record<string, string>;
  textInput: string;
  voiceInput: string;
  documents: EntityAttachment[];
  pendingUploads: EntityAttachment[];
  chatHistory: EntityChatMessage[];
} | null>(null);

const docInputRef = ref<HTMLInputElement | null>(null);
const chatInputRef = ref<HTMLTextAreaElement | null>(null);
const chatFeedRef = ref<HTMLElement | null>(null);
const infoSaveTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const pendingComposerHeightReset = ref(false);
const isVoiceListening = ref(false);
const activeVoiceRecognition = ref<{ stop: () => void } | null>(null);
const isProjectPickerOpen = ref(false);
const projectActionMessage = ref('');
const isProjectActionBusy = ref(false);
const selectedProjectId = ref('');
const isDeleteConfirmOpen = ref(false);

function toProfile(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return { ...(value as Record<string, unknown>) };
}

function logoImageFromProfile(profile: Record<string, unknown>) {
  const raw = profile.logo;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '';

  const logo = raw as Record<string, unknown>;
  return typeof logo.image === 'string' ? logo.image : '';
}

function toBooleanFlag(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }

  return false;
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function toMetadataStringArray(value: unknown) {
  if (typeof value === 'string') {
    return value.trim() ? [value.trim()] : [];
  }
  return toStringArray(value);
}

function getEntityContextFields(type: EntityType) {
  return ENTITY_CONTEXT_FIELDS[type] || [];
}

function buildEntityMetadataValues(type: EntityType, metadata: Record<string, unknown>) {
  const values: Record<string, string[]> = {};
  for (const field of getEntityContextFields(type)) {
    values[field.key] = toMetadataStringArray(metadata[field.key]);
  }
  return values;
}

function buildEntityFieldDrafts(type: EntityType) {
  const fieldDrafts: Record<string, string> = {};
  for (const field of getEntityContextFields(type)) {
    fieldDrafts[field.key] = '';
  }
  return fieldDrafts;
}

function createLocalAttachmentId() {
  return `doc-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

function createLocalChatMessageId() {
  return `msg-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

function createLocalNodeId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

function snap(value: number) {
  return Math.round(value / GRID_STEP) * GRID_STEP;
}

function getIsoNow() {
  return new Date().toISOString();
}

function normalizeChatHistory(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as EntityChatMessage[];
  }

  return value
    .map((item) => {
      const record = toProfile(item);
      const id = typeof record.id === 'string' ? record.id : createLocalChatMessageId();
      const role = record.role === 'assistant' ? 'assistant' : 'user';
      const text = typeof record.text === 'string' ? record.text : '';
      const createdAt = typeof record.createdAt === 'string' ? record.createdAt : getIsoNow();
      const rawAttachments = Array.isArray(record.attachments) ? record.attachments : [];

      const attachments = rawAttachments
        .map((attachment) => {
          const raw = toProfile(attachment);
          const data = typeof raw.data === 'string' ? raw.data : '';
          if (!data) return null;
          return {
            id: typeof raw.id === 'string' ? raw.id : createLocalAttachmentId(),
            name: typeof raw.name === 'string' ? raw.name : 'Файл',
            mime: typeof raw.mime === 'string' ? raw.mime : '',
            size: typeof raw.size === 'number' ? raw.size : 0,
            data,
          };
        })
        .filter((attachment): attachment is EntityAttachment => Boolean(attachment));

      if (!text.trim() && !attachments.length) {
        return null;
      }

      return {
        id,
        role,
        text,
        createdAt,
        attachments,
      } satisfies EntityChatMessage;
    })
    .filter((message): message is EntityChatMessage => Boolean(message));
}

function normalizeProjectCanvasData(canvasData: unknown): ProjectCanvasData {
  const raw = toProfile(canvasData);
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : [];

  const nodes: CanvasNodeProjection[] = rawNodes.flatMap((node) => {
    const record = toProfile(node);
    const id = typeof record.id === 'string' ? record.id : '';
    const entityId = typeof record.entityId === 'string' ? record.entityId : '';
    const x = typeof record.x === 'number' ? record.x : Number.NaN;
    const y = typeof record.y === 'number' ? record.y : Number.NaN;

    if (!id || !entityId || !Number.isFinite(x) || !Number.isFinite(y)) {
      return [];
    }

    return [{ id, entityId, x, y }];
  });

  const edges: CanvasEdgeProjection[] = rawEdges.flatMap((edge) => {
    const record = toProfile(edge);
    const id = typeof record.id === 'string' ? record.id : '';
    const source = typeof record.source === 'string' ? record.source : '';
    const target = typeof record.target === 'string' ? record.target : '';
    const label = typeof record.label === 'string' ? record.label : undefined;
    const color = typeof record.color === 'string' && record.color.trim() ? record.color : undefined;
    const arrowLeft = typeof record.arrowLeft === 'boolean' ? record.arrowLeft : undefined;
    const arrowRight = typeof record.arrowRight === 'boolean' ? record.arrowRight : undefined;

    if (!id || !source || !target) {
      return [];
    }

    return [{ id, source, target, label, color, arrowLeft, arrowRight }];
  });

  return { nodes, edges };
}

function findProjectInsertPosition(nodes: CanvasNodeProjection[]) {
  if (!nodes.length) {
    return {
      x: snap(-GRID_STEP * 6),
      y: snap(-GRID_STEP * 4),
    };
  }

  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const startX = snap(minX - GRID_STEP * 3);
  const targetY = snap(minY - GRID_STEP * 3);
  const occupied = new Set(nodes.map((node) => `${snap(node.x)}:${snap(node.y)}`));

  let nextX = startX;
  let guard = 0;
  while (occupied.has(`${nextX}:${targetY}`) && guard < 2000) {
    nextX = snap(nextX + PROJECT_INSERT_GAP);
    guard += 1;
  }

  return {
    x: nextX,
    y: targetY,
  };
}

function loadDraft(entityId: string) {
  const entity = entitiesStore.byId(entityId);
  if (!entity) return;

  const aiMetadata = toProfile(entity.ai_metadata);
  const rawDocuments = Array.isArray(aiMetadata.documents) ? aiMetadata.documents : [];
  const documents = rawDocuments
    .map((doc, index) => {
      const record = toProfile(doc);
      const data = typeof record.data === 'string' ? record.data : '';
      const name = typeof record.name === 'string' ? record.name : `Документ ${index + 1}`;
      const mime = typeof record.mime === 'string' ? record.mime : '';
      const size = typeof record.size === 'number' ? record.size : 0;
      if (!data) return null;
      return {
        id: typeof record.id === 'string' ? record.id : createLocalAttachmentId(),
        name,
        mime,
        size,
        data,
      };
    })
    .filter((doc): doc is NonNullable<typeof doc> => Boolean(doc));

  draft.value = {
    entityId: entity._id,
    name: entity.name || '',
    type: entity.type,
    description: typeof aiMetadata.description === 'string' ? aiMetadata.description : '',
    metadataValues: buildEntityMetadataValues(entity.type, aiMetadata),
    fieldDrafts: buildEntityFieldDrafts(entity.type),
    textInput: '',
    voiceInput: typeof aiMetadata.voice_input === 'string' ? aiMetadata.voice_input : '',
    documents,
    pendingUploads: [],
    chatHistory: normalizeChatHistory(aiMetadata.chat_history),
  };

  isProjectPickerOpen.value = false;
  projectActionMessage.value = '';
  isProjectActionBusy.value = false;

  pendingComposerHeightReset.value = true;
  void nextTick(() => {
    autoResizeChatInput();
    scrollEntityChatToBottom('auto');
  });
}

function persistDraft(entityId: string) {
  const currentDraft = draft.value;
  if (!currentDraft || currentDraft.entityId !== entityId) return;

  const entity = entitiesStore.byId(entityId);
  if (!entity) return;

  const aiMetadata = toProfile(entity.ai_metadata);
  const nextMetadata: Record<string, unknown> = {
    ...aiMetadata,
    description: currentDraft.description.trim(),
    text_input: currentDraft.textInput,
    voice_input: currentDraft.voiceInput.trim(),
    chat_history: currentDraft.chatHistory.map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      createdAt: message.createdAt,
      attachments: message.attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        mime: attachment.mime,
        size: attachment.size,
        data: attachment.data,
      })),
    })),
    documents: currentDraft.documents.map((doc) => ({
      id: doc.id,
      name: doc.name,
      mime: doc.mime,
      size: doc.size,
      data: doc.data,
    })),
  };

  for (const field of getEntityContextFields(currentDraft.type)) {
    nextMetadata[field.key] = currentDraft.metadataValues[field.key] || [];
  }

  entitiesStore.queueEntityUpdate(
    entityId,
    {
      name: currentDraft.name.trim() || entity.name,
      ai_metadata: nextMetadata,
    },
    { delay: ENTITY_SYNC_DELAY },
  );
}

function scheduleSave() {
  const currentDraft = draft.value;
  if (!currentDraft) return;

  if (infoSaveTimer.value) {
    clearTimeout(infoSaveTimer.value);
  }

  infoSaveTimer.value = setTimeout(() => {
    persistDraft(currentDraft.entityId);
  }, ENTITY_SYNC_DELAY);
}

function clearSaveTimer() {
  if (!infoSaveTimer.value) return;
  clearTimeout(infoSaveTimer.value);
  infoSaveTimer.value = null;
}

function closeModal() {
  const currentDraft = draft.value;
  if (currentDraft) {
    persistDraft(currentDraft.entityId);
  }
  clearSaveTimer();
  stopVoiceCapture();
  selectedProjectId.value = '';
  isProjectPickerOpen.value = false;
  isDeleteConfirmOpen.value = false;
  emit('close');
}

function toggleProjectPicker() {
  if (!draft.value || isProjectActionBusy.value) return;
  if (!availableProjectOptions.value.length) {
    projectActionMessage.value = 'Нет доступных проектов для добавления.';
    isProjectPickerOpen.value = false;
    return;
  }
  projectActionMessage.value = '';
  selectedProjectId.value = '';
  isProjectPickerOpen.value = !isProjectPickerOpen.value;
}

async function onAddToProject(projectId: string) {
  const currentDraft = draft.value;
  const entity = currentEntity.value;
  if (!currentDraft || !entity || isProjectActionBusy.value) return;

  if (entity.type === 'project' && entity._id === projectId) {
    projectActionMessage.value = 'Нельзя добавить проект в самого себя.';
    return;
  }

  const project = entitiesStore.byId(projectId);
  if (!project || project.type !== 'project') {
    projectActionMessage.value = 'Проект не найден.';
    return;
  }

  const canvasData = normalizeProjectCanvasData(project.canvas_data);
  if (canvasData.nodes.some((node) => node.entityId === entity._id)) {
    projectActionMessage.value = 'Запись уже добавлена в этот проект.';
    selectedProjectId.value = '';
    isProjectPickerOpen.value = false;
    return;
  }

  persistDraft(currentDraft.entityId);
  const position = findProjectInsertPosition(canvasData.nodes);
  const nextCanvasData: ProjectCanvasData = {
    nodes: [
      ...canvasData.nodes,
      {
        id: createLocalNodeId(),
        entityId: entity._id,
        x: position.x,
        y: position.y,
      },
    ],
    edges: canvasData.edges,
  };

  isProjectActionBusy.value = true;
  try {
    await entitiesStore.updateEntity(projectId, {
      canvas_data: nextCanvasData,
    });

    const locked = toBooleanFlag(toProfile(entity.profile).locked);
    projectActionMessage.value = locked
      ? `Добавлено в проект "${project.name || 'Без названия'}". Узел заблокирован для перемещения.`
      : `Добавлено в проект "${project.name || 'Без названия'}".`;
    selectedProjectId.value = '';
    isProjectPickerOpen.value = false;
  } catch {
    projectActionMessage.value = 'Не удалось добавить в проект.';
  } finally {
    isProjectActionBusy.value = false;
  }
}

function onProjectPickerChange(event: Event) {
  const select = event.target as HTMLSelectElement | null;
  if (!select) return;

  selectedProjectId.value = select.value;
  if (!selectedProjectId.value) return;
  void onAddToProject(selectedProjectId.value);
}

function openDeleteConfirm() {
  if (!draft.value || isProjectActionBusy.value) return;
  isDeleteConfirmOpen.value = true;
}

function closeDeleteConfirm() {
  if (isProjectActionBusy.value) return;
  isDeleteConfirmOpen.value = false;
}

const deleteConfirmName = computed(() => {
  const currentDraft = draft.value;
  if (!currentDraft) return 'это';
  return currentDraft.name.trim() || 'это';
});

async function onDeleteEntity() {
  const currentDraft = draft.value;
  if (!currentDraft || isProjectActionBusy.value) return;

  isProjectActionBusy.value = true;
  clearSaveTimer();
  stopVoiceCapture();

  try {
    await entitiesStore.deleteEntity(currentDraft.entityId);
    isDeleteConfirmOpen.value = false;
    emit('close');
  } catch {
    projectActionMessage.value = 'Не удалось удалить.';
  } finally {
    isProjectActionBusy.value = false;
  }
}

function getFieldValues(fieldKey: string) {
  if (!draft.value) return [] as string[];
  return draft.value.metadataValues[fieldKey] || [];
}

function getFieldDraft(fieldKey: string) {
  if (!draft.value) return '';
  return draft.value.fieldDrafts[fieldKey] || '';
}

function onFieldDraftInput(fieldKey: string, event: Event) {
  const input = event.target as HTMLInputElement | null;
  if (!input || !draft.value) return;
  draft.value.fieldDrafts[fieldKey] = input.value.slice(0, 32);
}

function addFieldValue(fieldKey: string) {
  if (!draft.value) return;
  const nextValue = (draft.value.fieldDrafts[fieldKey] || '').trim().slice(0, 32);
  if (!nextValue) return;

  const values = draft.value.metadataValues[fieldKey] || [];
  if (!values.includes(nextValue)) {
    draft.value.metadataValues[fieldKey] = [...values, nextValue];
  }
  draft.value.fieldDrafts[fieldKey] = '';
  scheduleSave();
}

function removeFieldValue(fieldKey: string, value: string) {
  if (!draft.value) return;
  draft.value.metadataValues[fieldKey] = (draft.value.metadataValues[fieldKey] || []).filter(
    (item) => item !== value,
  );
  scheduleSave();
}

function onNameInput() {
  scheduleSave();
}

function onDescriptionInput() {
  scheduleSave();
}

function focusChatInput() {
  chatInputRef.value?.focus();
}

function autoResizeChatInput() {
  const input = chatInputRef.value;
  if (!input) return;

  if (pendingComposerHeightReset.value) {
    input.style.height = '0px';
    pendingComposerHeightReset.value = false;
  }

  input.style.height = '0px';
  input.style.height = `${Math.min(176, input.scrollHeight)}px`;
}

function scrollEntityChatToBottom(behavior: ScrollBehavior = 'smooth') {
  const feed = chatFeedRef.value;
  if (!feed) return;
  feed.scrollTo({
    top: feed.scrollHeight,
    behavior,
  });
}

function normalizeChatText(value: string) {
  return value.replace(/\r\n/g, '\n').trim();
}

function pushChatMessage(role: EntityChatRole, text: string, attachments: EntityAttachment[] = []) {
  if (!draft.value) return;
  const normalized = normalizeChatText(text);
  if (!normalized && !attachments.length) return;

  draft.value.chatHistory = [
    ...draft.value.chatHistory,
    {
      id: createLocalChatMessageId(),
      role,
      text: normalized,
      createdAt: getIsoNow(),
      attachments: attachments.map((attachment) => ({ ...attachment })),
    },
  ];
}

async function onSendInput() {
  if (!draft.value) return;

  const message = normalizeChatText(draft.value.textInput);
  const attachments = [...draft.value.pendingUploads];
  if (!message && !attachments.length) return;

  pushChatMessage('user', message, attachments);
  draft.value.pendingUploads = [];
  draft.value.documents = Array.from(
    new Map([...draft.value.documents, ...attachments].map((attachment) => [attachment.id, attachment])).values(),
  );
  draft.value.textInput = '';

  autoResizeChatInput();
  void nextTick(() => {
    scrollEntityChatToBottom('auto');
  });
  scheduleSave();
}

function onChatComposerKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return;
  if (event.shiftKey) return;

  event.preventDefault();
  void onSendInput();
}

function onTextInput() {
  autoResizeChatInput();
  scheduleSave();
}

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('File read error'));
    reader.readAsDataURL(file);
  });
}

async function onDocumentsChange(event: Event) {
  const input = event.target as HTMLInputElement | null;
  const files = input?.files;
  if (!files || !files.length || !draft.value) return;

  const attachments = await Promise.all(
    Array.from(files).map(async (file) => ({
      id: createLocalAttachmentId(),
      name: file.name,
      mime: file.type,
      size: file.size,
      data: await fileToDataUrl(file),
    })),
  );

  draft.value.pendingUploads = [...draft.value.pendingUploads, ...attachments];
  if (!draft.value.textInput.trim()) {
    draft.value.textInput = attachments.map((attachment) => `[Файл] ${attachment.name}`).join('\n');
  }
  autoResizeChatInput();
  scheduleSave();

  if (input) {
    input.value = '';
  }
}

function removePendingUpload(attachmentId: string) {
  if (!draft.value) return;
  draft.value.pendingUploads = draft.value.pendingUploads.filter(
    (attachment) => attachment.id !== attachmentId,
  );
  scheduleSave();
}

function stopVoiceCapture() {
  isVoiceListening.value = false;
  if (activeVoiceRecognition.value) {
    activeVoiceRecognition.value.stop();
    activeVoiceRecognition.value = null;
  }
}

function startVoiceCapture() {
  if (!draft.value || typeof window === 'undefined') return;

  const speechWindow = window as Window & {
    SpeechRecognition?: new () => {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      onresult: ((event: unknown) => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
    };
    webkitSpeechRecognition?: new () => {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      onresult: ((event: unknown) => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
    };
  };

  const RecognitionCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
  if (!RecognitionCtor) return;

  stopVoiceCapture();

  const recognition = new RecognitionCtor();
  recognition.lang = 'ru-RU';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event: unknown) => {
    if (!draft.value) return;
    const eventResults = (event as { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }).results;
    const transcript = Array.from(eventResults || [])
      .map((result) => result?.[0]?.transcript || '')
      .join(' ')
      .trim();

    draft.value.voiceInput = transcript;
    draft.value.textInput = transcript;
    autoResizeChatInput();
    scheduleSave();
  };

  recognition.onend = () => {
    isVoiceListening.value = false;
    activeVoiceRecognition.value = null;
  };

  recognition.start();
  isVoiceListening.value = true;
  activeVoiceRecognition.value = { stop: () => recognition.stop() };
}

function onVoiceToggle() {
  if (isVoiceListening.value) {
    stopVoiceCapture();
    return;
  }
  startVoiceCapture();
}

function toDisplayTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

const currentEntity = computed(() => entitiesStore.byId(props.entityId) || null);
const availableProjectOptions = computed(() => {
  const current = currentEntity.value;
  return entitiesStore
    .byType('project')
    .filter((project) => !(current?.type === 'project' && project._id === current._id))
    .sort((left, right) =>
      (left.name || 'Без названия').localeCompare(right.name || 'Без названия', 'ru'),
    );
});

const modalIcon = computed(() => {
  if (!currentEntity.value) return null;

  const profile = toProfile(currentEntity.value.profile);
  const color = typeof profile.color === 'string' && profile.color.trim() ? profile.color : '#1058ff';
  const image = typeof profile.image === 'string' ? profile.image : '';
  const emoji = typeof profile.emoji === 'string' ? profile.emoji : '';
  const hasLogo = logoImageFromProfile(profile).trim().length > 0;

  return {
    type: currentEntity.value.type,
    color,
    image,
    emoji,
    hasLogo,
  };
});

const activeFields = computed(() => {
  const type = draft.value?.type || 'shape';
  return getEntityContextFields(type);
});

const chatPlaceholder = computed(() => {
  const type = draft.value?.type || 'shape';
  return `Опишите ${ENTITY_TYPE_CHAT_TARGET[type]}`;
});

const progressEntity = computed<Entity | null>(() => {
  if (!currentEntity.value || !draft.value) return currentEntity.value;

  const metadata = {
    ...toProfile(currentEntity.value.ai_metadata),
    description: draft.value.description,
    documents: [...draft.value.documents, ...draft.value.pendingUploads].map((doc) => ({
      id: doc.id,
      name: doc.name,
      mime: doc.mime,
      size: doc.size,
      data: doc.data,
    })),
    chat_history: draft.value.chatHistory.map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      createdAt: message.createdAt,
      attachments: message.attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        mime: attachment.mime,
        size: attachment.size,
        data: attachment.data,
      })),
    })),
  } as Record<string, unknown>;

  for (const field of activeFields.value) {
    metadata[field.key] = draft.value.metadataValues[field.key] || [];
  }

  return {
    ...currentEntity.value,
    name: draft.value.name,
    ai_metadata: metadata,
  };
});

const profileProgress = computed(() => calculateEntityProfileProgress(progressEntity.value));
const profileProgressLevel = computed(() => {
  if (profileProgress.value >= 85) return 'Высокая заполненность';
  if (profileProgress.value >= 60) return 'Хорошая заполненность';
  if (profileProgress.value >= 35) return 'Средняя заполненность';
  return 'Низкая заполненность';
});

watch(
  () => props.entityId,
  async (entityId) => {
    if (!entityId) return;
    if (!entitiesStore.initialized) {
      await entitiesStore.bootstrap();
    }
    loadDraft(entityId);
  },
  { immediate: true },
);

watch(
  currentEntity,
  (entity) => {
    if (!entity && draft.value) {
      closeModal();
    }
  },
);

onBeforeUnmount(() => {
  const currentDraft = draft.value;
  if (currentDraft) {
    persistDraft(currentDraft.entityId);
  }
  clearSaveTimer();
  stopVoiceCapture();
});
</script>

<template>
  <div class="entity-info-overlay" @pointerdown.self="closeModal">
    <div v-if="draft" class="entity-info-modal" @pointerdown.stop>
      <header class="entity-info-header">
        <div v-if="modalIcon" class="entity-info-progress-avatar">
          <ProfileProgressRing :value="profileProgress" :size="72" :stroke-width="5">
            <span
              class="entity-info-icon"
              :style="{ background: modalIcon.color, borderColor: modalIcon.color }"
            >
              <img
                v-if="modalIcon.image && !modalIcon.hasLogo"
                class="entity-info-icon-image"
                :src="modalIcon.image"
                alt=""
              />
              <img
                v-else-if="modalIcon.hasLogo"
                class="entity-info-icon-logo"
                :src="modalIcon.image"
                alt=""
              />
              <span v-else-if="modalIcon.emoji" class="entity-info-icon-emoji">{{ modalIcon.emoji }}</span>
              <AppIcon v-else :name="modalIcon.type" class="entity-info-icon-symbol" />
            </span>
          </ProfileProgressRing>
        </div>

        <div class="entity-info-title">
          <input
            v-model="draft.name"
            type="text"
            maxlength="64"
            class="entity-info-name-input"
            @input="onNameInput"
          />
          <div class="entity-info-progress-meta">
            <span class="entity-info-progress-level">{{ profileProgressLevel }}</span>
            <span class="entity-info-progress-percent">{{ profileProgress }}%</span>
          </div>
        </div>
      </header>

      <section class="entity-info-actions">
        <button
          type="button"
          class="entity-info-action-btn"
          :disabled="isProjectActionBusy"
          @click="toggleProjectPicker"
        >
          Добавить в проект
        </button>

        <select
          v-if="isProjectPickerOpen"
          :value="selectedProjectId"
          class="entity-info-project-select"
          :disabled="isProjectActionBusy"
          @change="onProjectPickerChange"
        >
          <option value="">Выберите проект</option>
          <option
            v-for="project in availableProjectOptions"
            :key="project._id"
            :value="project._id"
          >
            {{ project.name || 'Без названия' }}
          </option>
        </select>

        <button
          type="button"
          class="entity-info-action-btn danger"
          :disabled="isProjectActionBusy"
          @click="openDeleteConfirm"
        >
          Удалить
        </button>
      </section>

      <p v-if="projectActionMessage" class="entity-info-action-message">
        {{ projectActionMessage }}
      </p>

      <div class="entity-info-fixed">
        <section class="entity-info-section">
          <textarea
            v-model="draft.description"
            class="entity-info-textarea entity-info-description"
            rows="2"
            placeholder="Описание"
            @input="onDescriptionInput"
          />

          <div class="entity-info-fields-list">
            <div
              v-for="field in activeFields"
              :key="field.key"
              class="entity-info-field-row"
            >
              <div class="entity-info-field-scroll">
                <input
                  :value="getFieldDraft(field.key)"
                  type="text"
                  class="entity-info-tag-input"
                  maxlength="32"
                  :placeholder="field.label"
                  @input="onFieldDraftInput(field.key, $event)"
                  @keydown.enter.prevent="addFieldValue(field.key)"
                />
                <button
                  v-for="value in getFieldValues(field.key)"
                  :key="`${field.key}:${value}`"
                  type="button"
                  class="entity-info-tag"
                  @click="removeFieldValue(field.key, value)"
                >
                  {{ value }}
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section ref="chatFeedRef" class="entity-info-chat-feed">
        <article
          v-for="message in draft.chatHistory"
          :key="message.id"
          class="entity-chat-message"
          :class="{ user: message.role === 'user', assistant: message.role === 'assistant' }"
        >
          <div class="entity-chat-bubble">
            <p class="entity-chat-text">{{ message.text }}</p>
            <div v-if="message.attachments.length" class="entity-chat-attachments">
              <span
                v-for="attachment in message.attachments"
                :key="attachment.id"
                class="entity-chat-attachment-chip"
              >
                {{ attachment.name }}
              </span>
            </div>
          </div>
          <time class="entity-chat-time">{{ toDisplayTime(message.createdAt) }}</time>
        </article>
      </section>

      <section class="entity-info-chat-composer">
        <div v-if="draft.pendingUploads.length" class="entity-info-pending-uploads">
          <span
            v-for="attachment in draft.pendingUploads"
            :key="attachment.id"
            class="entity-info-upload-chip"
          >
            {{ attachment.name }}
            <button
              type="button"
              class="entity-info-upload-chip-remove"
              @click="removePendingUpload(attachment.id)"
            >
              ×
            </button>
          </span>
        </div>

        <div class="entity-info-chat-bar">
          <textarea
            ref="chatInputRef"
            v-model="draft.textInput"
            class="entity-info-chat-input"
            :placeholder="chatPlaceholder"
            rows="1"
            @input="onTextInput"
            @keydown="onChatComposerKeydown"
          />
        </div>

        <div class="entity-info-chat-tools">
          <div class="entity-info-chat-tools-left">
            <button
              type="button"
              class="entity-info-chat-icon-btn"
              title="Загрузка документа"
              @click="docInputRef?.click()"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M21 11.5V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8.5" />
                <path d="M15 3h6v6" />
                <path d="M10 14 21 3" />
              </svg>
            </button>
            <input
              ref="docInputRef"
              type="file"
              class="entity-info-hidden-input"
              multiple
              @change="onDocumentsChange"
            />

            <button
              type="button"
              class="entity-info-chat-icon-btn"
              title="Текстовый чат"
              @click="focusChatInput"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 5h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8l-5 4V7a2 2 0 0 1 2-2Z" />
              </svg>
            </button>

            <button
              type="button"
              class="entity-info-chat-icon-btn"
              :class="{ active: isVoiceListening }"
              title="Голосовой ввод"
              @click="onVoiceToggle"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <path d="M12 18v3" />
                <path d="M8 21h8" />
              </svg>
            </button>
          </div>

          <button
            type="button"
            class="entity-info-chat-icon-btn send"
            title="Отправить"
            @click="onSendInput"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 11.5 21 3l-7.5 18-2.6-7.1L3 11.5Z" />
            </svg>
          </button>
        </div>
      </section>
    </div>

    <div
      v-if="isDeleteConfirmOpen"
      class="entity-delete-confirm-overlay"
      @pointerdown.self="closeDeleteConfirm"
    >
      <div class="entity-delete-confirm-card" @pointerdown.stop>
        <h3 class="entity-delete-confirm-title">Удалить?</h3>
        <p class="entity-delete-confirm-text">
          "{{ deleteConfirmName }}" будет удалено из коллекции, базы и всех проектов.
        </p>
        <p class="entity-delete-confirm-warning">Действие необратимо.</p>
        <div class="entity-delete-confirm-actions">
          <button
            type="button"
            class="entity-delete-confirm-btn secondary"
            :disabled="isProjectActionBusy"
            @click="closeDeleteConfirm"
          >
            Отмена
          </button>
          <button
            type="button"
            class="entity-delete-confirm-btn danger"
            :disabled="isProjectActionBusy"
            @click="onDeleteEntity"
          >
            Удалить
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.entity-info-overlay {
  position: fixed;
  inset: 0;
  z-index: 180;
  display: flex;
  justify-content: center;
  align-items: center;
  background: rgba(15, 23, 42, 0.34);
  padding: 24px;
}

.entity-info-modal {
  width: min(456px, 96vw);
  height: min(86vh, 920px);
  max-height: 92vh;
  overflow: hidden;
  border-radius: 18px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  box-shadow: 0 28px 52px rgba(15, 23, 42, 0.3);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.entity-info-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.entity-info-progress-avatar {
  width: 72px;
  height: 72px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.entity-info-icon {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 1px solid #1058ff;
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.entity-info-icon-symbol {
  width: 56%;
  height: 56%;
}

.entity-info-icon-symbol :deep(svg) {
  width: 100%;
  height: 100%;
}

.entity-info-icon-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.entity-info-icon-logo {
  width: 56%;
  height: 56%;
  object-fit: contain;
}

.entity-info-icon-emoji {
  font-size: 31px;
  line-height: 1;
}

.entity-info-title {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.entity-info-name-input {
  width: 100%;
  border: 1px solid #dbe4f3;
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
  outline: none;
}

.entity-info-name-input:focus {
  border-color: #bfdbfe;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.14);
}

.entity-info-progress-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 16px;
}

.entity-info-progress-level {
  color: #64748b;
  font-size: 11px;
  font-weight: 600;
}

.entity-info-progress-percent {
  color: #1058ff;
  font-size: 12px;
  font-weight: 700;
}

.entity-info-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.entity-info-action-btn {
  height: 32px;
  border-radius: 10px;
  border: 1px solid #dbe4f3;
  background: #f8fafc;
  color: #1e293b;
  font-size: 12px;
  font-weight: 700;
  padding: 0 12px;
  cursor: pointer;
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease;
}

.entity-info-action-btn:hover:not(:disabled) {
  background: #eef4ff;
  border-color: #bfd5ff;
  color: #1058ff;
}

.entity-info-action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.entity-info-action-btn.danger {
  margin-left: auto;
  color: #b91c1c;
  border-color: #fecaca;
  background: #fff1f2;
}

.entity-info-action-btn.danger:hover:not(:disabled) {
  color: #991b1b;
  border-color: #fca5a5;
  background: #ffe4e6;
}

.entity-info-project-select {
  flex: 1;
  min-width: 180px;
  height: 32px;
  border-radius: 10px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  color: #0f172a;
  font-size: 12px;
  font-weight: 600;
  outline: none;
  padding: 0 10px;
}

.entity-info-project-select:focus {
  border-color: #bfdbfe;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.14);
}

.entity-info-action-message {
  margin: -4px 0 0;
  min-height: 14px;
  color: #475569;
  font-size: 11px;
  font-weight: 600;
}

.entity-info-fixed {
  flex-shrink: 0;
}

.entity-info-section {
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  background: #f8fafc;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.entity-info-textarea {
  width: 100%;
  border: 1px solid #dbe4f3;
  border-radius: 10px;
  background: #ffffff;
  color: #0f172a;
  font-size: 13px;
  line-height: 1.4;
  outline: none;
  padding: 9px 10px;
  resize: vertical;
}

.entity-info-textarea:focus {
  border-color: #bfdbfe;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.14);
}

.entity-info-description {
  min-height: 48px;
  max-height: 132px;
}

.entity-info-fields-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 128px;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 2px;
}

.entity-info-fields-list::-webkit-scrollbar {
  width: 6px;
}

.entity-info-field-row {
  border: 1px solid #dbe4f3;
  border-radius: 10px;
  background: #ffffff;
}

.entity-info-field-scroll {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 6px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 6px 8px;
}

.entity-info-field-scroll::-webkit-scrollbar {
  height: 6px;
}

.entity-info-tag {
  flex-shrink: 0;
  border: 1px solid #bfd5ff;
  border-radius: 999px;
  background: #eff6ff;
  color: #1e40af;
  font-size: 11px;
  font-weight: 700;
  padding: 5px 9px;
  cursor: pointer;
}

.entity-info-tag-input {
  flex: 0 0 140px;
  min-width: 120px;
  max-width: 200px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #0f172a;
  font-size: 12px;
  font-weight: 600;
  outline: none;
  padding: 6px 8px;
  order: -1;
}

.entity-info-tag-input:focus {
  background: #f8fafc;
}

.entity-info-chat-feed {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  background: #f8fafc;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.entity-chat-message {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 88%;
}

.entity-chat-message.user {
  align-self: flex-end;
  align-items: flex-end;
}

.entity-chat-message.assistant {
  align-self: flex-start;
  align-items: flex-start;
}

.entity-chat-bubble {
  border-radius: 12px;
  padding: 8px 10px;
  background: #ffffff;
  border: 1px solid #dbe4f3;
  box-shadow: 0 4px 12px rgba(112, 144, 176, 0.14);
}

.entity-chat-message.user .entity-chat-bubble {
  background: #1058ff;
  border-color: #1058ff;
  color: #ffffff;
}

.entity-chat-text {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.35;
  font-size: 12px;
}

.entity-chat-time {
  color: #94a3b8;
  font-size: 10px;
  font-weight: 600;
}

.entity-chat-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 6px;
}

.entity-chat-attachment-chip {
  border-radius: 999px;
  border: 1px solid rgba(219, 228, 243, 0.9);
  background: rgba(255, 255, 255, 0.9);
  color: #334155;
  font-size: 10px;
  font-weight: 700;
  padding: 3px 8px;
}

.entity-info-chat-composer {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.entity-info-pending-uploads {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.entity-info-upload-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  border: 1px solid #dbe4f3;
  background: #f8fafc;
  color: #334155;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
}

.entity-info-upload-chip-remove {
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  line-height: 1;
}

.entity-info-chat-bar {
  display: flex;
  align-items: stretch;
  border: 1px solid #dbe4f3;
  border-radius: 12px;
  background: #ffffff;
  padding: 4px 8px;
}

.entity-info-chat-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-top: 1px solid #e8edf7;
  padding-top: 7px;
}

.entity-info-chat-tools-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.entity-info-chat-icon-btn {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  color: #6b7a91;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    color 0.16s ease,
    border-color 0.16s ease,
    background-color 0.16s ease;
}

.entity-info-chat-icon-btn svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.entity-info-chat-icon-btn:hover {
  color: #1058ff;
  border-color: #bfd5ff;
  background: #eef4ff;
}

.entity-info-chat-icon-btn.active,
.entity-info-chat-icon-btn.send {
  color: #ffffff;
  background: #1058ff;
  border-color: #1058ff;
}

.entity-info-chat-input {
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
  max-height: 176px;
  overflow-y: auto;
}

.entity-info-chat-input::placeholder {
  color: #94a3b8;
}

.entity-info-hidden-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

.entity-delete-confirm-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.38);
  border-radius: 18px;
}

.entity-delete-confirm-card {
  width: min(360px, calc(100% - 24px));
  border-radius: 14px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.28);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.entity-delete-confirm-title {
  margin: 0;
  color: #0f172a;
  font-size: 15px;
  font-weight: 800;
}

.entity-delete-confirm-text {
  margin: 0;
  color: #334155;
  font-size: 13px;
  line-height: 1.4;
}

.entity-delete-confirm-warning {
  margin: 0;
  color: #b91c1c;
  font-size: 12px;
  font-weight: 700;
}

.entity-delete-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.entity-delete-confirm-btn {
  height: 32px;
  border-radius: 10px;
  border: 1px solid #dbe4f3;
  background: #f8fafc;
  color: #1e293b;
  font-size: 12px;
  font-weight: 700;
  padding: 0 12px;
  cursor: pointer;
}

.entity-delete-confirm-btn.secondary:hover:not(:disabled) {
  border-color: #bfd5ff;
  background: #eef4ff;
  color: #1058ff;
}

.entity-delete-confirm-btn.danger {
  border-color: #fecaca;
  background: #fff1f2;
  color: #b91c1c;
}

.entity-delete-confirm-btn.danger:hover:not(:disabled) {
  border-color: #fca5a5;
  background: #ffe4e6;
}

.entity-delete-confirm-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
