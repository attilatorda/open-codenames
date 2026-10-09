import { DEBUG_BUILD } from '@shared/build';
import type { LLMProviderId } from '@shared/providers';
import { AnthropicProvider } from './anthropic';
import { GoogleProvider } from './google';
import { MockLLMProvider } from './mock';
import { OpenAIProvider } from './openai';
import { OpenAICompatibleProvider } from './openaiCompatible';
import type { ILLMProvider } from './types';

export { slotSeesImages } from '@shared/providers';

/**
 * Every language-model provider. The providers only use fetch, so the web build runs the same code
 * in the browser (`browser: true`), where a local server cannot be reached.
 */
export function createLLMProviders(opts: { browser?: boolean } = {}): Map<LLMProviderId, ILLMProvider> {
  const providers = new Map<LLMProviderId, ILLMProvider>([
    ['anthropic', new AnthropicProvider({ browser: opts.browser })],
    ['openai', new OpenAIProvider()],
    ['google', new GoogleProvider()],
    [
      'openrouter',
      new OpenAICompatibleProvider({
        id: 'openrouter',
        displayName: 'OpenRouter',
        defaultBaseUrl: 'https://openrouter.ai/api/v1',
        keyCheckPath: '/key',
        extraHeaders: { 'X-OpenRouter-Title': 'Open Codenames' },
      }),
    ],
    ['xai', new OpenAICompatibleProvider({ id: 'xai', displayName: 'xAI', defaultBaseUrl: 'https://api.x.ai/v1' })],
    ['mistral', new OpenAICompatibleProvider({ id: 'mistral', displayName: 'Mistral AI', defaultBaseUrl: 'https://api.mistral.ai/v1' })],
  ]);
  if (DEBUG_BUILD) providers.set('mock', new MockLLMProvider());
  if (!opts.browser) {
    providers.set(
      'local',
      new OpenAICompatibleProvider({ id: 'local', displayName: 'Local LLM', defaultBaseUrl: 'http://localhost:11434/v1', local: true }),
    );
  }
  return providers;
}

const providers = createLLMProviders();

export function getLLMProvider(id: string): ILLMProvider | undefined {
  return providers.get(id as LLMProviderId);
}
