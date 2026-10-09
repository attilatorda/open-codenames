// The only way AI players talk to a language model. The renderer implements this over IPC
// (keys stay in the main process); tests implement it with scripted fakes.

export type LLMContentPart =
  | { type: 'text'; text: string }
  /** Resolved to a small thumbnail by whoever implements the client. */
  | { type: 'image'; imageId: string };

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: LLMContentPart[];
}

export interface LLMRequest {
  /** Which configured LLM slot (0–3) to use. */
  slot: number;
  system: string;
  messages: LLMMessage[];
  maxTokens: number;
  temperature?: number;
  /** Ask the provider for JSON output where supported. */
  json?: boolean;
  /** Reasoning depth hint for models that support it (mapped per provider). */
  effort?: 'low' | 'medium' | 'high';
  /** Hint: content up to and including the last image is stable across calls (prompt caching). */
  cacheImages?: boolean;
  /** Short label for the diagnostics log, e.g. "spymaster:A". */
  purpose?: string;
}

export interface LLMUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}

export interface LLMResponse {
  text: string;
  model: string;
  usage?: LLMUsage;
  latencyMs?: number;
}

export interface LLMClient {
  complete(request: LLMRequest, signal?: AbortSignal): Promise<LLMResponse>;
}

/** Thrown by LLMClient implementations; `friendly` is safe to show in the main UI. */
export class LLMClientError extends Error {
  constructor(
    readonly friendly: string,
    readonly kind: string,
    readonly detail?: string,
  ) {
    super(friendly);
    this.name = 'LLMClientError';
  }
}
