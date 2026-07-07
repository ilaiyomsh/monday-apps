import mondaySdk from 'monday-sdk-js';

const monday = mondaySdk();

export default monday;

// The only legitimate source for the Custom Object instance ID is monday's
// context, and only the `instanceId` / `appFeatureObjectId` fields — those are
// what monday sends as `data.payload.object_id` in the lifecycle webhook.
// Never fall back to `boardId` / `appFeatureId` / URL params: those are
// different entities and caused orphan `instance_policy_<boardId>` rows in
// earlier sessions.
export function pickObjectId(context: Record<string, unknown> | null): string {
  const ctx = context as Record<string, unknown> | undefined;
  const id =
    (ctx?.instanceId as string | number | undefined) ??
    (ctx?.appFeatureObjectId as string | number | undefined);
  return id ? String(id) : '';
}
