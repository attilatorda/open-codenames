# Picture collections (decks)

Open Codenames deals its boards from **picture collections**. The built-in standard collection is *Grandville’s Other World* — 68 public-domain engravings by J. J. Grandville (see [DECK_CREDITS.md](DECK_CREDITS.md)). Open **Decks** in the main menu to browse every collection with each picture’s title, artist, year, source and license.

## Importing your own collection

1. Put the pictures (PNG, JPG or WebP) in one folder. File names become titles: `The Golden Fish.jpg` → “The Golden Fish”.
2. Optional: add a `credits.csv` to the same folder for per-picture credits:

   ```csv
   file,title,artist,year,source,sourceURL,license,caption
   golden-fish.jpg,The Golden Fish,A. Painter,2004,Licensed from the artist’s studio,https://…,Licensed for this game,A fish swimming through a teacup
   ```

   `caption` is a short description of what the picture shows. It appears in the Decks browser; AI players never read it — they look at the picture.
3. **Decks → Import collection…**, choose the folder, fill in the collection-wide fields (they fill any gaps in the CSV), and import.
4. Press **Make standard** to deal Quick Play boards from it (or pick it per game in the setup screen).

Imported pictures are copied (downscaled to 1024 px) into the game’s data folder; your originals are not changed. Remove an imported collection from the Decks screen at any time.

## Rights

Only import pictures you have the right to use. Work by living artists — and by anyone who died less than about 70 years ago — is normally under copyright: get the artist’s or rights holder’s permission (many artists license reproductions) before using or sharing it. Built-in collections only contain public-domain artwork.
