import { describe, expect, it } from 'vitest';
import { OperativeReplySchema, ParseError, SpymasterReplySchema, extractJson, parseReply } from '@core/ai/parse';

describe('model reply parsing', () => {
  it('extracts JSON from fences and surrounding prose', () => {
    expect(extractJson('Sure!\n```json\n{"a": 1}\n```\nGood luck')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a": {"b": 2}} done')).toEqual({ a: { b: 2 } });
  });

  it('repairs trailing commas and smart quotes', () => {
    expect(extractJson('{"a": [1, 2,], }')).toEqual({ a: [1, 2] });
    expect(extractJson('{“a”: 1}')).toEqual({ a: 1 });
  });

  it('normalizes coordinates and probabilities', () => {
    const r = parseReply(
      OperativeReplySchema,
      '{"guesses":[{"card":" b2 ","confidence":"85%"},{"card":"C1","confidence":70},{"card":"D1","confidence":"x"}]}',
    );
    expect(r.guesses.map((g) => g.card)).toEqual(['B2', 'C1', 'D1']);
    expect(r.guesses.map((g) => g.confidence)).toEqual([0.85, 0.7, 0.5]);
  });

  it('defaults missing risks', () => {
    const r = parseReply(SpymasterReplySchema, '{"candidates":[{"clue":"sea","targets":[{"card":"A1","strength":0.9}]}]}');
    expect(r.candidates[0].risks).toEqual([]);
  });

  it('throws ParseError for unusable replies', () => {
    expect(() => parseReply(OperativeReplySchema, 'I think B2.')).toThrow(ParseError);
    expect(() => parseReply(OperativeReplySchema, '{"guesses": []}')).toThrow(ParseError);
  });
});
