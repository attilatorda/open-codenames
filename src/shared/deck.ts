// The built-in standard deck: public-domain artwork cut into picture cards, shipped with the game.

export interface DeckCard {
  /** Stable id such as "d001". */
  id: string;
  /** Path relative to the deck folder. */
  file: string;
  /** Plain description of what the card shows (used for players whose model cannot see images). */
  caption: string;
  /** Title of the original artwork. */
  title: string;
  artist: string;
  year: string;
  /** Book or series the artwork comes from. */
  work?: string;
  /** Museum / archive the scan comes from. */
  source: string;
  sourceURL: string;
  license: string;
}

export interface DeckManifest {
  version: 1;
  /** Stable collection id, e.g. "grandville". */
  id: string;
  name: string;
  description: string;
  cards: DeckCard[];
}

/** A deck card plus the image id the game uses to display and send it. */
export interface DeckCardInfo extends DeckCard {
  imageId: string;
}

export interface DeckInfo {
  id: string;
  name: string;
  description: string;
  /** Shipped with the game (cannot be removed). Imported collections live in the player's data folder. */
  builtIn: boolean;
  cards: DeckCardInfo[];
}

/** What the import dialog found in a folder. */
export interface FolderScan {
  folder: string;
  images: number;
  /** Per-picture credits supplied with the folder, if any. */
  metadata: 'deck.json' | 'credits.csv' | null;
  suggestedName: string;
}

/** Collection-wide credits typed by the player; per-picture credits.csv/deck.json values take precedence. */
export interface ImportCollectionRequest {
  folder: string;
  name: string;
  artist: string;
  year: string;
  source: string;
  sourceURL: string;
  license: string;
}

export const DEFAULT_COLLECTION_ID = 'grandville';
