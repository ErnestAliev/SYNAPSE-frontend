<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import AppHeader from './components/layout/AppHeader.vue';
import AgentChatDock from './components/ui/AgentChatDock.vue';
import { useEntitiesStore } from './stores/entities';
import { useAuthStore } from './stores/auth';

const entitiesStore = useEntitiesStore();
const authStore = useAuthStore();
const route = useRoute();

const showWorkspaceExtras = computed(() => {
  if (!authStore.isAuthenticated) return false;
  return route.name !== 'auth-login';
});

onMounted(async () => {
  await authStore.bootstrap();
  if (authStore.isAuthenticated) {
    await entitiesStore.bootstrap();
  }
});

watch(
  () => authStore.isAuthenticated,
  async (isAuthenticated, wasAuthenticated) => {
    if (isAuthenticated) {
      if (!entitiesStore.initialized) {
        await entitiesStore.bootstrap();
        return;
      }

      await entitiesStore.fetchEntities({ silent: true });
      return;
    }

    if (wasAuthenticated) {
      entitiesStore.items = [];
      entitiesStore.initialized = false;
      entitiesStore.error = null;
    }
  },
);
</script>

<template>
  <div class="app-shell">
    <AppHeader />

    <main class="app-content">
      <RouterView />
    </main>

    <AgentChatDock v-if="showWorkspaceExtras" />

    <button v-if="showWorkspaceExtras" class="settings-btn" aria-label="Настройки">
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
  </div>
</template>

<style scoped>
.app-shell {
  position: relative;
  height: 100vh;
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

.settings-btn {
  position: absolute;
  left: 18px;
  bottom: 18px;
  z-index: 120;
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
</style>
