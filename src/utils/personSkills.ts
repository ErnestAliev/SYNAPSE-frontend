export type PersonSkillCategory = 'soft' | 'hard';

export interface PersonManualSkillEntry {
  name: string;
  level: number;
  category: PersonSkillCategory;
  group: string;
}

export interface PersonSkillLibraryGroup {
  key: string;
  label: string;
  category: PersonSkillCategory;
  skills: string[];
}

export interface PersonSkillLibraryMatch {
  name: string;
  category: PersonSkillCategory;
  group: string;
}

export const PERSON_SKILL_LEVEL_MIN = 1;
export const PERSON_SKILL_LEVEL_MAX = 10;
export const PERSON_SKILL_DEFAULT_LEVEL = 5;
export const PERSON_SKILL_CUSTOM_GROUP = 'Пользовательские';

export const PERSON_SKILL_LIBRARY_GROUPS: PersonSkillLibraryGroup[] = [
  {
    key: 'soft-communication',
    label: 'Коммуникация',
    category: 'soft',
    skills: [
      'Коммуникация',
      'Переговоры',
      'Презентации',
      'Публичные выступления',
      'Активное слушание',
      'Деловая переписка',
      'Storytelling',
      'Фасилитация',
    ],
  },
  {
    key: 'soft-leadership',
    label: 'Лидерство',
    category: 'soft',
    skills: [
      'Лидерство',
      'Делегирование',
      'Менторство',
      'Коучинг',
      'People management',
      'Найм',
      'Мотивация команды',
      'Управление конфликтами',
    ],
  },
  {
    key: 'soft-thinking',
    label: 'Мышление',
    category: 'soft',
    skills: [
      'Аналитическое мышление',
      'Системное мышление',
      'Критическое мышление',
      'Стратегическое мышление',
      'Problem solving',
      'Принятие решений',
      'Приоритизация',
      'Адаптивность',
    ],
  },
  {
    key: 'soft-self-management',
    label: 'Самоорганизация',
    category: 'soft',
    skills: [
      'Тайм-менеджмент',
      'Самоорганизация',
      'Ответственность',
      'Стрессоустойчивость',
      'Дисциплина',
      'Проактивность',
      'Внимание к деталям',
      'Обучаемость',
    ],
  },
  {
    key: 'hard-product',
    label: 'Продукт и проект',
    category: 'hard',
    skills: [
      'Product management',
      'Project management',
      'Roadmap planning',
      'Discovery',
      'CustDev',
      'Scrum',
      'Agile',
      'OKR',
    ],
  },
  {
    key: 'hard-marketing-sales',
    label: 'Маркетинг и продажи',
    category: 'hard',
    skills: [
      'Performance marketing',
      'SEO',
      'SMM',
      'Контент-маркетинг',
      'Email marketing',
      'B2B продажи',
      'B2C продажи',
      'CRM',
    ],
  },
  {
    key: 'hard-development',
    label: 'Разработка',
    category: 'hard',
    skills: [
      'JavaScript',
      'TypeScript',
      'Vue.js',
      'React',
      'Node.js',
      'Python',
      'SQL',
      'API design',
      'Git',
      'DevOps',
    ],
  },
  {
    key: 'hard-analytics',
    label: 'Аналитика и данные',
    category: 'hard',
    skills: [
      'Excel',
      'Google Sheets',
      'Data analysis',
      'Power BI',
      'Tableau',
      'BI аналитика',
      'A/B testing',
      'SQL analytics',
    ],
  },
  {
    key: 'hard-design',
    label: 'Дизайн',
    category: 'hard',
    skills: [
      'Figma',
      'UI design',
      'UX research',
      'Graphic design',
      'Photoshop',
      'Illustrator',
      'Брендинг',
      'Прототипирование',
    ],
  },
  {
    key: 'hard-motion-3d',
    label: 'Видео и 3D',
    category: 'hard',
    skills: [
      'After Effects',
      'Premiere Pro',
      'DaVinci Resolve',
      'Cinema4D',
      'Blender',
      'Motion design',
      '3D modeling',
      'Rendering',
    ],
  },
  {
    key: 'hard-finance-ops',
    label: 'Финансы и операции',
    category: 'hard',
    skills: [
      'Financial modeling',
      'Budgeting',
      'Unit economics',
      'Procurement',
      'Operations management',
      'Process automation',
      'Logistics',
      'Документооборот',
    ],
  },
];

const PERSON_SKILL_INDEX = PERSON_SKILL_LIBRARY_GROUPS.reduce(
  (acc, group) => {
    for (const skill of group.skills) {
      const normalizedName = normalizePersonSkillName(skill);
      if (!normalizedName) continue;
      acc.set(normalizedName.toLowerCase(), {
        name: normalizedName,
        category: group.category,
        group: group.label,
      });
    }
    return acc;
  },
  new Map<string, PersonSkillLibraryMatch>(),
);

export function normalizePersonSkillName(value: unknown) {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 64);
}

export function normalizePersonSkillLevel(value: unknown) {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) return PERSON_SKILL_DEFAULT_LEVEL;
  return Math.max(PERSON_SKILL_LEVEL_MIN, Math.min(PERSON_SKILL_LEVEL_MAX, numeric));
}

export function normalizePersonSkillCategory(value: unknown): PersonSkillCategory {
  return value === 'soft' ? 'soft' : 'hard';
}

export function normalizePersonSkillGroup(value: unknown) {
  if (typeof value !== 'string') return PERSON_SKILL_CUSTOM_GROUP;
  const normalized = value.trim().slice(0, 48);
  return normalized || PERSON_SKILL_CUSTOM_GROUP;
}

export function findPersonSkillLibraryMatch(value: unknown): PersonSkillLibraryMatch | null {
  const normalizedName = normalizePersonSkillName(value);
  if (!normalizedName) return null;
  return PERSON_SKILL_INDEX.get(normalizedName.toLowerCase()) || null;
}

export function resolvePersonManualSkillEntry(
  value: unknown,
  options: {
    fallbackCategory?: PersonSkillCategory;
    fallbackGroup?: string;
    fallbackLevel?: number;
  } = {},
): PersonManualSkillEntry | null {
  if (typeof value === 'string') {
    const normalizedName = normalizePersonSkillName(value);
    if (!normalizedName) return null;
    const matched = findPersonSkillLibraryMatch(normalizedName);
    return {
      name: matched?.name || normalizedName,
      level: normalizePersonSkillLevel(options.fallbackLevel),
      category: matched?.category || options.fallbackCategory || 'hard',
      group: matched?.group || options.fallbackGroup || PERSON_SKILL_CUSTOM_GROUP,
    };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const normalizedName = normalizePersonSkillName(record.name);
  if (!normalizedName) return null;

  const matched = findPersonSkillLibraryMatch(normalizedName);

  return {
    name: matched?.name || normalizedName,
    level: normalizePersonSkillLevel(record.level ?? options.fallbackLevel),
    category: matched?.category || normalizePersonSkillCategory(record.category ?? options.fallbackCategory),
    group: matched?.group || normalizePersonSkillGroup(record.group ?? options.fallbackGroup),
  };
}

export function normalizePersonManualSkills(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  const dedupe = new Map<string, number>();
  const result: PersonManualSkillEntry[] = [];

  for (const item of source) {
    const normalized = resolvePersonManualSkillEntry(item);
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

export function extractAiPersonSkills(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];

  const dedupe = new Set<string>();
  const result: string[] = [];

  for (const item of value) {
    const normalized = normalizePersonSkillName(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    result.push(normalized);
  }

  return result;
}

export function formatPersonSkillWithLevel(skill: PersonManualSkillEntry) {
  return `${skill.name} ${normalizePersonSkillLevel(skill.level)}/10`;
}

export function buildPersonSkillDisplayValues(
  metadata: Record<string, unknown>,
  options: { limit?: number } = {},
) {
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.floor(options.limit as number)) : 6;
  const manualSkills = normalizePersonManualSkills(metadata.manual_skills);
  const aiSkills = extractAiPersonSkills(metadata.skills);
  const result: string[] = [];
  const dedupe = new Set<string>();

  for (const skill of manualSkills) {
    const key = skill.name.toLowerCase();
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    result.push(formatPersonSkillWithLevel(skill));
    if (result.length >= limit) return result;
  }

  for (const skillName of aiSkills) {
    const key = skillName.toLowerCase();
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    result.push(skillName);
    if (result.length >= limit) return result;
  }

  return result;
}

export function countPersonSkillItems(metadata: Record<string, unknown>) {
  const manualSkills = normalizePersonManualSkills(metadata.manual_skills);
  const aiSkills = extractAiPersonSkills(metadata.skills);
  const dedupe = new Set<string>();

  for (const skill of manualSkills) {
    dedupe.add(skill.name.toLowerCase());
  }
  for (const skillName of aiSkills) {
    dedupe.add(skillName.toLowerCase());
  }

  return dedupe.size;
}
