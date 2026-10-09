# Privacy and security

## Your API keys

- Keys are encrypted with your operating system’s credential protection — **DPAPI on Windows** (Keychain on macOS, libsecret/KWallet on Linux) — and stored as ciphertext in the game’s data folder.
- If no secure facility is available, keys are kept **in memory for the current session only** and never written to disk in plain text.
- After you enter a key, the game interface never reads it back; only the background process that talks to providers can use it.
- Keys are sent **only** to the provider you selected for that slot, directly from your computer. There is no Open Codenames server, and the game never intentionally sends keys anywhere else.
- The diagnostics log removes anything that looks like a key before it is shown or saved.
- **Settings → Keys & privacy → Delete all keys** removes every saved key.

**Honest limits:** a desktop application cannot guarantee absolute secrecy of credentials from someone — or some software — that controls your machine. Use provider keys with spending limits, and revoke keys you no longer use.

## What is sent to AI providers

- **Image providers** receive the picture prompt (for example “a lighthouse in a storm, storybook illustration…”).
- **Language-model providers** receive the game state their player is allowed to know: board thumbnails, public clue and guess history, the score, and — for spymasters only — the secret key. Operatives never receive the key.
- Each provider’s own privacy policy and data-retention terms apply to what they receive.

## What stays on your computer

Stored in the game’s data folder (`%APPDATA%\Open Codenames` on Windows):

| File / folder | Contents |
|---|---|
| `settings.json` | Preferences and provider/model choices (no keys) |
| `credentials.json` | Encrypted keys |
| `images/` | Generated pictures (the cache that saves you money) |
| `replays/` | Game records used for debriefs and history |
| `logs/diagnostics.log` | Technical log with keys redacted |

Open Codenames has no account system, no analytics and no telemetry.
