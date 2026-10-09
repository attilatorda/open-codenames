import { useState } from 'react';
import { useApp } from '../state/AppContext';

const TABS = [
  { id: 'basics', label: 'The game' },
  { id: 'playing', label: 'Playing' },
  { id: 'ai', label: 'AI players' },
  { id: 'pictures', label: 'Pictures' },
  { id: 'setup', label: 'Keys & setup' },
  { id: 'costs', label: 'Costs' },
  { id: 'trouble', label: 'Troubleshooting' },
];

export function HelpScreen({ tab: initial }: { tab?: string }) {
  const { navigate, info } = useApp();
  const web = info.platform === 'web';
  const [tab, setTab] = useState(initial ?? 'basics');
  return (
    <div className="page">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <article className="section help">
        {tab === 'basics' && (
          <>
            <h2>What is Open Codenames?</h2>
            <p>
              Open Codenames is a deduction and communication game in the style of <em>Codenames Pictures</em>. The board is a grid of
              pictures. Two teams — <span className="t-green">Green</span> and <span className="t-red">Red</span> — race to find their
              own pictures.
            </p>
            <h3>The board</h3>
            <p>Every picture secretly belongs to one of three groups:</p>
            <ul>
              <li>
                <span className="t-green">Green</span> pictures and <span className="t-red">Red</span> pictures — the team that starts
                has one extra.
              </li>
              <li>
                <strong>Neutral</strong> pictures belong to nobody.
              </li>
            </ul>
            <p>
              On the standard 5×4 board (20 pictures) the starting team has 8 pictures, the other team 7, and 5 are neutral. There is no
              assassin card — no single picture can lose you the game. A quicker 4×4 and a larger 5×5 board are also available.
            </p>
            <h3>Spymaster and operative</h3>
            <p>
              Each team has a <strong>spymaster</strong>, who sees the secret key, and an <strong>operative</strong>, who only sees the
              pictures. In Quick Play you are on Green with an AI teammate, and two AI players form Red. By default your role alternates
              between games (change it in Settings → Gameplay).
            </p>
            <h3>Winning</h3>
            <p>The first team whose pictures are all revealed wins — even if the other team revealed the last one by mistake.</p>
            <h3>About</h3>
            <p>
              Open Codenames is open source under the MIT License. The picture deck is in the public domain; see the Decks page for every
              artwork’s credits. “Codenames” is a registered trademark of Czech Games Edition; Open Codenames is an independent fan project
              and is not affiliated with or endorsed by Czech Games Edition.
            </p>
          </>
        )}
        {tab === 'playing' && (
          <>
            <h2>Clues</h2>
            <p>
              A clue is exactly <strong>one word</strong> and a <strong>number</strong>. “Ocean 3” means: “three of our pictures relate to
              ocean.” The word must relate to what the pictures <em>show</em> — objects, places, mood, symbolism, culture — never to their
              position on the board or to letters.
            </p>
            <h3>Guessing</h3>
            <ul>
              <li>The operative picks pictures one at a time and may pick up to the number plus one (the bonus helps catch up on earlier clues).</li>
              <li>A correct picture lets them keep going.</li>
              <li>A neutral picture ends the turn.</li>
              <li>An opponent’s picture gives them a point and ends the turn.</li>
              <li>The operative must make at least one guess, and may stop at any time after that.</li>
            </ul>
            <h3>The status bar</h3>
            <p>
              The bar above the board always says whose turn it is and what they are doing, and holds the buttons for your next move. The
              current clue is shown at its left edge.
            </p>
            <ul>
              <li>
                <strong>As spymaster</strong> you see the key: a colored frame and corner badge mark each picture’s team (G = Green, R = Red, – =
                neutral). Type a word in the status bar, set the number with − and +, and press <em>Give clue</em>. Give clues
                that lead your teammate to your pictures and away from the opponents’.
              </li>
              <li>
                <strong>As operative</strong> you do not see the key. Click a picture to select it, then click it again (or press{' '}
                <em>Reveal</em>) to confirm. <em>End turn</em> stops guessing once you have made at least one guess.
              </li>
            </ul>
            <h3>Clue size for your AI teammate</h3>
            <p>
              When you are the operative, the status bar asks for a clue size each time before your AI teammate gives a clue. The number is
              how many pictures it tries to connect with that clue (fewer when fewer remain); 1 is the safest, 4 the riskiest. Your last
              choice is preselected.
            </p>
            <p>
              <strong>Auto</strong> lets the AI decide: it opens with a clue for 1 (25% of the time), 2 (50%) or 3 (25%) pictures, then aims
              for as many as it needs to stay ahead — safer when leading, bolder when behind. The AI is always aiming to <em>win</em>, not to
              connect as many pictures as possible.
            </p>
            <h3>Game log</h3>
            <p>
              The log on the right lists every clue, pick and remark, newest first. Operatives explain their picks out loud as they guess.
              Spymasters keep their intentions secret until the game ends.
            </p>
            <h3>Keys and mouse</h3>
            <ul>
              <li>
                <span className="kbd">Esc</span> opens the game menu (resume or quit).
              </li>
              <li>
                <span className="kbd">F11</span> toggles fullscreen.
              </li>
              <li>
                <span className="kbd">+</span> / <span className="kbd">−</span> zoom the board, <span className="kbd">0</span> fits it
                again; <span className="kbd">Ctrl</span> + mouse wheel zooms toward the cursor. When zoomed in, drag or scroll to move
                around.
              </li>
              <li>The eye icon on a picture enlarges it.</li>
            </ul>
          </>
        )}
        {tab === 'ai' && (
          <>
            <h2>Your AI teammate and opponents</h2>
            <p>
              Every AI seat is a real player with its own language model call and memory — two AIs never share a brain. The game engine
              enforces what each one may know: a spymaster sees the key, an operative never does.
            </p>
            <h3>How the AI plays</h3>
            <ul>
              <li>
                It looks at the <strong>pictures themselves</strong>. No text description of a picture is ever sent to it, so every AI seat
                needs a model that can see images.
              </li>
              <li>
                As spymaster it proposes several clues, checks each against the key for risk, and predicts how its teammate will read the best
                ones before choosing (one extra model call per clue).
              </li>
              <li>It never repeats a clue that has already been given in the game.</li>
              <li>It remembers how its teammate read earlier clues and adjusts.</li>
              <li>As operative it ranks the pictures for the clue and stops when it is no longer confident enough.</li>
            </ul>
            <h3>The debrief</h3>
            <p>
              After the game, the debrief shows which pictures every clue was meant for, the other clues the AI considered and why it chose
              what it did, and its clue-size strategy. Finished games are kept in History.
            </p>
            <h3>AI settings</h3>
            <ul>
              <li>
                <strong>AI daring</strong> (Settings → Gameplay) shifts every AI toward cautious or bold play: smaller or bigger clues, and
                fewer or more extra guesses.
              </li>
              <li>
                <strong>AI pace</strong> sets the pause between AI moves so you can follow along.
              </li>
            </ul>
          </>
        )}
        {tab === 'pictures' && (
          <>
            <h2>Where pictures come from</h2>
            <p>Choose the source in Settings → Pictures or in AI configuration.</p>
            <ul>
              <li>
                <strong>Standard deck</strong> (free, default): 68 surreal engravings by J. J. Grandville (1840s, public domain) — a crocodile
                in a top hat, dueling quill pens, a man flying on kites. Every picture can answer to several different clues.
              </li>
              <li>
                <strong>Generate new pictures</strong>: needs an image-generator key. Each new board creates fresh surreal mashups, billed by
                the provider. Higher quality usually costs more per picture. With <em>Reuse cached pictures</em> on, a subject that was already
                generated with the same settings is reused instead of paid for again. <em>Picture subjects</em> and <em>Art style</em> apply
                only to generated pictures; surreal mashups fuse two things per picture, like Codenames Pictures.
              </li>
              <li>
                <strong>My library</strong> (free): your own picture folder plus every picture generated in earlier games. You need at least 16
                pictures (20 for the standard 5×4 board).
              </li>
            </ul>
            <h3>Decks</h3>
            <p>
              The Decks page lists every picture collection with each artwork’s title, artist and year. <em>Make standard</em> deals Quick
              Play boards from that collection.
            </p>
            <p>
              <em>Import collection…</em> adds a folder of your own pictures. Titles come from the file names (e.g. “The Golden
              Fish.jpg”). For per-picture credits, add a <span className="mono">credits.csv</span> to the folder with the columns{' '}
              <span className="mono">file,title,artist,year,source,sourceURL,license,caption</span>; the fields in the import dialog fill any
              gaps. Removing an imported collection deletes the game’s copies, never your original folder.
            </p>
            <p>
              Only import pictures you have the right to use. Artwork by living artists (and anyone who died less than about 70 years ago) is
              usually under copyright — get permission before using or sharing it.
            </p>
          </>
        )}
        {tab === 'setup' && (
          <>
            <h2>Keys and setup</h2>
            <p>
              Open Codenames uses <strong>your own API keys</strong> (“bring your own key”). Configure 1–4 language-model keys and,
              optionally, one image-generation key in <strong>Settings → AI players → API configuration</strong>. Each AI player at the table
              uses one slot, so different slots can pit different companies against each other.
            </p>
            <ul>
              <li>Each LLM slot has a company, a model and a key. <em>Test connection</em> checks the key and loads the model list.</li>
              <li>
                In Quick Play, LLM 1 plays your teammate, LLM 2 the opposing spymaster and LLM 3 the opposing operative (slots are reused if
                you configure fewer). Standard mode lets you assign any slot to any seat.
              </li>
              <li>
                Every AI player must be able to <strong>see pictures</strong>. <em>Sees pictures: Auto</em> follows what is known about the
                provider and model name; choose <em>Yes</em> for a vision model the game does not recognize (for example a local one). A slot
                whose model cannot see pictures is not used.
              </li>
              <li>OpenRouter: test the connection to load the full model list, then pick a vision model.</li>
              <li>xAI: test the connection to load the available Grok models.</li>
              <li>
                Local models: any OpenAI-compatible server — Ollama at <span className="mono">http://localhost:11434/v1</span>, LM Studio at{' '}
                <span className="mono">http://localhost:1234/v1</span> — and AUTOMATIC1111/Forge (started with --api) for pictures.
              </li>
            </ul>
            <h3>How keys are stored</h3>
            {web ? (
              <p>
                In the browser version, keys are saved in this browser’s local storage for this site, without encryption. Anyone who can use
                this browser profile, and extensions that can read the page, may be able to read them. They are sent only to the provider you
                selected — never to an Open Codenames server (there isn’t one). Delete them all in Settings → Keys & privacy. If your browser
                blocks storage for embedded pages, settings and keys are forgotten when you close the tab.
              </p>
            ) : (
              <p>
                Keys are encrypted with your operating system’s credential protection (DPAPI on Windows, Keychain on macOS, libsecret on
                Linux) and stored only on this computer. If no secure storage is available, keys are kept for the current session only. They
                are sent only to the provider you selected — never to an Open Codenames server (there isn’t one). Delete them all in Settings →
                Keys & privacy.
              </p>
            )}
            {web && (
              <>
                <h3>Browser version</h3>
                <p>
                  The browser version plays with the built-in picture collections and calls the AI providers straight from this page:
                  Anthropic, OpenAI, Google, OpenRouter, xAI and Mistral. Generating new pictures, your own picture folder, importing
                  collections and local models are available in the desktop version.
                </p>
              </>
            )}
            <h3>Privacy</h3>
            <p>
              Prompts include the board pictures and the game state. A desktop app cannot fully protect secrets from software or people that
              control this machine — use provider keys with spending limits.
            </p>
            <h3>Settings</h3>
            <ul>
              <li>
                <strong>Reset settings</strong> returns gameplay, audio and display preferences to their defaults; keys and AI configuration
                are kept.
              </li>
              <li>
                <strong>Reduce motion</strong> turns off card flips and other animations.
              </li>
            </ul>
          </>
        )}
        {tab === 'costs' && (
          <>
            <h2>Who pays for what</h2>
            <p>
              Every picture and every AI move is a request to a third-party provider, billed to <strong>your</strong> account by that
              provider. Open Codenames does not charge you and does not pay or refund provider costs.
            </p>
            <h3>Rough scale</h3>
            <ul>
              <li>The standard 5×4 board is 20 pictures. Cached pictures are reused for free when the same subject comes up again.</li>
              <li>
                A game is typically 15–30 AI calls. Each call includes small thumbnails of the board. Board pictures are sent in a stable order
                so providers that support prompt caching can bill repeats at a discount.
              </li>
              <li>Each AI clue includes one extra call that predicts how the teammate will read it.</li>
              <li>Settings → Diagnostics shows how many calls and tokens this session has used.</li>
            </ul>
            <p>
              Check each provider’s pricing page and set spending limits in their dashboard. To play for free, use the standard deck and a
              local vision model.
            </p>
          </>
        )}
        {tab === 'trouble' && (
          <>
            <h2>Troubleshooting</h2>
            <dl>
              <dt>“The API key was rejected”</dt>
              <dd>Re-enter the key in API configuration and press Test connection. Make sure it belongs to the selected company.</dd>
              <dt>“This model cannot see pictures”</dt>
              <dd>Choose a vision model for that slot, or set Sees pictures to Yes if the model can see images.</dd>
              <dt>“Temporarily rate-limited”</dt>
              <dd>The provider is throttling your account. Wait a minute and press Retry, use the Fast pace less, or spread players across slots.</dd>
              <dt>“Billing or credit problem”</dt>
              <dd>Add credit or a payment method in the provider’s dashboard.</dd>
              <dt>“Could not find the selected model”</dt>
              <dd>Press Test connection and choose a model from the list your key can use.</dd>
              <dt>“Declined for content-policy reasons”</dt>
              <dd>Picture generation automatically swaps in a different subject. For AI moves, press Retry or switch models.</dd>
              <dt>The AI said something the game couldn’t understand</dt>
              <dd>The game already retried once. Press Retry; if it keeps happening, choose a stronger model for that slot.</dd>
              <dt>Local server not reachable</dt>
              <dd>Start Ollama / LM Studio (or AUTOMATIC1111 with --api) and check the server URL.</dd>
              <dt>Something else</dt>
              <dd>Settings → Diagnostics has the technical log (with keys redacted). Copy it when reporting a problem.</dd>
            </dl>
            <p>
              <button className="link-btn" onClick={() => navigate({ name: 'disclaimer', review: true })}>
                Read the disclaimer again
              </button>
            </p>
          </>
        )}
      </article>
    </div>
  );
}
