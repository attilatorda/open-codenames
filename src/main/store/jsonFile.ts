import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

/** Read JSON, returning `fallback` if the file is missing or corrupt. */
export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Atomic-ish write: write a temp file, then rename over the target. */
export async function writeJson(path: string, data: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, path);
}

/** Serialize async writes to the same file. */
export class WriteQueue {
  private chain: Promise<unknown> = Promise.resolve();
  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task);
    this.chain = next.catch(() => undefined);
    return next;
  }
}
