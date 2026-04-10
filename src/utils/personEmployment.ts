export interface PersonEmploymentEntry {
  companyEntityId: string;
  companyName: string;
  position: string;
  current: boolean;
  primary: boolean;
}

export const PERSON_EMPLOYMENT_MAX_ITEMS = 12;
const PERSON_CUSTOM_POSITION_STORAGE_KEY = 'synapse12.personEmployment.customPositions';
export const PERSON_POSITION_LIBRARY = [
  'CEO',
  'COO',
  'CFO',
  'CTO',
  'CMO',
  'Основатель',
  'Сооснователь',
  'Собственник',
  'Управляющий',
  'Исполнительный директор',
  'Операционный директор',
  'Коммерческий директор',
  'Финансовый директор',
  'Технический директор',
  'Продакт-менеджер',
  'Проектный менеджер',
  'Руководитель отдела',
  'Team Lead',
  'Руководитель продаж',
  'Менеджер по продажам',
  'Аккаунт-менеджер',
  'Маркетолог',
  'Performance-маркетолог',
  'Бренд-менеджер',
  'Дизайнер',
  'Motion designer',
  '3D artist',
  'Разработчик',
  'Frontend developer',
  'Backend developer',
  'Fullstack developer',
  'Аналитик',
  'Бизнес-аналитик',
  'Финансист',
  'Бухгалтер',
  'HR',
  'Рекрутер',
  'Юрист',
  'Консультант',
  'Продюсер',
  'Редактор',
].sort((left, right) => left.localeCompare(right, 'ru'));

function dedupeEmploymentPositions(source: string[]) {
  const dedupe = new Set<string>();
  const result: string[] = [];

  for (const item of source) {
    const normalized = normalizePersonEmploymentPosition(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    result.push(normalized);
  }

  return result;
}

export function normalizePersonEmploymentEntityId(value: unknown) {
  if (typeof value === 'string') {
    return value.trim().slice(0, 120);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value).slice(0, 120);
  }
  if (value && typeof value === 'object' && typeof (value as { toString?: () => string }).toString === 'function') {
    const serialized = value.toString();
    return serialized && serialized !== '[object Object]' ? serialized.trim().slice(0, 120) : '';
  }
  return '';
}

export function normalizePersonEmploymentCompanyName(value: unknown) {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

export function normalizePersonEmploymentPosition(value: unknown) {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 96);
}

export function readCustomPersonEmploymentPositions() {
  if (typeof window === 'undefined') return [] as string[];

  try {
    const raw = window.localStorage.getItem(PERSON_CUSTOM_POSITION_STORAGE_KEY);
    if (!raw) return [] as string[];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [] as string[];
    return dedupeEmploymentPositions(parsed.filter((item): item is string => typeof item === 'string'));
  } catch {
    return [] as string[];
  }
}

export function writeCustomPersonEmploymentPositions(items: string[]) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(
      PERSON_CUSTOM_POSITION_STORAGE_KEY,
      JSON.stringify(dedupeEmploymentPositions(items)),
    );
  } catch {
    // Ignore localStorage write failures.
  }
}

export function listPersonEmploymentPositions() {
  return dedupeEmploymentPositions([
    ...PERSON_POSITION_LIBRARY,
    ...readCustomPersonEmploymentPositions(),
  ]).sort((left, right) => left.localeCompare(right, 'ru'));
}

export function registerCustomPersonEmploymentPosition(value: unknown) {
  const normalized = normalizePersonEmploymentPosition(value);
  if (!normalized) return '';

  const current = listPersonEmploymentPositions();
  const exists = current.some((item) => item.toLowerCase() === normalized.toLowerCase());
  if (!exists) {
    writeCustomPersonEmploymentPositions([normalized, ...readCustomPersonEmploymentPositions()]);
  }

  return normalized;
}

export function findPersonEmploymentPositionMatch(value: unknown) {
  const normalized = normalizePersonEmploymentPosition(value);
  if (!normalized) return '';
  return listPersonEmploymentPositions().find((item) => item.toLowerCase() === normalized.toLowerCase()) || '';
}

export function buildPersonEmploymentPositionSuggestions(value: unknown, limit = 10) {
  const normalized = normalizePersonEmploymentPosition(value).toLowerCase();
  const positionLibrary = listPersonEmploymentPositions();
  if (!normalized) {
    return positionLibrary.slice(0, Math.max(10, limit));
  }

  const matched = positionLibrary.filter((item) => item.toLowerCase().includes(normalized));
  if (matched.length >= limit) {
    return matched.slice(0, limit);
  }

  const matchedKeys = new Set(matched.map((item) => item.toLowerCase()));
  const supplement = positionLibrary
    .filter((item) => !matchedKeys.has(item.toLowerCase()))
    .slice(0, Math.max(0, limit - matched.length));

  return [...matched, ...supplement];
}

function buildEmploymentDedupeKey(entry: PersonEmploymentEntry) {
  const companyKey = (entry.companyEntityId || entry.companyName).trim().toLowerCase();
  const positionKey = entry.position.trim().toLowerCase();
  return `${companyKey}|${positionKey}`;
}

export function resolvePersonEmploymentEntry(value: unknown): PersonEmploymentEntry | null {
  if (typeof value === 'string') {
    const companyName = normalizePersonEmploymentCompanyName(value);
    if (!companyName) return null;
    return {
      companyEntityId: '',
      companyName,
      position: '',
      current: true,
      primary: false,
    };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const companyEntityId = normalizePersonEmploymentEntityId(record.companyEntityId);
  const companyName = normalizePersonEmploymentCompanyName(record.companyName);
  const position = findPersonEmploymentPositionMatch(record.position) || normalizePersonEmploymentPosition(record.position);

  if (!companyEntityId && !companyName && !position) {
    return null;
  }

  return {
    companyEntityId,
    companyName,
    position,
    current: record.current === true,
    primary: record.primary === true,
  };
}

export function normalizePersonEmploymentEntries(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  const dedupe = new Map<string, number>();
  const result: PersonEmploymentEntry[] = [];

  for (const item of source) {
    const normalized = resolvePersonEmploymentEntry(item);
    if (!normalized) continue;

    const key = buildEmploymentDedupeKey(normalized);
    if (!key || key === '|') continue;

    const existingIndex = dedupe.get(key);
    if (typeof existingIndex === 'number') {
      result[existingIndex] = normalized;
      continue;
    }

    dedupe.set(key, result.length);
    result.push(normalized);

    if (result.length >= PERSON_EMPLOYMENT_MAX_ITEMS) {
      break;
    }
  }

  return result;
}

export function formatPersonEmployment(entry: PersonEmploymentEntry, options: { companyNameFallback?: string } = {}) {
  const companyName = normalizePersonEmploymentCompanyName(entry.companyName || options.companyNameFallback);
  const position = normalizePersonEmploymentPosition(entry.position);
  const fragments: string[] = [];

  if (position) {
    fragments.push(position);
  }
  if (companyName) {
    fragments.push(position ? `в ${companyName}` : companyName);
  }

  if (!fragments.length) {
    return '';
  }
  return fragments.join(' ');
}

export function buildPersonEmploymentDisplayValues(
  metadata: Record<string, unknown>,
  options: {
    limit?: number;
    resolveCompanyName?: (companyEntityId: string) => string;
  } = {},
) {
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.floor(options.limit as number)) : 4;
  const entries = normalizePersonEmploymentEntries(metadata.employment);
  const result: string[] = [];

  for (const entry of entries) {
    const companyNameFallback =
      typeof options.resolveCompanyName === 'function' && entry.companyEntityId
        ? options.resolveCompanyName(entry.companyEntityId)
        : '';
    const formatted = formatPersonEmployment(entry, { companyNameFallback });
    if (!formatted) continue;
    result.push(formatted);
    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

export function countPersonEmploymentItems(metadata: Record<string, unknown>) {
  return normalizePersonEmploymentEntries(metadata.employment).length;
}
