<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  PERSON_SKILL_CUSTOM_GROUP,
  PERSON_SKILL_LIBRARY_GROUPS,
  PERSON_SKILL_LEVEL_MAX,
  PERSON_SKILL_LEVEL_MIN,
  findPersonSkillLibraryMatch,
  normalizePersonSkillName,
  type PersonManualSkillEntry,
  type PersonSkillCategory,
} from '../../utils/personSkills';

const props = defineProps<{
  open: boolean;
  selectedSkills: PersonManualSkillEntry[];
}>();

const emit = defineEmits<{
  (event: 'close'): void;
  (event: 'toggle-skill', payload: { name: string; category: PersonSkillCategory; group: string }): void;
  (event: 'set-skill-level', payload: { name: string; level: number }): void;
  (event: 'add-custom-skill', payload: { name: string; category: PersonSkillCategory; group: string }): void;
}>();

const searchQuery = ref('');
const focusedSkillName = ref('');
const customSkillCategory = ref<PersonSkillCategory>('hard');

const selectedSkillMap = computed(() => {
  const map = new Map<string, PersonManualSkillEntry>();
  for (const skill of props.selectedSkills) {
    map.set(skill.name.toLowerCase(), skill);
  }
  return map;
});

const normalizedSearchQuery = computed(() => normalizePersonSkillName(searchQuery.value));
const exactLibraryMatch = computed(() => findPersonSkillLibraryMatch(normalizedSearchQuery.value));
const canAddCustomSkill = computed(() => {
  const query = normalizedSearchQuery.value;
  if (!query) return false;
  if (exactLibraryMatch.value) return false;
  return !selectedSkillMap.value.has(query.toLowerCase());
});

const filteredGroups = computed(() => {
  const query = normalizedSearchQuery.value.toLowerCase();
  const filterGroup = (category: PersonSkillCategory) =>
    PERSON_SKILL_LIBRARY_GROUPS
      .filter((group) => group.category === category)
      .map((group) => ({
        ...group,
        skills: query
          ? group.skills.filter((skill) => {
              const normalizedSkill = normalizePersonSkillName(skill).toLowerCase();
              return normalizedSkill.includes(query) || group.label.toLowerCase().includes(query);
            })
          : group.skills,
      }))
      .filter((group) => group.skills.length > 0);

  return {
    soft: filterGroup('soft'),
    hard: filterGroup('hard'),
  };
});

const focusedSkill = computed<PersonManualSkillEntry | null>(() => {
  const normalizedName = normalizePersonSkillName(focusedSkillName.value);
  if (normalizedName) {
    const matched = selectedSkillMap.value.get(normalizedName.toLowerCase());
    if (matched) return matched;
  }
  return props.selectedSkills[0] || null;
});

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    searchQuery.value = '';
    customSkillCategory.value = 'hard';
    focusedSkillName.value = props.selectedSkills[0]?.name || '';
  },
);

watch(
  () => props.selectedSkills,
  (skills) => {
    const normalizedFocused = normalizePersonSkillName(focusedSkillName.value).toLowerCase();
    if (!skills.length) {
      focusedSkillName.value = '';
      return;
    }
    if (!normalizedFocused || !selectedSkillMap.value.has(normalizedFocused)) {
      focusedSkillName.value = skills[0]?.name || '';
    }
  },
  { deep: true },
);

function isSelected(skillName: string) {
  const normalizedName = normalizePersonSkillName(skillName);
  if (!normalizedName) return false;
  return selectedSkillMap.value.has(normalizedName.toLowerCase());
}

function closeModal() {
  emit('close');
}

function onSkillToggle(skillName: string, category: PersonSkillCategory, group: string) {
  const normalizedName = normalizePersonSkillName(skillName);
  if (!normalizedName) return;

  const wasSelected = isSelected(normalizedName);
  emit('toggle-skill', {
    name: normalizedName,
    category,
    group,
  });

  if (wasSelected) {
    if (focusedSkillName.value === normalizedName) {
      const nextFocused = props.selectedSkills.find((skill) => skill.name !== normalizedName);
      focusedSkillName.value = nextFocused?.name || '';
    }
    return;
  }

  focusedSkillName.value = normalizedName;
}

function onSelectedSkillClick(skillName: string) {
  focusedSkillName.value = normalizePersonSkillName(skillName);
}

function onLevelSelect(level: number) {
  const targetSkill = focusedSkill.value;
  if (!targetSkill) return;
  emit('set-skill-level', {
    name: targetSkill.name,
    level,
  });
}

function addCustomSkill() {
  if (!canAddCustomSkill.value) return;
  const normalizedName = normalizedSearchQuery.value;
  if (!normalizedName) return;

  emit('add-custom-skill', {
    name: normalizedName,
    category: customSkillCategory.value,
    group: PERSON_SKILL_CUSTOM_GROUP,
  });
  focusedSkillName.value = normalizedName;
  searchQuery.value = '';
}

function categoryLabel(category: PersonSkillCategory) {
  return category === 'soft' ? 'Soft skill' : 'Hard skill';
}
</script>

<template>
  <div
    v-if="open"
    class="person-skills-library-overlay"
    @click.self="closeModal"
  >
    <section
      class="person-skills-library-modal"
      @click.stop
    >
      <header class="person-skills-library-header">
        <div>
          <p class="person-skills-library-eyebrow">База навыков</p>
          <h3 class="person-skills-library-title">Навыки персоны</h3>
          <p class="person-skills-library-subtitle">
            Нажмите на чип, чтобы добавить навык в профиль. Повторный клик удаляет его.
          </p>
        </div>
        <button
          type="button"
          class="person-skills-library-close"
          aria-label="Закрыть"
          @click="closeModal"
        >
          ×
        </button>
      </header>

      <div class="person-skills-library-toolbar">
        <input
          v-model="searchQuery"
          type="search"
          class="person-skills-library-search"
          placeholder="Найти навык или добавить свой"
          @keydown.enter.prevent="addCustomSkill"
        />

        <div
          v-if="canAddCustomSkill"
          class="person-skills-library-custom"
        >
          <div class="person-skills-library-custom-switch">
            <button
              type="button"
              class="person-skills-library-custom-option"
              :class="{ active: customSkillCategory === 'soft' }"
              @click="customSkillCategory = 'soft'"
            >
              Soft
            </button>
            <button
              type="button"
              class="person-skills-library-custom-option"
              :class="{ active: customSkillCategory === 'hard' }"
              @click="customSkillCategory = 'hard'"
            >
              Hard
            </button>
          </div>

          <button
            type="button"
            class="person-skills-library-add-custom"
            @click="addCustomSkill"
          >
            Добавить "{{ normalizedSearchQuery }}"
          </button>
        </div>
      </div>

      <div class="person-skills-library-layout">
        <div class="person-skills-library-groups">
          <section class="person-skills-library-column">
            <div class="person-skills-library-column-head">
              <span class="person-skills-library-column-pill soft">Soft skills</span>
            </div>

            <div
              v-if="filteredGroups.soft.length"
              class="person-skills-library-group-list"
            >
              <section
                v-for="group in filteredGroups.soft"
                :key="group.key"
                class="person-skills-library-group"
              >
                <h4 class="person-skills-library-group-title">{{ group.label }}</h4>
                <div class="person-skills-library-chip-wrap">
                  <button
                    v-for="skill in group.skills"
                    :key="skill"
                    type="button"
                    class="person-skills-library-chip"
                    :class="{ active: isSelected(skill) }"
                    @click="onSkillToggle(skill, group.category, group.label)"
                  >
                    <span>{{ skill }}</span>
                    <span
                      v-if="isSelected(skill)"
                      class="person-skills-library-chip-level"
                    >
                      {{ selectedSkillMap.get(skill.toLowerCase())?.level }}/10
                    </span>
                  </button>
                </div>
              </section>
            </div>

            <p
              v-else
              class="person-skills-library-empty"
            >
              По запросу ничего не найдено.
            </p>
          </section>

          <section class="person-skills-library-column">
            <div class="person-skills-library-column-head">
              <span class="person-skills-library-column-pill hard">Hard skills</span>
            </div>

            <div
              v-if="filteredGroups.hard.length"
              class="person-skills-library-group-list"
            >
              <section
                v-for="group in filteredGroups.hard"
                :key="group.key"
                class="person-skills-library-group"
              >
                <h4 class="person-skills-library-group-title">{{ group.label }}</h4>
                <div class="person-skills-library-chip-wrap">
                  <button
                    v-for="skill in group.skills"
                    :key="skill"
                    type="button"
                    class="person-skills-library-chip"
                    :class="{ active: isSelected(skill) }"
                    @click="onSkillToggle(skill, group.category, group.label)"
                  >
                    <span>{{ skill }}</span>
                    <span
                      v-if="isSelected(skill)"
                      class="person-skills-library-chip-level"
                    >
                      {{ selectedSkillMap.get(skill.toLowerCase())?.level }}/10
                    </span>
                  </button>
                </div>
              </section>
            </div>

            <p
              v-else
              class="person-skills-library-empty"
            >
              По запросу ничего не найдено.
            </p>
          </section>
        </div>

        <aside class="person-skills-library-sidebar">
          <div class="person-skills-library-selected">
            <div class="person-skills-library-sidebar-head">
              <span>Выбрано</span>
              <strong>{{ selectedSkills.length }}</strong>
            </div>

            <div
              v-if="selectedSkills.length"
              class="person-skills-library-selected-list"
            >
              <button
                v-for="skill in selectedSkills"
                :key="skill.name"
                type="button"
                class="person-skills-library-selected-item"
                :class="{ focused: focusedSkill?.name === skill.name }"
                @click="onSelectedSkillClick(skill.name)"
              >
                <span class="person-skills-library-selected-main">
                  <span class="person-skills-library-selected-name">{{ skill.name }}</span>
                  <span class="person-skills-library-selected-meta">
                    {{ skill.group }} · {{ categoryLabel(skill.category) }}
                  </span>
                </span>
                <span class="person-skills-library-selected-level">{{ skill.level }}/10</span>
              </button>
            </div>

            <p
              v-else
              class="person-skills-library-empty"
            >
              Пока ничего не выбрано.
            </p>
          </div>

          <div
            v-if="focusedSkill"
            class="person-skills-library-level-panel"
          >
            <p class="person-skills-library-level-eyebrow">Уровень навыка</p>
            <h4 class="person-skills-library-level-title">{{ focusedSkill.name }}</h4>
            <p class="person-skills-library-level-meta">
              {{ focusedSkill.group }} · {{ categoryLabel(focusedSkill.category) }}
            </p>

            <div class="person-skills-library-level-grid">
              <button
                v-for="level in PERSON_SKILL_LEVEL_MAX"
                :key="level"
                type="button"
                class="person-skills-library-level-btn"
                :class="{ active: focusedSkill.level === level }"
                @click="onLevelSelect(level)"
              >
                {{ level }}
              </button>
            </div>

            <p class="person-skills-library-level-caption">
              От {{ PERSON_SKILL_LEVEL_MIN }} до {{ PERSON_SKILL_LEVEL_MAX }}.
            </p>
          </div>

          <div
            v-else
            class="person-skills-library-level-panel empty"
          >
            <p class="person-skills-library-empty">
              Выберите навык, чтобы задать уровень.
            </p>
          </div>
        </aside>
      </div>
    </section>
  </div>
</template>

<style scoped>
.person-skills-library-overlay {
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

.person-skills-library-modal {
  width: min(1080px, calc(100vw - 32px));
  max-height: min(86vh, 920px);
  border-radius: 22px;
  background: linear-gradient(180deg, #fbfdff 0%, #f4f8ff 100%);
  border: 1px solid rgba(191, 213, 255, 0.9);
  box-shadow: 0 28px 80px rgba(15, 23, 42, 0.24);
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.person-skills-library-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.person-skills-library-eyebrow {
  margin: 0 0 6px;
  color: #2563eb;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.person-skills-library-title {
  margin: 0;
  color: #0f172a;
  font-size: 24px;
  line-height: 1.05;
}

.person-skills-library-subtitle {
  margin: 8px 0 0;
  color: #475569;
  font-size: 13px;
  line-height: 1.45;
}

.person-skills-library-close {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.8);
  color: #334155;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}

.person-skills-library-toolbar {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.person-skills-library-search {
  width: 100%;
  height: 44px;
  border-radius: 14px;
  border: 1px solid #bfd5ff;
  background: rgba(255, 255, 255, 0.92);
  color: #0f172a;
  font-size: 14px;
  font-weight: 600;
  outline: none;
  padding: 0 14px;
}

.person-skills-library-search:focus {
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.16);
}

.person-skills-library-custom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.person-skills-library-custom-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border-radius: 999px;
  background: rgba(219, 234, 254, 0.84);
}

.person-skills-library-custom-option {
  border: none;
  border-radius: 999px;
  background: transparent;
  color: #475569;
  font-size: 12px;
  font-weight: 700;
  padding: 6px 10px;
  cursor: pointer;
}

.person-skills-library-custom-option.active {
  background: #1058ff;
  color: #ffffff;
}

.person-skills-library-add-custom {
  border: 1px solid #bfd5ff;
  border-radius: 999px;
  background: #ffffff;
  color: #1058ff;
  font-size: 12px;
  font-weight: 800;
  padding: 10px 14px;
  cursor: pointer;
}

.person-skills-library-layout {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(280px, 0.9fr);
  gap: 16px;
}

.person-skills-library-groups {
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.person-skills-library-column {
  min-height: 0;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(219, 228, 243, 0.9);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.person-skills-library-column-head {
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.person-skills-library-column-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.person-skills-library-column-pill.soft {
  background: rgba(14, 165, 233, 0.12);
  color: #0369a1;
}

.person-skills-library-column-pill.hard {
  background: rgba(37, 99, 235, 0.12);
  color: #1d4ed8;
}

.person-skills-library-group-list {
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-right: 4px;
}

.person-skills-library-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.person-skills-library-group-title {
  margin: 0;
  color: #334155;
  font-size: 12px;
  font-weight: 800;
}

.person-skills-library-chip-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.person-skills-library-chip {
  border: 1px solid #dbe4f3;
  border-radius: 999px;
  background: #ffffff;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
  padding: 9px 12px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  transition:
    background-color 0.14s ease,
    border-color 0.14s ease,
    color 0.14s ease,
    transform 0.14s ease;
}

.person-skills-library-chip:hover {
  transform: translateY(-1px);
  border-color: #93c5fd;
}

.person-skills-library-chip.active {
  background: #1058ff;
  border-color: #1058ff;
  color: #ffffff;
}

.person-skills-library-chip-level {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  font-size: 11px;
  padding: 3px 7px;
}

.person-skills-library-sidebar {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.person-skills-library-selected,
.person-skills-library-level-panel {
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(219, 228, 243, 0.9);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.person-skills-library-level-panel.empty {
  flex: 1;
  justify-content: center;
}

.person-skills-library-sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
}

.person-skills-library-selected-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 260px;
  overflow-y: auto;
}

.person-skills-library-selected-item {
  width: 100%;
  border: 1px solid #dbe4f3;
  border-radius: 14px;
  background: #ffffff;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  text-align: left;
  cursor: pointer;
}

.person-skills-library-selected-item.focused {
  border-color: #1058ff;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}

.person-skills-library-selected-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.person-skills-library-selected-name {
  color: #0f172a;
  font-size: 13px;
  font-weight: 800;
}

.person-skills-library-selected-meta {
  color: #64748b;
  font-size: 11px;
  line-height: 1.35;
}

.person-skills-library-selected-level {
  flex-shrink: 0;
  border-radius: 999px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 11px;
  font-weight: 800;
  padding: 5px 8px;
}

.person-skills-library-level-eyebrow {
  margin: 0;
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.person-skills-library-level-title {
  margin: 0;
  color: #0f172a;
  font-size: 18px;
  line-height: 1.1;
}

.person-skills-library-level-meta {
  margin: -2px 0 0;
  color: #64748b;
  font-size: 12px;
}

.person-skills-library-level-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.person-skills-library-level-btn {
  height: 38px;
  border: 1px solid #dbe4f3;
  border-radius: 12px;
  background: #ffffff;
  color: #334155;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.person-skills-library-level-btn.active {
  border-color: #1058ff;
  background: #1058ff;
  color: #ffffff;
}

.person-skills-library-level-caption,
.person-skills-library-empty {
  margin: 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.45;
}

@media (max-width: 940px) {
  .person-skills-library-overlay {
    padding: 12px;
  }

  .person-skills-library-modal {
    width: min(100vw - 16px, 980px);
    max-height: min(92vh, 980px);
    padding: 16px;
  }

  .person-skills-library-layout,
  .person-skills-library-groups {
    grid-template-columns: minmax(0, 1fr);
  }

  .person-skills-library-selected-list {
    max-height: 180px;
  }
}
</style>
