// How every AI player plays. There is a single profile: before giving a clue it predicts how its
// teammate will read it, and it learns from every misunderstanding. Prompts and strategy read
// these fields; tests and tools may pass a variant (e.g. a bolder risk value).

export type RelationType =
  | 'literal'
  | 'visual'
  | 'conceptual'
  | 'cultural'
  | 'metaphorical'
  | 'abstract'
  | 'thematic';

export interface Personality {
  clueStyle: string;
  guessStyle: string;
  relations: RelationType[];
  /** -1 very cautious … +1 very bold. Shifts clue size and guess thresholds. */
  risk: number;
  /** How strongly score and opponent progress change behavior (1 = normal). */
  situational: number;
  /** Minimum confidence to keep guessing after the first pick. */
  guessThreshold: number;
  temperature: number;
  /** Spends an extra model call predicting how the teammate will read each clue. */
  simulatesTeammate: boolean;
}

export const AI_PROFILE: Personality = {
  clueStyle:
    'Optimize for how your teammate will actually interpret the clue. Prefer associations most people would share, and avoid clues that also fit dangerous pictures.',
  guessStyle:
    'Reason about what your spymaster most likely intended, using their past clues as evidence of how they think.',
  relations: ['conceptual', 'visual', 'cultural', 'literal'],
  risk: 0,
  situational: 1.1,
  guessThreshold: 0.5,
  temperature: 0.5,
  simulatesTeammate: true,
};
