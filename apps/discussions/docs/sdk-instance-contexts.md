# SDK instance contexts — board_view vs custom object (captured 2026-07-01)

Live samples of `monday.get('context')` + storage `settings` for the **same app**
(id `11457413`, version `v5` / `15673915`) running as its two feature types.
Captured in workspace `15426602`, account `14334098`, user `48274917` (עילי שלם, admin).

**The rule these prove:** the "object" the app lives in is always **`context.boardId`**.
For a board_view that's the host board; for a custom object that's the object itself.
The mapped data boards (`settings.boards.*`) are unrelated to who is an owner/member.
So `BoardPeoplePicker` (and any owner/member logic) must key off `context.boardId`,
NOT `settings.boards.discussions.id`.

## Key differences

| field | board_view | custom object (object_view) |
|---|---|---|
| `instanceType` | `board_view` | `object_view` |
| `appFeature.type` | `AppFeatureBoardView` | `AppFeatureObject` |
| `appFeatureId` | `21998724` | `23373106` |
| `boardId` | `18416019251` (דיונים1 data board it's embedded in) | `18419665045` (the object) |
| `instanceId` | `261745793` (= `boardViewId`, NOT boardId) | `18419665045` (= boardId) |
| `boardViewId` | `261745793` | — |
| `boardPermissions` | absent | present (`userPermissionMode:30`, `canOwnersOrAdminsOnly:true`, …) |
| `objectPermissions` | absent | `"edit"` |
| storage key (`discussions_settings_${instanceId}`) | `..._261745793` | `..._18419665045` |

Notes:
- The board_view is embedded ON the discussions data board, so its `context.boardId`
  (18416019251) *coincidentally* equals `settings.boards.discussions.id` — which is
  why the old `BoardPeoplePicker` looked correct there but was wrong on the custom object.
- The two instances have SEPARATE storage keys (instanceId differs), so their mappings
  are configured independently — the two blobs below are NOT identical (topics columns differ).
- Custom-object context carries the current user's role directly (`boardPermissions` /
  `objectPermissions`); board_view context does not — for board_view the owner check must
  query owners of `context.boardId` (as `App.jsx` already does).

## board_view — raw context

```json
{
  "boardId": 18416019251,
  "boardIds": [18416019251],
  "boardViewId": 261745793,
  "viewMode": "fullScreen",
  "instanceId": 261745793,
  "instanceType": "board_view",
  "workspaceId": 15426602,
  "appFeatureId": 21998724,
  "appFeature": { "type": "AppFeatureBoardView", "name": "Discussions" },
  "account": { "id": "14334098" },
  "user": { "id": "48274917", "isAdmin": true, "isGuest": false, "isViewOnly": false },
  "app": { "id": 11457413, "clientId": "6777be675c3a147b2b5a5f5bb4e666c4" },
  "appVersion": { "id": 15673915, "displayNumber": "v5", "status": "live" },
  "permissions": { "approvedScopes": ["me:read","boards:read","boards:write","users:read","docs:read","docs:write","updates:read","updates:write"] }
}
```
(No `boardPermissions` / `objectPermissions` keys in this instance.)

## custom object — raw context

```json
{
  "boardId": 18419665045,
  "boardIds": [18419665045],
  "workspaceId": 15426602,
  "appFeatureId": 23373106,
  "instanceId": 18419665045,
  "instanceType": "object_view",
  "boardPermissions": {
    "userPermissionMode": 30,
    "canRead": true,
    "canChangeContent": true,
    "canChangeStructureAndContent": true,
    "canOwnersOnly": true,
    "canOwnersOrAdminsOnly": true
  },
  "objectPermissions": "edit",
  "boardLoadingState": 10,
  "account": { "id": "14334098" },
  "user": { "id": "48274917", "isAdmin": true, "isGuest": false, "isViewOnly": false },
  "app": { "id": 11457413, "clientId": "6777be675c3a147b2b5a5f5bb4e666c4" },
  "appVersion": { "id": 15673915, "displayNumber": "v5", "status": "live" },
  "appFeature": { "type": "AppFeatureObject", "name": "Discussions" },
  "permissions": { "approvedScopes": ["me:read","boards:read","boards:write","users:read","docs:read","docs:write","updates:read","updates:write"] }
}
```

## storage settings (both instances)

Both point to the same data boards:
`discussions 18416019251` · `tasks 18416019250` · `topics 18416019247`.
`preferences: { previousTasksMode: "discussionType", showMyTasks: true }`.
The custom-object blob additionally has `permissions.enabled: true` with role→capability
maps (discussionCreatorID / discussionLeadID / participantsID / taskCreatorID /
responsibilityID). The board_view blob has NO `permissions` key and a smaller topics
column set (no topicPriorityID / pointCreatorID / pointResponsesID; different titles).
Full column mappings live in `boards.config.js` (defaults) + monday.storage (overrides).
