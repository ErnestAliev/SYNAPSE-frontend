import { apiClient } from './api';

export type EntityAiRole = 'user' | 'assistant';

export interface EntityAiChatMessage {
  role: EntityAiRole;
  text: string;
}

export interface EntityAiAttachmentPayload {
  name: string;
  mime: string;
  size: number;
  data?: string;
  text?: string;
}

export interface EntityAiSuggestion {
  status: 'ready' | 'need_clarification';
  description: string;
  changeType?: 'initial' | 'addition' | 'update';
  changeReason?: string;
  fields: Record<string, string[]>;
  importanceSignal?: 'increase' | 'decrease' | 'neutral';
  importanceReason?: string;
  clarifyingQuestions: string[];
  ignoredNoise: string[];
  confidence: Record<string, number>;
}

export interface EntityAiAnalyzePayload {
  entityId: string;
  message: string;
  voiceInput?: string;
  history?: EntityAiChatMessage[];
  attachments?: EntityAiAttachmentPayload[];
  documents?: EntityAiAttachmentPayload[];
  debug?: boolean;
}

export interface EntityAiAnalyzeResponse {
  reply: string;
  suggestion: EntityAiSuggestion;
  model?: string;
  usage?: unknown;
  vector?: {
    id: string;
    model: string;
    dimensions: number;
    updatedAt?: string;
  } | null;
  vectorWarning?: string;
  debug?: Record<string, unknown>;
}

export async function analyzeEntityWithAi(payload: EntityAiAnalyzePayload) {
  const { data } = await apiClient.post<EntityAiAnalyzeResponse>('/ai/entity-analyze', payload, {
    timeout: 90_000,
  });
  return data;
}

export interface EntityQuizOption {
  id: string;
  text: string;
}

export interface EntityQuizStepState {
  facts: Record<string, unknown>;
  missing: string[];
  confidence: number;
}

export interface EntityQuizDraftUpdate {
  description: string;
  fieldsPatch: Record<string, string[]>;
}

export interface EntityQuizStepPayload {
  entityId: string;
  action: 'start' | 'answer';
  client_event_id?: string;
  questionId?: string;
  input?: {
    activeQuestion?: {
      questionId?: string;
    };
  };
  answerText?: string;
  optionId?: string;
  debug?: boolean;
}

export interface EntityQuizStepResponse {
  mode: 'quiz_step' | 'quiz_stop_check' | 'quiz_completed';
  quizMode?: 'standard' | 'my';
  myScenario?: string;
  /** Stable unique ID for this quiz run. Same value for every question in the
   *  same run; changes when the quiz is restarted. Used as primary dedup key:
   *  (quizRunId, questionId) uniquely identifies a question in a run. */
  quizRunId?: string;
  entityType: string;
  questionId: string;
  questionText: string;
  options: EntityQuizOption[];
  expects?: { type?: string };
  state: EntityQuizStepState;
  draftUpdate: EntityQuizDraftUpdate;
  stopCheck?: Record<string, unknown> | null;
  orchestrator?: {
    activeQuestionId?: string;
    answeredQuestionIds?: string[];
    answers?: Record<string, unknown>;
    stepIndex?: number;
  };
  model?: string;
  usage?: unknown;
  resumed?: boolean;
  debug?: Record<string, unknown>;
}

export async function entityQuizStep(payload: EntityQuizStepPayload) {
  const { data } = await apiClient.post<EntityQuizStepResponse>('/ai/entity-quiz-step', payload, {
    timeout: 90_000,
  });
  return data;
}
