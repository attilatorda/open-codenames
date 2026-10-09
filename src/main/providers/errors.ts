import type { ErrorKind, FriendlyError } from '@shared/ipc';

/** Every provider failure becomes one of these: friendly text for the UI, detail for diagnostics. */
export class ProviderError extends Error {
  constructor(
    readonly kind: ErrorKind,
    readonly friendly: string,
    readonly detail?: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(friendly);
    this.name = 'ProviderError';
  }

  toFriendly(): FriendlyError {
    return { kind: this.kind, message: this.friendly, detail: this.detail };
  }
}

const MODERATION_HINTS = /moderat|safety|content[_ -]?polic|content[_ -]?filter|blocked|flagged|nsfw/i;
const QUOTA_HINTS = /insufficient[_ -]?quota|billing|credit|payment|balance|exceeded your current quota/i;

/** Map an HTTP failure to a friendly error. `who` is the provider's display name. */
export function classifyHttpError(who: string, status: number, body: string, local = false): ProviderError {
  const detail = `HTTP ${status}: ${truncate(body, 600)}`;
  if (status === 401) return new ProviderError('auth', `${who} rejected the API key. Check it in AI Configuration.`, detail, status);
  if (status === 402 || (status !== 400 && QUOTA_HINTS.test(body) && status !== 404)) {
    return new ProviderError('quota', `${who} reports a billing or credit problem with this account.`, detail, status);
  }
  if (status === 403) {
    if (MODERATION_HINTS.test(body)) {
      return new ProviderError('moderation', `${who} declined this request for content-policy reasons.`, detail, status);
    }
    return new ProviderError('auth', `${who} says this key is not allowed to do that (check the key’s permissions or model access).`, detail, status);
  }
  if (status === 404) {
    return new ProviderError('not_found', `${who} could not find the selected model. Pick another model in AI Configuration.`, detail, status);
  }
  if (status === 408) return new ProviderError('timeout', `${who} took too long to answer.`, detail, status, true);
  if (status === 429) {
    return new ProviderError('rate_limit', `${who} is temporarily rate-limited. Wait a moment and try again.`, detail, status, true);
  }
  if (status === 400 || status === 422 || status === 413) {
    if (MODERATION_HINTS.test(body)) {
      return new ProviderError('moderation', `${who} declined this request for content-policy reasons.`, detail, status);
    }
    return new ProviderError(
      'bad_request',
      `${who} rejected the request. The selected model may not support this kind of request.`,
      detail,
      status,
    );
  }
  if (status >= 500) {
    return new ProviderError(
      'server',
      local ? `The local server returned an error.` : `${who} is having problems right now (overloaded or down).`,
      detail,
      status,
      true,
    );
  }
  return new ProviderError('unknown', `${who} returned an unexpected error.`, detail, status);
}

export function classifyNetworkError(who: string, err: unknown, local = false, url?: string): ProviderError {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e?.name === 'AbortError') return new ProviderError('aborted', 'Cancelled.', undefined);
  if (e?.name === 'TimeoutError') {
    return new ProviderError('timeout', `${who} took too long to answer.`, e.message, undefined, true);
  }
  const code = e?.cause?.code ?? '';
  const detail = `${e?.message ?? String(err)}${code ? ` (${code})` : ''}${e?.cause?.message ? ` — ${e.cause.message}` : ''}`;
  if (local) {
    return new ProviderError('network', `Could not reach the local server${url ? ` at ${url}` : ''}. Is it running?`, detail, undefined, true);
  }
  return new ProviderError('network', `Could not reach ${who}. Check your internet connection.`, detail, undefined, true);
}

export function badResponse(who: string, detail: string): ProviderError {
  return new ProviderError('bad_response', `${who} sent a response the game could not read.`, detail);
}

export function toFriendly(err: unknown): FriendlyError {
  if (err instanceof ProviderError) return err.toFriendly();
  const e = err as { friendly?: string; kind?: ErrorKind; detail?: string; message?: string };
  if (e && typeof e.friendly === 'string') return { kind: e.kind ?? 'unknown', message: e.friendly, detail: e.detail };
  return { kind: 'unknown', message: 'Something went wrong.', detail: e?.message ?? String(err) };
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
