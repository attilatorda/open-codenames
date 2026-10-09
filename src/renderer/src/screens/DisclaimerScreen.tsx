import { useState } from 'react';
import { DISCLAIMER_VERSION } from '@shared/settings';
import { useApp } from '../state/AppContext';
import { Icon } from '../components/Icon';
import { play } from '../audio/sfx';

export const DISCLAIMER_POINTS: { title: string; body: string }[] = [
  {
    title: 'Third-party AI services',
    body: 'Open Codenames uses AI services run by other companies (for example Anthropic, OpenAI, Google, Stability AI or Black Forest Labs) to generate pictures and to power the AI players.',
  },
  {
    title: 'You bring your own API keys',
    body: 'You supply your own API keys. Those providers may charge you for every request the game makes. Open Codenames does not pay these costs and cannot refund them.',
  },
  {
    title: 'Pricing and terms are yours to check',
    body: 'You are responsible for understanding each provider’s pricing, usage limits and terms of service, and for monitoring your spending in their dashboards.',
  },
  {
    title: 'AI output can be wrong or unexpected',
    body: 'AI-generated pictures, clues and reasoning may be inaccurate, strange, inappropriate or biased. They do not represent the views of Open Codenames.',
  },
  {
    title: 'Outages and rate limits happen',
    body: 'Third-party services can be slow, unavailable, or rate-limit your account. The game handles this as gracefully as it can, but cannot prevent it.',
  },
  {
    title: 'Your keys stay on this computer',
    body: 'API keys are stored locally, encrypted with your operating system’s credential protection where available. Open Codenames does not intentionally send your keys to any Open Codenames server — they go only to the provider you chose.',
  },
  {
    title: 'Honest limits of desktop security',
    body: 'A desktop application cannot guarantee absolute secrecy of credentials from someone (or some software) that controls this machine. Use keys with spending limits, and delete them from Settings when you no longer need them.',
  },
];

/** The browser version keeps keys in the browser instead of the operating system's key store. */
const WEB_KEY_POINTS: { title: string; body: string }[] = [
  {
    title: 'Your keys stay in this browser',
    body: 'In the browser version, API keys are saved in this browser’s local storage for this site, without encryption. They are sent only to the provider you chose — never to an Open Codenames server.',
  },
  {
    title: 'Honest limits of browser security',
    body: 'Anyone who can use this browser profile, and browser extensions that can read this page, may be able to read the keys. Use keys with spending limits, and delete them in Settings when you no longer need them.',
  },
];

export function DisclaimerScreen({ review }: { review?: boolean }) {
  const { updateSettings, navigate, settings, info } = useApp();
  const points = info.platform === 'web' ? [...DISCLAIMER_POINTS.slice(0, 5), ...WEB_KEY_POINTS] : DISCLAIMER_POINTS;
  const [agreed, setAgreed] = useState(false);

  const accept = async () => {
    play('click');
    await updateSettings({ disclaimerAcceptedVersion: DISCLAIMER_VERSION });
    navigate(settings.setupComplete ? { name: 'menu' } : { name: 'config', first: true });
  };

  return (
    <div className="page">
      <div className="disclaimer section">
        <div className="disclaimer-head">
          <h1 className="h1">Important information</h1>
        </div>
        <p className="muted disclaimer-lead">
          Open Codenames is a Codenames-style game played with AI-generated pictures and AI teammates. Please read this
          carefully — it explains who pays for what, and how your keys are handled.
        </p>
        <ol className="disclaimer-list">
          {points.map((p) => (
            <li key={p.title}>
              <strong>{p.title}.</strong> <span>{p.body}</span>
            </li>
          ))}
        </ol>
        {review ? (
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => navigate({ name: 'help' })}>
              <Icon name="back" /> Back to Help
            </button>
          </div>
        ) : (
          <div className="disclaimer-actions">
            <label className="checkbox">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>I have read this, I understand that third-party providers may charge me, and I agree.</span>
            </label>
            <button className="btn btn-primary btn-lg" disabled={!agreed} onClick={() => void accept()}>
              Continue
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
