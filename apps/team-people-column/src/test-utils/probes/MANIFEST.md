# Probe Capture Manifest

Sandbox: `TEST_WORKSPACE_ID=16291824` ("AGENT-TEST — Claude sandbox", account yomsheni-il).
All boards/items below live in that workspace and were left in place as a live-verification demo.

## Seeded objects

- **WZ-TeamPeople-target** — board id `18421604791`
  - people column "צוות אחראי" — id `multiple_person_mm5694pg`
  - item "פרויקט אלפא" — id `12511510366`, people value: team `1348990` ("test ilai")
  - auto-created reflection `board_relation` column "link to WZ-TeamPeople-source" — id `board_relation_mm56pg3w`
- **WZ-TeamPeople-source** — board id `18421604809`
  - people column "אחראי" — id `multiple_person_mm562c71`
  - board_relation column "פרויקט" — id `board_relation_mm56dy57`, linked to target board `18421604791`
  - item "משימה 1" — id `12511436134`, relation linked to target item `12511510366`; people value later set to person `48274917` ("עילי שלם")
- Team used: id `1348990` ("test ilai"), 3 members: `37022703` (עידו פיוטרקובסקי), `48274917` (עילי שלם), `96863017` (רוני ארגמן)

**Note (deviation from the plan):** writing the team to the people column initially failed with
`ColumnValueException` / `invalidPersonAssignment` ("unable to assign team with id: 1348990").
Root cause: the team was not yet a subscriber of the target board — people-column writes require
board subscribership (this applies to teams, not just persons; see errors-and-auth.md). Fixed by
running `add_teams_to_board(board_id: 18421604791, team_ids: [1348990], kind: subscriber)` first
(inline literal ids, not variables — required per errors-and-auth.md notes on subscriber/team
mutations), then the write succeeded. This is a new team-write gotcha not previously in
column-formats.md — see report for the suggested reference update.

## File → operation → query → variables

| File | Operation | Query | Variables |
|---|---|---|---|
| `GetColumnValue.json` | Read source item's relation + own people column | `query GetColumnValue($itemIds:[ID!],$columnIds:[String!]){ items(ids:$itemIds){ id name column_values(ids:$columnIds){ id type text value ... on BoardRelationValue { linked_item_ids } ... on PeopleValue { persons_and_teams { id kind } } } } }` | `{"itemIds":["12511436134"],"columnIds":["board_relation_mm56dy57","multiple_person_mm562c71"]}` |
| `GetLinkedItemsPeople.json` | Read target item's people (team) column | `query GetLinkedItemsPeople($itemIds:[ID!],$columnIds:[String!]){ items(ids:$itemIds){ id name column_values(ids:$columnIds){ id type ... on PeopleValue { persons_and_teams { id kind } text } } } }` | `{"itemIds":["12511510366"],"columnIds":["multiple_person_mm5694pg"]}` |
| `GetTeamsMembers.json` | Read team + members + complexity | `query GetTeamsMembers($teamIds:[ID!]){ complexity { query before after } teams(ids:$teamIds){ id name users { id name photo_thumb } } }` | `{"teamIds":["1348990"]}` |
| `GetTeamsMembersWithBogus.json` | Same, with one bogus team id mixed in | same query as above | `{"teamIds":["1348990","999999999"]}` |
| `GetUsersDetails.json` | Fetch user details for the 3 team member ids | `query GetUsersDetails($userIds:[ID!]){ users(ids:$userIds){ id name photo_thumb } }` | `{"userIds":["37022703","48274917","96863017"]}` |
| `GetBoardColumns.json` | Board schema for both boards | `query GetBoardColumns($boardIds:[ID!]){ boards(ids:$boardIds){ id name columns { id title type settings settings_str } } }` | `{"boardIds":["18421604791","18421604809"]}` |
| `UpdateColumnValue.json` | Write a person (not team) to source item's people column | `mutation UpdateColumnValue($boardId:ID!,$itemId:ID!,$columnId:String!,$value:JSON!){ change_column_value(board_id:$boardId,item_id:$itemId,column_id:$columnId,value:$value){ id } }` | `{"boardId":"18421604809","itemId":"12511436134","columnId":"multiple_person_mm562c71","value":{"personsAndTeams":[{"id":48274917,"kind":"person"}]}}` |
| `UpdateColumnValueReadback.json` | Read back the write above | `query GetLinkedItemsPeople($itemIds:[ID!],$columnIds:[String!]){ items(ids:$itemIds){ id name column_values(ids:$columnIds){ id type ... on PeopleValue { persons_and_teams { id kind } text } } } }` | `{"itemIds":["12511436134"],"columnIds":["multiple_person_mm562c71"]}` |

## Complexity — GetTeamsMembers (single team id `[1348990]`)

`query=40, before=9909963, after=9909923` → cost of the call itself = 40 (matches `before - after`).

## Complexity — GetTeamsMembersWithBogus (`[1348990, 999999999]`)

`query=40, before=9909923, after=9909883` → same cost (40) as the single-id call. The bogus id
added **no extra complexity** and did not error.

## Bogus team id behavior

`teams(ids:[1348990, 999999999])` **silently omits** the bogus id — the `teams` array contains
only the one valid team (`test ilai`), no `null` placeholder, no error/warning surfaced in
`errors` or `extensions`. Same silent-omit pattern to watch for as other id-array lookups.

## GetBoardColumns — settings vs settings_str for board_relation

Both are populated with **equivalent** data: `settings` is a parsed JSON **object**
(`{"boardIds":[18421604791],"allowMultipleItems":false,"allowCreateReflectionColumn":true}`),
`settings_str` is the **JSON-stringified same object**. No divergence observed between them for
this column type in this probe (contrary to column-formats.md's general steer to prefer
`settings` over `settings_str` for status columns specifically — for board_relation, both were
present and consistent).

Also observed: the connect-boards column create on the source board auto-created a **reflection**
`board_relation` column on the target board (id `board_relation_mm56pg3w`, title "link to
WZ-TeamPeople-source", settings `{"allowCreateReflectionColumn":true,"boardIds":[18421604809]}`)
— confirms board-relation.md Rule 4 live.
