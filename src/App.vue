<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppHeader from './components/layout/AppHeader.vue';
import AgentChatDock from './components/ui/AgentChatDock.vue';
import { useEntitiesStore } from './stores/entities';
import { useAuthStore } from './stores/auth';
import { apiClient } from './services/api';

const entitiesStore = useEntitiesStore();
const authStore = useAuthStore();
const route = useRoute();
const router = useRouter();
const settingsMenuRef = ref<HTMLElement | null>(null);
const settingsOpen = ref(false);
const whatsappImportMonitorTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const workspaceResumeSyncTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const whatsappCompletionNotice = ref<{
  title: string;
  message: string;
  sessionId: string;
} | null>(null);
const WHATSAPP_BG_SESSION_STORAGE_KEY = 'synapse.whatsapp.background.session';

const showWorkspaceExtras = computed(() => {
  if (!authStore.isAuthenticated) return false;
  return route.name !== 'auth-login';
});

const showHeader = computed(() => route.name !== 'auth-login');

function onPointerDown(event: PointerEvent) {
  if (!settingsOpen.value) return;
  const target = event.target as Node | null;
  if (!target) return;
  if (!settingsMenuRef.value?.contains(target)) {
    settingsOpen.value = false;
  }
}

function toggleSettingsMenu() {
  settingsOpen.value = !settingsOpen.value;
}

function readTrackedWhatsappSessionId() {
  if (typeof window === 'undefined') return '';
  try {
    const raw = window.localStorage.getItem(WHATSAPP_BG_SESSION_STORAGE_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { sessionId?: unknown };
    return typeof parsed?.sessionId === 'string' ? parsed.sessionId.trim() : '';
  } catch {
    return '';
  }
}

function clearTrackedWhatsappSessionId() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(WHATSAPP_BG_SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup errors.
  }
}

function scheduleWhatsappImportMonitor(delayMs = 2200) {
  if (whatsappImportMonitorTimer.value) {
    clearTimeout(whatsappImportMonitorTimer.value);
    whatsappImportMonitorTimer.value = null;
  }
  whatsappImportMonitorTimer.value = setTimeout(() => {
    void pollWhatsappImportState();
  }, delayMs);
}

function clearWorkspaceResumeSyncTimer() {
  if (!workspaceResumeSyncTimer.value) return;
  clearTimeout(workspaceResumeSyncTimer.value);
  workspaceResumeSyncTimer.value = null;
}

function scheduleWorkspaceResumeSync(delayMs = 80) {
  clearWorkspaceResumeSyncTimer();
  if (!authStore.isAuthenticated || !entitiesStore.initialized) return;

  workspaceResumeSyncTimer.value = setTimeout(() => {
    workspaceResumeSyncTimer.value = null;
    if (!authStore.isAuthenticated || !entitiesStore.initialized) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    entitiesStore.startRealtimeSync();
    void entitiesStore.fetchEntities({ silent: true });
  }, delayMs);
}

function onDocumentVisibilityChange() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  scheduleWorkspaceResumeSync(40);
}

function onWindowResumeSync() {
  scheduleWorkspaceResumeSync(40);
}

async function pollWhatsappImportState() {
  if (!authStore.isAuthenticated) return;
  const sessionId = readTrackedWhatsappSessionId();
  if (!sessionId) return;

  try {
    const { data } = await apiClient.get<{
      session?: {
        status?: string;
        backgroundImport?: {
          state?: string;
          imported?: number;
          updatedNames?: number;
          updatedImages?: number;
        };
      };
    }>(`/integrations/whatsapp/session/${sessionId}`);
    const session = data?.session;
    const background = session?.backgroundImport || {};
    const state = typeof background.state === 'string' ? background.state.trim().toLowerCase() : '';

    if (state === 'running' || state === 'paused') {
      scheduleWhatsappImportMonitor(2200);
      return;
    }

    if (state === 'completed') {
      clearTrackedWhatsappSessionId();
      const imported = Math.max(0, Number(background.imported) || 0);
      const updatedNames = Math.max(0, Number(background.updatedNames) || 0);
      const updatedImages = Math.max(0, Number(background.updatedImages) || 0);
      whatsappCompletionNotice.value = {
        title: 'Загрузка WhatsApp завершена',
        message: `Новых: ${imported}, обновлено имен: ${updatedNames}, фото: ${updatedImages}.`,
        sessionId,
      };
      return;
    }

    if (
      state === 'stopped' ||
      state === 'error' ||
      (typeof session?.status === 'string' && session.status.trim().toLowerCase() === 'disconnected')
    ) {
      clearTrackedWhatsappSessionId();
      return;
    }

    scheduleWhatsappImportMonitor(2600);
  } catch {
    scheduleWhatsappImportMonitor(3600);
  }
}

function closeWhatsappCompletionNotice() {
  whatsappCompletionNotice.value = null;
}

async function openWhatsappConnectionsFromNotice() {
  whatsappCompletionNotice.value = null;
  await router.push('/entities/connection');
}

function updateViewportBottomOffset() {
  if (typeof window === 'undefined') return;

  const vv = window.visualViewport;
  if (!vv) {
    document.documentElement.style.setProperty('--synapse-vv-bottom-offset', '0px');
    return;
  }

  const offset = Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)));
  document.documentElement.style.setProperty('--synapse-vv-bottom-offset', `${offset}px`);
}

onMounted(async () => {
  await authStore.bootstrap();
  if (authStore.isAuthenticated) {
    await entitiesStore.bootstrap({ deferConnection: true });
    scheduleWhatsappImportMonitor(1200);
  }
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('visibilitychange', onDocumentVisibilityChange);
  window.addEventListener('resize', updateViewportBottomOffset);
  window.addEventListener('orientationchange', updateViewportBottomOffset);
  window.addEventListener('pageshow', onWindowResumeSync);
  window.addEventListener('online', onWindowResumeSync);
  window.visualViewport?.addEventListener('resize', updateViewportBottomOffset);
  window.visualViewport?.addEventListener('scroll', updateViewportBottomOffset);
  updateViewportBottomOffset();
});

onBeforeUnmount(() => {
  entitiesStore.stopRealtimeSync();
  clearWorkspaceResumeSyncTimer();
  if (whatsappImportMonitorTimer.value) {
    clearTimeout(whatsappImportMonitorTimer.value);
    whatsappImportMonitorTimer.value = null;
  }
  document.removeEventListener('pointerdown', onPointerDown);
  document.removeEventListener('visibilitychange', onDocumentVisibilityChange);
  window.removeEventListener('resize', updateViewportBottomOffset);
  window.removeEventListener('orientationchange', updateViewportBottomOffset);
  window.removeEventListener('pageshow', onWindowResumeSync);
  window.removeEventListener('online', onWindowResumeSync);
  window.visualViewport?.removeEventListener('resize', updateViewportBottomOffset);
  window.visualViewport?.removeEventListener('scroll', updateViewportBottomOffset);
  document.documentElement.style.setProperty('--synapse-vv-bottom-offset', '0px');
});

watch(
  () => authStore.isAuthenticated,
  async (isAuthenticated, wasAuthenticated) => {
    if (isAuthenticated) {
      scheduleWhatsappImportMonitor(1200);
      entitiesStore.startRealtimeSync();
      scheduleWorkspaceResumeSync(0);
      if (!entitiesStore.initialized) {
        await entitiesStore.bootstrap({ deferConnection: true });
        return;
      }

      await entitiesStore.fetchEntities({ silent: true });
      return;
    }

    if (wasAuthenticated) {
      clearWorkspaceResumeSyncTimer();
      clearTrackedWhatsappSessionId();
      whatsappCompletionNotice.value = null;
      if (whatsappImportMonitorTimer.value) {
        clearTimeout(whatsappImportMonitorTimer.value);
        whatsappImportMonitorTimer.value = null;
      }
      entitiesStore.stopRealtimeSync();
      entitiesStore.items = [];
      entitiesStore.initialized = false;
      entitiesStore.error = null;
      entitiesStore.loadedTypes = {
        project: false,
        connection: false,
        person: false,
        company: false,
        event: false,
        resource: false,
        goal: false,
        result: false,
        task: false,
        shape: false,
      };
    }
  },
);

watch(
  () => route.fullPath,
  () => {
    settingsOpen.value = false;
  },
);
</script>

<template>
  <div class="app-shell">
    <AppHeader v-if="showHeader" />

    <main class="app-content">
      <RouterView />
    </main>

    <div
      v-if="whatsappCompletionNotice"
      class="whatsapp-complete-overlay"
      @pointerdown.stop
      @touchstart.stop.prevent
      @touchend.stop.prevent
      @click.stop.prevent
      @click.self.prevent="closeWhatsappCompletionNotice"
    >
      <div class="whatsapp-complete-card" @pointerdown.stop @touchstart.stop @touchend.stop @click.stop>
        <h3 class="whatsapp-complete-title">{{ whatsappCompletionNotice.title }}</h3>
        <p class="whatsapp-complete-text">{{ whatsappCompletionNotice.message }}</p>
        <div class="whatsapp-complete-actions">
          <button type="button" class="whatsapp-complete-btn primary" @click="openWhatsappConnectionsFromNotice">
            Посмотреть
          </button>
          <button type="button" class="whatsapp-complete-btn" @click="closeWhatsappCompletionNotice">
            Позже
          </button>
        </div>
      </div>
    </div>

    <AgentChatDock v-if="showWorkspaceExtras" />

    <div v-if="showWorkspaceExtras" ref="settingsMenuRef" class="settings-wrap">
      <button class="settings-btn" aria-label="Настройки" @click="toggleSettingsMenu">
        <svg
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3"></circle>
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33
            1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51
            1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06
            a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09
            a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06
            a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01
            a1.65 1.65 0 0 0 1-.33 1.65 1.65 0 0 0 .5-1.18V3a2 2 0 1 1 4 0v.09
            a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06
            a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01
            a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09
            a1.65 1.65 0 0 0-1.51 1z"
          ></path>
        </svg>
      </button>

      <div v-if="settingsOpen" class="settings-popover">
        <div class="settings-user">{{ authStore.user?.email }}</div>
        <div class="settings-note">Настройки профиля скоро</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  position: relative;
  height: 100dvh;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.app-content > * {
  flex: 1;
  min-height: 0;
}

.settings-wrap {
  position: fixed;
  left: calc(18px + env(safe-area-inset-left, 0px));
  bottom: calc(18px + env(safe-area-inset-bottom, 0px) + var(--synapse-vv-bottom-offset, 0px));
  z-index: 120;
}

.settings-btn {
  width: 46px;
  height: 46px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: var(--shadow-base);
  transition: 0.2s ease;
}

.settings-btn:hover {
  color: var(--text-main);
  box-shadow: var(--shadow-hover);
  transform: translateY(-1px);
}

.settings-popover {
  position: absolute;
  left: 56px;
  bottom: 0;
  min-width: 220px;
  border-radius: 14px;
  border: 1px solid var(--border-color);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: var(--shadow-hover);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.settings-user {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  word-break: break-word;
}

.settings-note {
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
}

.whatsapp-complete-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.34);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 220;
  padding: 24px;
}

.whatsapp-complete-card {
  width: min(440px, 100%);
  border-radius: 16px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  box-shadow: 0 24px 48px rgba(15, 23, 42, 0.2);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.whatsapp-complete-title {
  margin: 0;
  color: #0f172a;
  font-size: 16px;
  font-weight: 800;
}

.whatsapp-complete-text {
  margin: 0;
  color: #334155;
  font-size: 13px;
  line-height: 1.45;
}

.whatsapp-complete-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.whatsapp-complete-btn {
  height: 34px;
  min-width: 86px;
  border-radius: 10px;
  border: 1px solid #bcd3ff;
  background: #edf4ff;
  color: #1058ff;
  font-size: 12px;
  font-weight: 700;
  padding: 0 12px;
  cursor: pointer;
}

.whatsapp-complete-btn.primary {
  border-color: #1058ff;
  background: #1058ff;
  color: #ffffff;
}

@media (max-width: 768px) {
  .settings-wrap {
    left: calc(10px + env(safe-area-inset-left, 0px));
    bottom: calc(14px + env(safe-area-inset-bottom, 0px) + var(--synapse-vv-bottom-offset, 0px));
  }
}
</style>
