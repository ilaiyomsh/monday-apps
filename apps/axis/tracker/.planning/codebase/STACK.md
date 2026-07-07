# Technology Stack

**Analysis Date:** 2026-01-25

## Languages

**Primary:**
- JavaScript (JSX) - React components, hooks, utilities
- CSS Modules - Component styling with SASS support

## Runtime

**Environment:**
- Node.js (version unspecified in config, inferred from pnpm usage)

**Package Manager:**
- pnpm - Used across all scripts
- Lockfile: `pnpm-lock.yaml` (present)

## Frameworks

**Core:**
- React 18.2.0 - UI library with hooks
- React DOM 18.2.0 - DOM rendering

**Calendar & Scheduling:**
- react-big-calendar 1.19.4 - Calendar component with drag-drop, resize, and multiple view modes
- date-fns 4.1.0 - Date manipulation and formatting with Hebrew locale support

**UI Components:**
- @vibe/core 3.77.0 - Monday.com design system CSS and component tokens
- @vibe/icons 1.16.0 - Icon library (NavigationChevronLeft, NavigationChevronRight, DropdownChevronDown)
- lucide-react 0.555.0 - Additional icon set

**Build & Dev:**
- Vite 6.2.2 - Build tool and dev server
- @vitejs/plugin-react 4.3.2 - React Fast Refresh support

**Testing:**
- No testing framework configured

## Key Dependencies

**Critical:**
- monday-sdk-js 0.5.5 - Monday.com JavaScript SDK for GraphQL API calls via `monday.api()`
- @mondaycom/apps-sdk 2.1.2 - Monday.com Apps SDK for iframe context and permissions

**Infrastructure:**
- @hebcal/core 6.0.8 - Hebrew calendar library for Israeli holiday calculations
- concurrently 5.2.0 - Run multiple npm scripts in parallel (dev server + tunnel)
- cross-port-killer / kill-port 1.2.1 - Stop dev processes on port 8301, 4049, 4040

**Development:**
- @mondaycom/apps-cli 4.7.4 - CLI for tunnel creation and code deployment to Monday
- sass 1.54.8 - SASS compiler for CSS modules
- patch-package 8.0.1 - Apply npm patches to dependencies (patches/ directory)
- eslint-config-react-app 7.0.1 - ESLint configuration

## Configuration

**Environment:**
- `.env` file with `PORT=8301`, `BROWSER=none`, `TUNNEL_SUBDOMAIN`, `ZIP` (Monday app CDN link)
- Vite config in `vite.config.js`:
  - Output directory: `build/`
  - Dev server port: 8301
  - Allowed hosts: `.apps-tunnel.monday.app` (for tunnel access)

**Build:**
- `vite.config.js` - Single config file
- `.npmrc` - `legacy-peer-deps=true` to allow peer dependency mismatches

**HTML Entry Point:**
- `index.html` with:
  - RTL (right-to-left) Hebrew support: `<html lang="he" dir="rtl">`
  - Google Fonts: Rubik font family (300-900 weights)
  - Root element: `<div id="root"></div>`
  - Entry script: `/src/index.jsx` (ES module)

## Platform Requirements

**Development:**
- Node.js + pnpm
- Port 8301 for dev server
- Port 4049, 4040 for tunnel (mapps CLI)
- Internet connectivity for Monday API

**Production:**
- Deployment target: Monday.com board view iframe
- Deployment method: Monday mapps CLI (`pnpm deploy` → `vite build` + `mapps code:push`)
- Build artifact: `build/` directory (Vite output)
- CDN for built assets: Monday.com CDN (url in .env `ZIP` variable)

## Script Commands

**Development:**
- `pnpm start` - Start dev server + tunnel (kills ports first)
- `pnpm run server` - Dev server only on port 8301
- `pnpm run expose` - Create tunnel via `mapps tunnel:create`
- `pnpm run stop` - Kill processes on ports 8301, 4049, 4040

**Build & Deploy:**
- `pnpm run build` - Run `vite build` → outputs to `build/`
- `pnpm run deploy` - Full deploy: build + push to Monday via `mapps code:push`

**Other:**
- `pnpm run postinstall` - Auto-run `patch-package` after npm install

---

*Stack analysis: 2026-01-25*
