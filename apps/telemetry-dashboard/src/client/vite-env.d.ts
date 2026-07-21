/// <reference types="vite/client" />

// Injected by vite.config.ts `define`.
declare const __APP_VERSION__: string;
declare const __BUILD_SHA__: string;
declare const __IS_RELEASE__: boolean;

// Axiom error-sink activation gate (baked into the client bundle at build time by CI;
// absent in dev/tunnel/test → the sink stays structurally inert). See utils/axiomErrorSink.ts.
interface ImportMetaEnv {
  readonly VITE_AXIOM_DATASET?: string;
  readonly VITE_AXIOM_TOKEN?: string;
  readonly VITE_AXIOM_APP?: string;
  readonly VITE_AXIOM_ENV?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// monday-sdk-js ships no types.
declare module 'monday-sdk-js';
