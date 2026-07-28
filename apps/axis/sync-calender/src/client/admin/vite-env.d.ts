/// <reference types="vite/client" />

// Version layer constants injected at build time (vite.config.ts `define`).
declare const __APP_VERSION__: string;
declare const __BUILD_SHA__: string;
declare const __IS_RELEASE__: boolean;

// Axiom error sink env — baked by the deploy workflows' client build step
// (empty/undefined in dev/tunnel/test → the sink self-gates to a no-op).
interface ImportMetaEnv {
  readonly VITE_AXIOM_DATASET?: string;
  readonly VITE_AXIOM_TOKEN?: string;
  readonly VITE_AXIOM_APP?: string;
  readonly VITE_AXIOM_ENV?: string;
}
