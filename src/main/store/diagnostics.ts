import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { DiagnosticEntry, UsageCounters } from '@shared/ipc';

const MAX_ENTRIES = 500;
const MAX_LOG_BYTES = 1_000_000;
const KEY_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /sk-(?:proj-|or-)?[A-Za-z0-9_-]{16,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /r8_[A-Za-z0-9]{10,}/g,
  /xai-[A-Za-z0-9]{10,}/g,
  /Bearer\s+[A-Za-z0-9._-]{12,}/gi,
];

/** In-memory ring buffer + rotating log file. Every message is scrubbed of anything key-like. */
export class Diagnostics {
  private entries: DiagnosticEntry[] = [];
  private nextId = 1;
  private secrets: () => string[] = () => [];
  private readonly logPath: string;
  counters: UsageCounters = emptyCounters();

  constructor(userData: string) {
    this.logPath = join(userData, 'logs', 'diagnostics.log');
  }

  setSecretSource(fn: () => string[]): void {
    this.secrets = fn;
  }

  redact(text: string | undefined): string | undefined {
    if (!text) return text;
    let out = text;
    for (const s of this.secrets()) out = out.split(s).join('[redacted]');
    for (const p of KEY_PATTERNS) out = out.replace(p, '[redacted]');
    return out;
  }

  log(entry: Omit<DiagnosticEntry, 'id' | 'at'>): void {
    const full: DiagnosticEntry = {
      ...entry,
      id: this.nextId++,
      at: new Date().toISOString(),
      message: this.redact(entry.message) ?? '',
      detail: this.redact(entry.detail),
    };
    this.entries.push(full);
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    void this.writeLine(full);
  }

  list(): DiagnosticEntry[] {
    return this.entries.slice().reverse();
  }

  clear(): void {
    this.entries = [];
    this.counters = emptyCounters();
  }

  private async writeLine(e: DiagnosticEntry): Promise<void> {
    try {
      await mkdir(join(this.logPath, '..'), { recursive: true });
      const size = await stat(this.logPath).then((s) => s.size).catch(() => 0);
      if (size > MAX_LOG_BYTES) await rename(this.logPath, `${this.logPath}.1`).catch(() => undefined);
      const parts = [e.at, e.level.toUpperCase(), e.source, e.provider ?? '', e.purpose ?? '', e.message, e.detail ?? ''];
      await appendFile(this.logPath, `${parts.join(' | ')}\n`, 'utf8');
    } catch {
      // Logging must never break the game.
    }
  }
}

function emptyCounters(): UsageCounters {
  return {
    llmCalls: 0,
    llmErrors: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    imagesGenerated: 0,
    imagesFromCache: 0,
    imageErrors: 0,
  };
}
