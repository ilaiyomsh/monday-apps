/// <reference types="vite/client" />

// Version layer constants injected at build time (vite.config.ts `define`).
declare const __APP_VERSION__: string;
declare const __BUILD_SHA__: string;
declare const __IS_RELEASE__: boolean;
