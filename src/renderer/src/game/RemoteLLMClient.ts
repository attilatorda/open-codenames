import { LLMClientError, type LLMClient, type LLMRequest, type LLMResponse } from '@core/ai/LLMClient';

let counter = 0;

/** LLMClient backed by the main process. The renderer never holds an API key. */
export class RemoteLLMClient implements LLMClient {
  async complete(request: LLMRequest, signal?: AbortSignal): Promise<LLMResponse> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const id = `r${Date.now().toString(36)}${(counter++).toString(36)}`;
    const onAbort = () => void window.oc.llm.cancel(id);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await window.oc.llm.complete(id, request);
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!res.ok) throw new LLMClientError(res.error.message, res.error.kind, res.error.detail);
      return res.data;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }
}
