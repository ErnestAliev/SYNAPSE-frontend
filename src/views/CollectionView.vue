<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useEntitiesStore } from '../stores/entities';
import AppIcon from '../components/ui/AppIcon.vue';
import FilterDropdown from '../components/ui/FilterDropdown.vue';
import type { Entity, EntityType } from '../types/entity';

const props = defineProps<{
  type?: string;
}>();

const entitiesStore = useEntitiesStore();
const router = useRouter();

const FILTERS = {
  roles: ['Все роли', 'Основатель', 'Инвестор', 'Разработчик', 'Руководитель', 'Подрядчик'],
  interests: ['Все интересы', 'Власть', 'Финансы', 'Путешествия', 'Технологии', 'Искусство'],
  skills: ['Все навыки', 'Переговоры', 'Программирование', 'Маркетинг', 'Аналитика'],
  tags: ['Все теги', 'Рисковый', 'Коммуникабельный', 'VIP', 'Скрытный'],
  importance: ['Любая важность', 'Критично', 'Высокая', 'Средняя', 'Низкая'],
} as const;

const searchQuery = ref('');
const collectionViewRef = ref<HTMLElement | null>(null);
const selectedTag = ref(FILTERS.tags[0]);
const selectedRole = ref(FILTERS.roles[0]);
const selectedInterest = ref(FILTERS.interests[0]);
const selectedSkill = ref(FILTERS.skills[0]);
const selectedImportance = ref(FILTERS.importance[0]);

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

const activeType = computed<EntityType>(() => normalizeType(props.type));

const typedEntities = computed(() => entitiesStore.byType(activeType.value));

const filteredEntities = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();

  return typedEntities.value.filter((entity) => {
    if (!q) {
      return true;
    }

    return entity.name.toLowerCase().includes(q);
  });
});

const firstEntity = computed<Entity | null>(() => {
  const entities = filteredEntities.value;
  if (!entities.length) {
    return null;
  }

  const preferredId = entitiesStore.lastCreatedIdByType[activeType.value];
  if (!preferredId) {
    return entities[0]!;
  }

  return entities.find((entity) => entity._id === preferredId) || entities[0]!;
});

const remainingEntities = computed(() => {
  const first = firstEntity.value;

  if (!first) {
    return [] as Entity[];
  }

  return filteredEntities.value.filter((entity) => entity._id !== first._id);
});

onMounted(async () => {
  if (!entitiesStore.initialized) {
    await entitiesStore.bootstrap();
  }
});

async function createEntity() {
  const nextEntityNumber = entitiesStore.countByType(activeType.value) + 1;
  const payload: {
    type: EntityType;
    name: string;
    profile: Record<string, unknown>;
    ai_metadata: Record<string, unknown>;
    canvas_data?: { nodes: []; edges: [] };
  } = {
    type: activeType.value,
    name:
      activeType.value === 'project'
        ? `Новый проект ${nextEntityNumber}`
        : `Новый узел ${nextEntityNumber}`,
    profile: {},
    ai_metadata: {},
  };

  if (activeType.value === 'project') {
    payload.canvas_data = { nodes: [], edges: [] };
  }

  await entitiesStore.createEntity(payload);

  // Keep the just-created card visible near "Создать".
  searchQuery.value = '';
  await nextTick();
  collectionViewRef.value?.scrollTo({ top: 0, behavior: 'auto' });
}

function onCardClick(entity: Entity) {
  if (entity.type !== 'project') return;

  router.push({ name: 'project-canvas', params: { id: entity._id } });
}
</script>

<template>
  <main class="workspace">
    <div class="tools-header">
      <div class="search-bar">
        <AppIcon name="search" />
        <input v-model="searchQuery" type="search" placeholder="Поиск..." />
      </div>

      <div class="filters-group">
        <FilterDropdown v-model="selectedTag" :options="FILTERS.tags" />
        <FilterDropdown v-model="selectedRole" :options="FILTERS.roles" />
        <FilterDropdown v-model="selectedInterest" :options="FILTERS.interests" />
        <FilterDropdown v-model="selectedSkill" :options="FILTERS.skills" />
        <FilterDropdown v-model="selectedImportance" :options="FILTERS.importance" />
      </div>
    </div>

    <section ref="collectionViewRef" class="collection-view">
      <div v-if="entitiesStore.loading" class="state">Загрузка...</div>
      <div v-else-if="entitiesStore.error" class="state state-error">{{ entitiesStore.error }}</div>
      <div v-else class="grid-layout">
        <button class="create-card" @click="createEntity">
          <AppIcon name="plus" />
          <span class="create-card-label">Создать</span>
        </button>

        <template v-if="firstEntity">
          <button
            v-if="activeType === 'project'"
            class="project-card"
            @click="onCardClick(firstEntity)"
          >
            <div class="project-thumbnail"></div>
            <div class="project-info">
              <span class="project-name">{{ firstEntity.name }}</span>
            </div>
          </button>

          <button
            v-else
            class="entity-card"
            @click="onCardClick(firstEntity)"
          >
            <div class="card-cycle">
              <AppIcon :name="activeType" />
            </div>
            <div class="card-name">{{ firstEntity.name }}</div>
          </button>
        </template>

        <template v-for="entity in remainingEntities" :key="entity._id">
          <button
            v-if="activeType === 'project'"
            class="project-card"
            @click="onCardClick(entity)"
          >
            <div class="project-thumbnail"></div>
            <div class="project-info">
              <span class="project-name">{{ entity.name }}</span>
            </div>
          </button>

          <button
            v-else
            class="entity-card"
            @click="onCardClick(entity)"
          >
            <div class="card-cycle">
              <AppIcon :name="activeType" />
            </div>
            <div class="card-name">{{ entity.name }}</div>
          </button>
        </template>
      </div>
    </section>
  </main>
</template>

<style scoped>
.workspace {
  height: 100%;
  min-height: 0;
  flex: 1;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.tools-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 32px;
  background: var(--bg-header);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(226, 232, 240, 0.8);
  z-index: 90;
  flex-wrap: nowrap;
  overflow-x: auto;
  flex-shrink: 0;
}

.tools-header::-webkit-scrollbar {
  display: none;
}

.search-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-card);
  border: 1px solid transparent;
  padding: 6px 12px;
  border-radius: 20px;
  min-width: 220px;
  width: 220px;
  color: var(--text-muted);
  transition: 0.2s;
  box-shadow: var(--shadow-base);
  flex-shrink: 0;
}

.search-bar:focus-within {
  box-shadow: 0 0 0 2px var(--primary-soft), var(--shadow-base);
}

.search-bar input {
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  color: var(--text-main);
  width: 100%;
}

.search-bar input::placeholder {
  color: var(--text-muted);
}

.filters-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
}

.collection-view {
  min-height: 0;
  padding: 8px 32px 40px;
  overflow-y: auto;
  flex: 1;
}

.grid-layout {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 24px;
}

.create-card {
  background: var(--bg-card);
  border: 2px dashed #cbd5e1;
  border-radius: var(--radius-lg);
  min-height: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  cursor: pointer;
  transition: all 0.2s;
  gap: 12px;
}

.create-card:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: #fff;
}

.create-card-label {
  font-weight: 600;
}

.entity-card {
  background: #e6effc;
  border: 1px solid #d2e1fb;
  border-radius: var(--radius-lg);
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  min-height: 180px;
  position: relative;
  box-shadow: var(--shadow-base);
}

.entity-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-hover);
}

.card-cycle {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: var(--bg-app);
  border: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  margin-bottom: 16px;
}

.card-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-main);
  text-align: center;
}

.project-card {
  background: #e6effc;
  border: 1px solid #d2e1fb;
  border-radius: var(--radius-lg);
  overflow: hidden;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  height: 180px;
  box-shadow: var(--shadow-base);
}

.project-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-hover);
}

.project-thumbnail {
  flex: 1;
  background: #e6effc;
  background-image: radial-gradient(rgba(148, 163, 184, 0.45) 1px, transparent 1px);
  background-size: 16px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 12px;
  border-bottom: 1px solid var(--border-color);
}

.project-info {
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.project-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-main);
  text-align: center;
}

.state {
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-md);
  padding: 18px;
  background: #fff;
  color: var(--text-muted);
}

.state-error {
  color: #dc2626;
}

@media (max-width: 900px) {
  .tools-header {
    padding: 12px;
    gap: 10px;
  }

  .collection-view {
    padding: 8px 12px 24px;
  }
}
</style>
