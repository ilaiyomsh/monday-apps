// Provider dispatcher — given a sync config (or just a provider name), returns
// the matching provider implementation. Adding a new provider = registering
// it in PROVIDERS below; no consumer changes.

import googleProvider from './providers/google/index.js';
import microsoftProvider, { isMicrosoftEnabled } from './providers/microsoft/index.js';

const PROVIDERS = {
  google: googleProvider,
  microsoft: microsoftProvider,
};

export { isMicrosoftEnabled };

export function getProvider(configOrName) {
  const name = typeof configOrName === 'string'
    ? configOrName
    : (configOrName?.provider || 'google');
  const impl = PROVIDERS[name];
  if (!impl) {
    const err = new Error(`unknown_provider: ${name}`);
    err.code = 'unknown_provider';
    throw err;
  }
  return impl;
}

export function listProviders() {
  return Object.keys(PROVIDERS);
}
