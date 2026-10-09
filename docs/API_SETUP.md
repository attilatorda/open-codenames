# Setting up API keys

Open Codenames is “bring your own key”: it talks to AI services with keys you create in each provider’s dashboard. You need **1–4 language-model keys** and **0 or 1 image-generation key**.

Open the configuration screen any time from **Settings → AI players → API configuration**.

## Language models (1–4 slots)

Each slot is one AI “brain”. In Quick Play:

| Slot | Plays |
|---|---|
| LLM 1 | your AI teammate |
| LLM 2 | the opposing spymaster |
| LLM 3 | the opposing operative |

With fewer slots, they are reused (one key can play all three AIs). In **Standard** and **AI vs AI** you assign any slot to any seat — for example, a Claude spymaster against a GPT spymaster.

For each slot:

1. Choose the **company**.
2. Paste the **API key** (it is saved, encrypted, when you leave the field).
3. Press **Test connection**. This checks the key and loads the list of models your key can use.
4. Pick a **model**.
5. “Sees pictures” — leave on **Auto**, or choose **Yes** for a vision model the game does not recognize. AI players read the pictures themselves, so a model that cannot see images cannot play.

| Company | Where to get a key | Notes |
|---|---|---|
| Anthropic (Claude) | console.anthropic.com → API keys | Default model: Claude Opus 5.5 |
| OpenAI (GPT) | platform.openai.com → API keys | |
| Google (Gemini) | aistudio.google.com → Get API key | |
| OpenRouter | openrouter.ai → Keys | Gives access to many models with one key; pick a vision model |
| xAI (Grok) | console.x.ai | |
| Mistral AI | console.mistral.ai | |
| Local LLM | — | Any OpenAI-compatible server: Ollama (`http://localhost:11434/v1`) or LM Studio (`http://localhost:1234/v1`). No key needed. Use a vision model (for example a “-vision” or “-vl” model) for the best experience. |

## Image generation (0 or 1 key)

| Company | Notes |
|---|---|
| Stability AI (Stable Diffusion) | Stable Image Core, SD 3.5 (Flash/Medium/Large/Turbo) or Ultra. Test connection shows your credit balance. |
| Black Forest Labs (FLUX) | FLUX.2 [pro], [flex], [max]. |
| OpenAI | GPT Image 2.5 Flare (fast) or Sunburst (best). |
| Google | Nano Banana models. |
| Replicate | Any text-to-image model; default `black-forest-labs/flux-schnell` (fast and cheap). |
| Local Stable Diffusion | AUTOMATIC1111 or Forge web UI started with `--api` (default `http://127.0.0.1:7860`). |

**Quality** (Low / Medium / High) changes the price per picture on providers that support it.

### No image key?

That's fine: boards are dealt from the built-in **standard deck** (68 public-domain engravings). You can also choose **My folder & library** and pick a folder of your own pictures (PNG, JPG or WebP). You need at least 16 pictures for a 4×4 board, 20 for the standard 5×4 board and 25 for 5×5. Every picture generated in earlier games is also kept in your library, so you can switch to free library boards at any time (Settings → Pictures).
