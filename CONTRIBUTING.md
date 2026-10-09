# Contributing to Open Codenames

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Getting started

```sh
npm install
npm run dev        # desktop game (debug build) with hot reload
npm run dev:web    # browser version
```

The debug build has an **offline mock AI** (AI configuration → “Use offline mock AI (dev)”), so you can play and test without an API key. See `README.md` for the architecture and every script.

## Before you open a pull request

```sh
npm run typecheck
npm test
npm run e2e        # desktop, drives the real app with Playwright
npm run e2e:web    # browser version in headless Chrome
```

Please keep changes focused, and describe what you changed and how you checked it.

## Ground rules for the game

- **Information boundaries.** Players only ever see `SpymasterView` / `OperativeView` (`src/core/engine/views.ts`). An operative's prompt must never depend on the hidden key; `tests/boundaries.test.ts` checks this.
- **AI players look at the pictures.** Prompts carry the images themselves, never text descriptions of them, and only vision models can take a seat.
- **No repeated clues.** An AI never gives a clue that was already given in the game.
- **Plain, grounded AI talk.** Clues are common words; table talk reports what actually happened. No catchphrases or role-play.
- **UI style.** Board-game-site look: dark top bar, light table, white panels, blue action buttons. No glows or gradients; color emphasis belongs to the picture cards. Explanations go in the Help screen, not on other screens.
- **Keys stay with the player.** API keys are sent only to the provider the player chose, and never logged (the diagnostics log redacts them).

## Picture collections

Only contribute artwork that is in the public domain or that you have the right to license for this project, and add its credits (see `docs/COLLECTIONS.md` and `docs/DECK_CREDITS.md`).

## License

By contributing you agree that your contribution is licensed under the MIT License (`LICENSE`).
