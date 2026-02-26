<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import AppHeader from './components/layout/AppHeader.vue';
import AgentChatDock from './components/ui/AgentChatDock.vue';
import { useEntitiesStore } from './stores/entities';
import { useAuthStore } from './stores/auth';

const entitiesStore = useEntitiesStore();
const authStore = useAuthStore();
const route = useRoute();
const settingsMenuRef = ref<HTMLElement | null>(null);
const settingsOpen = ref(false);

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
  }
  document.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('resize', updateViewportBottomOffset);
  window.addEventListener('orientationchange', updateViewportBottomOffset);
  window.visualViewport?.addEventListener('resize', updateViewportBottomOffset);
  window.visualViewport?.addEventListener('scroll', updateViewportBottomOffset);
  updateViewportBottomOffset();
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown);
  window.removeEventListener('resize', updateViewportBottomOffset);
  window.removeEventListener('orientationchange', updateViewportBottomOffset);
  window.visualViewport?.removeEventListener('resize', updateViewportBottomOffset);
  window.visualViewport?.removeEventListener('scroll', updateViewportBottomOffset);
  document.documentElement.style.setProperty('--synapse-vv-bottom-offset', '0px');
});

watch(
  () => authStore.isAuthenticated,
  async (isAuthenticated, wasAuthenticated) => {
    if (isAuthenticated) {
      if (!entitiesStore.initialized) {
        await entitiesStore.bootstrap({ deferConnection: true });
        return;
      }

      await entitiesStore.fetchEntities({ silent: true });
      return;
    }

    if (wasAuthenticated) {
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

@media (max-width: 768px) {
  .settings-wrap {
    left: calc(10px + env(safe-area-inset-left, 0px));
    bottom: calc(14px + env(safe-area-inset-bottom, 0px) + var(--synapse-vv-bottom-offset, 0px));
  }
}
</style>
