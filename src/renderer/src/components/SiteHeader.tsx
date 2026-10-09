import { useApp } from '../state/AppContext';
import type { Screen } from '../state/nav';
import { play } from '../audio/sfx';

const LINKS: { label: string; screen: Screen; match: Screen['name'][]; testId: string }[] = [
  { label: 'Play', screen: { name: 'menu' }, match: ['menu', 'play', 'setup', 'loading', 'game', 'debrief'], testId: 'nav-play' },
  { label: 'History', screen: { name: 'history' }, match: ['history'], testId: 'nav-history' },
  { label: 'Decks', screen: { name: 'deck' }, match: ['deck'], testId: 'nav-deck' },
  { label: 'Settings', screen: { name: 'settings' }, match: ['settings', 'config'], testId: 'nav-settings' },
  { label: 'Help', screen: { name: 'help' }, match: ['help'], testId: 'nav-help' },
];

/** The dark site bar across the top of every screen. */
export function SiteHeader({ current }: { current: Screen['name'] }) {
  const { navigate, info } = useApp();
  return (
    <header className="site-header">
      <button
        className="site-logo"
        onClick={() => {
          play('click');
          navigate({ name: 'menu' });
        }}
      >
        <span className="site-logo-mark" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        Open Codenames
      </button>
      <nav className="site-nav">
        {LINKS.map((l) => (
          <button
            key={l.label}
            className={l.match.includes(current) ? 'active' : ''}
            onClick={() => {
              play('click');
              navigate(l.screen);
            }}
            data-testid={l.testId}
          >
            {l.label}
          </button>
        ))}
      </nav>
      <div className="spacer" />
      {info.devMock && <span className="site-debug">DEBUG</span>}
      <span className="site-version">v{info.version}</span>
    </header>
  );
}
