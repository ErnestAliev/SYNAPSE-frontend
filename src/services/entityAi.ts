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
}

export interface EntityAiSuggestion {
  status: 'ready' | 'need_clarification';
  description: string;
  fields: Record<string, string[]>;
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
