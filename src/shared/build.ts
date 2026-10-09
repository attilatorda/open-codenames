// Build flavor, fixed at build time by OC_BUILD (see electron.vite.config.ts and vite.web.config.ts).
// Debug builds include the offline mock AI and placeholder image generator; release builds leave
// them out entirely (the constant lets the bundler drop that code).

declare const __OC_DEBUG__: boolean;

export const DEBUG_BUILD: boolean = __OC_DEBUG__;
