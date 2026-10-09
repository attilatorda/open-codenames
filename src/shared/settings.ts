import type { ClueSizeMode } from '@core/ai/strategy/clueSize';
import type { Role } from '@core/types';
import type { ImageProviderId, LLMProviderId } from './providers';

/** Bump when the disclaimer text changes materially; players must accept again. */
export const DISCLAIMER_VERSION = 1;
export const LLM_SLOT_COUNT = 4;
/** v2: boards are dealt from the built-in standard deck by default. */
export const SETTINGS_VERSION = 2;

export interface ConnectionTest {
  ok: boolean;
  at: string;
  message: string;
}

export interface LLMSlotConfig {
  enabled: boolean;
  provider: LLMProviderId | '';
  model: string;
  baseUrl?: string;
  /** Whether the model can see pictures; 'auto' follows the provider catalog. Models that cannot see pictures cannot play. */
  vision: 'auto' | 'on' | 'off';
  lastTest?: ConnectionTest;
  /** Models discovered by the last successful test. */
  discoveredModels?: { id: string; label: string }[];
}

export interface ImageSettings {
  provider: ImageProviderId | 'none';
  model: string;
  baseUrl?: string;
  quality: 'low' | 'medium' | 'high';
  /** Personal picture folder (used when there is no image key, or always if preferred). */
  folder?: string;
  /** 'deck' = built-in standard deck; 'generate' needs an image provider; 'library' = folder + earlier generated images. */
  source: 'deck' | 'generate' | 'library';
  /** The standard collection boards are dealt from (when source is 'deck'). */
  deckId: string;
  reuseCache: boolean;
  lastTest?: ConnectionTest;
}

export type HumanRoleSetting = Role | 'alternate';

export interface GameplaySettings {
  layoutId: string;
  styleId: string;
  /** Which subject bank new boards draw from. */
  conceptSet: 'surreal' | 'scenes';
  humanRole: HumanRoleSetting;
  lastHumanRole?: Role;
  /** The clue size last picked in a game; preselected the next time your AI teammate gives a clue. */
  clueSize: ClueSizeMode;
  /** -0.5 (cautious AIs) … +0.5 (bold AIs). */
  riskBias: number;
  pace: 'relaxed' | 'normal' | 'fast';
}

export interface Settings {
  version: number;
  disclaimerAcceptedVersion: number | null;
  setupComplete: boolean;
  llmSlots: LLMSlotConfig[];
  image: ImageSettings;
  gameplay: GameplaySettings;
  audio: { volume: number; muted: boolean };
  display: { fullscreen: boolean; reduceMotion: boolean };
}

export function emptySlot(): LLMSlotConfig {
  return { enabled: false, provider: '', model: '', vision: 'auto' };
}

export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    disclaimerAcceptedVersion: null,
    setupComplete: false,
    llmSlots: Array.from({ length: LLM_SLOT_COUNT }, emptySlot),
    image: { provider: 'none', model: '', quality: 'low', source: 'deck', deckId: 'grandville', reuseCache: true },
    gameplay: {
      layoutId: '4x5',
      styleId: 'ink',
      conceptSet: 'surreal',
      humanRole: 'alternate',
      clueSize: 'auto',
      riskBias: 0,
      pace: 'normal',
    },
    audio: { volume: 0.7, muted: false },
    display: { fullscreen: false, reduceMotion: false },
  };
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

/** Merge stored settings over defaults so new fields get sensible values after updates. */
export function mergeSettings(base: Settings, patch: DeepPartial<Settings> | undefined): Settings {
  if (!patch) return base;
  const out = structuredClone(base) as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const current = out[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && current && typeof current === 'object' && !Array.isArray(current)) {
      out[k] = { ...(current as object), ...(v as object) };
    } else {
      out[k] = v;
    }
  }
  const merged = out as unknown as Settings;
  // Always keep exactly LLM_SLOT_COUNT slots.
  merged.llmSlots = Array.from({ length: LLM_SLOT_COUNT }, (_, i) => ({ ...emptySlot(), ...(merged.llmSlots?.[i] ?? {}) }));
  return merged;
}
