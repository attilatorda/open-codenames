import type { OcApi } from '@shared/ipc';

declare global {
  interface Window {
    oc: OcApi;
  }
}

export {};
