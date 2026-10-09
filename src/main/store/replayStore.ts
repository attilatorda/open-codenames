import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { GameRecord } from '@core/replay/GameRecord';
import type { ReplaySummary } from '@shared/ipc';
import { readJson, writeJson } from './jsonFile';

const MAX_REPLAYS = 200;

/** Finished (and abandoned) games as JSON in userData/replays — groundwork for replays and the AI Arena. */
export class ReplayStore {
  private readonly dir: string;

  constructor(userData: string) {
    this.dir = join(userData, 'replays');
  }

  async save(record: GameRecord): Promise<void> {
    if (!/^[\w-]+$/.test(record.id)) throw new Error('Invalid replay id');
    await writeJson(join(this.dir, `${record.id}.json`), record);
    await this.prune();
  }

  async load(id: string): Promise<GameRecord | null> {
    if (!/^[\w-]+$/.test(id)) return null;
    return readJson<GameRecord | null>(join(this.dir, `${id}.json`), null);
  }

  async remove(id: string): Promise<void> {
    if (!/^[\w-]+$/.test(id)) return;
    await fs.rm(join(this.dir, `${id}.json`), { force: true });
  }

  async list(): Promise<ReplaySummary[]> {
    const files = await fs.readdir(this.dir).catch(() => [] as string[]);
    const out: ReplaySummary[] = [];
    for (const f of files.filter((f) => f.endsWith('.json'))) {
      const r = await readJson<GameRecord | null>(join(this.dir, f), null);
      if (!r) continue;
      out.push({
        id: r.id,
        modeId: r.modeId,
        createdAt: r.createdAt,
        winner: r.winner,
        winReason: r.winReason,
        aborted: r.aborted,
        humanTeam: r.humanTeam,
        players: r.players.map((p) => ({ name: p.name, team: p.team, role: p.role, kind: p.kind, model: p.model })),
      });
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async prune(): Promise<void> {
    const files = await fs.readdir(this.dir).catch(() => [] as string[]);
    if (files.length <= MAX_REPLAYS) return;
    const stats = await Promise.all(
      files.map(async (f) => ({ f, t: (await fs.stat(join(this.dir, f)).catch(() => undefined))?.mtimeMs ?? 0 })),
    );
    stats.sort((a, b) => a.t - b.t);
    for (const { f } of stats.slice(0, files.length - MAX_REPLAYS)) await fs.rm(join(this.dir, f), { force: true });
  }
}
