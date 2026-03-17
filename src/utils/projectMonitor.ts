export const PROJECT_CHAT_MONITOR_UPDATED_EVENT = 'synapse12:project-chat-monitor-updated';

const PROJECT_CHAT_MONITOR_STORAGE_PREFIX = 'synapse12.project-chat-monitor.v1:';
const PROJECT_CHAT_MONITOR_MAX_ENTRIES = 6;

export interface ProjectChatMonitorEntry {
  id: string;
  createdAt: string;
  projectId: string;
  scope: Record<string, unknown>;
  request: {
    message: string;
    history: Array<{ role: string; text: string }>;
    attachments: Array<Record<string, unknown>>;
  };
  response: {
    reply: string;
    model: string;
  };
  debug: {
    scope: Record<string, unknown>;
    input: Record<string, unknown>;
    semanticRouter: Record<string, unknown>;
    prompts: Record<string, unknown>;
    directContextChat: Record<string, unknown>;
    response: Record<string, unknown>;
  };
}

function buildProjectChatMonitorStorageKey(projectId: string) {
  return `${PROJECT_CHAT_MONITOR_STORAGE_PREFIX}${String(projectId || '').trim()}`;
}

function emitProjectChatMonitorUpdated(projectId: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PROJECT_CHAT_MONITOR_UPDATED_EVENT, {
    detail: {
      projectId: String(projectId || '').trim(),
    },
  }));
}

export function readProjectChatMonitorEntries(projectId: string): ProjectChatMonitorEntry[] {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId || typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(buildProjectChatMonitorStorageKey(normalizedProjectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeProjectChatMonitorEntries(projectId: string, entries: ProjectChatMonitorEntry[]) {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId || typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(
      buildProjectChatMonitorStorageKey(normalizedProjectId),
      JSON.stringify(Array.isArray(entries) ? entries.slice(0, PROJECT_CHAT_MONITOR_MAX_ENTRIES) : []),
    );
  } catch {
    return;
  }

  emitProjectChatMonitorUpdated(normalizedProjectId);
}

export function appendProjectChatMonitorEntry(projectId: string, entry: ProjectChatMonitorEntry) {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) return;

  const current = readProjectChatMonitorEntries(normalizedProjectId);
  const next = [entry, ...current]
    .filter((item) => item && typeof item === 'object')
    .slice(0, PROJECT_CHAT_MONITOR_MAX_ENTRIES);

  writeProjectChatMonitorEntries(normalizedProjectId, next);
}
