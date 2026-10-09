import { mockBrainReply } from '@core/ai/mockBrain';
import type { LLMRequest } from '@core/ai/LLMClient';
import type { ILLMProvider, ModelListing, ProviderContext, ProviderRequest, ProviderResponse } from './types';

/** Offline stand-in for a language model; debug builds only. */
export class MockLLMProvider implements ILLMProvider {
  readonly id = 'mock' as const;
  readonly displayName = 'Mock AI';

  async complete(ctx: ProviderContext, req: ProviderRequest): Promise<ProviderResponse> {
    await new Promise((r) => setTimeout(r, 250 + Math.random() * 500));
    if (ctx.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const asCore: LLMRequest = {
      slot: 0,
      system: req.system,
      maxTokens: req.maxTokens,
      messages: req.messages.map((m) => ({
        role: m.role,
        // The mock cannot look at pictures, so it reads their library descriptions instead.
        content: m.content.map((p) => (p.type === 'text' ? p : { type: 'text' as const, text: p.caption ?? '(no description available)' })),
      })),
    };
    return { text: mockBrainReply(asCore), model: 'mock-brain', usage: { inputTokens: 0, outputTokens: 0 } };
  }

  async listModels(_ctx: ProviderContext): Promise<ModelListing[]> {
    return [{ id: 'mock-brain', label: 'Mock brain' }];
  }
}
