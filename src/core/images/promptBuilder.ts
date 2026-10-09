// Image prompt construction. Kept separate from any provider so the same board can be
// rendered by Stability, FLUX, OpenAI or a local model without touching game rules.

export interface ArtStyle {
  id: string;
  label: string;
  /** Style words appended after the subject. */
  prompt: string;
  /** Optional full template; `{concept}` is replaced with the subject. */
  template?: string;
  /** Extra negative-prompt terms for providers that support them. */
  negative?: string;
}

export const ART_STYLES: readonly ArtStyle[] = [
  {
    id: 'ink',
    label: 'Surreal ink (black & white)',
    prompt: '',
    template:
      'Monochrome ink illustration, surreal mashup: {concept}. Clean bold black outlines, white fills, light gray halftone shading, whimsical vintage cartoon style, isolated on a plain white background',
    negative: 'color, colorful, photograph, photorealistic',
  },
  {
    id: 'storybook',
    label: 'Storybook',
    prompt: 'storybook illustration, soft gouache textures, warm cinematic lighting, rich colors',
  },
  {
    id: 'photo',
    label: 'Cinematic photo',
    prompt: 'cinematic photograph, natural light, shallow depth of field, high detail',
  },
  {
    id: 'poster',
    label: 'Retro poster',
    prompt: 'mid-century travel poster style, bold flat shapes, limited color palette, screen-print texture',
  },
  {
    id: 'clay',
    label: 'Claymation',
    prompt: 'claymation diorama, handmade clay figures, soft studio lighting, tactile textures',
  },
  {
    id: 'oil',
    label: 'Oil painting',
    prompt: 'classical oil painting, visible brushwork, dramatic chiaroscuro',
  },
  {
    id: 'pixel',
    label: 'Pixel art',
    prompt: 'detailed 16-bit pixel art, crisp pixels, vibrant palette',
  },
  {
    id: 'surreal',
    label: 'Surreal dream',
    prompt: 'surrealist dreamlike painting, uncanny atmosphere, soft gradients',
  },
];

export const MIXED_STYLE_ID = 'mixed';
export const DEFAULT_STYLE_ID = 'ink';

const COMPOSITION = 'centered composition, square format, no text, no letters, no words, no watermark, no border';

export function getStyle(id: string): ArtStyle {
  return ART_STYLES.find((s) => s.id === id) ?? ART_STYLES[0];
}

export function buildImagePrompt(concept: string, style: ArtStyle): string {
  const body = style.template ? style.template.replace('{concept}', concept) : `${concept}, ${style.prompt}`;
  return `${body}, ${COMPOSITION}`;
}

export function negativePromptFor(styleId: string): string {
  const extra = getStyle(styleId).negative;
  return extra ? `${NEGATIVE_PROMPT}, ${extra}` : NEGATIVE_PROMPT;
}

/** A neutral description of what the picture shows, for non-vision models. */
export function captionFor(concept: string): string {
  return concept.charAt(0).toUpperCase() + concept.slice(1);
}

export const NEGATIVE_PROMPT = 'text, letters, words, watermark, signature, logo, frame, border, blurry, low quality';
