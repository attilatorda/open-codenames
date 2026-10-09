import { z } from 'zod';

/** Accepts 0.8, "0.8", 80 or "80%" and returns a value in [0, 1]. */
const probability = z.preprocess((raw) => {
  let v = typeof raw === 'string' ? parseFloat(raw.replace('%', '')) : typeof raw === 'number' ? raw : NaN;
  if (Number.isNaN(v)) return 0.5;
  if (v > 1) v = v / 100;
  return Math.max(0, Math.min(1, v));
}, z.number());

const coord = z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v), z.string());

export const SpymasterReplySchema = z.object({
  boardNotes: z.string().optional(),
  candidates: z
    .array(
      z.object({
        clue: z.string(),
        targets: z.array(z.object({ card: coord, strength: probability })).min(1),
        risks: z.array(z.object({ card: coord, level: probability })).default([]),
        why: z.string().optional(),
      }),
    )
    .min(1),
});
export type SpymasterReply = z.infer<typeof SpymasterReplySchema>;

export const OperativeReplySchema = z.object({
  interpretation: z.string().optional(),
  guesses: z
    .array(
      z.object({
        card: coord,
        confidence: probability,
        reason: z.string().optional(),
      }),
    )
    .min(1),
});
export type OperativeReply = z.infer<typeof OperativeReplySchema>;

export const SimulationReplySchema = z.object({
  readings: z.array(z.object({ clue: z.string(), picks: z.array(coord) })),
});
export type SimulationReply = z.infer<typeof SimulationReplySchema>;

export class ParseError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

/** Pull the first JSON object out of a model reply (handles fences, prose and trailing commas). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new ParseError('No JSON object found in the reply.', text);
  const slice = body.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    const repaired = slice.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"');
    try {
      return JSON.parse(repaired);
    } catch (err) {
      throw new ParseError(`Reply was not valid JSON: ${(err as Error).message}`, text);
    }
  }
}

export function parseReply<T>(schema: z.ZodType<T>, text: string): T {
  const data = extractJson(text);
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ParseError(
      `JSON did not match the expected shape at "${issue?.path.join('.') || '(root)'}": ${issue?.message}`,
      text,
    );
  }
  return result.data;
}
