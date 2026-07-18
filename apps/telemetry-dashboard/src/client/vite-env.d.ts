/// <reference types="vite/client" />

// Injected by vite.config.ts `define`.
declare const __APP_VERSION__: string;
declare const __BUILD_SHA__: string;
declare const __IS_RELEASE__: boolean;

// monday-sdk-js ships no types.
declare module 'monday-sdk-js';
