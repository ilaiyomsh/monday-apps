import '@vibe/core/tokens'; // @vibe/core design tokens — must load before our CSS
import './i18n';
import './styles/tokens.css';
import './styles/app.css';
import { bootstrapApp, attachAxiomSink } from '@axis/app-core';
import { logger, axiomEnv } from './core';
import { versionLabel } from './utils/versionLabel';
import App from './App';

// Version layer (docs/monday-cicd-spec.md): one line at boot, same label shown in Settings.
console.info('[day-off] ' + versionLabel);

// Attach the shared Axiom sink BEFORE render so the ring-buffer replay and the live
// sink don't overlap (no double-ship). Inert unless PROD + dataset + token are baked
// into the bundle (VITE_AXIOM_DATASET / VITE_AXIOM_TOKEN).
attachAxiomSink(logger, axiomEnv);

// bootstrapApp: polyfill + global error handlers + render (standard #6 + startup).
bootstrapApp({ logger, children: <App /> });
