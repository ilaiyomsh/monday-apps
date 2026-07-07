# RTL + CSS trap checklist

Run this checklist during the post-generation verify step and before shipping
any UI change in a scaffolded app. Every item below burned real sessions in
sibling apps (discussions, Axis/Day-off, Axis/tracker) — these are not
hypothetical.

## RTL defaults in this scaffold

- `index.html` ships `<html lang="he" dir="rtl">` — RTL is the default, not a
  retrofit. `useMondayContext` re-syncs `document.documentElement.dir`/`lang`
  from `context.user.currentLanguage` at runtime.
- Write **logical** CSS properties by default: `inset-inline-start`,
  `padding-inline-start`, `margin-inline-end`, `text-align: start`, `border-start-start-radius`.
  Physical `left/right` are allowed ONLY inside a `dir="ltr"` island, with a
  comment saying so (see `apps/discussions` CreateTaskFab: "explicit RIGHT —
  ancestors are dir='ltr'; do NOT use inset-inline-end").
- LTR islands are legitimate: numeric/date content, code, some toolbars. Mark
  them explicitly with `dir="ltr"` on the wrapper element.

## Trap 1 — `position: fixed` under a transform ancestor

If ANY ancestor has `transform`, `filter`, `perspective`, or
`backdrop-filter`, `position: fixed` stops being viewport-fixed and anchors to
that ancestor instead. Symptoms: a dropdown/dialog renders offset, clipped, or
"sticks" to a card. monday board views live inside containers you don't
control, so you cannot rule ancestors out.

**Fix:** portal the floating element to `document.body` and position it with
viewport coordinates. Use the bundled `Popover` component
(`src/components/shared/Popover.jsx`) or the same pattern in `PersonPicker` —
do not hand-position inside the DOM tree.

## Trap 2 — `position: sticky` inside `overflow: hidden`

Sticky positioning silently degrades to static when any ancestor between the
sticky element and its scroll container has `overflow: hidden` (or `clip`/
`auto` on the wrong axis). Symptom: a sticky table header/column that "just
doesn't stick" with zero errors.

**Fix:** make the element that actually scrolls (`overflow-y: auto`) the
DIRECT clipping ancestor of the sticky element; audit intermediate wrappers
with dev tools (`Computed → overflow`) rather than guessing. If a wrapper
needs rounded-corner clipping, move the clip to a non-ancestor sibling or use
`clip-path` on a deeper node.

## Trap 3 — cross-module CSS-module class references that hash away in prod

Referencing a class from ANOTHER `.module.css` file by its dev-time name
(e.g. `.popover .row` written in a different module, or querying
`document.querySelector('.trigger')`) works in dev — where names may be
readable — and breaks in production where every class becomes a hash.
Vitest configs that set `classNameStrategy: 'non-scoped'` make tests blind to
this exact bug: tests pass, prod breaks.

**Fix:** a module may only reference classes it defines. To style a child
component, pass a `className` prop (all bundled components accept one). To
reach third-party internals (`@vibe/core`), use `:global(...)` explicitly —
that documents the escape hatch and survives hashing.

## Trap 4 — bidi quote/punctuation escaping in Hebrew strings

Neutral characters (quotes, hyphens, parentheses, dots between numbers) get
reordered by the bidi algorithm at RTL/LTR boundaries. Classic symptoms:
`"13.7 - 15.7"` reading reversed, a trailing `"` or `(` jumping to the other
side of a mixed Hebrew/English label, JSX apostrophes breaking the string.

**Fix:**
- Date ranges: never render raw `start - end` text into an RTL context — use
  the bundled `DateRangeDisplay` (a `dir="ltr"` span, ported from
  Axis/Day-off's `Rng`). Do not fix with invisible RLM/LRM characters pasted
  into strings; they get lost in copy/edit.
- Mixed-direction labels: wrap the LTR fragment in `<span dir="ltr">` or use
  `unicode-bidi: isolate` — isolation, not override.
- In JSX, prefer explicit escapes (`&quot;`, `&#39;`) or template literals for
  Hebrew strings containing quotes; check rendered output in an actual RTL
  page, not just the code.

## Verify-step usage

During post-generation verify (dev server on the mock harness):

1. Confirm `<html>` has `dir="rtl"` and the layout reads right-to-left.
2. Open every popover/menu once — confirm it positions correctly (Trap 1).
3. Scroll any table/list with sticky headers (Trap 2).
4. `pnpm build` and spot-check the preview for styles that vanished (Trap 3).
5. Render one date range and one mixed Hebrew/English label (Trap 4).
