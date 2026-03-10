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

export interface EntityLinkPreviewPayload {
  entityId: string;
  url: string;
}

export interface EntityLinkPreviewResponse {
  sourceUrl: string;
  finalUrl: string;
  hostname: string;
  siteLabel: string;
  sourceKind: string;
  title: string;
  description: string;
  textSnippet: string;
  preparedText: string;
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
  console.log('[AI] analyzeEntityWithAi → request', {
    entityId: payload.entityId,
    message: payload.message?.slice(0, 120),
    historyLen: payload.history?.length ?? 0,
  });
  try {
    const { data } = await apiClient.post<EntityAiAnalyzeResult>('/ai/entity-analyze', payload, {
      timeout: 150_000,
    });
    console.log('[AI] analyzeEntityWithAi → response', {
      status: (data as EntityAiAnalyzeProcessingResponse).status ?? 'full',
      hasReply: 'reply' in data,
      reply: 'reply' in data ? (data as EntityAiAnalyzeResponse).reply?.slice(0, 120) : null,
      suggestion: 'suggestion' in data ? (data as EntityAiAnalyzeResponse).suggestion : null,
    });
    return data;
  } catch (err) {
    console.error('[AI] analyzeEntityWithAi → ERROR', err);
    throw err;
  }
}

export async function prepareEntityLinkPreview(payload: EntityLinkPreviewPayload) {
  const { data } = await apiClient.post<EntityLinkPreviewResponse>('/ai/entity-link-preview', payload, {
    timeout: 30_000,
  });
  return data;
}
