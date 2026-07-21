#!/usr/bin/env bash
# lib-eslint-flat.sh — shared ESLint-9 flat-config engine for error-guard.
#
# Sourced (never executed) by scripts/check.sh (per-file hook gate) and
# scripts/audit.sh (whole-tree gap report). Consolidating the engine here is
# deliberate: the two scripts drifting apart is exactly what let the ESLint-9
# fail-open gap survive (each carried its own copy of the invocation). One
# engine, one place to fix.
#
# HISTORY: check.sh/audit.sh were originally written for the ESLint-8 eslintrc
# engine (`--no-eslintrc --config <json> --resolve-plugins-relative-to`). The
# repo runs ESLint 9 (flat config default), which removed those flags. A stopgap
# forced eslintrc mode with ESLINT_USE_FLAT_CONFIG=false; that env var and the
# whole eslintrc engine are removed in ESLint 10, and it also depended on each
# consumed app carrying eslint-plugin-promise / @typescript-eslint/parser
# locally (most do not) — so the promise + TS rules silently dropped per app.
# This library replaces all of that with a generated flat config
# (eslint.config.mjs) plus a repo-root plugin install (see root package.json
# devDependencies), so the kit resolves uniformly regardless of the target app.
#
# Caller contract — before sourcing, set:
#   TEMPLATE    absolute path to templates/eslint-error-rules.json (rule source of truth)
#   APPS_ROOT   the repo root (has node_modules with eslint + the plugin kit)
# The library defines helper functions but performs no work on source.

# The hook checks BOTH client and server files with one config, so the
# catch-must-log selector here is the UNION of the two kits' allowances:
# logger.* / throw / showErrorWithDetails (client) / next(err) (server —
# forwarding to the terminal error middleware, which logs). The per-app ESLint
# kit stays the precise anchor (client kit does NOT allow next()).
EG_UNION_SELECTOR="CatchClause > BlockStatement:not(:has(CallExpression[callee.object.name='logger'])):not(:has(ThrowStatement)):not(:has(CallExpression[callee.name='showErrorWithDetails'])):not(:has(CallExpression[callee.name='next']))"

# --- shared file filter (single source for check.sh + audit.sh) -------------
eg_should_skip() {
  # returns 0 (skip) / 1 (keep)
  local f="$1" base
  base="$(basename "$f")"
  case "$f" in
    *.js|*.jsx|*.ts|*.tsx) : ;;
    *) return 0 ;;
  esac
  case "$f" in
    */node_modules/*|*/dist/*|*/build/*) return 0 ;;
    */__tests__/*|*/test-utils/*) return 0 ;;
    */dev-harness/*) return 0 ;;
    *.test.js|*.test.jsx|*.test.ts|*.test.tsx) return 0 ;;
    *.spec.js|*.spec.jsx|*.spec.ts|*.spec.tsx) return 0 ;;
  esac
  case "$f" in
    */services/logger/*) return 0 ;;   # server logger dir (basename is index.js)
  esac
  case "$base" in
    setupTests.*|logger.js|logger.ts) return 0 ;;
    *Sink*|*-sink.*) return 0 ;;
    # sanctioned infra files: console breadcrumbs + intentional exit-path catches
    axiomBrowserTransport.js|processGuards.js|process-guards.js) return 0 ;;
  esac
  return 1
}

# --- locate an ESLint install (prefer the repo root's full kit) --------------
eg_find_eslint_dir() {
  local d="$1"
  while [ -n "$d" ] && [ "$d" != "/" ]; do
    if [ -x "$d/node_modules/.bin/eslint" ]; then printf '%s' "$d"; return 0; fi
    d="$(dirname "$d")"
  done
  return 1
}

eg_sibling_eslint_dir() {
  local d
  for d in "$APPS_ROOT"/*/ "$APPS_ROOT"/*/*/; do
    [ -x "${d}node_modules/.bin/eslint" ] && { printf '%s' "${d%/}"; return 0; }
  done
  return 1
}

# Pick the dir whose node_modules/.bin/eslint we run. Prefer APPS_ROOT (the
# documented install, which carries the full plugin kit); fall back to an app
# up-tree or any sibling so the gate degrades instead of vanishing.
eg_resolve_eslint_root() {
  local start_dir="$1" d
  if [ -x "$APPS_ROOT/node_modules/.bin/eslint" ]; then printf '%s' "$APPS_ROOT"; return 0; fi
  if d="$(eg_find_eslint_dir "$start_dir")"; then printf '%s' "$d"; return 0; fi
  if d="$(eg_sibling_eslint_dir)"; then printf '%s' "$d"; return 0; fi
  return 1
}

# Resolve a node module's entry file, trying the repo root first (full kit) then
# a fallback dir. Empty output => not resolvable.
eg_resolve_module() {
  local mod="$1" fallback="${2:-}"
  node -e "try{process.stdout.write(require.resolve('$mod',{paths:['$APPS_ROOT','$fallback'].filter(Boolean)}))}catch(e){}" 2>/dev/null || true
}

# --- generate the flat config (eslint.config.mjs) ---------------------------
# Args: CONFIG_PATH  PROMISE_ENTRY  TSPARSER_ENTRY  TSPLUGIN_ENTRY  TYPE_AWARE(0|1)  TSCONFIG_ROOT
#   PROMISE_ENTRY  ""  => drop promise/catch-or-return (plugin unavailable)
#   TSPARSER_ENTRY ""  => no TS config block (caller must drop *.ts/*.tsx files)
#   TYPE_AWARE=1 + TSPLUGIN_ENTRY set => add @typescript-eslint/no-floating-promises
#     (type-aware; audit full-tree mode only — too heavy for the per-edit hook).
# Rules come from $TEMPLATE (single source of truth); only the catch-must-log
# selector is swapped for the client+server union and promise is dropped if absent.
eg_gen_config() {
  local cfg="$1" promise="$2" tsparser="$3" tsplugin="$4" typeaware="${5:-0}" tsroot="${6:-}"
  local hp=false; [ -n "$promise" ] && hp=true
  local rules_json
  rules_json="$(jq -c --arg sel "$EG_UNION_SELECTOR" --argjson hp "$hp" '
     (.rules
      | ."no-restricted-syntax"[1].selector = $sel
      | if $hp then . else del(."promise/catch-or-return") end)' "$TEMPLATE")"

  {
    echo "// generated by error-guard/lib-eslint-flat.sh — ESLint 9 flat config"
    echo "import { pathToFileURL } from 'node:url';"
    if $hp; then
      echo "const _p = await import(pathToFileURL('$promise').href); const promise = _p.default ?? _p;"
    fi
    if [ -n "$tsparser" ]; then
      echo "const _tp = await import(pathToFileURL('$tsparser').href); const tsParser = _tp.default ?? _tp;"
    fi
    if [ "$typeaware" = 1 ] && [ -n "$tsplugin" ]; then
      echo "const _te = await import(pathToFileURL('$tsplugin').href); const tseslint = _te.default ?? _te;"
    fi
    # $rules_json is a variable expansion — its literal backticks/quotes are NOT
    # re-scanned by the shell, so the message text is embedded verbatim.
    echo "const rules = $rules_json;"
    if $hp; then echo "const basePlugins = { promise };"; else echo "const basePlugins = {};"; fi
    echo "const jsLang = { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } };"
    echo "export default ["
    echo "  { files: ['**/*.{js,jsx,mjs,cjs}'], languageOptions: jsLang, plugins: basePlugins, rules },"
    if [ -n "$tsparser" ]; then
      if [ "$typeaware" = 1 ] && [ -n "$tsplugin" ]; then
        cat <<JS
  { files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: { parser: tsParser, ecmaVersion: 'latest', sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true }, projectService: true, tsconfigRootDir: '$tsroot' } },
    plugins: { ...basePlugins, '@typescript-eslint': tseslint },
    rules: { ...rules, '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }] } },
JS
      else
        cat <<'JS'
  { files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: { parser: tsParser, ecmaVersion: 'latest', sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: basePlugins, rules },
JS
      fi
    fi
    echo "];"
  } > "$cfg"
}

# --- run ESLint over the given files, JSON to $1 ----------------------------
# Args: OUT_JSON  ERR_TXT  ESLINT_BIN  CONFIG  <files...>
# ESLint flat config only lints files under its base path (cwd), so we run from
# APPS_ROOT — every app file is under it. --no-config-lookup + --config makes our
# minimal kit the ONLY config (the target app's own eslint.config is ignored).
# --no-inline-config: an app file's own eslint-disable comments can name rules
# this minimal config doesn't define (ESLint would report those as ruleId-bearing
# messages and false-fail the gate); it also stops inline comments silencing the
# error-guard rules themselves.
eg_run_eslint() {
  local out="$1" err="$2" bin="$3" cfg="$4"; shift 4
  ( cd "$APPS_ROOT" && "$bin" --no-config-lookup --no-inline-config --config "$cfg" \
      --format json "$@" ) > "$out" 2>"$err" || true
}
