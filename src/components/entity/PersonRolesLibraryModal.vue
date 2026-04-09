<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  PERSON_ROLE_CUSTOM_GROUP,
  PERSON_ROLE_LIBRARY_GROUPS,
  findPersonRoleLibraryMatch,
  normalizePersonRoleName,
  type PersonManualRoleEntry,
  type PersonRoleCategory,
} from '../../utils/personRoles';

const props = defineProps<{
  open: boolean;
  selectedRoles: PersonManualRoleEntry[];
}>();

const emit = defineEmits<{
  (event: 'close'): void;
  (event: 'toggle-role', payload: { name: string; category: PersonRoleCategory; group: string }): void;
  (event: 'add-custom-role', payload: { name: string; category: PersonRoleCategory; group: string }): void;
}>();

const searchQuery = ref('');
const customRoleCategory = ref<PersonRoleCategory>('professional');

const selectedRoleMap = computed(() => {
  const map = new Map<string, PersonManualRoleEntry>();
  for (const role of props.selectedRoles) {
    map.set(role.name.toLowerCase(), role);
  }
  return map;
});

const normalizedSearchQuery = computed(() => normalizePersonRoleName(searchQuery.value));
const exactLibraryMatch = computed(() => findPersonRoleLibraryMatch(normalizedSearchQuery.value));
const canAddCustomRole = computed(() => {
  const query = normalizedSearchQuery.value;
  if (!query) return false;
  if (exactLibraryMatch.value) return false;
  return !selectedRoleMap.value.has(query.toLowerCase());
});

const filteredGroups = computed(() => {
  const query = normalizedSearchQuery.value.toLowerCase();
  const filterGroup = (category: PersonRoleCategory) =>
    PERSON_ROLE_LIBRARY_GROUPS
      .filter((group) => group.category === category)
      .map((group) => ({
        ...group,
        roles: query
          ? group.roles.filter((role) => {
              const normalizedRole = normalizePersonRoleName(role).toLowerCase();
              return normalizedRole.includes(query) || group.label.toLowerCase().includes(query);
            })
          : group.roles,
      }))
      .filter((group) => group.roles.length > 0);

  return {
    personal: filterGroup('personal'),
    professional: filterGroup('professional'),
  };
});

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    searchQuery.value = '';
    customRoleCategory.value = 'professional';
  },
);

function isSelected(roleName: string) {
  const normalizedName = normalizePersonRoleName(roleName);
  if (!normalizedName) return false;
  return selectedRoleMap.value.has(normalizedName.toLowerCase());
}

function closeModal() {
  emit('close');
}

function onRoleToggle(roleName: string, category: PersonRoleCategory, group: string) {
  const normalizedName = normalizePersonRoleName(roleName);
  if (!normalizedName) return;

  emit('toggle-role', {
    name: normalizedName,
    category,
    group,
  });
}

function addCustomRole() {
  if (!canAddCustomRole.value) return;
  const normalizedName = normalizedSearchQuery.value;
  if (!normalizedName) return;

  emit('add-custom-role', {
    name: normalizedName,
    category: customRoleCategory.value,
    group: PERSON_ROLE_CUSTOM_GROUP,
  });
  searchQuery.value = '';
}

function categoryLabel(category: PersonRoleCategory) {
  return category === 'personal' ? 'Личная роль' : 'Профессиональная роль';
}
</script>

<template>
  <div
    v-if="open"
    class="person-roles-library-overlay"
    @click.self="closeModal"
  >
    <section
      class="person-roles-library-modal"
      @click.stop
    >
      <header class="person-roles-library-header">
        <div>
          <p class="person-roles-library-eyebrow">База ролей</p>
          <h3 class="person-roles-library-title">Роли персоны</h3>
          <p class="person-roles-library-subtitle">
            Нажмите на чип, чтобы добавить роль в профиль. Повторный клик удаляет её.
          </p>
        </div>
        <button
          type="button"
          class="person-roles-library-close"
          aria-label="Закрыть"
          @click="closeModal"
        >
          ×
        </button>
      </header>

      <div class="person-roles-library-toolbar">
        <input
          v-model="searchQuery"
          type="search"
          class="person-roles-library-search"
          placeholder="Найти роль или добавить свою"
          @keydown.enter.prevent="addCustomRole"
        />

        <div
          v-if="canAddCustomRole"
          class="person-roles-library-custom"
        >
          <div class="person-roles-library-custom-switch">
            <button
              type="button"
              class="person-roles-library-custom-option"
              :class="{ active: customRoleCategory === 'personal' }"
              @click="customRoleCategory = 'personal'"
            >
              Личное
            </button>
            <button
              type="button"
              class="person-roles-library-custom-option"
              :class="{ active: customRoleCategory === 'professional' }"
              @click="customRoleCategory = 'professional'"
            >
              Проф.
            </button>
          </div>

          <button
            type="button"
            class="person-roles-library-add-custom"
            @click="addCustomRole"
          >
            Добавить "{{ normalizedSearchQuery }}"
          </button>
        </div>
      </div>

      <div class="person-roles-library-layout">
        <div class="person-roles-library-groups">
          <section class="person-roles-library-column">
            <div class="person-roles-library-column-head">
              <span class="person-roles-library-column-pill personal">Личные роли</span>
            </div>

            <div
              v-if="filteredGroups.personal.length"
              class="person-roles-library-group-list"
            >
              <section
                v-for="group in filteredGroups.personal"
                :key="group.key"
                class="person-roles-library-group"
              >
                <h4 class="person-roles-library-group-title">{{ group.label }}</h4>
                <div class="person-roles-library-chip-wrap">
                  <button
                    v-for="role in group.roles"
                    :key="role"
                    type="button"
                    class="person-roles-library-chip"
                    :class="{ active: isSelected(role) }"
                    @click="onRoleToggle(role, group.category, group.label)"
                  >
                    {{ role }}
                  </button>
                </div>
              </section>
            </div>

            <p
              v-else
              class="person-roles-library-empty"
            >
              По запросу ничего не найдено.
            </p>
          </section>

          <section class="person-roles-library-column">
            <div class="person-roles-library-column-head">
              <span class="person-roles-library-column-pill professional">Профессиональные роли</span>
            </div>

            <div
              v-if="filteredGroups.professional.length"
              class="person-roles-library-group-list"
            >
              <section
                v-for="group in filteredGroups.professional"
                :key="group.key"
                class="person-roles-library-group"
              >
                <h4 class="person-roles-library-group-title">{{ group.label }}</h4>
                <div class="person-roles-library-chip-wrap">
                  <button
                    v-for="role in group.roles"
                    :key="role"
                    type="button"
                    class="person-roles-library-chip"
                    :class="{ active: isSelected(role) }"
                    @click="onRoleToggle(role, group.category, group.label)"
                  >
                    {{ role }}
                  </button>
                </div>
              </section>
            </div>

            <p
              v-else
              class="person-roles-library-empty"
            >
              По запросу ничего не найдено.
            </p>
          </section>
        </div>

        <aside class="person-roles-library-sidebar">
          <div class="person-roles-library-selected">
            <div class="person-roles-library-sidebar-head">
              <span>Выбрано</span>
              <strong>{{ selectedRoles.length }}</strong>
            </div>

            <div
              v-if="selectedRoles.length"
              class="person-roles-library-selected-list"
            >
              <div
                v-for="role in selectedRoles"
                :key="role.name"
                class="person-roles-library-selected-item"
              >
                <span class="person-roles-library-selected-name">{{ role.name }}</span>
                <span class="person-roles-library-selected-meta">
                  {{ role.group }} · {{ categoryLabel(role.category) }}
                </span>
              </div>
            </div>

            <p
              v-else
              class="person-roles-library-empty"
            >
              Пока ничего не выбрано.
            </p>
          </div>
        </aside>
      </div>
    </section>
  </div>
</template>

<style scoped>
.person-roles-library-overlay {
  position: fixed;
  inset: 0;
  z-index: 1300;
  background: rgba(15, 23, 42, 0.34);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.person-roles-library-modal {
  width: min(1160px, calc(100vw - 40px));
  max-height: min(88vh, 920px);
  overflow: hidden;
  border-radius: 28px;
  border: 1px solid rgba(191, 213, 255, 0.9);
  background: linear-gradient(180deg, #f8fbff 0%, #eef5ff 100%);
  box-shadow: 0 28px 80px rgba(15, 23, 42, 0.26);
  display: flex;
  flex-direction: column;
}

.person-roles-library-header {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  padding: 24px 28px 18px;
  border-bottom: 1px solid rgba(191, 213, 255, 0.9);
}

.person-roles-library-eyebrow {
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #4f6b95;
}

.person-roles-library-title {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  color: #16325c;
}

.person-roles-library-subtitle {
  margin: 8px 0 0;
  max-width: 720px;
  font-size: 14px;
  line-height: 1.5;
  color: #56708f;
}

.person-roles-library-close {
  width: 38px;
  height: 38px;
  border: 0;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.9);
  color: #5f7090;
  font-size: 24px;
  cursor: pointer;
}

.person-roles-library-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 28px 0;
  flex-wrap: wrap;
}

.person-roles-library-search {
  flex: 1 1 360px;
  min-width: 260px;
  height: 46px;
  border-radius: 16px;
  border: 1px solid rgba(173, 195, 230, 0.96);
  background: rgba(255, 255, 255, 0.94);
  padding: 0 16px;
  font-size: 15px;
  color: #17325d;
}

.person-roles-library-search:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.16);
}

.person-roles-library-custom {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.person-roles-library-custom-switch {
  display: inline-flex;
  align-items: center;
  padding: 4px;
  border-radius: 999px;
  background: rgba(213, 227, 248, 0.95);
}

.person-roles-library-custom-option {
  border: 0;
  background: transparent;
  color: #5b6e8a;
  border-radius: 999px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.person-roles-library-custom-option.active {
  background: #ffffff;
  color: #16325c;
  box-shadow: 0 8px 18px rgba(59, 130, 246, 0.16);
}

.person-roles-library-add-custom {
  border: 0;
  border-radius: 14px;
  background: #1058ff;
  color: #ffffff;
  padding: 11px 16px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.person-roles-library-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 18px;
  padding: 20px 28px 28px;
  min-height: 0;
  flex: 1;
}

.person-roles-library-groups {
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.person-roles-library-column,
.person-roles-library-sidebar {
  min-height: 0;
}

.person-roles-library-column {
  display: flex;
  flex-direction: column;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(202, 217, 240, 0.95);
  overflow: hidden;
}

.person-roles-library-column-head {
  padding: 16px 18px 0;
}

.person-roles-library-column-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.person-roles-library-column-pill.personal {
  background: rgba(251, 191, 36, 0.18);
  color: #9a6400;
}

.person-roles-library-column-pill.professional {
  background: rgba(59, 130, 246, 0.14);
  color: #1d4ed8;
}

.person-roles-library-group-list {
  min-height: 0;
  overflow: auto;
  padding: 12px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.person-roles-library-group-title {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 700;
  color: #24456f;
}

.person-roles-library-chip-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.person-roles-library-chip {
  border: 1px solid rgba(182, 201, 231, 0.95);
  border-radius: 999px;
  background: #ffffff;
  color: #2c4e79;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;
}

.person-roles-library-chip:hover {
  transform: translateY(-1px);
  border-color: #93b5ec;
}

.person-roles-library-chip.active {
  border-color: #1058ff;
  background: linear-gradient(180deg, #eef4ff 0%, #dbeafe 100%);
  color: #0f4bd7;
}

.person-roles-library-sidebar {
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(202, 217, 240, 0.95);
  padding: 18px;
  overflow: auto;
}

.person-roles-library-sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  color: #24456f;
  font-size: 14px;
  font-weight: 700;
}

.person-roles-library-selected-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.person-roles-library-selected-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 16px;
  background: #f5f9ff;
  border: 1px solid rgba(210, 222, 242, 0.95);
}

.person-roles-library-selected-name {
  color: #16325c;
  font-size: 14px;
  font-weight: 700;
}

.person-roles-library-selected-meta {
  color: #64748b;
  font-size: 12px;
  line-height: 1.4;
}

.person-roles-library-empty {
  margin: 0;
  color: #70849e;
  font-size: 13px;
  line-height: 1.5;
}

@media (max-width: 960px) {
  .person-roles-library-layout,
  .person-roles-library-groups {
    grid-template-columns: 1fr;
  }

  .person-roles-library-modal {
    width: min(100vw - 16px, 1160px);
    max-height: min(94vh, 980px);
  }

  .person-roles-library-overlay {
    padding: 8px;
  }
}
</style>
