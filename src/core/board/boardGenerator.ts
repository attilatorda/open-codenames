import type { BoardLayout, Card, CardKind, TeamId } from '../types';
import { createRng, type Rng } from '../util/rng';
import { SURREAL_BANK, type Concept } from './conceptBank';
import { coordFor, layoutSize } from './layouts';
import { ART_STYLES, MIXED_STYLE_ID, buildImagePrompt, captionFor, getStyle } from '../images/promptBuilder';

/** A card slot before its image exists. */
export interface PlannedCard {
  id: number;
  coord: string;
  kind: CardKind;
  concept: string;
  prompt: string;
  styleId: string;
}

export interface BoardPlan {
  seed: number;
  layout: BoardLayout;
  startingTeam: TeamId;
  cards: PlannedCard[];
}

export interface IBoardGenerator {
  plan(seed: number, layout: BoardLayout, styleId: string): BoardPlan;
}

/** Assign secret identities to positions. The starting team gets the extra card. */
export function assignKinds(layout: BoardLayout, startingTeam: TeamId, rng: Rng): CardKind[] {
  const second: TeamId = startingTeam === 'A' ? 'B' : 'A';
  const kinds: CardKind[] = [
    ...Array<CardKind>(layout.starting).fill(startingTeam),
    ...Array<CardKind>(layout.other).fill(second),
    ...Array<CardKind>(layout.neutral).fill('NEUTRAL'),
    ...Array<CardKind>(layout.assassin).fill('ASSASSIN'),
  ];
  if (kinds.length !== layoutSize(layout)) {
    throw new Error(`Layout ${layout.id} card counts do not add up`);
  }
  return rng.shuffle(kinds);
}

/** Pick concepts spread across categories so a board is never all animals. */
export function pickConcepts(count: number, rng: Rng, bank: readonly Concept[] = SURREAL_BANK): Concept[] {
  const byCategory = new Map<string, Concept[]>();
  for (const c of rng.shuffle(bank)) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c);
    byCategory.set(c.category, list);
  }
  const categories = rng.shuffle([...byCategory.keys()]);
  const picked: Concept[] = [];
  while (picked.length < count) {
    let progressed = false;
    for (const cat of categories) {
      const list = byCategory.get(cat)!;
      const next = list.pop();
      if (next) {
        picked.push(next);
        progressed = true;
        if (picked.length === count) break;
      }
    }
    if (!progressed) throw new Error('Concept bank is too small for this board');
  }
  return rng.shuffle(picked);
}

export class ConceptBoardGenerator implements IBoardGenerator {
  constructor(private readonly bank: readonly Concept[] = SURREAL_BANK) {}

  plan(seed: number, layout: BoardLayout, styleId: string): BoardPlan {
    const rng = createRng(seed);
    const startingTeam: TeamId = rng.next() < 0.5 ? 'A' : 'B';
    const kinds = assignKinds(layout, startingTeam, rng);
    const concepts = pickConcepts(kinds.length, rng, this.bank);
    const cards = kinds.map((kind, i): PlannedCard => {
      const style = styleId === MIXED_STYLE_ID ? rng.pick(ART_STYLES) : getStyle(styleId);
      return {
        id: i,
        coord: coordFor(i, layout),
        kind,
        concept: concepts[i].text,
        prompt: buildImagePrompt(concepts[i].text, style),
        styleId: style.id,
      };
    });
    return { seed, layout, startingTeam, cards };
  }
}

/** Plan a board whose images come from an existing library instead of generation. */
export function planFromLibrary(
  seed: number,
  layout: BoardLayout,
  images: { imageId: string; concept?: string; caption?: string; source: 'generated' | 'folder' | 'mock' | 'deck' }[],
): { startingTeam: TeamId; cards: Card[] } {
  const rng = createRng(seed);
  const startingTeam: TeamId = rng.next() < 0.5 ? 'A' : 'B';
  const kinds = assignKinds(layout, startingTeam, rng);
  if (images.length < kinds.length) {
    throw new Error(`Need ${kinds.length} images but the library has ${images.length}`);
  }
  const chosen = rng.shuffle(images).slice(0, kinds.length);
  const cards = kinds.map(
    (kind, i): Card => ({
      id: i,
      coord: coordFor(i, layout),
      kind,
      image: {
        imageId: chosen[i].imageId,
        concept: chosen[i].concept,
        caption: chosen[i].caption ?? (chosen[i].concept ? captionFor(chosen[i].concept!) : undefined),
        source: chosen[i].source,
      },
      revealed: false,
    }),
  );
  return { startingTeam, cards };
}

/** Combine a plan with generated images. A result may carry a replacement concept (after a moderation swap). */
export function cardsFromPlan(
  plan: BoardPlan,
  results: Map<number, { imageId: string; concept?: string }>,
  source: 'generated' | 'mock',
): Card[] {
  return plan.cards.map((pc) => {
    const result = results.get(pc.id);
    if (!result) throw new Error(`Missing image for card ${pc.coord}`);
    const concept = result.concept ?? pc.concept;
    return {
      id: pc.id,
      coord: pc.coord,
      kind: pc.kind,
      image: { imageId: result.imageId, concept, caption: captionFor(concept), source },
      revealed: false,
    };
  });
}
