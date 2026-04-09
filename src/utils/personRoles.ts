export type PersonRoleCategory = 'personal' | 'professional';

export interface PersonManualRoleEntry {
  name: string;
  category: PersonRoleCategory;
  group: string;
}

export interface PersonRoleLibraryGroup {
  key: string;
  label: string;
  category: PersonRoleCategory;
  roles: string[];
}

export interface PersonRoleLibraryMatch {
  name: string;
  category: PersonRoleCategory;
  group: string;
}

export const PERSON_ROLE_CUSTOM_GROUP = 'Пользовательские';

export const PERSON_ROLE_LIBRARY_GROUPS: PersonRoleLibraryGroup[] = [
  {
    key: 'personal-family',
    label: 'Семья',
    category: 'personal',
    roles: [
      'Отец',
      'Мать',
      'Муж',
      'Жена',
      'Родитель',
      'Сын',
      'Дочь',
      'Опекун',
    ],
  },
  {
    key: 'personal-close-circle',
    label: 'Близкий круг',
    category: 'personal',
    roles: [
      'Брат',
      'Сестра',
      'Друг',
      'Подруга',
      'Наставник',
      'Ученик',
      'Соратник',
      'Хранитель семьи',
    ],
  },
  {
    key: 'personal-community',
    label: 'Сообщество',
    category: 'personal',
    roles: [
      'Лидер сообщества',
      'Участник сообщества',
      'Волонтер',
      'Организатор',
      'Медиатор',
      'Представитель семьи',
      'Гражданский активист',
      'Куратор сообщества',
    ],
  },
  {
    key: 'professional-business',
    label: 'Бизнес',
    category: 'professional',
    roles: [
      'Предприниматель',
      'Основатель',
      'CEO',
      'Собственник',
      'Руководитель',
      'Управляющий',
      'Партнер по бизнесу',
      'Исполнительный директор',
    ],
  },
  {
    key: 'professional-management',
    label: 'Менеджмент',
    category: 'professional',
    roles: [
      'Team Lead',
      'Проектный менеджер',
      'Продуктовый менеджер',
      'Операционный менеджер',
      'Руководитель отдела',
      'Координатор',
      'Куратор проекта',
      'Продюсер',
    ],
  },
  {
    key: 'professional-expertise',
    label: 'Экспертиза',
    category: 'professional',
    roles: [
      'Аналитик',
      'Маркетолог',
      'Разработчик',
      'Дизайнер',
      'Архитектор',
      'Финансист',
      'Юрист',
      'HR',
    ],
  },
  {
    key: 'professional-communication',
    label: 'Коммуникация и продажи',
    category: 'professional',
    roles: [
      'Консультант',
      'Переговорщик',
      'Аккаунт-менеджер',
      'Менеджер по продажам',
      'Спикер',
      'Амбассадор',
      'Редактор',
      'Исследователь',
    ],
  },
];

const PERSON_ROLE_INDEX = PERSON_ROLE_LIBRARY_GROUPS.reduce(
  (acc, group) => {
    for (const role of group.roles) {
      const normalizedName = normalizePersonRoleName(role);
      if (!normalizedName) continue;
      acc.set(normalizedName.toLowerCase(), {
        name: normalizedName,
        category: group.category,
        group: group.label,
      });
    }
    return acc;
  },
  new Map<string, PersonRoleLibraryMatch>(),
);

export function normalizePersonRoleName(value: unknown) {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 64);
}

export function normalizePersonRoleCategory(value: unknown): PersonRoleCategory {
  return value === 'personal' ? 'personal' : 'professional';
}

export function normalizePersonRoleGroup(value: unknown) {
  if (typeof value !== 'string') return PERSON_ROLE_CUSTOM_GROUP;
  const normalized = value.trim().slice(0, 48);
  return normalized || PERSON_ROLE_CUSTOM_GROUP;
}

export function findPersonRoleLibraryMatch(value: unknown): PersonRoleLibraryMatch | null {
  const normalizedName = normalizePersonRoleName(value);
  if (!normalizedName) return null;
  return PERSON_ROLE_INDEX.get(normalizedName.toLowerCase()) || null;
}

export function resolvePersonManualRoleEntry(
  value: unknown,
  options: {
    fallbackCategory?: PersonRoleCategory;
    fallbackGroup?: string;
  } = {},
): PersonManualRoleEntry | null {
  if (typeof value === 'string') {
    const normalizedName = normalizePersonRoleName(value);
    if (!normalizedName) return null;
    const matched = findPersonRoleLibraryMatch(normalizedName);
    return {
      name: matched?.name || normalizedName,
      category: matched?.category || options.fallbackCategory || 'professional',
      group: matched?.group || options.fallbackGroup || PERSON_ROLE_CUSTOM_GROUP,
    };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const normalizedName = normalizePersonRoleName(record.name);
  if (!normalizedName) return null;

  const matched = findPersonRoleLibraryMatch(normalizedName);

  return {
    name: matched?.name || normalizedName,
    category: matched?.category || normalizePersonRoleCategory(record.category ?? options.fallbackCategory),
    group: matched?.group || normalizePersonRoleGroup(record.group ?? options.fallbackGroup),
  };
}

export function normalizePersonManualRoles(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  const dedupe = new Map<string, number>();
  const result: PersonManualRoleEntry[] = [];

  for (const item of source) {
    const normalized = resolvePersonManualRoleEntry(item);
    if (!normalized) continue;

    const key = normalized.name.toLowerCase();
    const existingIndex = dedupe.get(key);
    if (typeof existingIndex === 'number') {
      result[existingIndex] = normalized;
      continue;
    }

    dedupe.set(key, result.length);
    result.push(normalized);
  }

  return result;
}

export function extractAiPersonRoles(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];

  const dedupe = new Set<string>();
  const result: string[] = [];

  for (const item of value) {
    const normalized = normalizePersonRoleName(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    result.push(normalized);
  }

  return result;
}

export function buildPersonRoleDisplayValues(
  metadata: Record<string, unknown>,
  options: { limit?: number } = {},
) {
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.floor(options.limit as number)) : 6;
  const manualRoles = normalizePersonManualRoles(metadata.manual_roles);
  const aiRoles = extractAiPersonRoles(metadata.roles);
  const result: string[] = [];
  const dedupe = new Set<string>();

  for (const role of manualRoles) {
    const key = role.name.toLowerCase();
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    result.push(role.name);
    if (result.length >= limit) return result;
  }

  for (const roleName of aiRoles) {
    const key = roleName.toLowerCase();
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    result.push(roleName);
    if (result.length >= limit) return result;
  }

  return result;
}

export function countPersonRoleItems(metadata: Record<string, unknown>) {
  const manualRoles = normalizePersonManualRoles(metadata.manual_roles);
  const aiRoles = extractAiPersonRoles(metadata.roles);
  const dedupe = new Set<string>();

  for (const role of manualRoles) {
    dedupe.add(role.name.toLowerCase());
  }
  for (const roleName of aiRoles) {
    dedupe.add(roleName.toLowerCase());
  }

  return dedupe.size;
}
