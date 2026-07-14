import '@vibe/core/tokens'; // @vibe/core design tokens — must load before our CSS
import './i18n';
import './styles/tokens.css';
import './styles/app.css';
import { bootstrapApp } from '@axis/app-core';
import { logger } from './core';
import { versionLabel } from './utils/versionLabel';
import App from './App';

// Version layer (docs/monday-cicd-spec.md): one line at boot, same label shown in Settings.
console.info('[day-off] ' + versionLabel);

// bootstrapApp: polyfill + global error handlers + render (standard #6 + startup).
bootstrapApp({ logger, children: <App /> });
