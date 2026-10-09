import type { LLMUsage } from '@core/ai/LLMClient';
import type { LLMProviderId } from '@shared/providers';

export interface ResolvedImage {
  mimeType: string;
  base64: string;
}

export type ProviderContent =
  | { type: 'text'; text: string }
  /** `caption` is the library's description of the picture; only the offline mock reads it. */
  | { type: 'image'; image: ResolvedImage; caption?: string };

export interface ProviderMessage {
  role: 'user' | 'assistant';
  content: ProviderContent[];
}

export interface ProviderRequest {
  system: string;
  messages: ProviderMessage[];
  maxTokens: number;
  temperature?: number;
  json?: boolean;
  effort?: 'low' | 'medium' | 'high';
  cacheImages?: boolean;
}

export interface ProviderResponse {
  text: string;
  model: string;
  usage?: LLMUsage;
}

export interface ProviderContext {
  apiKey?: string;
  model: string;
  baseUrl?: string;
  signal?: AbortSignal;
}

export interface ModelListing {
  id: string;
  label: string;
}

/** Vendor-specific code lives behind this interface; game code never sees it. */
export interface ILLMProvider {
  readonly id: LLMProviderId;
  readonly displayName: string;
  complete(ctx: ProviderContext, req: ProviderRequest): Promise<ProviderResponse>;
  /** Cheap call that proves the key works; returns the models the key can use. */
  listModels(ctx: ProviderContext): Promise<ModelListing[]>;
}

/** Thinking/reasoning models spend output tokens on reasoning, so give them headroom. */
export const REASONING_TOKEN_FLOOR = 16_000;
