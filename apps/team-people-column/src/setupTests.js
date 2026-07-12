// Vitest global test setup.
//
// Explicitly registers jest-dom matchers (toBeInTheDocument, etc.) via the
// vitest-specific entry point rather than relying on any implicit/ambient
// registration — a known pnpm-hoisting incident (jest-dom's package.json
// "exports" map resolving to the wrong build when hoisted under pnpm) makes
// implicit setup unreliable. This import self-registers into vitest's global
// `expect` as a side effect; nothing else is needed here.
import '@testing-library/jest-dom/vitest';
