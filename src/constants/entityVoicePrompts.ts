import type { EntityType } from '../types/entity';

export interface EntityVoicePromptSet {
  mode: 'ready' | 'planned';
  badge: string;
  questions: string[];
}

function createPlannedPromptSet(label: string): EntityVoicePromptSet {
  return {
    mode: 'planned',
    badge: `${label}: скоро`,
    questions: ['Наводящие голосовые вопросы для этого типа сущности будут добавлены позже.'],
  };
}

export const ENTITY_VOICE_PROMPT_SETS: Record<EntityType, EntityVoicePromptSet> = {
  person: {
    mode: 'ready',
    badge: '5 вопросов',
    questions: [
      'Что у него или у неё нового?',
      'Где он или она работает, чем занимается?',
      'Что у него или у неё в планах?',
      'Твоё личное впечатление о нём или о ней.',
      'Хочешь что-то добавить?',
    ],
  },
  project: createPlannedPromptSet('Проект'),
  connection: createPlannedPromptSet('Подключение'),
  company: createPlannedPromptSet('Компания'),
  event: createPlannedPromptSet('Событие'),
  resource: createPlannedPromptSet('Ресурс'),
  goal: createPlannedPromptSet('Цель'),
  result: createPlannedPromptSet('Результат'),
  task: createPlannedPromptSet('Задача'),
  shape: createPlannedPromptSet('Элемент'),
};

export function getEntityVoicePromptSet(type: EntityType): EntityVoicePromptSet {
  return ENTITY_VOICE_PROMPT_SETS[type] || ENTITY_VOICE_PROMPT_SETS.shape;
}
