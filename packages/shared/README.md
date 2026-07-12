# packages/shared — empty stub (read before adding code)

This package is a placeholder: it exports nothing and **no app imports it**.

The REAL shared runtime code lives in `apps/axis/services/app-core`
(`@axis/app-core`), consumed by tracker and day-off. New cross-app code belongs
there or in a deliberate new package — **not here** — because every deploy
workflow triggers on `packages/shared/**`: any change to this directory
redeploys ALL five apps (owner decision 2026-07-12: the stub and its triggers
stay as a safety net for a future genuinely-global package).
