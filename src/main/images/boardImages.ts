import type { ImageJob, ImageJobResult, ImageProgress } from '@shared/ipc';
import { CONCEPT_BANK } from '@core/board/conceptBank';
import { buildImagePrompt, getStyle, negativePromptFor } from '@core/images/promptBuilder';
import { ProviderError } from '../providers/errors';
import type { IImageGenerationProvider, ImageContext } from '../providers/image/types';
import type { Diagnostics } from '../store/diagnostics';
import { ImageLibrary } from './ImageLibrary';

export interface BoardImageOptions {
  jobs: ImageJob[];
  provider: IImageGenerationProvider;
  ctx: Omit<ImageContext, 'signal'>;
  library: ImageLibrary;
  diagnostics: Diagnostics;
  reuseCache: boolean;
  mock: boolean;
  signal: AbortSignal;
  onProgress: (p: Omit<ImageProgress, 'batchId'>) => void;
  concurrency?: number;
}

const FATAL: ReadonlySet<string> = new Set(['auth', 'quota', 'not_configured', 'not_found', 'bad_request', 'aborted']);
const MAX_RETRIES = 2;
const MAX_SWAPS = 2;

/**
 * Generate (or fetch from cache) every picture on a board, a few at a time.
 * Transient failures are retried, moderated prompts get a new concept, and account-level
 * problems (bad key, no credits) stop the whole batch immediately.
 */
export async function generateBoardImages(opts: BoardImageOptions): Promise<ImageJobResult[]> {
  const { jobs, library, diagnostics } = opts;
  const internal = new AbortController();
  const signal = AbortSignal.any([opts.signal, internal.signal]);
  const used = new Set(jobs.map((j) => j.concept));
  const results = new Map<number, ImageJobResult>();
  let done = 0;
  let fatal: ProviderError | undefined;
  const queue = [...jobs];

  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      if (signal.aborted) return;
      try {
        results.set(job.cardId, await one(job));
        done++;
        opts.onProgress({ cardId: job.cardId, status: 'done', imageId: results.get(job.cardId)!.imageId, done, total: jobs.length });
      } catch (err) {
        const pe = err instanceof ProviderError ? err : new ProviderError('unknown', 'Image generation failed.', String(err));
        if (!fatal && pe.kind !== 'aborted') fatal = pe;
        opts.onProgress({ cardId: job.cardId, status: 'failed', done, total: jobs.length, message: pe.friendly });
        internal.abort();
        return;
      }
    }
  };

  const one = async (job: ImageJob): Promise<ImageJobResult> => {
    let concept = job.concept;
    let prompt = job.prompt;
    let retries = 0;
    let swaps = 0;
    for (;;) {
      const id = ImageLibrary.cacheKey(opts.provider.id, opts.ctx.model, opts.ctx.quality, prompt);
      if (opts.reuseCache && library.get(id)) {
        diagnostics.counters.imagesFromCache++;
        return { cardId: job.cardId, imageId: id, concept, cached: true };
      }
      const started = Date.now();
      try {
        const img = await opts.provider.generate({ ...opts.ctx, signal }, { prompt, negativePrompt: negativePromptFor(job.styleId), seed: hashSeed(prompt) });
        await library.saveGenerated(id, img.bytes, img.mime, {
          concept,
          prompt,
          styleId: job.styleId,
          provider: opts.provider.id,
          model: opts.ctx.model,
          mock: opts.mock,
        });
        diagnostics.counters.imagesGenerated++;
        diagnostics.log({ level: 'info', source: 'image', provider: opts.provider.id, message: `Generated "${concept}"`, latencyMs: Date.now() - started });
        return { cardId: job.cardId, imageId: id, concept, cached: false };
      } catch (err) {
        if (signal.aborted) throw new ProviderError('aborted', 'Cancelled.');
        const pe = err instanceof ProviderError ? err : new ProviderError('unknown', 'Image generation failed.', String(err));
        diagnostics.counters.imageErrors++;
        diagnostics.log({ level: 'warn', source: 'image', provider: opts.provider.id, message: `${pe.friendly} ("${concept}")`, detail: pe.detail });
        if (pe.kind === 'moderation' && swaps < MAX_SWAPS) {
          swaps++;
          const replacement = CONCEPT_BANK.find((c) => !used.has(c.text) && hashSeed(c.text + job.cardId + swaps) % 7 === 0) ??
            CONCEPT_BANK.find((c) => !used.has(c.text));
          if (replacement) {
            used.add(replacement.text);
            concept = replacement.text;
            prompt = buildImagePrompt(concept, getStyle(job.styleId));
            opts.onProgress({ cardId: job.cardId, status: 'swapped', done, total: jobs.length, message: 'Picked a different subject after a content filter.' });
            continue;
          }
        }
        if (FATAL.has(pe.kind) || retries >= MAX_RETRIES) throw pe;
        retries++;
        opts.onProgress({ cardId: job.cardId, status: 'retrying', done, total: jobs.length, message: pe.friendly });
        await new Promise((r) => setTimeout(r, 1500 * retries));
      }
    }
  };

  const n = Math.max(1, Math.min(opts.concurrency ?? 3, jobs.length));
  await Promise.all(Array.from({ length: n }, worker));
  if (fatal) throw fatal;
  if (opts.signal.aborted) throw new ProviderError('aborted', 'Cancelled.');
  return jobs.map((j) => results.get(j.cardId)!);
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
