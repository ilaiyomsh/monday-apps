// Structure-aware reader for GitHub Actions workflow steps — node stdlib only, matching
// error-wiring-audit.mjs's "no dependencies" constraint.
//
// Why this exists: the audit used to check deploy-workflow Axiom wiring with
// `text.includes('VITE_AXIOM_TOKEN')`. That passes on a workflow where the key sits in a
// comment, inside a `run:` script body, or — as actually shipped — in a SECOND `env:` block
// appended to a step that already had one. A duplicate mapping key is rejected by GitHub's
// own workflow validator, and where a parser tolerates it the first block silently loses;
// either way the audit reported the wiring as present while the deploy was broken. A gate
// that cannot see structure cannot catch a structural defect.

/**
 * @typedef {{ keys: string[], duplicates: string[] }} Block
 * @typedef {{ name: string|null, line: number, duplicateKeys: string[], env: Block|null }} Step
 */

const indentOf = (line) => line.length - line.trimStart().length;
const skippable = (line) => line.trim() === '' || line.trimStart().startsWith('#');
/** `key:` or `key: value` — not a list item, not a comment. */
const KEY_RE = /^([A-Za-z_][\w.-]*)\s*:(?:\s|$)/;
const ITEM_RE = /^-\s+/;

/**
 * Collect the steps of every job in a workflow, with the mapping keys of each step and of
 * its `env:` block, plus any key that appears twice at the same level.
 *
 * Deliberately narrow: only keys at exactly the step's key indentation, and inside `env:`
 * only keys at exactly the env block's key indentation. A block-scalar body (`run: |`) is
 * always more indented than its own key, so its contents can never be read as step keys.
 *
 * @param {string} text raw workflow YAML
 * @returns {Step[]}
 */
export function parseWorkflowSteps(text) {
  const lines = text.split('\n');
  /** @type {Step[]} */
  const steps = [];
  let stepsIndent = -1; // -1 = not currently inside a `steps:` block

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (skippable(line)) continue;
    const indent = indentOf(line);

    if (stepsIndent === -1) {
      if (/^steps\s*:\s*$/.test(line.trim())) stepsIndent = indent;
      continue;
    }
    if (indent <= stepsIndent) {
      // Dedented out of the steps block. The line is NOT re-examined as a `steps:` header:
      // a job's `steps:` always sits deeper than the job key that dedents out of the
      // previous one, so it is always reached on a later iteration with stepsIndent reset.
      stepsIndent = -1;
      continue;
    }
    if (!ITEM_RE.test(line.trimStart())) continue;

    const { step, lastLine } = collectStep(lines, i, indent + 2);
    steps.push(step);
    i = lastLine;
  }
  return steps;
}

/**
 * @param {string[]} lines
 * @param {number} start index of the `- …` line that opens the step
 * @param {number} keyIndent column at which the step's own keys sit
 * @returns {{ step: Step, lastLine: number }}
 */
function collectStep(lines, start, keyIndent) {
  const seen = [];
  const duplicateKeys = [];
  /** @type {Block|null} */
  let env = null;
  let name = null;
  let i = start;

  for (; i < lines.length; i++) {
    const raw = lines[i];
    if (skippable(raw)) continue;
    const first = i === start;
    const indent = first ? keyIndent : indentOf(raw);
    const text = first ? raw.trimStart().replace(ITEM_RE, '') : raw.trimStart();

    if (!first) {
      if (indent < keyIndent) break; // dedent ends the step
      if (indent === keyIndent && ITEM_RE.test(text)) break; // next step begins
      if (indent !== keyIndent) continue; // nested content of one of this step's keys
    }

    const m = KEY_RE.exec(text);
    if (!m) continue;
    const key = m[1];
    if (seen.includes(key) && !duplicateKeys.includes(key)) duplicateKeys.push(key);
    seen.push(key);

    if (key === 'name' && name === null) {
      const nm = /^name\s*:\s*(.+?)\s*$/.exec(text);
      if (nm) name = nm[1].replace(/^['"]|['"]$/g, '');
    }
    if (key === 'env') {
      const block = collectBlock(lines, i + 1, keyIndent);
      // A second `env:` must not be dropped: merge its keys, and duplicateKeys already
      // records that the step declared `env` twice.
      env = env === null
        ? block
        : { keys: [...env.keys, ...block.keys], duplicates: [...env.duplicates, ...block.duplicates] };
    }
  }
  return { step: { name, line: start + 1, duplicateKeys, env }, lastLine: i - 1 };
}

/**
 * Keys of the mapping block that starts at `from` and is nested deeper than `parentIndent`.
 * @returns {Block}
 */
function collectBlock(lines, from, parentIndent) {
  const keys = [];
  const duplicates = [];
  let blockIndent = -1;
  for (let i = from; i < lines.length; i++) {
    const raw = lines[i];
    if (skippable(raw)) continue;
    const indent = indentOf(raw);
    if (indent <= parentIndent) break;
    if (blockIndent === -1) blockIndent = indent;
    if (indent !== blockIndent) continue;
    const m = KEY_RE.exec(raw.trimStart());
    if (!m) continue;
    if (keys.includes(m[1]) && !duplicates.includes(m[1])) duplicates.push(m[1]);
    keys.push(m[1]);
  }
  return { keys, duplicates };
}

/**
 * Audit a workflow for build-time env wiring.
 *
 * Two independent failures are reported:
 *  - any duplicate mapping key inside a step (a hard defect whichever key it is);
 *  - `requiredKeys` not all present in the `env:` mapping of a SINGLE step. Spreading them
 *    across two steps does not wire a build, so the union is not accepted.
 *
 * @param {string} text raw workflow YAML
 * @param {{ requiredKeys: string[] }} opts
 * @returns {{ errors: string[] }} empty when the workflow is correctly wired
 */
export function auditWorkflowEnv(text, { requiredKeys }) {
  const steps = parseWorkflowSteps(text);
  const errors = [];

  for (const step of steps) {
    const label = step.name ? `step "${step.name}"` : `step at line ${step.line}`;
    for (const dup of step.duplicateKeys) {
      errors.push(`duplicate '${dup}:' key in ${label} (line ${step.line}) — GitHub Actions rejects it, and a tolerant parser silently drops the first one`);
    }
    for (const dup of step.env?.duplicates ?? []) {
      errors.push(`duplicate env var '${dup}' in ${label} (line ${step.line})`);
    }
  }

  const satisfied = steps.some((s) => s.env && requiredKeys.every((k) => s.env.keys.includes(k)));
  if (!satisfied) {
    const present = new Set(steps.flatMap((s) => s.env?.keys ?? []));
    const missing = requiredKeys.filter((k) => !present.has(k));
    errors.push(missing.length > 0
      ? `no step declares all of ${requiredKeys.join(', ')} in its env: block [missing everywhere: ${missing.join(', ')}]`
      : `${requiredKeys.join(', ')} are all declared, but spread across different steps — no single build step receives them all`);
  }

  return { errors };
}
