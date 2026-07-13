/*
 * Captured monday API fixtures for dropdownLabels — every payload below is a
 * REAL response recorded from live sandbox probes on 2026-07-12 (test-guard
 * rule 4 / monday-api LAND step: mocks come from captured responses, never
 * hand-built). Provenance: each export notes the API request_id.
 *
 * Scratch objects (WZ- boards/columns, workspace 16291824) were deleted after
 * capture; the managed-column list entries are REAL account objects (read-only
 * capture) — the two "סוג דיון" managed columns and one unrelated "תפקיד".
 */

// boards->columns read of a REGULAR dropdown column (settings + revision).
// request_id c98e2118-5678-9a84-928e-1af38901e2e2
export const regularColumnRead = {
  boards: [{
    columns: [{
      id: 'dropdown_mm56bwz6',
      title: 'WZ-סוג',
      type: 'dropdown',
      settings: { labels: [
        { id: 1, label: 'כספים', is_deactivated: false },
        { id: 2, label: 'הנהלה', is_deactivated: false },
      ] },
      revision: 'f4387564c4dbeff549bffbff32ef978a',
    }],
  }],
};

// update_dropdown_column success — server assigned id 3 to the new label and
// bumped the revision. request_id 5df0d531-ad0d-95eb-9799-fdb10ad9c409
export const regularUpdateSuccess = {
  update_dropdown_column: {
    id: 'dropdown_mm56bwz6',
    settings: { labels: [
      { id: 1, label: 'כספים', is_deactivated: false },
      { id: 2, label: 'הנהלה', is_deactivated: false },
      { id: 3, label: 'טוויסט', is_deactivated: false },
    ] },
    revision: '4779b6d91afe0de674790f0bd628e604',
  },
};

// update_dropdown_column with a stale revision.
// request_id f414872f-c2ec-9f51-bb74-a2d66fab79b5
export const regularRevisionMismatchErrors = [{
  message: 'Board revision mismatch',
  locations: [{ line: 1, column: 84 }],
  path: ['update_dropdown_column'],
  extensions: { code: 'REVISION_MISMATCH', status_code: 409 },
}];

// THE managed-column discriminator: update_dropdown_column called on a column
// that is an attached managed column instance.
// request_id 6ac740d6-9a01-9f33-a3eb-aaaeae259290
export const managedStructureErrors = [{
  message: 'notices.column.settings.update.error.structure',
  locations: [{ line: 1, column: 84 }],
  path: ['update_dropdown_column'],
  extensions: { code: 'INVALID_ARGUMENT_EXCEPTION', status_code: 400 },
}];

// boards->columns read of an ATTACHED MANAGED dropdown column — note the shape
// is indistinguishable from a regular dropdown (this is why detection needs the
// account-level query). request_id c2d18e3e-5f31-99c9-9328-c99f6597f4eb
export const attachedManagedColumnRead = {
  boards: [{
    columns: [{
      id: 'dropdown_mm56expk',
      revision: 'eb076020c184f218608f08f9b9c2e9fb',
      settings: { labels: [
        { id: 1, label: 'אחת', is_deactivated: false },
      ] },
    }],
  }],
};

// Account-level managed_column(state: active) list, trimmed to the 3 relevant
// REAL entries: two managed columns titled "סוג דיון" (one type "color"/status,
// one type "dropdown" — same Hebrew labels!) and one unrelated "תפקיד".
// The dropdown one (8bb03419-…) is the column attached to the real discussions
// board. request_id 01950743-09e8-9e96-ad15-73c046eb46b3
export const managedColumnList = { managed_column: [
  {
    "id": "71c2b145-1b1b-46ca-8aac-19036b45d33d",
    "title": "סוג דיון",
    "state": "active",
    "settings_json": {
      "type": "color",
      "labels": [
        {
          "id": 0,
          "color": 0,
          "label": "כספים",
          "index": 0,
          "is_done": false,
          "is_deactivated": false,
          "hex": "#fdab3d"
        },
        {
          "id": 1,
          "color": 1,
          "label": "הנהלה",
          "index": 1,
          "is_done": true,
          "is_deactivated": false,
          "hex": "#00c875"
        },
        {
          "id": 2,
          "color": 2,
          "label": "אסטרטגיה",
          "index": 2,
          "is_done": false,
          "is_deactivated": false,
          "hex": "#df2f4a"
        },
        {
          "id": 3,
          "color": 3,
          "label": "כוח אדם",
          "index": 3,
          "is_done": false,
          "is_deactivated": false,
          "hex": "#007eb5"
        },
        {
          "id": 4,
          "color": 4,
          "label": "משפטי",
          "index": 4,
          "is_done": false,
          "is_deactivated": false,
          "hex": "#9d50dd"
        },
        {
          "id": 5,
          "color": 5,
          "label": "",
          "index": 5,
          "is_done": false,
          "is_deactivated": false,
          "hex": "#c4c4c4"
        }
      ]
    },
    "revision": 5
  },
  {
    "id": "8bb03419-cca9-422a-b5eb-0727b2c66340",
    "title": "סוג דיון",
    "state": "active",
    "settings_json": {
      "type": "dropdown",
      "labels": [
        {
          "id": 1,
          "label": "כספים",
          "is_deactivated": false
        },
        {
          "id": 2,
          "label": "הנהלה",
          "is_deactivated": false
        },
        {
          "id": 3,
          "label": "אסטרטגיה",
          "is_deactivated": false
        },
        {
          "id": 4,
          "label": "כוח אדם",
          "is_deactivated": false
        },
        {
          "id": 5,
          "label": "משפטי",
          "is_deactivated": false
        }
      ]
    },
    "revision": 0
  },
  {
    "id": "b8e7fd97-108a-40ba-8ed2-0676cce30d36",
    "title": "תפקיד",
    "state": "active",
    "settings_json": {
      "type": "color",
      "labels": [
        {
          "id": 0,
          "color": 9,
          "label": "מטמיע",
          "index": 2,
          "is_done": false,
          "is_deactivated": false,
          "hex": "#ffcb00"
        },
        {
          "id": 1,
          "color": 19,
          "label": "מנהל",
          "index": 0,
          "is_done": false,
          "is_deactivated": false,
          "hex": "#ff6d3b"
        },
        {
          "id": 2,
          "color": 107,
          "label": "מפתח",
          "index": 1,
          "is_done": false,
          "is_deactivated": false,
          "hex": "#225091"
        },
        {
          "id": 3,
          "color": 3,
          "label": "מתמחה",
          "index": 3,
          "is_done": false,
          "is_deactivated": true,
          "hex": "#007eb5"
        }
      ]
    },
    "revision": 3
  }
] };

// update_dropdown_managed_column success — new label got id 3, revision 0 -> 1.
// request_id de8117eb-fdae-9a48-8fdb-4bcd0d6a4920
export const managedUpdateSuccess = {
  update_dropdown_managed_column: {
    id: '039e1304-bf6c-4644-b1d9-4cded8822a95',
    revision: 1,
    settings_json: { type: 'dropdown', labels: [
      { id: 1, label: 'כספים', is_deactivated: false },
      { id: 2, label: 'הנהלה', is_deactivated: false },
      { id: 3, label: 'טוויסט', is_deactivated: false },
    ] },
  },
};

// update_dropdown_managed_column with a stale revision.
// request_id 2764945a-4542-9486-8282-ded3230e30bf
export const managedRevisionMismatchErrors = [{
  message: 'Stale item, reload and try again',
  locations: [{ line: 1, column: 72 }],
  path: ['update_dropdown_managed_column'],
  extensions: { code: 'REVISION_MISMATCH', status_code: 409 },
}];

// update_dropdown_managed_column omitting existing labels = a DELETE attempt,
// blocked because labels are in use. Proof that a partial labels set is
// destructive — the module must always resend the full set.
// request_id 01ea2c50-7d9d-919a-aaac-45cb3e6154b5
export const managedPartialDeleteErrors = [{
  message: 'Invalid model data',
  locations: [{ line: 1, column: 72 }],
  path: ['update_dropdown_managed_column'],
  extensions: {
    code: 'INVALID_INPUT',
    status_code: 400,
    errors: ["can't delete labels from column model, labels are in use, deleted ids: 2,3"],
  },
}];

// The ORIGINAL production bug: create_item with create_labels_if_missing: true
// on a managed dropdown column — the label is NOT created.
// request_id ed4302e0-15fa-90cd-92ee-c71ad8139a6d
export const climOnManagedErrors = [{
  message: "The dropdown label 'טוויסט' does not exist, possible labels are: {1: אחת}",
  locations: [{ line: 1, column: 56 }],
  path: ['create_item'],
  extensions: {
    code: 'ColumnValueException',
    status_code: 200,
    error_data: { column_value: '{"labels" => ["טוויסט"]}' },
  },
}];
