import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CredentialStore, type SecretCipher } from '../src/main/store/CredentialStore';
import { Diagnostics } from '../src/main/store/diagnostics';

/** Stand-in for Electron safeStorage: reversible, but never stores the plaintext. */
const fakeCipher = (available = true, backend = 'dpapi'): SecretCipher => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(`ENC:${[...s].reverse().join('')}`),
  decryptString: (b) => [...b.toString().slice(4)].reverse().join(''),
  getSelectedStorageBackend: () => backend,
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'oc-cred-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('credential store', () => {
  it('round-trips keys and never writes plaintext', async () => {
    const store = new CredentialStore(dir, fakeCipher());
    await store.load();
    await store.set('llm:0', 'sk-ant-SECRET-1234');
    await store.set('image', 'r8_IMAGESECRET9999');
    expect(store.get('llm:0')).toBe('sk-ant-SECRET-1234');
    const raw = await readFile(join(dir, 'credentials.json'), 'utf8');
    expect(raw).not.toContain('SECRET');
    const status = store.status();
    expect(status.llm[0]).toEqual({ hasKey: true, hint: '…1234' });
    expect(status.llm[1]).toEqual({ hasKey: false });
    expect(status.image.hint).toBe('…9999');
    expect(status.persistent).toBe(true);

    const reloaded = new CredentialStore(dir, fakeCipher());
    await reloaded.load();
    expect(reloaded.get('image')).toBe('r8_IMAGESECRET9999');
  });

  it('deletes everything', async () => {
    const store = new CredentialStore(dir, fakeCipher());
    await store.load();
    await store.set('llm:2', 'key-abcdef');
    await store.deleteAll();
    expect(store.get('llm:2')).toBeUndefined();
    expect(existsSync(join(dir, 'credentials.json'))).toBe(false);
  });

  it('keeps keys in memory only when no secure storage exists', async () => {
    for (const cipher of [fakeCipher(false), fakeCipher(true, 'basic_text')]) {
      const store = new CredentialStore(dir, cipher);
      await store.load();
      await store.set('llm:0', 'sk-session-only');
      expect(store.get('llm:0')).toBe('sk-session-only');
      expect(store.status().persistent).toBe(false);
      expect(existsSync(join(dir, 'credentials.json'))).toBe(false);
    }
  });
});

describe('diagnostics redaction', () => {
  it('scrubs configured secrets and key-like strings', () => {
    const d = new Diagnostics(dir);
    d.setSecretSource(() => ['my-custom-secret-value']);
    d.log({ level: 'error', source: 'llm', message: 'failed with my-custom-secret-value', detail: 'Authorization: Bearer abcdefghijklmnop sk-proj-ABCDEFGHIJKLMNOPQRST AIzaSyA1234567890abcdefghij' });
    const [e] = d.list();
    expect(e.message).toBe('failed with [redacted]');
    expect(e.detail).not.toMatch(/abcdefghijklmnop|ABCDEFGHIJKLMNOP|AIzaSy/);
  });
});
