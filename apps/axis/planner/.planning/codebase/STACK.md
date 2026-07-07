# Technology Stack

**Analysis Date:** 2026-01-25

## Languages

**Primary:**
- TypeScript ~5.9.3 - All source code, strict mode enabled
- JavaScript (Node.js) - Build and configuration files

**Secondary:**
- CSS 4 (via Tailwind PostCSS) - Styling

## Runtime

**Environment:**
- Node.js (no specific version pinned in .nvmrc)

**Package Manager:**
- pnpm 9.15.4 - Required and enforced via packageManager field in `package.json`
- Lockfile: pnpm-lock.yaml (managed by pnpm)

## Frameworks

**Core:**
- React 19.2.0 - UI framework, functional components with hooks
- React DOM 19.2.0 - DOM rendering

**Build/Dev:**
- Vite 7.2.4 - Build tool and dev server (port 8301)
- @vitejs/plugin-react 5.1.1 - React fast refresh
- @tailwindcss/vite 4.1.18 - Tailwind integration

**Styling:**
- Tailwind CSS 4.1.18 - Utility-first CSS framework
- @tailwindcss/postcss 4.1.18 - PostCSS plugin
- tailwind-merge 3.4.0 - Merge Tailwind class names

**Testing:**
- Not detected

## Key Dependencies

**Critical:**
- monday-sdk-js 0.5.7 - Monday.com platform SDK for context, storage, and API access
- @mondaycom/apps-sdk 3.2.1 - Monday.com apps-specific utilities
- @mondaycom/apps-cli 4.10.5 - CLI for Monday.com app development (dev only)

**UI Components:**
- @vibe/core 3.83.1 - Monday.com's design system component library and tokens

**Drag & Drop:**
- @dnd-kit/core 6.3.1 - Headless drag-and-drop library
- @dnd-kit/modifiers 9.0.0 - Positioning modifiers for dnd-kit
- @dnd-kit/utilities 3.2.2 - Utility functions for dnd-kit

**Data & Utilities:**
- @tanstack/react-virtual 3.13.18 - Virtual scrolling for large lists
- date-fns 4.1.0 - Date manipulation and formatting
- react-use-measure 2.1.7 - React hook for measuring DOM elements
- clsx 2.1.1 - Utility for constructing className strings

## Development Tools

**Linting:**
- ESLint 9.39.1 - JavaScript/TypeScript linter
- @eslint/js 9.39.1 - ESLint recommended config
- typescript-eslint 8.46.4 - TypeScript support for ESLint
- eslint-plugin-react-hooks 7.0.1 - React hooks rules
- eslint-plugin-react-refresh 0.4.24 - React fast refresh rules
- globals 16.5.0 - Global variables for environments

**Build/Dev Utilities:**
- TypeScript 5.9.3 - TypeScript compiler (dev only)
- @types/react 19.2.5 - React type definitions
- @types/react-dom 19.2.3 - React DOM type definitions
- @types/node 24.10.1 - Node.js type definitions

**Process Management:**
- concurrently 9.2.1 - Run multiple commands concurrently
- cross-port-killer 1.4.0 - Kill processes on ports (used in pnpm stop)

**CSS Processing:**
- PostCSS 8.5.6 - CSS transformation framework
- autoprefixer 10.4.23 - Add vendor prefixes to CSS

## Configuration

**Environment:**
- Development: localhost with fallback mock data via `useMondaySettings`
- App runs inside Monday.com iframe with access to monday.get('context')
- No .env files detected - all configuration via Monday Instance Storage

**Build:**
- `vite.config.ts` - Vite configuration with React and Tailwind plugins
- `tsconfig.json` - TypeScript references config
- `tsconfig.app.json` - Application TypeScript config
  - Target: ES2022
  - Module: ESNext
  - jsx: react-jsx
  - Strict mode enabled
  - Module resolution: bundler
  - noEmit: true
- `eslint.config.js` - ESLint flat config with React and TypeScript rules
- `postcss.config.js` - PostCSS configuration with Tailwind plugin

**Monday.com Integration:**
- API Version: 2026-01 (hardcoded in `src/services/mondayService.ts`)
- Storage: monday.storage.instance for persistent app settings
- Dev Server: Configured for Monday.com tunnel (port 8301)
  - Allowed hosts: `.monday.app`, `.apps-tunnel.monday.app`

## Platform Requirements

**Development:**
- Node.js (version not specified, recommend 18+)
- pnpm 9.15.4
- Access to Monday.com account for testing
- Port 8301 available for dev server
- Tunnel support via `mapps tunnel:create`

**Production:**
- Deployment target: Monday.com apps platform via `mapps code:push`
- Output: Static SPA (Vite builds to `dist/`)
- Runs within Monday.com iframe context

## Project Configuration

**TypeScript Compiler Options:**
- Strict mode: true
- skipLibCheck: true
- Module detection: force
- No emit: true (type checking only, Vite handles transpilation)
- noUncheckedSideEffectImports: true
- noFallthroughCasesInSwitch: true

**Dependencies Resolution:**
- Path aliases: Not detected (standard node resolution)
- ES modules: true (type: "module" in package.json)

---

*Stack analysis: 2026-01-25*
