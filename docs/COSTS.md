# Costs: who pays for what

**Every picture and every AI move is a request to a third-party provider, billed to your account by that provider.** Open Codenames does not charge you, does not pay these costs, and cannot refund them. Check each provider’s pricing page and set a spending limit in their dashboard.

## Where requests come from

| Action | Requests |
|---|---|
| Building a board | One image request per picture: 20 on the standard 5×4 board (16 or 25 on the other sizes). Pictures already generated with the same subject, style, model and quality are reused for free. |
| A spymaster’s clue | 2 LLM requests: one for candidate clues, one predicting how its teammate will read them. |
| An operative’s turn | 1 LLM request per turn (not per guess). |
| A malformed AI answer | At most 1 automatic retry. |

A typical game has 10–20 AI turns. Each AI request includes small thumbnails (384 px) of the board pictures. The pictures are always sent first and in the same order so providers that support prompt caching (for example Anthropic and OpenAI) can bill the repeated part at a discount.

## Keeping costs down

- Use **Low** image quality, or a fast/cheap image model (for example FLUX schnell on Replicate).
- Use a **smaller board** (4×4 is 16 pictures instead of 20).
- Switch to **My library** boards (Settings → Pictures) to replay with pictures you already have — no image costs at all.
- Use a smaller/cheaper model for the opponents and a stronger one for your teammate.
- Run a **local model** (Ollama / LM Studio) and a **local Stable Diffusion** for completely free play.

**Settings → Diagnostics** shows how many AI calls, tokens and pictures this session has used.
