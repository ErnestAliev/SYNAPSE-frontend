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

export interface EntityAiAnalyzeProcessingResponse {
  status: 'processing';
  message?: string;
}

export type EntityAiAnalyzeResult = EntityAiAnalyzeResponse | EntityAiAnalyzeProcessingResponse;

export function isEntityAiProcessingResponse(
  response: EntityAiAnalyzeResult,
): response is EntityAiAnalyzeProcessingResponse {
  return Boolean(response && 'status' in response && response.status === 'processing');
}

export async function analyzeEntityWithAi(payload: EntityAiAnalyzePayload) {
  const { data } = await apiClient.post<EntityAiAnalyzeResult>('/ai/entity-analyze', payload, {
    timeout: 150_000,
  });
  return data;
}
