import { ConceptBoardGenerator, cardsFromPlan } from '@core/board/boardGenerator';
import { getLayout, withAssassin } from '@core/board/layouts';
import { GameEngine } from '@core/engine/GameEngine';
import type { Card, CardKind, TeamId } from '@core/types';

/** The standard game has no assassin; `assassinVariant` deals one (the assassin option). */
export function makeEngine(seed = 42, layoutId = '5x5', assassinVariant = false): GameEngine {
  const base = getLayout(layoutId);
  const layout = assassinVariant ? withAssassin(base) : base;
  const plan = new ConceptBoardGenerator().plan(seed, layout, 'storybook');
  const results = new Map(plan.cards.map((c) => [c.id, { imageId: `img-${c.id}` }]));
  return new GameEngine({
    id: `game-${seed}`,
    seed,
    layout,
    cards: cardsFromPlan(plan, results, 'mock'),
    startingTeam: plan.startingTeam,
  });
}

export function cardsOf(engine: GameEngine, kind: CardKind): Card[] {
  return engine.getState().cards.filter((c) => c.kind === kind && !c.revealed);
}

export function activeTeam(engine: GameEngine): TeamId {
  return engine.getState().turn.team;
}
