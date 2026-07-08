import '@vibe/core/tokens'; // @vibe/core design tokens — must load before our CSS
import './i18n';
import './styles/tokens.css';
import './styles/app.css';
import { bootstrapApp } from '@axis/app-core';
import { logger } from './core';
import App from './App';

// bootstrapApp: polyfill + global error handlers + render (standard #6 + startup).
bootstrapApp({ logger, children: <App /> });
