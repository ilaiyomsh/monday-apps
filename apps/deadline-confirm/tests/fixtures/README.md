# Probe-captured fixtures (monday-api skill LAND rule: never hand-built)

Captured 2026-07-14 against API version 2026-07, sandbox workspace 16291824,
scratch board `WZ-deadline-confirm-probe` (id 18422009734, deleted after).
Status column labels: id 0 = "בעבודה", id 1 = "בוצע" (settings.labels[].id).

| file | operation | notes |
|---|---|---|
| get-item.probe.json | §11.1 GetItem | status set (index=0), person set, date set |
| get-item-after-transition.probe.json | §11.1 GetItem | after change_column_value → index=1 ("already done") |
| get-item-empty.probe.json | §11.1 GetItem | never-set columns: status text/index null, people text "", date "" |
| get-item-not-found.probe.json | §11.1 GetItem | nonexistent item id → items: [] |
| set-status.probe.json | §11.2 SetStatus | value {"index": 1} — index carries label ID |
| create-update.probe.json | §11.3 AddUpdate | Hebrew body |
| board-columns-settings.probe.json | columns settings + me | admin picker parsing (settings.labels) |
