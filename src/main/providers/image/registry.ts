import { DEBUG_BUILD } from '@shared/build';
import type { ImageProviderId } from '@shared/providers';
import { A1111Provider } from './a1111';
import { BflProvider } from './bfl';
import { GoogleImageProvider } from './googleImages';
import { MockImageProvider } from './mock';
import { OpenAIImageProvider } from './openaiImages';
import { ReplicateProvider } from './replicate';
import { StabilityProvider } from './stability';
import type { IImageGenerationProvider } from './types';

const providers = new Map<ImageProviderId, IImageGenerationProvider>([
  ['stability', new StabilityProvider()],
  ['bfl', new BflProvider()],
  ['openai', new OpenAIImageProvider()],
  ['google', new GoogleImageProvider()],
  ['replicate', new ReplicateProvider()],
  ['local-a1111', new A1111Provider()],
]);
// Placeholder art for testing the generation pipeline; debug builds only.
if (DEBUG_BUILD) providers.set('mock', new MockImageProvider());

export function getImageProvider(id: string): IImageGenerationProvider | undefined {
  return providers.get(id as ImageProviderId);
}
