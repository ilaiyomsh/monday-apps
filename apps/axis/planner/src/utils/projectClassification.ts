import type { PlannerSettings } from '../types/settings.types';
import type { ProjectClassification } from '../types/gantt.types';

export const CLASSIFICATION_ORDER: ProjectClassification[] = ['external', 'internal', 'other'];

/**
 * i18n key paths for the three classification buckets. Callers should run the
 * value through `t()` (or `i18n.t()`) — keeping the keys in code lets us share
 * the lookup between the JSX consumer (AddProjectDropdown) and the hook
 * consumer (useDataFlattener) without each having to maintain its own mapping.
 */
export const CLASSIFICATION_LABEL_KEYS: Record<ProjectClassification, string> = {
  external: 'classification.external',
  internal: 'classification.internal',
  other: 'classification.other',
};

export const isClassificationEnabled = (
  settings: PlannerSettings | null | undefined
): boolean => Boolean(
  settings?.enableProjectClassification && settings?.projectClassificationColumnId
);

export const classifyProject = (
  projectData: Record<string, unknown> | undefined | null,
  settings: PlannerSettings | null | undefined
): ProjectClassification => {
  if (!isClassificationEnabled(settings)) return 'other';
  const columnId = settings!.projectClassificationColumnId!;

  // Prefer label index (stable ID) over text — text can change in Monday and
  // break stored mappings. Falls back to text for backward compatibility with
  // settings that were saved before A.1 / A.2 were introduced (no migration).
  const labelId = projectData?.[columnId + '_index'];
  const labelText = projectData?.[columnId];

  const externals = settings!.externalProjectStatusValues || [];
  const internals = settings!.internalProjectStatusValues || [];

  const matches = (haystack: string[], needle: unknown): boolean =>
    typeof needle === 'string' && needle.length > 0 && haystack.includes(needle);

  if (matches(externals, labelId) || matches(externals, labelText)) return 'external';
  if (matches(internals, labelId) || matches(internals, labelText)) return 'internal';
  return 'other';
};
