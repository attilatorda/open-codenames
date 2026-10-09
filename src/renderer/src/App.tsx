import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppInfo } from '@shared/ipc';
import { DISCLAIMER_VERSION, type DeepPartial, type Settings } from '@shared/settings';
import { configureSfx } from './audio/sfx';
import { AppContext, type AppCtx } from './state/AppContext';
import type { Screen } from './state/nav';
import { DisclaimerScreen } from './screens/DisclaimerScreen';
import { ApiConfigScreen } from './screens/ApiConfigScreen';
import { MainMenu } from './screens/MainMenu';
import { PlayMenu } from './screens/PlayMenu';
import { MatchSetupScreen } from './screens/MatchSetupScreen';
import { BoardLoadingScreen } from './screens/BoardLoadingScreen';
import { GameScreen } from './screens/GameScreen';
import { DebriefScreen } from './screens/DebriefScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { HelpScreen } from './screens/HelpScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { DeckScreen } from './screens/DeckScreen';
import { SiteHeader } from './components/SiteHeader';

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'boot' });
  const [toastText, setToastText] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([window.oc.settings.get(), window.oc.app.info()]).then(([s, i]) => {
      setSettings(s);
      setInfo(i);
      if (i.devMock) document.title = 'Open Codenames (Debug)';
      if (s.disclaimerAcceptedVersion !== DISCLAIMER_VERSION) setScreen({ name: 'disclaimer' });
      else if (!s.setupComplete) setScreen({ name: 'config', first: true });
      else setScreen({ name: 'menu' });
    });
  }, []);

  useEffect(() => {
    if (settings) configureSfx(settings.audio.volume, settings.audio.muted);
  }, [settings]);

  useEffect(() => {
    if (!toastText) return;
    const t = setTimeout(() => setToastText(null), 3200);
    return () => clearTimeout(t);
  }, [toastText]);

  const updateSettings = useCallback(async (patch: DeepPartial<Settings>) => {
    const next = await window.oc.settings.update(patch);
    setSettings(next);
    return next;
  }, []);

  const ctx = useMemo<AppCtx | null>(
    () =>
      settings && info
        ? {
            settings,
            info,
            updateSettings,
            replaceSettings: setSettings,
            navigate: setScreen,
            toast: setToastText,
          }
        : null,
    [settings, info, updateSettings],
  );

  // The site bar appears once the first-run steps (disclaimer, first AI setup) are done.
  const header = !!ctx && screen.name !== 'boot' && !(screen.name === 'disclaimer' && !screen.review) && !(screen.name === 'config' && screen.first);

  return (
    <>
      <div className={`app${settings?.display.reduceMotion ? ' reduce-motion' : ''}`}>
        {ctx ? (
          <AppContext.Provider value={ctx}>
            {header && <SiteHeader current={screen.name} />}
            <div className="app-main">
              <ScreenSwitch screen={screen} />
            </div>
          </AppContext.Provider>
        ) : (
          <div className="boot" />
        )}
      </div>
      {toastText && (
        <div className="toast" role="status">
          {toastText}
        </div>
      )}
    </>
  );
}

function ScreenSwitch({ screen }: { screen: Screen }) {
  switch (screen.name) {
    case 'boot':
      return null;
    case 'disclaimer':
      return <DisclaimerScreen review={screen.review} />;
    case 'config':
      return <ApiConfigScreen first={screen.first} />;
    case 'menu':
      return <MainMenu />;
    case 'play':
      return <PlayMenu />;
    case 'setup':
      return <MatchSetupScreen modeId={screen.modeId} />;
    case 'loading':
      return <BoardLoadingScreen key={screen.config.id} config={screen.config} />;
    case 'game':
      return <GameScreen key={screen.config.id} config={screen.config} board={screen.board} />;
    case 'debrief':
      return <DebriefScreen record={screen.record} config={screen.config} />;
    case 'settings':
      return <SettingsScreen tab={screen.tab} />;
    case 'help':
      return <HelpScreen tab={screen.tab} />;
    case 'history':
      return <HistoryScreen />;
    case 'deck':
      return <DeckScreen />;
  }
}
