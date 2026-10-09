# Troubleshooting

When something goes wrong during a game, a dialog lets you **Retry**, **Skip this turn** or **Quit**. Technical details are always available in **Settings → Diagnostics** (keys are redacted; use **Copy** when reporting a problem).

| Message | What to do |
|---|---|
| “… rejected the API key” | Re-enter the key in API configuration and press Test connection. Check that it belongs to the selected company and has not been revoked. |
| “… says this key is not allowed to do that” | The key lacks permission for this model or endpoint. Check its permissions/project in the provider dashboard. |
| “… reports a billing or credit problem” | Add credit or a payment method with the provider. |
| “… is temporarily rate-limited” | Wait a minute and press Retry. Spreading AI players across several slots/providers also helps. |
| “… could not find the selected model” | Press Test connection and choose a model from the list your key can use. |
| “… declined this request for content-policy reasons” | For pictures, the game automatically picks a different subject. For AI moves, press Retry or try another model. |
| “… gave an answer the game could not understand” | The game already retried once. Press Retry; if it keeps happening, choose a stronger model for that slot. |
| “… could not come up with a legal clue” | Press Retry. Very small models sometimes struggle with the clue format. |
| “Could not reach …” | Check your internet connection or firewall. |
| “Could not reach the local server …” | Start Ollama / LM Studio (or AUTOMATIC1111/Forge with `--api`) and check the server URL. |
| “Your picture library has N images, but this board needs M” | Add pictures to your folder, choose a smaller board, or configure an image generator. |
| An AI seems unable to see the pictures | Set “Sees pictures” to **Yes** for that slot if the model supports images, or pick a vision model. Slots whose model cannot see pictures are not used. |

## Other tips

- **F11** toggles fullscreen. Use the eye icon on a picture to enlarge it.
- If the game window looks wrong after an update, try **Settings → Keys & privacy → Reset settings** (keys and AI configuration are kept).
- To start completely fresh, close the game and delete the data folder (`%APPDATA%\Open Codenames`).
