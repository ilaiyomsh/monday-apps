/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __BUILD_SHA__: string;
declare const __IS_RELEASE__: boolean;

// Axiom logging v2 — client sink activation vars (baked into the bundle via
// .env.production.local, never committed; see axiomErrorSink.ts activation gate).
interface ImportMetaEnv {
  readonly VITE_AXIOM_DATASET?: string;
  readonly VITE_AXIOM_TOKEN?: string;
  readonly VITE_AXIOM_APP?: string;
  readonly VITE_AXIOM_ENV?: string;
}
