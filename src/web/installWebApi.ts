import { createWebApi } from './webApi';

// Must run before the UI module is evaluated: the UI reads `window.oc` on start-up.
window.oc = createWebApi();
