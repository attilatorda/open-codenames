import { createContext, useContext } from 'react';
import type { AppInfo } from '@shared/ipc';
import type { DeepPartial, Settings } from '@shared/settings';
import type { Screen } from './nav';

export interface AppCtx {
  settings: Settings;
  info: AppInfo;
  updateSettings: (patch: DeepPartial<Settings>) => Promise<Settings>;
  replaceSettings: (s: Settings) => void;
  navigate: (screen: Screen) => void;
  toast: (text: string) => void;
}

export const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppContext missing');
  return ctx;
}
