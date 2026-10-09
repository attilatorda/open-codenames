import { join } from 'node:path';
import { type DeepPartial, type Settings, SETTINGS_VERSION, defaultSettings, mergeSettings } from '@shared/settings';
import { WriteQueue, readJson, writeJson } from './jsonFile';

/** Non-secret preferences in userData/settings.json. API keys never go here. */
export class SettingsStore {
  private settings: Settings = defaultSettings();
  private readonly queue = new WriteQueue();
  private readonly path: string;

  constructor(userData: string) {
    this.path = join(userData, 'settings.json');
  }

  async load(): Promise<Settings> {
    const stored = await readJson<DeepPartial<Settings> | null>(this.path, null);
    this.settings = mergeSettings(defaultSettings(), stored ?? undefined);
    if (stored && (stored.version ?? 1) < 2) {
      // The standard deck replaced placeholder/folder boards as the default picture source.
      this.settings.image.source = 'deck';
      if (this.settings.image.provider === 'mock') this.settings.image = { ...this.settings.image, provider: 'none', model: '' };
      this.settings.version = SETTINGS_VERSION;
      await this.queue.run(() => writeJson(this.path, this.settings));
    }
    return this.get();
  }

  get(): Settings {
    return structuredClone(this.settings);
  }

  async update(patch: DeepPartial<Settings>): Promise<Settings> {
    this.settings = mergeSettings(this.settings, patch);
    await this.queue.run(() => writeJson(this.path, this.settings));
    return this.get();
  }

  async reset(): Promise<Settings> {
    // Keep the disclaimer acceptance and the AI configuration; reset preferences only.
    const keep = { disclaimerAcceptedVersion: this.settings.disclaimerAcceptedVersion, setupComplete: this.settings.setupComplete, llmSlots: this.settings.llmSlots, image: this.settings.image };
    this.settings = mergeSettings(defaultSettings(), keep);
    await this.queue.run(() => writeJson(this.path, this.settings));
    return this.get();
  }
}
