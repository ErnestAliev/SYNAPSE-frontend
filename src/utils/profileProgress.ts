import type { Entity, EntityType } from '../types/entity';
import { countPersonRoleItems } from './personRoles';
import { countPersonSkillItems } from './personSkills';

type MetadataFieldKey =
  | 'tags'
  | 'markers'
  | 'phones'
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
  connection: ['tags', 'markers', 'roles', 'status', 'links', 'importance', 'phones'],
  person: ['tags', 'markers', 'skills', 'importance', 'links', 'roles', 'phones'],
  company: ['tags', 'markers', 'industry', 'departments', 'stage', 'risks', 'links', 'phones'],
  event: ['tags', 'markers', 'date', 'location', 'participants', 'outcomes', 'links', 'phones'],
  resource: ['tags', 'markers', 'resources', 'status', 'importance', 'owners', 'links', 'phones'],
  goal: ['tags', 'markers', 'priority', 'metrics', 'owners', 'status', 'links', 'phones'],
  result: ['tags', 'markers', 'outcomes', 'metrics', 'importance', 'owners', 'links', 'phones'],
  task: ['tags', 'markers', 'priority', 'status', 'owners', 'date', 'links', 'phones'],
  project: ['tags', 'markers', 'stage', 'priority', 'risks', 'owners', 'links', 'phones'],
  shape: ['tags', 'markers', 'importance', 'status', 'links', 'phones'],
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

function countFilledMetadataFields(type: EntityType, metadata: Record<string, unknown>) {
  const fields = ENTITY_METADATA_FIELDS[type] || [];
  let filled = 0;
  for (const key of fields) {
    if (type === 'person' && key === 'skills') {
      if (countPersonSkillItems(metadata) > 0) {
        filled += 1;
      }
      continue;
    }
    if (type === 'person' && key === 'roles') {
      if (countPersonRoleItems(metadata) > 0) {
        filled += 1;
      }
      continue;
    }
    if (toStringArray(metadata[key]).length > 0) {
      filled += 1;
    }
  }
  return filled;
}

function hasProfilePhoto(profile: Record<string, unknown>) {
  const image = typeof profile.image === 'string' ? profile.image.trim() : '';
  if (image) return true;

  const rawLogo = toRecord(profile.logo);
  const logoImage = typeof rawLogo.image === 'string' ? rawLogo.image.trim() : '';
  return Boolean(logoImage);
}

export function calculateEntityProfileProgress(entity: Entity | null | undefined) {
  if (!entity) return 0;

  const profile = toRecord(entity.profile);
  const metadata = toRecord(entity.ai_metadata);
  const trimmedName = (entity.name || '').trim();
  const trimmedDescription =
    typeof metadata.description === 'string' ? metadata.description.trim() : '';

  const metadataFields = ENTITY_METADATA_FIELDS[entity.type] || [];
  const totalParts = metadataFields.length + 3; // photo + description + name + metadata fields
  if (totalParts <= 0) return 0;

  const hasName = Boolean(trimmedName);
  const hasDescription = Boolean(trimmedDescription);
  const hasPhoto = hasProfilePhoto(profile);
  const filledMetadataFields = countFilledMetadataFields(entity.type, metadata);
  const filledParts = Number(hasPhoto) + Number(hasDescription) + Number(hasName) + filledMetadataFields;

  return clampPercent(Math.round((filledParts / totalParts) * 100));
}
