export interface PersonEmploymentEntry {
  companyEntityId: string;
  companyName: string;
  position: string;
  current: boolean;
  primary: boolean;
}

export const PERSON_EMPLOYMENT_MAX_ITEMS = 12;

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
  const position = normalizePersonEmploymentPosition(record.position);

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

  const labels: string[] = [];
  if (entry.current) labels.push('текущее');
  if (entry.primary) labels.push('основное');

  return labels.length ? `${fragments.join(' ')} (${labels.join(', ')})` : fragments.join(' ');
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
