import { ProviderError, classifyHttpError, classifyNetworkError } from './errors';

export interface HttpOptions {
  /** Provider display name for error messages. */
  who: string;
  timeoutMs?: number;
  /** Extra attempts for retryable failures (429, 5xx, network). */
  retries?: number;
  signal?: AbortSignal;
  local?: boolean;
  /** Override classification for provider-specific error bodies. */
  classify?: (status: number, body: string) => ProviderError | undefined;
}

const DEFAULT_TIMEOUT = 90_000;
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new ProviderError('aborted', 'Cancelled.'));
      },
      { once: true },
    );
  });

/** fetch() with timeout, cancellation, retry/backoff and friendly error classification. */
export async function httpRequest(url: string, init: RequestInit, opts: HttpOptions): Promise<Response> {
  const retries = opts.retries ?? 2;
  let lastError: ProviderError | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) throw new ProviderError('aborted', 'Cancelled.');
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal });
    } catch (err) {
      if (opts.signal?.aborted) throw new ProviderError('aborted', 'Cancelled.');
      lastError = classifyNetworkError(opts.who, timeout.aborted ? Object.assign(new Error('timeout'), { name: 'TimeoutError' }) : err, opts.local, url);
      if (!lastError.retryable || attempt === retries) throw lastError;
      await sleep(backoff(attempt), opts.signal);
      continue;
    }
    if (res.ok) return res;
    const body = await res.text().catch(() => '');
    lastError = opts.classify?.(res.status, body) ?? classifyHttpError(opts.who, res.status, body, opts.local);
    if (!lastError.retryable || attempt === retries) throw lastError;
    await sleep(retryAfter(res) ?? backoff(attempt), opts.signal);
  }
  throw lastError ?? new ProviderError('unknown', `${opts.who} request failed.`);
}

export async function httpJson<T = unknown>(url: string, init: RequestInit, opts: HttpOptions): Promise<T> {
  const res = await httpRequest(url, init, opts);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError('bad_response', `${opts.who} sent a response the game could not read.`, text.slice(0, 500));
  }
}

function backoff(attempt: number): number {
  return Math.min(8000, 800 * 2 ** attempt) + Math.floor(Math.random() * 300);
}

function retryAfter(res: Response): number | undefined {
  const h = res.headers.get('retry-after');
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.min(15_000, Math.max(0, secs * 1000));
  const date = Date.parse(h);
  return Number.isFinite(date) ? Math.min(15_000, Math.max(0, date - Date.now())) : undefined;
}

export function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
