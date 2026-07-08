import { useCallback, useRef, useState } from 'react';
import { safeApi } from '../../utils/mondayApi';
import logger from '../../utils/logger';

// Event Type column = top-level categories only.
// Sub-types live in their own columns: all-day → allDayType, future → temporary checkbox.
const EVENT_TYPE_LABELS_PLAIN       = ['All-day', 'Routine', 'Projects'];
const EVENT_TYPE_LABELS_DISTINCTION = ['All-day', 'Routine', 'Internal', 'External'];

const eventTypeLabelsFor = (distinction) =>
    distinction ? EVENT_TYPE_LABELS_DISTINCTION : EVENT_TYPE_LABELS_PLAIN;

const STAGE_LABELS = ['Internal Meetings', 'External Meetings', 'Solo Work'];
const PROJECT_TYPE_LABELS = ['Internal', 'External'];
const ROUTINE_LABELS = ['Meeting', 'Training', 'Other'];
const ALL_DAY_TYPE_LABELS = ['Vacation', 'Sick'];

// Monday color palette (var_name → hex). Each status column gets its own family
// so the calendar at-a-glance tells you which dimension you're reading.
const EVENT_TYPE_COLORS_PLAIN = {
    'All-day':  'bright-blue',
    'Routine':  'aquamarine',
    'Projects': 'working_orange',
};
const EVENT_TYPE_COLORS_DISTINCTION = {
    'All-day':  'bright-blue',
    'Routine':  'aquamarine',
    'Internal': 'egg_yolk',
    'External': 'done-green',
};
const ROUTINE_COLORS = {
    'Meeting':  'grass_green',
    'Training': 'saladish',
    'Other':    'tan',
};
const CLASSIFICATION_COLORS = {
    'Internal Meetings': 'indigo',
    'External Meetings': 'sofia_pink',
    'Solo Work':         'orchid',
};
const ALL_DAY_TYPE_COLORS = {
    'Vacation': 'bright-blue',
    'Sick':     'stuck-red',

};
const PROJECT_TYPE_COLORS = {
    'Internal': 'egg_yolk',
    'External': 'done-green',
};

/**
 * Build the `defaults` JSON for a status column.
 * Accepts an array of label names and an optional name→var_name map.
 * Produces `{ labels, labels_colors, labels_positions_v2 }` that Monday accepts.
 */
const labelsAsDefaults = (labels, colorMap = null) => {
    const labelsObj = {};
    const labelsPositions = {};
    const labelsColors = {};
    labels.forEach((label, i) => {
        const idx = String(i);
        labelsObj[idx] = label;
        labelsPositions[idx] = i;
        if (colorMap && colorMap[label]) {
            labelsColors[idx] = { color: colorMap[label] };
        }
    });
    const out = { labels: labelsObj, labels_positions_v2: labelsPositions };
    if (Object.keys(labelsColors).length > 0) {
        out.labels_colors = labelsColors;
    }
    return out;
};

const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtTime = (h, m = 0) => `${pad(h)}:${pad(m)}:00`;

const BOARD_DESCRIPTIONS = {
    Customers: 'Companies and clients you do work for.',
    Projects:  'Active and past projects, linked to customers.',
    Tasks:     'Tasks inside each project, linked to time logs.',
    'Time Logs': 'Hour-by-hour reports of work done.',
};

export const useBoardBuilder = (monday, context) => {
    const [progress, setProgress] = useState([]);
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    // columnId -> { labelName: actualMondayIndex } — Monday assigns its own indexes to status labels.
    const statusLabelMapsRef = useRef({});

    const log = useCallback((msg) => {
        setProgress((prev) => [...prev, msg]);
    }, []);

    const apiMutate = useCallback(async (callerName, query, variables) => {
        const res = await safeApi(monday, callerName, query, { variables });
        if (res?.errors) throw new Error(JSON.stringify(res.errors));
        return res?.data;
    }, [monday]);

    const createBoard = useCallback(async (name, location = null, description = null) => {
        // Monday accepts either folder_id OR workspace_id (not both — folder implies workspace).
        // Try folder first to keep new boards alongside the app's host board; if Monday rejects
        // the folder (some folder ids returned by board_folder_id are system/view folders that
        // can't host new boards), fall back to workspace.
        const buildMutation = (withFolder) => {
            const variables = { name };
            const decls = ['$name: String!'];
            const args = ['board_name: $name', 'board_kind: public'];
            if (description) {
                decls.push('$description: String');
                args.push('description: $description');
                variables.description = description;
            }
            if (withFolder && location?.folderId) {
                decls.push('$folder: ID!');
                args.push('folder_id: $folder');
                variables.folder = String(location.folderId);
            } else if (location?.workspaceId) {
                decls.push('$ws: ID!');
                args.push('workspace_id: $ws');
                variables.ws = String(location.workspaceId);
            }
            return {
                query: `mutation (${decls.join(', ')}) { create_board(${args.join(', ')}) { id } }`,
                variables,
            };
        };

        const tryCreate = async (withFolder) => {
            const { query, variables } = buildMutation(withFolder);
            return apiMutate('useBoardBuilder.createBoard', query, variables);
        };

        let data;
        const wantsFolder = !!location?.folderId;
        try {
            data = await tryCreate(wantsFolder);
        } catch (e) {
            // Detect "folder not found": MondayApiError wraps the SDK exception, so the original
            // reason lives in errorCode + response.errors[].extensions, not in e.message.
            const errCode = e?.errorCode;
            const respErrors = e?.response?.errors || e?.response?.data?.errors || [];
            const folderRelated = respErrors.some((re) => {
                const ext = re?.extensions;
                return ext?.error_data?.resource_type === 'folder' || /folder/i.test(re?.message || '');
            });
            const isFolderError = wantsFolder && (errCode === 'ResourceNotFoundException' || folderRelated);
            if (!isFolderError) throw e;
            logger.warn('useBoardBuilder', `Folder ${location.folderId} rejected by Monday — retrying in workspace only`);
            data = await tryCreate(false);
        }
        const id = data?.create_board?.id;
        if (!id) throw new Error(`Failed to create board "${name}"`);
        return String(id);
    }, [apiMutate]);

    const resolveLocation = useCallback(async () => {
        const boardId = context?.boardId;
        if (!boardId) {
            logger.warn('useBoardBuilder', 'No boardId in context — boards will land in default workspace');
            return {};
        }
        try {
            const data = await apiMutate(
                'useBoardBuilder.resolveLocation',
                `query ($id: [ID!]) { boards(ids: $id) { workspace_id board_folder_id } }`,
                { id: [String(boardId)] }
            );
            const board = data?.boards?.[0];
            return {
                workspaceId: board?.workspace_id || null,
                folderId: board?.board_folder_id || null,
            };
        } catch (e) {
            logger.warn('useBoardBuilder', 'Failed to resolve workspace/folder, falling back to default', e);
            return {};
        }
    }, [apiMutate, context]);

    // Status columns require the dedicated `create_status_column` mutation —
    // generic `create_column` silently ignores `defaults` for status, leaving
    // Monday's stock Done/Working on it/Stuck labels in place.
    const createStatusColumn = useCallback(async (boardId, title, defaults) => {
        // defaults from labelsAsDefaults: { labels: { '0': 'Name' }, labels_colors: { '0': { color: 'colorName' } } }
        const labelsObj = defaults?.labels || {};
        const colorsObj = defaults?.labels_colors || {};
        const labelsArr = Object.keys(labelsObj)
            .map(Number)
            .sort((a, b) => a - b)
            .map((i) => {
                const rawColor = colorsObj[String(i)]?.color;
                // Monday's StatusColumnColors enum uses underscores (e.g. stuck_red, done_green).
                // Some constants in this file were authored with hyphens — normalize them.
                const normalized = rawColor ? String(rawColor).replace(/-/g, '_') : null;
                // `color` is required by Monday's CreateStatusLabelInput — fall back if missing/invalid.
                const colorEnum = normalized && /^[a-z_]+$/i.test(normalized) ? normalized : 'dark_blue';
                const labelStr = String(labelsObj[String(i)]).replace(/"/g, '\\"');
                return `{ color: ${colorEnum}, label: "${labelStr}", index: ${i} }`;
            })
            .join('\n                    ');
        const titleEsc = title.replace(/"/g, '\\"');
        // Request `settings` inline with the create — fetching it via a separate query right
        // after the mutation hits a Monday read-replica race where labels return empty briefly.
        const mutation = `mutation {
            create_status_column(
                board_id: ${boardId}
                title: "${titleEsc}"
                defaults: { labels: [
                    ${labelsArr}
                ] }
            ) { id settings_str }
        }`;
        const data = await apiMutate('useBoardBuilder.createStatusColumn', mutation, {});
        const created = data?.create_status_column;
        const id = created?.id;
        if (!id) throw new Error(`Failed to create status column "${title}"`);

        // Monday assigns its own persistent label IDs — extract them so callers can write
        // column_values using `{"index": <labelId>}` (Monday's format despite the field name).
        // Note: using `settings_str` here (not `settings`) — the typed `settings` field isn't
        // selectable on `create_status_column`'s return type.
        const labelIdByName = {};
        try {
            const raw = created.settings_str;
            const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
            const realLabels = parsed.labels;
            if (Array.isArray(realLabels)) {
                realLabels.forEach((l) => {
                    if (l?.label != null && l?.id != null) labelIdByName[l.label] = Number(l.id);
                });
            } else if (realLabels && typeof realLabels === 'object') {
                // Legacy object form: keys ARE the label IDs.
                Object.entries(realLabels).forEach(([labelId, name]) => {
                    if (name != null) labelIdByName[name] = Number(labelId);
                });
            }
        } catch (e) {
            logger.warn('useBoardBuilder', `Could not parse labels for "${title}"`, e);
        }
        statusLabelMapsRef.current[id] = labelIdByName;
        return id;
    }, [apiMutate]);

    const createColumn = useCallback(async (boardId, title, columnType, defaults = null, description = null) => {
        // Route status columns with custom labels through the dedicated mutation.
        if (columnType === 'status' && defaults?.labels) {
            return createStatusColumn(boardId, title, defaults);
        }
        const variables = { boardId: String(boardId), title, columnType };
        const decls = ['$boardId: ID!', '$title: String!', '$columnType: ColumnType!'];
        const args = ['board_id: $boardId', 'title: $title', 'column_type: $columnType'];
        if (defaults !== null) {
            decls.push('$defaults: JSON!');
            args.push('defaults: $defaults');
            variables.defaults = JSON.stringify(defaults);
        }
        if (description) {
            decls.push('$description: String');
            args.push('description: $description');
            variables.description = description;
        }
        const query = `mutation (${decls.join(', ')}) { create_column(${args.join(', ')}) { id } }`;
        const data = await apiMutate('useBoardBuilder.createColumn', query, variables);
        const id = data?.create_column?.id;
        if (!id) throw new Error(`Failed to create column "${title}"`);
        return id;
    }, [apiMutate, createStatusColumn]);

    const createItem = useCallback(async (boardId, itemName, columnValues = null) => {
        const variables = { boardId: String(boardId), itemName };
        let query = `mutation ($boardId: ID!, $itemName: String!`;
        if (columnValues) {
            query += `, $columnValues: JSON!`;
            variables.columnValues = JSON.stringify(columnValues);
        }
        query += `) { create_item(board_id: $boardId, item_name: $itemName`;
        if (columnValues) query += `, column_values: $columnValues`;
        query += `) { id } }`;

        const data = await apiMutate('useBoardBuilder.createItem', query, variables);
        const id = data?.create_item?.id;
        if (!id) throw new Error(`Failed to create item "${itemName}"`);
        return String(id);
    }, [apiMutate]);

    const fetchCurrentUser = useCallback(async () => {
        const data = await apiMutate('useBoardBuilder.fetchCurrentUser', `query { me { id name } }`, {});
        return { id: data?.me?.id, name: data?.me?.name || 'Reporter' };
    }, [apiMutate]);

    const updateItemColumns = useCallback(async (boardId, itemId, columnValues) => {
        const query = `mutation ($boardId: ID!, $itemId: ID!, $values: JSON!) {
            change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $values) { id }
        }`;
        await apiMutate('useBoardBuilder.updateItemColumns', query, {
            boardId: String(boardId),
            itemId: String(itemId),
            values: JSON.stringify(columnValues),
        });
    }, [apiMutate]);

    const buildSettingsFromResult = (answers, boards, columns) => {
        const { tasks, stages, distinction } = answers;
        const colorMap = distinction ? EVENT_TYPE_COLORS_DISTINCTION : EVENT_TYPE_COLORS_PLAIN;

        // Use Monday's actual label indexes (Monday assigns its own — they are NOT 0,1,2,...).
        const eventTypeLabelToIdx = statusLabelMapsRef.current[columns.timeLogs.eventType] || {};

        // Map each known event-type label to its semantic meaning.
        const labelMeaning = distinction
            ? {
                  'All-day':  'allDay',
                  Routine:    'routine',
                  Internal:   'internalProject',
                  External:   'externalProject',
              }
            : {
                  'All-day':  'allDay',
                  Routine:    'nonBillable',
                  Projects:   'billable',
              };

        const eventTypeMapping = {};
        const eventTypeLabelMeta = {};
        Object.entries(eventTypeLabelToIdx).forEach(([labelName, realIdx]) => {
            const meaning = labelMeaning[labelName];
            if (meaning) eventTypeMapping[String(realIdx)] = meaning;
            eventTypeLabelMeta[String(realIdx)] = { label: labelName, color: colorMap[labelName] || '' };
        });

        // mapping סוג פרויקט — מאוכלס לפי id-ים שמונדיי הקצתה ללייבלים, לא לפי שמות.
        // (runtime קורא value.index = label.id, אז המפתחות חייבים להיות id-ים אמיתיים.)
        const projectTypeIdsByName = distinction && columns.projects.projectType
            ? (statusLabelMapsRef.current[columns.projects.projectType] || {})
            : {};
        const projectTypeMapping = distinction
            ? Object.fromEntries(
                Object.entries({ Internal: 'internal', External: 'external' })
                    .filter(([name]) => projectTypeIdsByName[name] != null)
                    .map(([name, role]) => [String(projectTypeIdsByName[name]), role])
              )
            : null;

        const fieldConfig = {
            task: tasks ? 'required' : 'hidden',
            stage: stages ? 'required' : 'hidden',
            notes: 'optional',
            billableToggle: 'visible',
            nonBillableType: 'required',
        };
        const structureMode = tasks
            ? 'PROJECT_WITH_TASKS'
            : stages
            ? 'PROJECT_WITH_STAGE'
            : 'PROJECT_ONLY';

        return {
            connectedBoardId: boards.projects,
            peopleColumnIds: [columns.projects.owners],
            useCurrentBoardForReporting: false,
            timeReportingBoardId: boards.timeLogs,
            tasksBoardId: tasks ? boards.tasks : null,
            tasksProjectColumnId: tasks ? columns.projects.tasksLink : null,
            customerColumnId: columns.projects.customer,
            customerReportColumnId: columns.timeLogs.customer,
            dateColumnId: columns.timeLogs.date,
            endTimeColumnId: columns.timeLogs.endTime,
            durationColumnId: columns.timeLogs.duration,
            projectColumnId: columns.timeLogs.project,
            taskColumnId: tasks ? columns.timeLogs.task : null,
            reporterColumnId: columns.timeLogs.reporter,
            eventTypeStatusColumnId: columns.timeLogs.eventType,
            notesColumnId: columns.timeLogs.notes,
            stageColumnId: stages ? columns.timeLogs.stage : null,
            nonBillableStatusColumnId: columns.timeLogs.routineType,
            allDayTypeStatusColumnId: columns.timeLogs.allDayType || null,
            temporaryCheckboxColumnId: columns.timeLogs.temporary || null,
            projectTypeColumnId: distinction ? columns.projects.projectType : null,
            projectTypeMapping: projectTypeMapping && Object.keys(projectTypeMapping).length > 0
                ? projectTypeMapping
                : null,
            enableProjectTypeDistinction: !!distinction,
            fieldConfig,
            structureMode,
            eventTypeMapping,
            eventTypeLabelMeta,
        };
    };

    /**
     * Portfolio flow — settings assembled from a user-picked existing Portfolio
     * board, with only the Time Logs board created fresh.
     */
    const buildPortfolioSettingsFromResult = (answers, boards, columns) => {
        const { tasks, stages, distinction, portfolioBoardId, projectTypeColumnId, projectTypeMapping } = answers;
        const colorMap = distinction ? EVENT_TYPE_COLORS_DISTINCTION : EVENT_TYPE_COLORS_PLAIN;
        const eventTypeLabelToIdx = statusLabelMapsRef.current[columns.timeLogs.eventType] || {};

        const labelMeaning = distinction
            ? {
                  'All-day':  'allDay',
                  Routine:    'routine',
                  Internal:   'internalProject',
                  External:   'externalProject',
              }
            : {
                  'All-day':  'allDay',
                  Routine:    'nonBillable',
                  Projects:   'billable',
              };

        const eventTypeMapping = {};
        const eventTypeLabelMeta = {};
        Object.entries(eventTypeLabelToIdx).forEach(([labelName, realIdx]) => {
            const meaning = labelMeaning[labelName];
            if (meaning) eventTypeMapping[String(realIdx)] = meaning;
            eventTypeLabelMeta[String(realIdx)] = { label: labelName, color: colorMap[labelName] || '' };
        });

        return {
            projectsSourceMode: 'portfolio',
            connectedBoardId: portfolioBoardId,
            peopleColumnIds: ['portfolio_project_owner'],
            tasksBoardId: null,
            tasksProjectColumnId: null,
            customerColumnId: null,
            customerReportColumnId: null,
            useCurrentBoardForReporting: false,
            timeReportingBoardId: boards.timeLogs,
            dateColumnId: columns.timeLogs.date,
            endTimeColumnId: columns.timeLogs.endTime,
            durationColumnId: columns.timeLogs.duration,
            projectColumnId: columns.timeLogs.project,
            taskColumnId: columns.timeLogs.task || null,
            reporterColumnId: columns.timeLogs.reporter,
            eventTypeStatusColumnId: columns.timeLogs.eventType,
            notesColumnId: columns.timeLogs.notes,
            stageColumnId: stages ? columns.timeLogs.stage : null,
            nonBillableStatusColumnId: columns.timeLogs.routineType,
            allDayTypeStatusColumnId: columns.timeLogs.allDayType || null,
            temporaryCheckboxColumnId: columns.timeLogs.temporary || null,
            projectTypeColumnId: distinction ? projectTypeColumnId : null,
            projectTypeMapping: distinction && projectTypeMapping && Object.keys(projectTypeMapping).length > 0
                ? projectTypeMapping
                : null,
            projectTypeSourceBoardId: null,
            projectTypeSourceColumnId: null,
            enableProjectTypeDistinction: !!distinction,
            fieldConfig: {
                task: tasks ? 'required' : 'hidden',
                stage: stages ? 'required' : 'hidden',
                notes: 'optional',
                billableToggle: 'visible',
                nonBillableType: 'required',
            },
            structureMode: tasks
                ? (stages ? 'PROJECT_WITH_TASKS_AND_STAGE' : 'PROJECT_WITH_TASKS')
                : (stages ? 'PROJECT_WITH_STAGE' : 'PROJECT_ONLY'),
            eventTypeMapping,
            eventTypeLabelMeta,
        };
    };

    /**
     * Seed sample data: 2 customers, 2 projects, optionally 3 tasks per project,
     * and 5 time logs spanning the current Sun–Thu work week.
     */
    const seedSampleData = useCallback(async (boards, columns, user, answers) => {
        const userId = user?.id;
        const userName = user?.name || 'Reporter';

        log('Seeding sample customers...');
        const customer1Id = await createItem(boards.customers, 'Acme Corp');
        const customer2Id = await createItem(boards.customers, 'Globex Industries');

        log('Seeding sample projects...');
        const ownerValue = userId ? { personsAndTeams: [{ id: Number(userId), kind: 'person' }] } : null;
        const ownersCol = columns.projects.owners;

        const project1Cv = { [columns.projects.customer]: { item_ids: [Number(customer1Id)] } };
        const project2Cv = { [columns.projects.customer]: { item_ids: [Number(customer2Id)] } };
        if (ownerValue && ownersCol) {
            project1Cv[ownersCol] = ownerValue;
            project2Cv[ownersCol] = ownerValue;
        }
        if (answers.distinction && columns.projects.projectType) {
            const projectTypeIds = statusLabelMapsRef.current[columns.projects.projectType] || {};
            if (projectTypeIds.External != null) project1Cv[columns.projects.projectType] = { index: projectTypeIds.External };
            if (projectTypeIds.Internal != null) project2Cv[columns.projects.projectType] = { index: projectTypeIds.Internal };
        }
        const project1Name = 'Website Redesign';
        const project2Name = 'Mobile App MVP';
        const project1Id = await createItem(boards.projects, project1Name, project1Cv);
        const project2Id = await createItem(boards.projects, project2Name, project2Cv);

        // Sample tasks (one per sub-task of each project) — only if user opted in.
        const projectTasks = {};
        if (answers.tasks && boards.tasks && columns.tasks?.project) {
            log('Seeding sample tasks...');
            const samples = [
                { project: project1Id, names: ['Discovery', 'Design', 'QA'] },
                { project: project2Id, names: ['Spec', 'Build', 'Launch prep'] },
            ];
            for (const { project, names } of samples) {
                projectTasks[project] = [];
                for (const name of names) {
                    const taskCv = { [columns.tasks.project]: { item_ids: [Number(project)] } };
                    const id = await createItem(boards.tasks, name, taskCv);
                    projectTasks[project].push({ id, name });
                }
            }
        }

        log('Seeding sample time logs...');

        const today = new Date();
        const sunday = new Date(today);
        sunday.setDate(today.getDate() - today.getDay());
        sunday.setHours(0, 0, 0, 0);
        const dayOffset = (offset) => {
            const d = new Date(sunday);
            d.setDate(sunday.getDate() + offset);
            return d;
        };

        const reporter = userId ? { personsAndTeams: [{ id: Number(userId), kind: 'person' }] } : null;

        const billableLabelExternal = answers.distinction ? 'External' : 'Projects';
        const billableLabelInternal = answers.distinction ? 'Internal' : 'Projects';

        const projectIdToName = { [project1Id]: project1Name, [project2Id]: project2Name };
        const projectToCustomer = { [project1Id]: customer1Id, [project2Id]: customer2Id };

        const entries = [
            { day: 0, startH: 9,  endH: 12, dur: 3, eventLabel: billableLabelExternal, project: project1Id },
            { day: 1, startH: 13, endH: 17, dur: 4, eventLabel: billableLabelInternal, project: project2Id },
            { day: 2, startH: 9,  endH: 11, dur: 2, eventLabel: billableLabelExternal, project: project1Id },
            { day: 3, startH: 14, endH: 16, dur: 2, eventLabel: 'Routine',              project: null },
            { day: 4, startH: 10, endH: 12, dur: 2, eventLabel: billableLabelInternal,  project: project2Id, temporary: true },
        ];

        const stageLabels = ['Internal Meetings', 'External Meetings', 'Solo Work'];

        const dateCol = columns.timeLogs.date;
        const endTimeCol = columns.timeLogs.endTime;
        const durationCol = columns.timeLogs.duration;
        const projectCol = columns.timeLogs.project;
        const reporterCol = columns.timeLogs.reporter;
        const eventTypeCol = columns.timeLogs.eventType;
        const stageCol = columns.timeLogs.stage;
        const customerCol = columns.timeLogs.customer;
        const taskCol = columns.timeLogs.task;
        const temporaryCol = columns.timeLogs.temporary;

        const taskToTimeLogs = {}; // taskId → [timeLogId]

        for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            const d = dayOffset(e.day);
            const dateStr = fmtDate(d);
            const projectName = e.project ? projectIdToName[e.project] : 'Routine';
            const itemName = `${projectName} - ${userName}`;

            const cv = {
                [dateCol]: { date: dateStr, time: fmtTime(e.startH) },
                [endTimeCol]: { date: dateStr, time: fmtTime(e.endH) },
                [durationCol]: String(e.dur),
                [eventTypeCol]: { label: e.eventLabel },
            };
            if (reporter) cv[reporterCol] = reporter;
            if (e.project && projectCol) cv[projectCol] = { item_ids: [Number(e.project)] };
            if (e.project && customerCol && projectToCustomer[e.project]) {
                cv[customerCol] = { item_ids: [Number(projectToCustomer[e.project])] };
            }
            if (answers.stages && stageCol) cv[stageCol] = { label: stageLabels[i % stageLabels.length] };
            if (e.temporary && temporaryCol) cv[temporaryCol] = { checked: 'true' };

            let pickedTaskId = null;
            if (answers.tasks && taskCol && e.project && projectTasks[e.project]?.length) {
                const pickedTask = projectTasks[e.project][i % projectTasks[e.project].length];
                pickedTaskId = pickedTask.id;
                cv[taskCol] = { item_ids: [Number(pickedTaskId)] };
            }
            const timeLogId = await createItem(boards.timeLogs, itemName, cv);
            if (pickedTaskId) {
                if (!taskToTimeLogs[pickedTaskId]) taskToTimeLogs[pickedTaskId] = [];
                taskToTimeLogs[pickedTaskId].push(timeLogId);
            }
        }

        // Populate reverse-side board_relation columns so connections feel 2-way.
        log('Linking reverse-side columns...');

        // Customers ← Projects
        if (columns.customers.projects) {
            const customerToProjects = {
                [customer1Id]: [project1Id],
                [customer2Id]: [project2Id],
            };
            for (const [customerId, projectIds] of Object.entries(customerToProjects)) {
                await updateItemColumns(boards.customers, customerId, {
                    [columns.customers.projects]: { item_ids: projectIds.map(Number) },
                });
            }
        }

        // Projects ← Tasks
        if (answers.tasks && columns.projects.tasksLink) {
            for (const [projectId, taskList] of Object.entries(projectTasks)) {
                if (!taskList.length) continue;
                await updateItemColumns(boards.projects, projectId, {
                    [columns.projects.tasksLink]: { item_ids: taskList.map((t) => Number(t.id)) },
                });
            }
        }

        // Tasks ← Time Logs
        if (answers.tasks && columns.tasks.timeLogs) {
            for (const [taskId, timeLogIds] of Object.entries(taskToTimeLogs)) {
                await updateItemColumns(boards.tasks, taskId, {
                    [columns.tasks.timeLogs]: { item_ids: timeLogIds.map(Number) },
                });
            }
        }
    }, [createItem, updateItemColumns, log]);

    /**
     * Portfolio flow: skip Customers/Projects/Tasks creation (the Portfolio + its
     * project boards already exist in monday and we don't own them). Create only
     * the Time Logs board, wired to the picked portfolio.
     */
    const buildPortfolio = useCallback(async (answers) => {
        const { tasks, stages, distinction, portfolioBoardId } = answers;
        if (!portfolioBoardId) {
            throw new Error('Portfolio board id is required for portfolio flow');
        }

        const location = await resolveLocation();
        if (location.workspaceId) {
            log(`Target: workspace ${location.workspaceId}${location.folderId ? `, folder ${location.folderId}` : ''}`);
        }

        const boards = {};
        const columns = { timeLogs: {} };

        log('Creating Time Logs board...');
        boards.timeLogs = await createBoard('Time Logs', location, BOARD_DESCRIPTIONS['Time Logs']);

        log('  • Date');
        columns.timeLogs.date = await createColumn(
            boards.timeLogs, 'Date', 'date', null,
            'Date and start time of the report'
        );

        log('  • End Time');
        columns.timeLogs.endTime = await createColumn(
            boards.timeLogs, 'End Time', 'date', null,
            'End time of the report'
        );

        log('  • Duration');
        columns.timeLogs.duration = await createColumn(
            boards.timeLogs, 'Duration', 'numbers', null,
            'Hours worked (or days, for vacation/sick)'
        );

        log('  • Project link → Portfolio');
        columns.timeLogs.project = await createColumn(
            boards.timeLogs,
            'Project',
            'board_relation',
            { boardIds: [Number(portfolioBoardId)] },
            'Portfolio item this time log is for'
        );

        if (tasks) {
            log('  • Task link');
            // No fixed boardIds — tasks live on per-project Project boards resolved at runtime.
            columns.timeLogs.task = await createColumn(
                boards.timeLogs,
                'Task',
                'board_relation',
                null,
                'Task inside the picked portfolio project'
            );
        }

        log('  • Reporter');
        columns.timeLogs.reporter = await createColumn(
            boards.timeLogs, 'Reporter', 'people', null,
            'Who reported this time'
        );

        const eventTypeLabels = eventTypeLabelsFor(distinction);
        const eventTypeColors = distinction ? EVENT_TYPE_COLORS_DISTINCTION : EVENT_TYPE_COLORS_PLAIN;
        log(`  • Event Type (${eventTypeLabels.length} labels${distinction ? ' — distinction' : ''})`);
        columns.timeLogs.eventType = await createColumn(
            boards.timeLogs,
            'Event Type',
            'status',
            labelsAsDefaults(eventTypeLabels, eventTypeColors),
            'Top-level event category (All-day / Routine / Projects or Internal+External)'
        );

        log('  • Routine Type (3 labels)');
        columns.timeLogs.routineType = await createColumn(
            boards.timeLogs,
            'Routine Type',
            'status',
            labelsAsDefaults(ROUTINE_LABELS, ROUTINE_COLORS),
            'Sub-type for Non-Billable: Meeting / Training / Other'
        );

        // W4.6 (Day-off integration): עמודת סוג היום נחוצה רק כשהיעדרויות מדווחות
        // בתוך ה-tracker. כשהמקור חיצוני (absenceSource='dayoff') מדלגים — הוולידטור
        // (W4.5) כבר לא דורש allDayTypeStatusColumnId תחת מקור זה.
        if (answers.absenceSource !== 'dayoff') {
            log('  • All-day Type (3 labels)');
            columns.timeLogs.allDayType = await createColumn(
                boards.timeLogs,
                'All-day Type',
                'status',
                labelsAsDefaults(ALL_DAY_TYPE_LABELS, ALL_DAY_TYPE_COLORS),
                'Sub-type for all-day events: Vacation / Sick / Reserves'
            );
        } else {
            log('  • All-day Type — skipped (absences are managed in the Day-off app)');
        }

        log('  • Temporary (checkbox)');
        columns.timeLogs.temporary = await createColumn(
            boards.timeLogs, 'Temporary', 'checkbox', null,
            'Marks a planned/future report not yet finalized'
        );

        if (stages) {
            log('  • Classification (3 labels)');
            columns.timeLogs.stage = await createColumn(
                boards.timeLogs,
                'Classification',
                'status',
                labelsAsDefaults(STAGE_LABELS, CLASSIFICATION_COLORS),
                'What kind of work: Internal / External Meetings / Solo Work'
            );
        }

        log('  • Notes');
        columns.timeLogs.notes = await createColumn(
            boards.timeLogs, 'Notes', 'long_text', null,
            'Free-text notes about this report'
        );

        // Seed: fetch first 3 items from the portfolio and create sample time logs
        // referencing them. If the portfolio is empty, skip silently.
        log('Seeding sample time logs from portfolio...');
        let portfolioItems = [];
        try {
            const itemsRes = await safeApi(
                monday,
                'useBoardBuilder.fetchPortfolioItems',
                `query { boards(ids: [${portfolioBoardId}]) { items_page(limit: 3) { items { id name } } } }`
            );
            portfolioItems = itemsRes.data?.boards?.[0]?.items_page?.items || [];
        } catch (e) {
            logger.warn('useBoardBuilder', 'Failed to fetch portfolio items for seeding', e);
        }

        if (portfolioItems.length === 0) {
            log('  (portfolio has no projects yet — skipping seed)');
        } else {
            const user = await fetchCurrentUser();
            const userId = user?.id;
            const reporter = userId ? { personsAndTeams: [{ id: Number(userId), kind: 'person' }] } : null;

            const today = new Date();
            const sunday = new Date(today);
            sunday.setDate(today.getDate() - today.getDay());
            sunday.setHours(0, 0, 0, 0);
            const dayOffset = (offset) => {
                const d = new Date(sunday);
                d.setDate(sunday.getDate() + offset);
                return d;
            };

            const billableLabelExternal = distinction ? 'External' : 'Projects';
            const seedEntries = portfolioItems.slice(0, 3).map((p, i) => ({
                day: i,
                startH: 9 + i,
                endH: 11 + i,
                dur: 2,
                project: p.id,
                projectName: p.name,
                eventLabel: billableLabelExternal,
            }));

            for (const e of seedEntries) {
                const d = dayOffset(e.day);
                const dateStr = fmtDate(d);
                const cv = {
                    [columns.timeLogs.date]: { date: dateStr, time: fmtTime(e.startH) },
                    [columns.timeLogs.endTime]: { date: dateStr, time: fmtTime(e.endH) },
                    [columns.timeLogs.duration]: String(e.dur),
                    [columns.timeLogs.eventType]: { label: e.eventLabel },
                    [columns.timeLogs.project]: { item_ids: [Number(e.project)] },
                };
                if (reporter) cv[columns.timeLogs.reporter] = reporter;
                await createItem(boards.timeLogs, `${e.projectName} - ${user.name || 'Reporter'}`, cv);
            }
        }

        const settings = buildPortfolioSettingsFromResult(answers, boards, columns);
        log('Boards ready, saving settings...');

        setResult({ boards, columns, settings });
        return settings;
    }, [resolveLocation, createBoard, createColumn, createItem, fetchCurrentUser, monday, log]);

    const build = useCallback(async (answers) => {
        const { tasks, stages, distinction } = answers;
        setRunning(true);
        setError(null);
        setResult(null);
        setProgress([]);

        try {
            logger.info('useBoardBuilder', 'Starting build', answers);

            if (answers.source === 'portfolio') {
                const settings = await buildPortfolio(answers);
                setRunning(false);
                return settings;
            }


            const location = await resolveLocation();
            if (location.workspaceId) {
                log(`Target: workspace ${location.workspaceId}${location.folderId ? `, folder ${location.folderId}` : ''}`);
            }

            const boards = {};
            const columns = { projects: {}, timeLogs: {}, customers: {}, tasks: {} };

            log('Creating Customers board...');
            boards.customers = await createBoard('Customers', location, BOARD_DESCRIPTIONS.Customers);

            log('Creating Projects board...');
            boards.projects = await createBoard('Projects', location, BOARD_DESCRIPTIONS.Projects);

            log('  • Customer link column');
            columns.projects.customer = await createColumn(
                boards.projects,
                'Customer',
                'board_relation',
                { boardIds: [Number(boards.customers)] },
                'Customer this project belongs to'
            );

            // Reciprocal Customers → Projects link.
            log('  • Customers ← Projects link');
            columns.customers.projects = await createColumn(
                boards.customers,
                'Projects',
                'board_relation',
                { boardIds: [Number(boards.projects)] },
                'Projects done for this customer'
            );

            log('  • Owners (people) column');
            columns.projects.owners = await createColumn(
                boards.projects,
                'Owners',
                'people',
                null,
                'Team members responsible for this project'
            );

            if (distinction) {
                log('  • Project Type column');
                columns.projects.projectType = await createColumn(
                    boards.projects,
                    'Project Type',
                    'status',
                    labelsAsDefaults(PROJECT_TYPE_LABELS, PROJECT_TYPE_COLORS),
                    'Internal vs. external (client-facing) project'
                );
            }

            if (tasks) {
                log('Creating Tasks board...');
                boards.tasks = await createBoard('Tasks', location, BOARD_DESCRIPTIONS.Tasks);

                log('  • Tasks → Project link');
                columns.tasks.project = await createColumn(
                    boards.tasks,
                    'Project',
                    'board_relation',
                    { boardIds: [Number(boards.projects)] },
                    'Parent project of this task'
                );

                log('  • Projects → Tasks link');
                columns.projects.tasksLink = await createColumn(
                    boards.projects,
                    'Tasks',
                    'board_relation',
                    { boardIds: [Number(boards.tasks)] },
                    'Tasks under this project'
                );
            }

            log('Creating Time Logs board...');
            boards.timeLogs = await createBoard('Time Logs', location, BOARD_DESCRIPTIONS['Time Logs']);

            log('  • Date');
            columns.timeLogs.date = await createColumn(
                boards.timeLogs, 'Date', 'date', null,
                'Date and start time of the report'
            );

            log('  • End Time');
            columns.timeLogs.endTime = await createColumn(
                boards.timeLogs, 'End Time', 'date', null,
                'End time of the report'
            );

            log('  • Duration');
            columns.timeLogs.duration = await createColumn(
                boards.timeLogs, 'Duration', 'numbers', null,
                'Hours worked (or days, for vacation/sick)'
            );

            log('  • Project link');
            columns.timeLogs.project = await createColumn(
                boards.timeLogs,
                'Project',
                'board_relation',
                { boardIds: [Number(boards.projects)] },
                'Which project this time log belongs to'
            );

            log('  • Customer link');
            columns.timeLogs.customer = await createColumn(
                boards.timeLogs,
                'Customer',
                'board_relation',
                { boardIds: [Number(boards.customers)] },
                'Customer this time log is for'
            );

            if (tasks) {
                log('  • Task link');
                columns.timeLogs.task = await createColumn(
                    boards.timeLogs,
                    'Task',
                    'board_relation',
                    { boardIds: [Number(boards.tasks)] },
                    'Which task inside the project'
                );

                // Reciprocal Tasks → Time Logs link.
                log('  • Tasks ← Time Logs link');
                columns.tasks.timeLogs = await createColumn(
                    boards.tasks,
                    'Time Logs',
                    'board_relation',
                    { boardIds: [Number(boards.timeLogs)] },
                    'Time logs reported on this task'
                );
            }

            log('  • Reporter');
            columns.timeLogs.reporter = await createColumn(
                boards.timeLogs, 'Reporter', 'people', null,
                'Who reported this time'
            );

            const eventTypeLabels = eventTypeLabelsFor(distinction);
            const eventTypeColors = distinction ? EVENT_TYPE_COLORS_DISTINCTION : EVENT_TYPE_COLORS_PLAIN;
            log(`  • Event Type (${eventTypeLabels.length} labels${distinction ? ' — distinction' : ''})`);
            columns.timeLogs.eventType = await createColumn(
                boards.timeLogs,
                'Event Type',
                'status',
                labelsAsDefaults(eventTypeLabels, eventTypeColors),
                'Top-level event category (All-day / Routine / Projects or Internal+External)'
            );

            log('  • Routine Type (3 labels)');
            columns.timeLogs.routineType = await createColumn(
                boards.timeLogs,
                'Routine Type',
                'status',
                labelsAsDefaults(ROUTINE_LABELS, ROUTINE_COLORS),
                'Sub-type for Non-Billable: Meeting / Training / Other'
            );

            // W4.6 (Day-off integration): עמודת סוג היום נחוצה רק כשהיעדרויות מדווחות
            // בתוך ה-tracker. כשהמקור חיצוני (absenceSource='dayoff') מדלגים — הוולידטור
            // (W4.5) כבר לא דורש allDayTypeStatusColumnId תחת מקור זה.
            if (answers.absenceSource !== 'dayoff') {
                log('  • All-day Type (3 labels)');
                columns.timeLogs.allDayType = await createColumn(
                    boards.timeLogs,
                    'All-day Type',
                    'status',
                    labelsAsDefaults(ALL_DAY_TYPE_LABELS, ALL_DAY_TYPE_COLORS),
                    'Sub-type for all-day events: Vacation / Sick / Reserves'
                );
            } else {
                log('  • All-day Type — skipped (absences are managed in the Day-off app)');
            }

            log('  • Temporary (checkbox)');
            columns.timeLogs.temporary = await createColumn(
                boards.timeLogs, 'Temporary', 'checkbox', null,
                'Marks a planned/future report not yet finalized'
            );

            if (stages) {
                log('  • Classification (3 labels)');
                columns.timeLogs.stage = await createColumn(
                    boards.timeLogs,
                    'Classification',
                    'status',
                    labelsAsDefaults(STAGE_LABELS, CLASSIFICATION_COLORS),
                    'What kind of work: Internal / External Meetings / Solo Work'
                );
            }

            log('  • Notes');
            columns.timeLogs.notes = await createColumn(
                boards.timeLogs, 'Notes', 'long_text', null,
                'Free-text notes about this report'
            );

            const user = await fetchCurrentUser();
            await seedSampleData(boards, columns, user, answers);

            const settings = buildSettingsFromResult(answers, boards, columns);
            log('Boards ready, saving settings...');

            setResult({ boards, columns, settings });
            setRunning(false);
            return settings;
        } catch (e) {
            logger.error('useBoardBuilder', 'Build failed', e);
            setError(e.message || String(e));
            setRunning(false);
            throw e;
        }
    }, [createBoard, createColumn, fetchCurrentUser, seedSampleData, resolveLocation, log, buildPortfolio]);

    return { build, progress, running, result, error };
};

