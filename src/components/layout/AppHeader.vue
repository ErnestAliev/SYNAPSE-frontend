<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useEntitiesStore } from '../../stores/entities';
import AppIcon from '../ui/AppIcon.vue';
import GoogleSignInButton from '../auth/GoogleSignInButton.vue';
import type { EntityType } from '../../types/entity';
import { useAuthStore } from '../../stores/auth';

type TabConfig = {
  id: EntityType;
  label: string;
  to: string;
};

const tabs: TabConfig[] = [
  { id: 'project', label: 'Проекты', to: '/projects' },
  { id: 'person', label: 'Персоны', to: '/entities/person' },
  { id: 'company', label: 'Компании', to: '/entities/company' },
  { id: 'event', label: 'События', to: '/entities/event' },
  { id: 'resource', label: 'Ресурсы', to: '/entities/resource' },
  { id: 'goal', label: 'Цели', to: '/entities/goal' },
  { id: 'result', label: 'Результаты', to: '/entities/result' },
  { id: 'task', label: 'Задачи', to: '/entities/task' },
  { id: 'shape', label: 'Элементы', to: '/entities/shape' },
  { id: 'connection', label: 'Подключение', to: '/entities/connection' },
];

const route = useRoute();
const router = useRouter();
const entitiesStore = useEntitiesStore();
const authStore = useAuthStore();
const authMenuOpen = ref(false);
const authMenuRef = ref<HTMLElement | null>(null);
const showTabs = computed(() => authStore.isAuthenticated);
const isAuthPage = computed(() => route.name === 'auth-login');
const isGoogleButtonReady = computed(
  () => Boolean(authStore.googleClientId) || authStore.publicConfigLoaded,
);

function normalizeType(value: unknown): EntityType {
  const allowed: EntityType[] = [
    'project',
    'connection',
    'person',
    'company',
    'event',
    'resource',
    'goal',
    'result',
    'task',
    'shape',
  ];

  if (typeof value === 'string' && allowed.includes(value as EntityType)) {
    return value as EntityType;
  }

  return 'project';
}

const activeTab = computed<EntityType>(() => {
  if (route.path.startsWith('/projects') || route.path.startsWith('/canvas')) {
    return 'project';
  }

  return normalizeType(route.params.type);
});

function goToTab(tab: TabConfig) {
  router.push(tab.to);
}

const authDisplayName = computed(() => {
  const user = authStore.user;
  if (!user) return '';
  if (user.givenName?.trim()) return user.givenName.trim();
  if (user.name?.trim()) return user.name.trim();
  return user.email;
});

async function onGoogleCredential(credential: string) {
  try {
    await authStore.signInWithGoogleCredential(credential);

    if (!entitiesStore.initialized) {
      void entitiesStore.bootstrap();
      return;
    }

    void entitiesStore.fetchEntities({ silent: true });
  } catch {
    // Error is handled in authStore.
  }
}

function onGoogleError(message: string) {
  if (!authStore.error) {
    authStore.error = message;
  }
}

async function onSignOut() {
  authMenuOpen.value = false;
  await authStore.signOut();
  if (route.name !== 'auth-login') {
    await router.replace('/auth');
  }
}

function toggleAuthMenu() {
  authMenuOpen.value = !authMenuOpen.value;
}

function onPointerDown(event: PointerEvent) {
  if (!authMenuOpen.value) return;
  const target = event.target as Node | null;
  if (!target) return;
  if (!authMenuRef.value?.contains(target)) {
    authMenuOpen.value = false;
  }
}

onMounted(() => {
  authStore.loadPublicConfig();
  document.addEventListener('pointerdown', onPointerDown);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown);
});

watch(
  () => route.fullPath,
  () => {
    authMenuOpen.value = false;
  },
);
</script>

<template>
  <header class="global-header">
    <nav v-if="showTabs" class="tabs-container" aria-label="Primary tabs">
      <div v-for="tab in tabs" :key="tab.id" class="tab-wrapper">
        <button class="tab-btn" :class="{ active: activeTab === tab.id }" @click="goToTab(tab)">
          <AppIcon :name="tab.id" />
          {{ tab.label }}
          <span class="tab-counter" :class="{ flash: !!entitiesStore.flashStates[tab.id] }">
            {{ entitiesStore.countByType(tab.id) }}
          </span>
        </button>

        <div v-if="entitiesStore.flashStates[tab.id]" :key="String(entitiesStore.flashStates[tab.id])" class="plus-one-anim">
          +1
        </div>
      </div>
    </nav>
    <div v-else class="header-title">Synapse12</div>

    <div v-if="!isAuthPage" class="auth-panel">
      <GoogleSignInButton
        v-if="!authStore.isAuthenticated && isGoogleButtonReady"
        :client-id="authStore.googleClientId"
        :disabled="authStore.loading"
        @credential="onGoogleCredential"
        @error="onGoogleError"
      />
      <button v-else-if="!authStore.isAuthenticated" type="button" class="auth-google-loading" disabled>
        Загрузка входа...
      </button>

      <div v-else ref="authMenuRef" class="auth-user-menu">
        <button type="button" class="auth-avatar-btn" @click="toggleAuthMenu">
          <img
            v-if="authStore.user?.picture"
            class="auth-avatar"
            :src="authStore.user.picture"
            alt=""
          />
          <span v-else class="auth-avatar auth-avatar-fallback">
            {{ authDisplayName.charAt(0).toUpperCase() || 'U' }}
          </span>
        </button>

        <div v-if="authMenuOpen" class="auth-user-popover">
          <div class="auth-user-name">{{ authDisplayName }}</div>
          <div class="auth-user-email">{{ authStore.user?.email }}</div>
          <button type="button" class="auth-logout-btn" @click="onSignOut">
            Выйти из системы
          </button>
        </div>
      </div>
    </div>
  </header>
  <div v-if="authStore.error && !isAuthPage" class="auth-inline-error">{{ authStore.error }}</div>
</template>

<style scoped>
.global-header {
  height: 60px;
  background: var(--bg-header);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(226, 232, 240, 0.6);
  display: flex;
  align-items: center;
  padding: 0 24px;
  gap: 14px;
  z-index: 100;
  flex-shrink: 0;
  box-shadow: 0 2px 10px rgba(112, 144, 176, 0.05);
}

.tabs-container {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  flex: 1;
  justify-content: flex-start;
}

.tabs-container::-webkit-scrollbar {
  display: none;
}

.header-title {
  flex: 1;
  min-width: 0;
  font-size: 16px;
  font-weight: 800;
  color: #0f172a;
}

.tab-wrapper {
  position: relative;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 20px;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s;
  white-space: nowrap;
}

.tab-btn:hover {
  color: var(--text-main);
  background: rgba(0, 0, 0, 0.03);
}

.tab-btn.active {
  color: var(--primary);
  background: var(--primary-soft);
  font-weight: 600;
}

.tab-counter {
  background: #e2e8f0;
  color: var(--text-muted);
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  transition: all 0.3s;
}

.tab-btn.active .tab-counter {
  background: var(--primary);
  color: #fff;
}

.tab-counter.flash {
  animation: pulseFlash 0.6s ease-out forwards;
  background: var(--success);
  color: #fff;
}

.plus-one-anim {
  position: absolute;
  top: -10px;
  right: 10px;
  color: var(--success);
  font-weight: 700;
  font-size: 14px;
  animation: floatUp 0.8s forwards;
  pointer-events: none;
}

.auth-panel {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 36px;
}

.auth-user-menu {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.auth-avatar-btn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: 0.18s ease;
}

.auth-avatar-btn:hover {
  border-color: #bfd5ff;
  box-shadow: 0 4px 10px rgba(16, 88, 255, 0.16);
}

.auth-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid #dbe4f3;
  background: #fff;
}

.auth-avatar-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
  background: #e2e8f0;
  width: 30px;
  height: 30px;
  border-radius: 50%;
}

.auth-user-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 220px;
  border-radius: 12px;
  border: 1px solid #dbe4f3;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.16);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 130;
}

.auth-user-name {
  color: #0f172a;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.3;
}

.auth-user-email {
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
  word-break: break-word;
}

.auth-logout-btn {
  height: 34px;
  border: 1px solid #dbe4f3;
  border-radius: 10px;
  background: #ffffff;
  color: #475569;
  font-size: 13px;
  font-weight: 700;
  padding: 0 12px;
  cursor: pointer;
  transition: all 0.18s ease;
  margin-top: 2px;
}

.auth-logout-btn:hover {
  color: #1058ff;
  border-color: #bfd5ff;
  background: #eef4ff;
}

.auth-google-loading {
  height: 36px;
  min-width: 190px;
  border-radius: 999px;
  border: 1px solid #dbe4f3;
  background: #f8fafc;
  color: #94a3b8;
  font-size: 12px;
  font-weight: 700;
  padding: 0 12px;
  cursor: not-allowed;
}

.auth-inline-error {
  padding: 4px 24px 0;
  color: #b91c1c;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@keyframes pulseFlash {
  0% {
    transform: scale(1);
    background: #e2e8f0;
  }

  50% {
    transform: scale(1.3);
    background: var(--success);
    color: #fff;
    box-shadow: 0 0 10px rgba(16, 185, 129, 0.4);
  }

  100% {
    transform: scale(1);
  }
}

@keyframes floatUp {
  0% {
    opacity: 1;
    transform: translateY(0);
  }

  100% {
    opacity: 0;
    transform: translateY(-20px);
  }
}

@media (max-width: 980px) {
  .global-header {
    padding: 0 12px;
  }

  .auth-panel {
    min-width: 36px;
  }

  .auth-user-popover {
    right: -6px;
  }
}
</style>
