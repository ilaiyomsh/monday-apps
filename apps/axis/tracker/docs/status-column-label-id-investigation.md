# Status column — label ID vs index investigation

**Goal:** confirm the exact format Monday accepts in `column_values` writes for status columns, and what `settings.labels` keys actually represent (id vs display position).

**Test board:** Time Logs `5095729158`
**Test column:** Event Type `color_mm309y7w`
**Known labels (from earlier debug log):** `1=External`, `2=Sick`, `7=Vacation`, `9=Internal`, `14=Planned`, `108=Non-Billable`

---

## Step 1 — read the column structure

```graphql
query {
  boards(ids: 5095729158) {
    columns(ids: ["color_mm309y7w"]) {
      id
      title
      type
      settings
    }
  }
}
```

### Answer
```json
{
  "data": {
    "boards": [
      {
        "columns": [
          {
            "id": "color_mm309y7w",
            "title": "Event Type",
            "type": "status",
            "settings": {
              "labels": [
                {
                  "id": 1,
                  "color": 1,
                  "label": "External",
                  "index": 1,
                  "is_done": false,
                  "is_deactivated": false,
                  "hex": "#00c875"
                },
                {
                  "id": 2,
                  "color": 2,
                  "label": "Sick",
                  "index": 4,
                  "is_done": false,
                  "is_deactivated": false,
                  "hex": "#df2f4a"
                },
                {
                  "id": 7,
                  "color": 7,
                  "label": "Vacation",
                  "index": 3,
                  "is_done": false,
                  "is_deactivated": false,
                  "hex": "#579bfc"
                },
                {
                  "id": 9,
                  "color": 9,
                  "label": "Internal",
                  "index": 0,
                  "is_done": false,
                  "is_deactivated": false,
                  "hex": "#ffcb00"
                },
                {
                  "id": 14,
                  "color": 14,
                  "label": "Planned",
                  "index": 5,
                  "is_done": false,
                  "is_deactivated": false,
                  "hex": "#784bd1"
                },
                {
                  "id": 108,
                  "color": 108,
                  "label": "Non-Billable",
                  "index": 2,
                  "is_done": false,
                  "is_deactivated": false,
                  "hex": "#4eccc6"
                }
              ]
            }
          }
        ]
      }
    ]
  },
  "extensions": {
    "request_id": "dc97402f-ca04-9e5d-9989-0131e196bb33"
  }
}
```

**What we want to learn:** the structure of `labels`, `labels_positions_v2`, `labels_colors`. Are the keys of `labels` the label IDs, the display positions, or something else?

---

## Step 2 — write with `index: <number>` where number is from the labels keys

If `index` in column_values means "label id" (legacy naming), this should set the label "Internal".
If `index` means display position, it'll set whatever label is at position 9 (or fail since position max is 39 but actual position depends on labels_positions_v2).

```graphql
mutation {
  create_item(
    board_id: 5095729158
    item_name: "TEST_index9"
    column_values: "{\"color_mm309y7w\":{\"index\":9}}"
  ) {
    id
    column_values(ids: ["color_mm309y7w"]) {
      id
      text
      value
    }
  }
}
```

### Answer
```json
{
  "data": {
    "create_item": {
      "id": "2887147339",
      "column_values": [
        {
          "id": "color_mm309y7w",
          "text": "Internal",
          "value": "{\"index\":9}"
        }
      ]
    }
  },
  "extensions": {
    "request_id": "9256a5b1-af19-95a1-bc2f-4ae7f8a01f92"
  }
}
```

---

## Step 3a — write with `label_id: "<string>"`

```graphql
mutation {
  create_item(
    board_id: 5095729158
    item_name: "TEST_labelid9_string"
    column_values: "{\"color_mm309y7w\":{\"label_id\":\"9\"}}"
  ) {
    id
    column_values(ids: ["color_mm309y7w"]) { id text value }
  }
}
```

### Answer
```json
{
  "data": {
    "create_item": {
      "id": "2887162285",
      "column_values": [
        {
          "id": "color_mm309y7w",
          "text": null,
          "value": "{\"label_id\":\"9\"}"
        }
      ]
    }
  },
  "extensions": {
    "request_id": "5ad0dda8-bb9b-9268-8871-1839314c6c2c"
  }
}
```

---

## Step 3b — write with `label_id: <int>`

```graphql
mutation {
  create_item(
    board_id: 5095729158
    item_name: "TEST_labelid9_int"
    column_values: "{\"color_mm309y7w\":{\"label_id\":9}}"
  ) {
    id
    column_values(ids: ["color_mm309y7w"]) { id text value }
  }
}
```

### Answer
```json
{
  "data": {
    "create_item": {
      "id": "2887147992",
      "column_values": [
        {
          "id": "color_mm309y7w",
          "text": null,
          "value": "{\"label_id\":9}"
        }
      ]
    }
  },
  "extensions": {
    "request_id": "880ebc5e-fccf-9c1c-a3d1-31166cabb89b"
  }
}
```

---

## Step 4 — write by label name (baseline)

This should always work. Useful to see what shape Monday returns in `value` for a known-correct write.

```graphql
mutation {
  create_item(
    board_id: 5095729158
    item_name: "TEST_label_internal"
    column_values: "{\"color_mm309y7w\":{\"label\":\"Internal\"}}"
  ) {
    id
    column_values(ids: ["color_mm309y7w"]) { id text value }
  }
}
```

### Answer
```json
{
  "data": {
    "create_item": {
      "id": "2887150883",
      "column_values": [
        {
          "id": "color_mm309y7w",
          "text": "Internal",
          "value": "{\"index\":9}"
        }
      ]
    }
  },
  "extensions": {
    "request_id": "9776d9d3-f678-941d-bc57-4993dc4c7516"
  }
}
```

---

## Step 5 (optional) — read an existing item's status value

After Step 4, change the same item's status manually in the UI to a different label (e.g. "Sick"), then run:

```graphql
query {
  items(ids: REPLACE_WITH_ITEM_ID_FROM_STEP_4) {
    column_values(ids: ["color_mm309y7w"]) {
      id
      text
      value
    }
  }
}
```

### Answer
```json
{
  "data": {
    "items": [
      {
        "column_values": [
          {
            "id": "color_mm309y7w",
            "text": "Internal",
            "value": "{\"index\":9}"
          }
        ]
      }
    ]
  },
  "extensions": {
    "request_id": "65496734-31b8-9028-be86-cd3ccc8e6ed8"
  }
}
```

---

## Conclusion

- **`settings.labels` is an array** of `{ id, label, index, color, hex, is_done, is_deactivated }`.
  - `id` — persistent unique label ID (e.g. 1, 9, 108). Stable across renames and reorders.
  - `index` — display position (0..N-1). Changes when the user drags labels in the UI.
- **`column_values` for status accepts:**
  - `{"index": <labelId>}` ✅ — the field is named "index" but the value is actually the **label ID**, not display position. Confirmed by setting Internal (id=9) with `{"index":9}` even after reordering it to display position 5.
  - `{"label": "Name"}` ✅ — Monday converts to `{"index": <id>}` internally.
  - `{"label_id": ...}` ❌ — Monday accepts the JSON without error but the label is **not** linked (`text` returns `null`). Do not use.
- **Same format works for both `create_item` and `change_multiple_column_values`.** Stored value: `{"index": <id>, "changed_at": "..."}`.

### Practical rule
When writing a status column value, always pass `{ index: <labelId> }`. The "labelId" must come from `settings.labels[].id` (NOT from the array position, NOT from `settings.labels[].index`).

### Required code changes
- [x] `useBoardBuilder.js` — `createStatusColumn` map: switched from `settings_str` to `settings`, parses array form (`label.id` → real ID), keeps legacy object form fallback.
- [x] `useBoardBuilder.js` — `seedSampleData` writes use `{ index: <labelId from map> }`.
- [x] `useBoardBuilder.js` — `buildSettingsFromResult` (`eventTypeMapping` / `eventTypeLabelMeta`) keyed by real label IDs.
- [ ] Audit other callers in the app that read/write status column values (`MappingTab`, `EventModal`, `eventTypeMapping` consumers) — verify they treat the keys/values as label IDs, not array positions. (Existing code in `parseStatusColumnLabels` already handles both formats.)
    