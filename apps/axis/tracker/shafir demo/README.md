# Shafir Demo — Tracker Configuration Snapshot

Captured: 2026-05-14
Workspace: **Shafir Demo** (id `15483235`)
Account: yomsheni-il.monday.com

## Boards

### 1. Portfolio — "Projects" (`18413142225`)
Monday Portfolio board. Source of projects for the tracker.

- Owner: Ilai Shalem
- Items: 1 (`12009882170` "New project")
- Key columns:
  - `portfolio_project_link` (board_relation, hierarchy → `18413143808`) — per-project tasks board
  - `portfolio_project_owner` (people) — project manager
  - `color_mm3bgkwa` **Type** (status) — `0=Internal`, `1=External`
  - `portfolio_project_rag`, `portfolio_project_priority`, `portfolio_project_step`
  - `portfolio_project_planned_timeline`, `portfolio_project_actual_timeline` (mirror)

Full dump: [`portfolio-board-18413142225.json`](./portfolio-board-18413142225.json)

### 2. Time Logs (`18413144191`)
Reporting board for time entries.

| Tracker setting | Column ID | Title | Type |
|---|---|---|---|
| `dateColumnId` | `date_mm3bqyqj` | Start Time | date |
| `endTimeColumnId` | `date_mm3bzrqg` | End Time | date |
| `durationColumnId` | `numeric_mm3b9baz` | Duration | numbers |
| `projectColumnId` | `board_relation_mm3bg3vz` | Project | board_relation → 18413142225 |
| `reporterColumnId` | `multiple_person_mm3bz1jp` | Reporter | people |
| `eventTypeStatusColumnId` | `color_mm3bb7rt` | Event Type | status |
| `allDayTypeStatusColumnId` | `color_mm3be653` | All-day Type | status |
| `nonBillableStatusColumnId` | `color_mm3bzz0b` | Routine Type | status |
| `stageColumnId` | `color_mm3bqskb` | Classification | status |
| `notesColumnId` | `long_text_mm3bygjc` | Notes | long_text |
| `temporaryCheckboxColumnId` | `boolean_mm3baycm` | Temporary | checkbox |

Full dump: [`timelogs-board-18413144191.json`](./timelogs-board-18413144191.json)

## Status Label IDs

### Event Type (`color_mm3bb7rt` on Time Logs)
| ID | Label | Color | Maps to |
|---|---|---|---|
| 1 | External | #00c875 | externalProject |
| 7 | All Day | #579bfc | allDay |
| 9 | Internal | #ffcb00 | internalProject |
| 108 | Rutine | #4eccc6 | routine |

### All-day Type (`color_mm3be653`)
| ID | Label | Color |
|---|---|---|
| 2 | Sick | #df2f4a |
| 3 | Reserves | #007eb5 |
| 7 | Vacation | #579bfc |

### Routine Type (`color_mm3bzz0b`)
| ID | Label | Color |
|---|---|---|
| 6 | Meeting | #037f4c |
| 8 | Training | #cab641 |
| 157 | Other | #bca58a |

### Classification (`color_mm3bqskb`)
| ID | Label | Color |
|---|---|---|
| 12 | External Meetings | #ff007f |
| 109 | Internal Meetings | #5559df |
| 155 | Solo Work | #e484bd |

### Project Type (`color_mm3bgkwa` on Portfolio)
| ID | Label | Maps to |
|---|---|---|
| 0 | Internal | internal |
| 1 | External | external |

## Tracker Settings Snapshot
Saved as [`tracker-settings-2026-05-14.json`](./tracker-settings-2026-05-14.json).

Highlights:
- `projectsSourceMode: "portfolio"` · `enableProjectTypeDistinction: true`
- `structureMode: "PROJECT_WITH_TASKS"` — **needs to change to `PROJECT_ONLY`** (no tasks board in this demo)
- `fieldConfig.task: "required"` — should be removed/relaxed alongside the structure change
- `taskColumnId: "board_relation_mm3b507b"` — stale, no such column on Time Logs; clear when switching to PROJECT_ONLY
- `monthlyHoursTarget: 182.5`, `workdayLength: 8.5`, work days Sun–Thu

## TODO when re-importing settings
- Set `structureMode` → `"PROJECT_ONLY"`
- Set `fieldConfig.task` → remove or set to `"hidden"`/`"optional"`
- Set `fieldConfig.stage` → keep `"required"` if Classification is still wanted, otherwise relax
- Clear `taskColumnId`, `tasksBoardId`, `tasksProjectColumnId`, `taskStatusColumnId`
