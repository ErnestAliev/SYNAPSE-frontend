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

function createReadyPromptSet(questions: string[]): EntityVoicePromptSet {
  return {
    mode: 'ready',
    badge: `${questions.length} вопросов`,
    questions,
  };
}

export const ENTITY_VOICE_PROMPT_SETS: Record<EntityType, EntityVoicePromptSet> = {
  person: createReadyPromptSet([
      'Что у него или у неё нового?',
      'Где он или она работает, чем занимается?',
      'Что у него или у неё в планах?',
      'Твоё личное впечатление о нём или о ней.',
      'Хочешь что-то добавить?',
    ]),
  project: createPlannedPromptSet('Проект'),
  connection: createPlannedPromptSet('Подключение'),
  company: createReadyPromptSet([
    'Что нового у компании?',
    'Чем компания занимается?',
    'На чём компания зарабатывает?',
    'Какое у тебя впечатление о компании?',
    'Хочешь что-то добавить?',
  ]),
  event: createReadyPromptSet([
    'Что это за событие?',
    'Что произошло?',
    'Когда это было или будет?',
    'Какое у тебя впечатление об этом событии?',
    'Хочешь что-то добавить?',
  ]),
  resource: createReadyPromptSet([
    'Что это за ресурс?',
    'Для чего он нужен?',
    'Как он используется?',
    'Какое у тебя впечатление об этом ресурсе?',
    'Хочешь что-то добавить?',
  ]),
  goal: createReadyPromptSet([
    'Что это за цель?',
    'Зачем она нужна?',
    'К чему хочется прийти?',
    'Какое у тебя впечатление об этой цели?',
    'Хочешь что-то добавить?',
  ]),
  result: createReadyPromptSet([
    'Что это за результат?',
    'Что в итоге получилось?',
    'Это хороший результат или нет?',
    'Какое у тебя впечатление от результата?',
    'Хочешь что-то добавить?',
  ]),
  task: createReadyPromptSet([
    'Что это за задача?',
    'Что нужно сделать?',
    'Для чего это нужно?',
    'Какое у тебя впечатление от этой задачи?',
    'Хочешь что-то добавить?',
  ]),
  shape: {
    mode: 'ready',
    badge: 'Свободный блок',
    questions: [
      'Используй этот блок как свободный контекст: сюда можно вынести любую мысль, пояснение, дополнительное описание, расшифровку, связь, ситуацию, причину, последствие или просто отдельный кусок смысла, который не хочется смешивать с основной карточкой.',
    ],
  },
};

export function getEntityVoicePromptSet(type: EntityType): EntityVoicePromptSet {
  return ENTITY_VOICE_PROMPT_SETS[type] || ENTITY_VOICE_PROMPT_SETS.shape;
}
