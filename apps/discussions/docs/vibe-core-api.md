# @vibe/core — API quick reference (for this app's migration)

> **The app now runs @vibe/core v4 + React 19.** v4 deltas from the v3 notes below:
> - **No static enums** (`Button.kinds`, `Text.types`, etc. were removed) — pass the **string values**
>   directly: `kind="primary"|"secondary"|"tertiary"`, `size="xxs"|"xs"|"small"|"medium"|"large"`,
>   `Text type="text1|text2|text3"` `weight="bold|medium|normal"` `color="secondary"`,
>   `Avatar size="small|medium"`, `Skeleton type="rectangle"`, `Label kind="line"` `color`
>   (status: `"done-green"`, `"working_orange"`, `"stuck-red"`, `"dark"`).
> - **`DatePicker` moved to the main entry** — `import { DatePicker } from '@vibe/core'` (no longer `/next`);
>   props unchanged (`mode="single"`, `date`, `onDateChange`).
> - findDOMNode is gone from v4's bundled react-select, so Dropdown works under React 19.
>
> The reference below was captured against v3.88.1; component names/props are largely the same in v4,
> but use string literals (not `.kinds`/`.types` statics).

Verified against the installed `@vibe/core@3.88.1` / `@vibe/icons@1.16.0` `.d.ts` files.
Import from `@vibe/core` unless noted as `@vibe/core/next`. Most components are
**default exports re-exported as named** from `@vibe/core` (so `import { Button } from '@vibe/core'` works).
Tokens are loaded once in `src/index.jsx` via `import '@vibe/core/tokens'`.

## Layout / typography
- `Flex` — `direction` ("row"|"column"…), `gap` (number|Flex.gaps.*), `align`, `justify`, `wrap`. Statics: `Flex.directions/justify/align/gaps`.
- `Box` — `padding*`, `margin*`, `rounded`, `shadow`, `border`, `backgroundColor`, `scrollable`, `elementType`.
- `Text` — `type`, `weight`, `color`, `align`. `Heading` — `type` ("h1".."h5"), `weight`, `color`.

## Inputs
- `TextField` — `value`, `onChange(value, event)` ← **value-first**, `placeholder`, `title` (label), `size`, `validation={{status:'error',text}}`, `iconName`, `maxLength`. Statics `TextField.sizes`.
- `TextArea` — `value`, `onChange(event)` ← **event** (use `e.target.value`), `placeholder`, `size` ("small"|"large"), `error`, `label`, `maxLength`, `resize`.
- `Checkbox` — `checked`, `onChange(event)` (`e.target.checked`), `label`, `indeterminate`, `disabled`.
- `Dropdown` — `options:[{value,label}]`, `value`, `onChange(option, meta)`, `multi`, `searchable`, `clearable`, `placeholder`, `size`, `menuPlacement`.
- `DatePicker` (`@vibe/core/next`) — `date:Date`, `onDateChange(date)`, `mode` "single"|"range", `locale` (date-fns), `isDateDisabled`. Uses `Date`, not moment.

## Containers / overlays
- `Modal` (+ `ModalHeader`, `ModalContent`) — Modal: `id` (**required**), `show` (**not** open), `onClose(event)`, `size` ("small"|"medium"|"large"|"full-view"), `alertModal`. ModalHeader: `title`, `description`.
- `Dialog` (popover) — `content` (node|fn), `children` (trigger), `position`, `showTrigger`/`hideTrigger` ("click"|"hover"…), `open` (controlled), `moveBy`. Pair with `DialogContentContainer` for the panel chrome.
- `Tooltip` — `content`, `position`, `children`, `showTrigger`/`hideTrigger`.
- `Tabs`: `TabsContext activeTabId={n}` > (`TabList activeTabId onTabChange={(id)=>}` > `Tab`) + (`TabPanels activeTabId` > `TabPanel`).

## Display
- `Button` — `kind` (Button.kinds.PRIMARY|SECONDARY|TERTIARY), `size`, `color`, `onClick`, `loading`, `leftIcon`/`rightIcon` (icon component). `IconButton` — icon-only.
- `Avatar` — `src`, `text`, `size`, `type`, `backgroundColor`/`customBackgroundColor`, `square`. Statics `Avatar.sizes/types/colors`.
- `Label` (chip) — `text`, `color` (Label.colors.*), `kind`, `size`. `Counter` — `count`, `color`, `size`, `prefix`.
- `Skeleton` — `type` ("circle"|"rectangle"|"text"), `width`, `height`, `fullWidth`, `size`.
- `ExpandCollapse` — `title`, `open`, `onClick`, `iconPosition`, `hideBorder`, children.
- `Loader` — `size`, `color`, `hasBackground`.
- `Toast` — `open`, `type` ("normal"|"positive"|"negative"|"warning"|"dark"), `autoHideDuration`, `onClose`, `closeable`, `actions:[{type:'button'|'link',content,onClick}]`, `action` (single JSX). Statics `Toast.types/actionTypes`.
- `Table` (+ `TableHeader`,`TableHeaderCell`,`TableBody`,`TableRow`,`TableCell`) — Table: `columns:[{id,title,width?}]`, `dataState`, `emptyState`, `errorState`, `size`. Children: `<TableHeader>` (cells) + `<TableBody>` (rows).

## Icons
`import { Add, CloseSmall, Delete, Calendar, Search, ... } from '@vibe/icons'` → pass component to `leftIcon`/`icon` props.

## Tokens (CSS vars for CSS Modules)
Spacing `--spacing-xs|small|medium|large|xl`; colors `--primary-color`, `--text-color`, `--secondary-text-color`, `--positive-color`, `--negative-color`, `--warning-color`, `--ui-border-color`, `--ui-background-color`, `--placeholder-color`, named `--color-<name>`; type `--font-size-h1..`, `--font-weight-bold|normal`; shadows `--box-shadow-xs|small|medium|large`; motion `--motion-*`.

## Gotchas
- TextField onChange is **value-first**; TextArea onChange is **event**.
- Modal uses `show`, not `open`; `id` required.
- Toast `type` values are positive/negative/normal/warning/dark (not success/error).
- DatePicker lives in `@vibe/core/next` and speaks `Date`.
