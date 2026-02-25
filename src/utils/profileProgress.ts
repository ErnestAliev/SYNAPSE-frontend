import type { Entity, EntityType } from '../types/entity';

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

const ENTITY_METADATA_FIELDS: Record<EntityType, MetadataFieldKey[]> = {
  person: ['tags', 'markers', 'skills', 'importance', 'links', 'roles'],
  company: ['tags', 'industry', 'departments', 'stage', 'risks', 'links'],
  event: ['tags', 'date', 'location', 'participants', 'outcomes', 'links'],
  resource: ['tags', 'resources', 'status', 'importance', 'owners', 'links'],
  goal: ['tags', 'priority', 'metrics', 'owners', 'status', 'links'],
  result: ['tags', 'outcomes', 'metrics', 'importance', 'owners', 'links'],
  task: ['tags', 'priority', 'status', 'owners', 'date', 'links'],
  project: ['tags', 'stage', 'priority', 'risks', 'owners', 'links'],
  shape: ['tags', 'markers', 'importance', 'status', 'links'],
};

const PROFILE_METADATA_TARGETS: Record<MetadataFieldKey, number> = {
  tags: 4,
  markers: 3,
  skills: 4,
  importance: 1,
  links: 2,
  roles: 2,
  industry: 2,
  departments: 2,
  stage: 1,
  risks: 2,
  date: 1,
  location: 1,
  participants: 3,
  outcomes: 3,
  resources: 3,
  priority: 1,
  status: 1,
  owners: 2,
  metrics: 2,
};

const PROFILE_METADATA_WEIGHTS: Record<EntityType, Partial<Record<MetadataFieldKey, number>>> = {
  person: { tags: 1.1, markers: 0.8, skills: 1.3, importance: 1.2, links: 0.9, roles: 1.3 },
  company: { tags: 1, industry: 1.3, departments: 1.2, stage: 1.2, risks: 1, links: 0.9 },
  event: { tags: 0.9, date: 1.3, location: 1.2, participants: 1.1, outcomes: 1.1, links: 0.9 },
  resource: { tags: 1, resources: 1.3, status: 1.2, importance: 1.1, owners: 1, links: 0.9 },
  goal: { tags: 0.9, priority: 1.2, metrics: 1.3, owners: 1.1, status: 1.1, links: 0.9 },
  result: { tags: 0.9, outcomes: 1.3, metrics: 1.2, importance: 1.1, owners: 1, links: 0.9 },
  task: { tags: 0.9, priority: 1.2, status: 1.3, owners: 1.1, date: 1.1, links: 0.9 },
  project: { tags: 1, stage: 1.2, priority: 1.2, risks: 1.1, owners: 1.1, links: 0.9 },
  shape: { tags: 1, markers: 1.1, importance: 1.2, status: 1.2, links: 0.9 },
};

function toRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
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

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function metadataFieldCompletion(fieldKey: MetadataFieldKey, values: string[]) {
  const target = PROFILE_METADATA_TARGETS[fieldKey] || 1;
  if (!values.length || target <= 0) return 0;
  return Math.min(values.length / target, 1);
}

function calculateMetadataCompletion(type: EntityType, metadata: Record<string, unknown>) {
  const fields = ENTITY_METADATA_FIELDS[type] || [];
  if (!fields.length) return 0;

  const weights = PROFILE_METADATA_WEIGHTS[type] || {};
  let sum = 0;
  let totalWeight = 0;

  for (const key of fields) {
    const weight = weights[key] ?? 1;
    const completion = metadataFieldCompletion(key, toStringArray(metadata[key]));
    sum += completion * weight;
    totalWeight += weight;
  }

  if (!totalWeight) return 0;
  return sum / totalWeight;
}

function countUserChatMessages(metadata: Record<string, unknown>) {
  const raw = Array.isArray(metadata.chat_history) ? metadata.chat_history : [];
  return raw.filter((item) => {
    const record = toRecord(item);
    const role = record.role === 'assistant' ? 'assistant' : 'user';
    if (role !== 'user') return false;
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    const attachments = Array.isArray(record.attachments) ? record.attachments : [];
    return text.length > 0 || attachments.length > 0;
  }).length;
}

function countAttachedDocuments(metadata: Record<string, unknown>) {
  const raw = Array.isArray(metadata.documents) ? metadata.documents : [];
  return raw.filter((item) => {
    const record = toRecord(item);
    const data = typeof record.data === 'string' ? record.data.trim() : '';
    return data.length > 0;
  }).length;
}

export function calculateEntityProfileProgress(entity: Entity | null | undefined) {
  if (!entity) return 0;

  const profile = toRecord(entity.profile);
  const metadata = toRecord(entity.ai_metadata);
  const trimmedName = (entity.name || '').trim();
  const trimmedDescription =
    typeof metadata.description === 'string' ? metadata.description.trim() : '';

  const hasImage = typeof profile.image === 'string' && profile.image.trim().length > 0;
  const hasEmoji = typeof profile.emoji === 'string' && profile.emoji.trim().length > 0;
  const colorValue = typeof profile.color === 'string' ? profile.color.trim().toLowerCase() : '';
  const hasCustomColor = Boolean(colorValue && colorValue !== '#1058ff');

  const metadataCompletion = calculateMetadataCompletion(entity.type, metadata);
  const messageCount = countUserChatMessages(metadata);
  const documentsCount = countAttachedDocuments(metadata);

  const nameScore = trimmedName ? Math.min(trimmedName.length / 20, 1) : 0;
  const descriptionScore = trimmedDescription ? Math.min(trimmedDescription.length / 260, 1) : 0;
  const mediaScore = hasImage ? 1 : hasEmoji ? 0.8 : hasCustomColor ? 0.45 : 0;
  const docsScore = Math.min(documentsCount / 3, 1);
  const chatScore = Math.min(messageCount / 8, 1);

  const weightedScore =
    nameScore * 14 +
    descriptionScore * 22 +
    mediaScore * 16 +
    metadataCompletion * 30 +
    docsScore * 10 +
    chatScore * 8;

  return clampPercent(Math.round(weightedScore));
}
