<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useEntitiesStore } from '../../stores/entities';
import AppIcon from '../ui/AppIcon.vue';
import type { EntityType } from '../../types/entity';

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
  { id: 'shape', label: 'Пустые', to: '/entities/shape' },
];

const route = useRoute();
const router = useRouter();
const entitiesStore = useEntitiesStore();

function normalizeType(value: unknown): EntityType {
  const allowed: EntityType[] = [
    'project',
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
  if (route.path.startsWith('/projects')) {
    return 'project';
  }

  return normalizeType(route.params.type);
});

function goToTab(tab: TabConfig) {
  router.push(tab.to);
}
</script>

<template>
  <header class="global-header">
    <nav class="tabs-container" aria-label="Primary tabs">
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
  </header>
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
  gap: 0;
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
}
</style>
