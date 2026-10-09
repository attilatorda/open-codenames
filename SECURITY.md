# Security

Open Codenames handles players' own API keys, so security reports matter to us.

## Reporting a vulnerability

Please report vulnerabilities **privately** through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue for security problems. Include what you found, how to reproduce it, and what an attacker could do with it.

## How keys are handled

- **Desktop:** keys are encrypted with the operating system's credential protection (DPAPI on Windows, Keychain on macOS, libsecret on Linux) and stored only on the player's computer. The UI can write keys but never read them back; only the main process uses them.
- **Browser version:** keys are stored in the browser's local storage for the game's site, without encryption, and sent straight from the page to the chosen provider.
- Keys are sent only to the provider the player selected. There is no Open Codenames server.
- The diagnostics log redacts anything that looks like a key.

See `docs/PRIVACY_SECURITY.md` for the player-facing details.
