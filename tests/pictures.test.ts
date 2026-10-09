import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT_ID, getLayout } from '@core/board/layouts';
import { ConceptBoardGenerator } from '@core/board/boardGenerator';
import { SCENE_BANK, SURREAL_BANK, conceptBank } from '@core/board/conceptBank';
import { DEFAULT_STYLE_ID, buildImagePrompt, getStyle, negativePromptFor } from '@core/images/promptBuilder';
import { defaultSettings } from '@shared/settings';

describe('Codenames Pictures defaults', () => {
  it('uses the 5 columns × 4 rows board with 8 / 7 / 5 neutral and no assassin', () => {
    const l = getLayout(DEFAULT_LAYOUT_ID);
    expect([l.cols, l.rows]).toEqual([5, 4]);
    expect([l.starting, l.other, l.neutral, l.assassin]).toEqual([8, 7, 5, 0]);
    expect(l.short).toBe('5×4');
    expect(defaultSettings().gameplay.layoutId).toBe(DEFAULT_LAYOUT_ID);
  });

  it('defaults to black-and-white surreal mashups', () => {
    const s = defaultSettings().gameplay;
    expect(s.styleId).toBe(DEFAULT_STYLE_ID);
    expect(s.conceptSet).toBe('surreal');
    const prompt = buildImagePrompt('an elephant whose trunk is an umbrella and whose tail is a propeller', getStyle('ink'));
    expect(prompt).toMatch(/^Monochrome ink illustration, surreal mashup: an elephant whose trunk is an umbrella/);
    expect(prompt).toMatch(/no text/);
    expect(negativePromptFor('ink')).toMatch(/color/);
  });

  it('has a large, duplicate-free surreal bank spread over categories', () => {
    expect(SURREAL_BANK.length).toBeGreaterThan(150);
    expect(new Set(SURREAL_BANK.map((c) => c.text)).size).toBe(SURREAL_BANK.length);
    expect(new Set(SURREAL_BANK.map((c) => c.category)).size).toBeGreaterThanOrEqual(8);
    expect(SURREAL_BANK.some((c) => c.text.includes('elephant whose trunk is an umbrella'))).toBe(true);
    expect(conceptBank('scenes')).toBe(SCENE_BANK);
  });

  it('plans boards from the chosen bank with the ink style', () => {
    const plan = new ConceptBoardGenerator().plan(1, getLayout('4x5'), 'ink');
    expect(plan.cards).toHaveLength(20);
    const surreal = new Set(SURREAL_BANK.map((c) => c.text));
    expect(plan.cards.every((c) => surreal.has(c.concept) && c.styleId === 'ink')).toBe(true);
    const scenes = new ConceptBoardGenerator(SCENE_BANK).plan(1, getLayout('4x5'), 'photo');
    expect(scenes.cards.every((c) => !surreal.has(c.concept))).toBe(true);
  });
});
