import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import type { CredentialStatus, KeyStatus } from '@shared/ipc';
import { LLM_SLOT_COUNT } from '@shared/settings';
import { WriteQueue, readJson, writeJson } from './jsonFile';

/** The subset of Electron's safeStorage we use (injectable for tests). */
export interface SecretCipher {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(enc: Buffer): string;
  getSelectedStorageBackend?(): string;
}

interface StoredEntry {
  enc: string;
  hint: string;
  updatedAt: string;
}

interface StoredFile {
  version: 1;
  entries: Record<string, StoredEntry>;
}

export type CredentialKey = `llm:${number}` | 'image';

/**
 * API keys encrypted with the OS credential facility (DPAPI on Windows, Keychain on macOS,
 * libsecret/kwallet on Linux) and stored as ciphertext in userData/credentials.json.
 * If no secure facility exists, keys are kept in memory for this session only — never plaintext on disk.
 */
export class CredentialStore {
  private readonly path: string;
  private file: StoredFile = { version: 1, entries: {} };
  private readonly sessionOnly = new Map<string, string>();
  private readonly queue = new WriteQueue();

  constructor(
    userData: string,
    private readonly cipher: SecretCipher,
  ) {
    this.path = join(userData, 'credentials.json');
  }

  get backend(): string {
    try {
      return this.cipher.getSelectedStorageBackend?.() ?? (process.platform === 'win32' ? 'dpapi' : process.platform === 'darwin' ? 'keychain' : 'unknown');
    } catch {
      return 'unknown';
    }
  }

  /** Linux "basic_text" uses a hard-coded password, which is not real protection. */
  get secure(): boolean {
    return this.cipher.isEncryptionAvailable() && this.backend !== 'basic_text';
  }

  async load(): Promise<void> {
    this.file = await readJson<StoredFile>(this.path, { version: 1, entries: {} });
    if (!this.file.entries) this.file = { version: 1, entries: {} };
  }

  get(key: CredentialKey): string | undefined {
    const session = this.sessionOnly.get(key);
    if (session) return session;
    const entry = this.file.entries[key];
    if (!entry || !this.cipher.isEncryptionAvailable()) return undefined;
    try {
      return this.cipher.decryptString(Buffer.from(entry.enc, 'base64'));
    } catch {
      return undefined;
    }
  }

  /** All stored secrets, so the diagnostics log can redact them. */
  allSecrets(): string[] {
    const keys: CredentialKey[] = ['image', ...Array.from({ length: LLM_SLOT_COUNT }, (_, i) => `llm:${i}` as const)];
    return keys.map((k) => this.get(k)).filter((v): v is string => !!v && v.length >= 6);
  }

  async set(key: CredentialKey, secret: string): Promise<void> {
    const value = secret.trim();
    if (!value) return this.clear(key);
    if (!this.secure) {
      this.sessionOnly.set(key, value);
      return;
    }
    this.sessionOnly.delete(key);
    this.file.entries[key] = {
      enc: this.cipher.encryptString(value).toString('base64'),
      hint: value.slice(-4),
      updatedAt: new Date().toISOString(),
    };
    await this.persist();
  }

  async clear(key: CredentialKey): Promise<void> {
    this.sessionOnly.delete(key);
    delete this.file.entries[key];
    await this.persist();
  }

  async deleteAll(): Promise<void> {
    this.sessionOnly.clear();
    this.file = { version: 1, entries: {} };
    await this.queue.run(async () => {
      await fs.rm(this.path, { force: true });
    });
  }

  status(): CredentialStatus {
    const one = (key: CredentialKey): KeyStatus => {
      const session = this.sessionOnly.get(key);
      if (session) return { hasKey: true, hint: `…${session.slice(-4)}` };
      const entry = this.file.entries[key];
      return entry ? { hasKey: true, hint: `…${entry.hint}` } : { hasKey: false };
    };
    return {
      secureStorage: this.secure,
      persistent: this.secure,
      backend: this.backend,
      llm: Array.from({ length: LLM_SLOT_COUNT }, (_, i) => one(`llm:${i}`)),
      image: one('image'),
    };
  }

  private persist(): Promise<void> {
    return this.queue.run(() => writeJson(this.path, this.file));
  }
}
