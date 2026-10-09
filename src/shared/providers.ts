// Provider catalog shown in the AI Configuration dropdowns. Data only: no secrets, no network code.
// Model lists are suggestions; "Test connection" replaces them with what the key can actually use.

import type { SlotInfo } from './ipc';
import type { LLMSlotConfig } from './settings';

export type LLMProviderId =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'openrouter'
  | 'xai'
  | 'mistral'
  | 'local'
  | 'mock';

export type ImageProviderId = 'stability' | 'openai' | 'google' | 'bfl' | 'replicate' | 'local-a1111' | 'mock';

export interface ModelOption {
  id: string;
  label: string;
}

export interface LLMProviderInfo {
  id: LLMProviderId;
  /** Company / service name shown in the dropdown. */
  name: string;
  keyRequired: boolean;
  keyPlaceholder: string;
  keyUrl?: string;
  defaultModel: string;
  models: ModelOption[];
  defaultBaseUrl?: string;
  baseUrlEditable: boolean;
  /** Can this provider's models look at images? 'model' = depends on the model. Players must see the pictures. */
  vision: 'yes' | 'no' | 'model';
  note?: string;
  devOnly?: boolean;
}

export interface ImageProviderInfo {
  id: ImageProviderId;
  name: string;
  keyRequired: boolean;
  keyPlaceholder: string;
  keyUrl?: string;
  defaultModel: string;
  models: ModelOption[];
  defaultBaseUrl?: string;
  baseUrlEditable: boolean;
  note?: string;
  devOnly?: boolean;
}

export const LLM_PROVIDERS: readonly LLMProviderInfo[] = [
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    keyRequired: true,
    keyPlaceholder: 'sk-ant-…',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-opus-5-5',
    models: [
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
      { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
    ],
    baseUrlEditable: false,
    vision: 'yes',
  },
  {
    id: 'openai',
    name: 'OpenAI (GPT)',
    keyRequired: true,
    keyPlaceholder: 'sk-…',
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-6.1-sol',
    models: [
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
      { id: 'gpt-6-astra', label: 'GPT-6 Astra' },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
    ],
    baseUrlEditable: false,
    vision: 'yes',
  },
  {
    id: 'google',
    name: 'Google (Gemini)',
    keyRequired: true,
    keyPlaceholder: 'AIza…',
    keyUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-3.8-flash',
    models: [
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
    ],
    baseUrlEditable: false,
    vision: 'yes',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter (many models)',
    keyRequired: true,
    keyPlaceholder: 'sk-or-…',
    keyUrl: 'https://openrouter.ai/keys',
    defaultModel: 'openrouter/auto',
    models: [{ id: 'openrouter/auto', label: 'Auto (OpenRouter picks)' }],
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    baseUrlEditable: false,
    vision: 'model',
    note: 'Test the connection to load the full model list. Pick a vision model so it can see the pictures.',
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    keyRequired: true,
    keyPlaceholder: 'xai-…',
    keyUrl: 'https://console.x.ai',
    defaultModel: '',
    models: [],
    defaultBaseUrl: 'https://api.x.ai/v1',
    baseUrlEditable: false,
    vision: 'model',
    note: 'Test the connection to load the available Grok models.',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    keyRequired: true,
    keyPlaceholder: 'Mistral API key',
    keyUrl: 'https://console.mistral.ai/api-keys',
    defaultModel: 'mistral-medium-latest',
    models: [
      { id: 'mistral-medium-latest', label: 'Mistral Medium (latest)' },
      { id: 'mistral-large-latest', label: 'Mistral Large (latest)' },
    ],
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    baseUrlEditable: false,
    vision: 'model',
  },
  {
    id: 'local',
    name: 'Local LLM (Ollama, LM Studio…)',
    keyRequired: false,
    keyPlaceholder: 'Optional',
    defaultModel: '',
    models: [],
    defaultBaseUrl: 'http://localhost:11434/v1',
    baseUrlEditable: true,
    vision: 'model',
    note: 'Any OpenAI-compatible server. Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1',
  },
  {
    id: 'mock',
    name: 'Mock AI (offline, developer)',
    keyRequired: false,
    keyPlaceholder: 'Not needed',
    defaultModel: 'mock-brain',
    models: [{ id: 'mock-brain', label: 'Mock brain' }],
    baseUrlEditable: false,
    vision: 'yes',
    devOnly: true,
  },
];

export const IMAGE_PROVIDERS: readonly ImageProviderInfo[] = [
  {
    id: 'stability',
    name: 'Stability AI (Stable Diffusion)',
    keyRequired: true,
    keyPlaceholder: 'sk-…',
    keyUrl: 'https://platform.stability.ai/account/keys',
    defaultModel: 'core',
    models: [
      { id: 'core', label: 'Stable Image Core' },
      { id: 'sd3.5-flash', label: 'Stable Diffusion 3.5 Flash' },
      { id: 'sd3.5-medium', label: 'Stable Diffusion 3.5 Medium' },
      { id: 'sd3.5-large-turbo', label: 'Stable Diffusion 3.5 Large Turbo' },
      { id: 'sd3.5-large', label: 'Stable Diffusion 3.5 Large' },
      { id: 'ultra', label: 'Stable Image Ultra' },
    ],
    baseUrlEditable: false,
  },
  {
    id: 'bfl',
    name: 'Black Forest Labs (FLUX)',
    keyRequired: true,
    keyPlaceholder: 'BFL API key',
    keyUrl: 'https://dashboard.bfl.ai',
    defaultModel: 'flux-2-pro',
    models: [
      { id: 'flux-2-pro', label: 'FLUX.2 [pro]' },
      { id: 'flux-2-flex', label: 'FLUX.2 [flex]' },
      { id: 'flux-2-max', label: 'FLUX.2 [max]' },
    ],
    baseUrlEditable: false,
  },
  {
    id: 'openai',
    name: 'OpenAI (GPT Image)',
    keyRequired: true,
    keyPlaceholder: 'sk-…',
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-image-2.5-flare',
    models: [
      { id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare (fast)' },
      { id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst (best)' },
    ],
    baseUrlEditable: false,
  },
  {
    id: 'google',
    name: 'Google (Nano Banana)',
    keyRequired: true,
    keyPlaceholder: 'AIza…',
    keyUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-nano-banana-2.1',
    models: [
      { id: 'gemini-nano-banana-2.1', label: 'Nano Banana 2.1' },
      { id: 'gemini-3.1-flash-lite-image', label: 'Nano Banana 2 Lite (fastest)' },
      { id: 'gemini-3.1-flash-image', label: 'Nano Banana 2' },
    ],
    baseUrlEditable: false,
  },
  {
    id: 'replicate',
    name: 'Replicate (FLUX and more)',
    keyRequired: true,
    keyPlaceholder: 'r8_…',
    keyUrl: 'https://replicate.com/account/api-tokens',
    defaultModel: 'black-forest-labs/flux-schnell',
    models: [
      { id: 'black-forest-labs/flux-schnell', label: 'FLUX schnell (fast, cheap)' },
      { id: 'black-forest-labs/flux-2-pro', label: 'FLUX.2 [pro]' },
    ],
    baseUrlEditable: false,
    note: 'Any Replicate text-to-image model that accepts prompt / aspect_ratio / output_format.',
  },
  {
    id: 'local-a1111',
    name: 'Local Stable Diffusion (A1111 / Forge)',
    keyRequired: false,
    keyPlaceholder: 'Not needed',
    defaultModel: 'default',
    models: [{ id: 'default', label: 'Model loaded in the web UI' }],
    defaultBaseUrl: 'http://127.0.0.1:7860',
    baseUrlEditable: true,
    note: 'Start the web UI with --api.',
  },
  {
    id: 'mock',
    name: 'Mock images (offline, developer)',
    keyRequired: false,
    keyPlaceholder: 'Not needed',
    defaultModel: 'placeholder',
    models: [{ id: 'placeholder', label: 'Placeholder art' }],
    baseUrlEditable: false,
    devOnly: true,
  },
];

export function llmProviderInfo(id: string): LLMProviderInfo | undefined {
  return LLM_PROVIDERS.find((p) => p.id === id);
}

export function imageProviderInfo(id: string): ImageProviderInfo | undefined {
  return IMAGE_PROVIDERS.find((p) => p.id === id);
}

export function displayModel(providerId: string, model: string): string {
  const p = llmProviderInfo(providerId);
  return p?.models.find((m) => m.id === model)?.label ?? model;
}

/** Whether the slot's model can see pictures. Only models that can are allowed to play. */
export function slotSeesImages(slot: Pick<LLMSlotConfig, 'provider' | 'model' | 'vision'>): boolean {
  if (slot.vision === 'on') return true;
  if (slot.vision === 'off') return false;
  const info = llmProviderInfo(slot.provider);
  if (!info) return false;
  if (info.vision === 'yes') return true;
  if (info.vision === 'no') return false;
  // Provider-dependent: guess from well-known vision model names.
  return /vision|vl\b|-vl|llava|pixtral|gpt-4o|gpt-[5-9]|claude|gemini|grok-[2-9]|mistral-(medium|large|small)|gemma-?3|qwen.*vl|llama-?4|openrouter\/auto/i.test(slot.model);
}

/** What the UI needs to know about one LLM slot. Players read pictures, so a slot is only ready with a vision model. */
export function describeSlot(slot: LLMSlotConfig, index: number, hasKey: boolean, allowed: (id: LLMProviderId) => boolean): SlotInfo {
  const info = llmProviderInfo(slot.provider);
  const model = slot.model || info?.defaultModel || '';
  const vision = slotSeesImages({ ...slot, model });
  return {
    slot: index,
    ready: !!(slot.enabled && info && allowed(info.id) && model && vision && (!info.keyRequired || hasKey)),
    provider: slot.provider,
    providerName: info?.name ?? '',
    model,
    modelLabel: info ? displayModel(info.id, model) : model,
    vision,
  };
}
