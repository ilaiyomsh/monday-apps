import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { monday } from '../utils/mondayApi/monday-client.js';
import { useMondayContext } from './MondayContext.jsx';
import { sanitizeTemplate, sanitizeParticipantTemplate, sanitizeTypeTemplate } from '../utils/templates.js';
import { stableColorForKey, randomPaletteColor, colorNameToCss } from '../constants/mondayPalette.js';
import logger from '../utils/logger.js';

/*
 * Discussion TEMPLATES store — persisted per app instance in monday.storage,
 * mirroring SettingsContext's storage approach (key, timeout, JSON, instanceId
 * fallback). Templates are independent of the board/column mapping, so this
 * provider does NOT gate render: it loads in the background and starts empty if
 * storage is unavailable (e.g. local dev). Available to all users.
 *
 * Stored value shape: { templates: Template[] }  (see utils/templates.js)
 */
const STORAGE_KEY_BASE = 'discussions_templates';
const PARTICIPANTS_STORAGE_KEY_BASE = 'discussions_participant_templates';
const TYPE_STORAGE_KEY_BASE = 'discussions_type_templates';
// Per-type DISPLAY colors, keyed by the type's label TEXT. One small object,
// loaded for ALL users (drives the discussion accent color in list/calendar);
// only owners edit it (Settings → templates tab). Kept separate from the type
// templates so coloring a type never requires loading a full type template.
const TYPE_COLORS_STORAGE_KEY_BASE = 'discussions_type_colors';
const TIMEOUT_MS = 5000;

const TemplatesContext = createContext(null);
let missingProviderWarned = false;

function genId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `tpl_${crypto.randomUUID()}`;
    }
  } catch (err) {
    // crypto unavailable — fall through to the time+random id below (still usable)
    logger.warn('TemplatesContext', 'crypto.randomUUID unavailable; using fallback id', err);
  }
  return `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function instanceKey(context) {
  const instanceId = context?.instanceId || context?.boardId || 'default';
  return `${STORAGE_KEY_BASE}_${instanceId}`;
}

function participantsInstanceKey(context) {
  const instanceId = context?.instanceId || context?.boardId || 'default';
  return `${PARTICIPANTS_STORAGE_KEY_BASE}_${instanceId}`;
}

function typeInstanceKey(context) {
  const instanceId = context?.instanceId || context?.boardId || 'default';
  return `${TYPE_STORAGE_KEY_BASE}_${instanceId}`;
}

function typeColorsInstanceKey(context) {
  const instanceId = context?.instanceId || context?.boardId || 'default';
  return `${TYPE_COLORS_STORAGE_KEY_BASE}_${instanceId}`;
}

// Normalize a stored color map to { [typeName]: colorName } of non-empty entries.
// Values are monday color NAMES; drop any legacy '#hex' value (from an earlier
// build) so it gracefully falls back to the stable name resolver.
function sanitizeTypeColors(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [name, colorName] of Object.entries(raw)) {
    if (name && typeof colorName === 'string' && colorName.trim() && !colorName.startsWith('#')) {
      out[String(name)] = colorName;
    }
  }
  return out;
}

export function TemplatesProvider({ children }) {
  const { context } = useMondayContext();
  const [templates, setTemplates] = useState([]);
  const [participantTemplates, setParticipantTemplates] = useState([]);
  const [typeTemplates, setTypeTemplates] = useState([]);
  const [typeColors, setTypeColors] = useState({});
  const [loading, setLoading] = useState(true);
  const loadedRef = useRef(false);
  const typeColorsRef = useRef({});
  const commitTypeColors = useCallback((next) => {
    typeColorsRef.current = next;
    setTypeColors(next);
  }, []);
  // Mirror of `templates`/`participantTemplates`/`typeTemplates` so the CRUD
  // callbacks always read the latest list (not a stale closure) without
  // re-creating themselves on every change.
  const templatesRef = useRef([]);
  const participantTemplatesRef = useRef([]);
  const typeTemplatesRef = useRef([]);
  const commit = useCallback((next) => {
    templatesRef.current = next;
    setTemplates(next);
  }, []);
  const commitParticipants = useCallback((next) => {
    participantTemplatesRef.current = next;
    setParticipantTemplates(next);
  }, []);
  const commitTypes = useCallback((next) => {
    typeTemplatesRef.current = next;
    setTypeTemplates(next);
  }, []);

  const load = useCallback(async () => {
    const withTimeout = (p) =>
      Promise.race([
        p,
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
      ]);

    // Topic templates.
    try {
      const res = await withTimeout(monday.storage.getItem(instanceKey(context)));
      if (res?.data?.value) {
        const saved = JSON.parse(res.data.value);
        const list = Array.isArray(saved) ? saved : saved?.templates || [];
        commit(list.map((t) => sanitizeTemplate(t, t?.id || genId())));
      } else {
        commit([]);
      }
    } catch (err) {
      // storage unavailable / parse error — start empty, never block the app.
      logger.warn('TemplatesContext', 'topic templates load failed', err);
      commit([]);
    }

    // Participant templates (separate storage key).
    try {
      const res = await withTimeout(monday.storage.getItem(participantsInstanceKey(context)));
      if (res?.data?.value) {
        const saved = JSON.parse(res.data.value);
        const list = Array.isArray(saved) ? saved : saved?.templates || [];
        commitParticipants(list.map((t) => sanitizeParticipantTemplate(t, t?.id || genId())));
      } else {
        commitParticipants([]);
      }
    } catch (err) {
      logger.warn('TemplatesContext', 'participant templates load failed', err);
      commitParticipants([]);
    }

    // Type templates (unified per-"סוג דיון"; separate storage key). Drop any
    // malformed entry whose discussionType didn't survive sanitize (returns null).
    try {
      const res = await withTimeout(monday.storage.getItem(typeInstanceKey(context)));
      if (res?.data?.value) {
        const saved = JSON.parse(res.data.value);
        const list = Array.isArray(saved) ? saved : saved?.templates || [];
        commitTypes(list.map((t) => sanitizeTypeTemplate(t, t?.id || genId())).filter(Boolean));
      } else {
        commitTypes([]);
      }
    } catch (err) {
      logger.warn('TemplatesContext', 'type templates load failed', err);
      commitTypes([]);
    }

    // Per-type colors (single object keyed by type name).
    try {
      const res = await withTimeout(monday.storage.getItem(typeColorsInstanceKey(context)));
      if (res?.data?.value) {
        const saved = JSON.parse(res.data.value);
        commitTypeColors(sanitizeTypeColors(saved?.colors ?? saved));
      } else {
        commitTypeColors({});
      }
    } catch (err) {
      logger.warn('TemplatesContext', 'type colors load failed', err);
      commitTypeColors({});
    }

    setLoading(false);
  }, [context, commit, commitParticipants, commitTypes, commitTypeColors]);

  // gate on context: wait until the parent frame identifies the instance.
  useEffect(() => {
    if (!context || loadedRef.current) return;
    loadedRef.current = true;
    load();
  }, [context, load]);

  const persist = useCallback(
    async (next) => {
      commit(next);
      try {
        await monday.storage.setItem(instanceKey(context), JSON.stringify({ templates: next }));
      } catch (err) {
        // In a real monday instance a write failure means the change was NOT
        // saved — surface it (ERROR -> toast) so the user knows. In local dev
        // (no instance) storage is expected to be unavailable, so stay quiet
        // (WARN -> no toast), matching SettingsContext's tolerance.
        if (context?.instanceId || context?.boardId) {
          logger.error('TemplatesContext', 'שמירת התבנית נכשלה — ייתכן שהשינוי לא נשמר', err);
        } else {
          logger.warn('TemplatesContext', 'אחסון תבניות לא זמין (פיתוח מקומי) — נשמר בזיכרון בלבד', err);
        }
      }
      return next;
    },
    [context, commit]
  );

  const createTemplate = useCallback(
    async (template) => {
      const clean = sanitizeTemplate(template, genId());
      await persist([...templatesRef.current, clean]);
      return clean;
    },
    [persist]
  );

  const updateTemplate = useCallback(
    async (id, template) => {
      const clean = sanitizeTemplate(template, id);
      await persist(templatesRef.current.map((t) => (t.id === id ? clean : t)));
      return clean;
    },
    [persist]
  );

  const deleteTemplate = useCallback(
    async (id) => {
      await persist(templatesRef.current.filter((t) => t.id !== id));
    },
    [persist]
  );

  const persistParticipants = useCallback(
    async (next) => {
      commitParticipants(next);
      try {
        await monday.storage.setItem(
          participantsInstanceKey(context),
          JSON.stringify({ templates: next })
        );
      } catch (err) {
        if (context?.instanceId || context?.boardId) {
          logger.error('TemplatesContext', 'שמירת תבנית המשתתפים נכשלה — ייתכן שהשינוי לא נשמר', err);
        } else {
          logger.warn('TemplatesContext', 'אחסון תבניות לא זמין (פיתוח מקומי) — נשמר בזיכרון בלבד', err);
        }
      }
      return next;
    },
    [context, commitParticipants]
  );

  const createParticipantTemplate = useCallback(
    async (template) => {
      const clean = sanitizeParticipantTemplate(template, genId());
      await persistParticipants([...participantTemplatesRef.current, clean]);
      return clean;
    },
    [persistParticipants]
  );

  const updateParticipantTemplate = useCallback(
    async (id, template) => {
      const clean = sanitizeParticipantTemplate(template, id);
      await persistParticipants(participantTemplatesRef.current.map((t) => (t.id === id ? clean : t)));
      return clean;
    },
    [persistParticipants]
  );

  const deleteParticipantTemplate = useCallback(
    async (id) => {
      await persistParticipants(participantTemplatesRef.current.filter((t) => t.id !== id));
    },
    [persistParticipants]
  );

  const persistTypes = useCallback(
    async (next) => {
      commitTypes(next);
      try {
        await monday.storage.setItem(typeInstanceKey(context), JSON.stringify({ templates: next }));
      } catch (err) {
        if (context?.instanceId || context?.boardId) {
          logger.error('TemplatesContext', 'שמירת תבנית סוג הדיון נכשלה — ייתכן שהשינוי לא נשמר', err);
        } else {
          logger.warn('TemplatesContext', 'אחסון תבניות לא זמין (פיתוח מקומי) — נשמר בזיכרון בלבד', err);
        }
      }
      return next;
    },
    [context, commitTypes]
  );

  // Upsert by discussionType — there is at most ONE type template per type, so
  // saving replaces any existing entry for that type (keeping its id) or appends.
  const upsertTypeTemplate = useCallback(
    async (template) => {
      const clean = sanitizeTypeTemplate(template, template?.id || genId());
      if (!clean) return null; // missing/invalid discussionType
      const existing = typeTemplatesRef.current.find((t) => t.discussionType === clean.discussionType);
      const withId = existing ? { ...clean, id: existing.id } : clean;
      const next = existing
        ? typeTemplatesRef.current.map((t) => (t.discussionType === clean.discussionType ? withId : t))
        : [...typeTemplatesRef.current, withId];
      await persistTypes(next);
      return withId;
    },
    [persistTypes]
  );

  const deleteTypeTemplate = useCallback(
    async (discussionType) => {
      await persistTypes(typeTemplatesRef.current.filter((t) => t.discussionType !== discussionType));
    },
    [persistTypes]
  );

  const persistTypeColors = useCallback(
    async (next) => {
      commitTypeColors(next);
      try {
        await monday.storage.setItem(typeColorsInstanceKey(context), JSON.stringify({ colors: next }));
      } catch (err) {
        if (context?.instanceId || context?.boardId) {
          logger.error('TemplatesContext', 'שמירת צבע סוג הדיון נכשלה — ייתכן שהשינוי לא נשמר', err);
        } else {
          logger.warn('TemplatesContext', 'אחסון תבניות לא זמין (פיתוח מקומי) — נשמר בזיכרון בלבד', err);
        }
      }
      return next;
    },
    [context, commitTypeColors]
  );

  // Resolve a type's monday color NAME: the stored name, else a stable hash color
  // (so an unseen type still gets a consistent, non-grey color). Pure read.
  const typeColorName = useCallback(
    (name) => (name && typeColorsRef.current[name]) || stableColorForKey(name),
    []
  );

  // Resolve a type's DISPLAY color as a CSS string (theme-aware var) — drop
  // straight into a style value. This is what list/calendar/swatches consume.
  const typeColor = useCallback(
    (name) => colorNameToCss(typeColorName(name)),
    [typeColorName]
  );

  // Explicitly set (owner edit) a type's color NAME.
  const setTypeColor = useCallback(
    async (name, colorName) => {
      if (!name || !colorName) return;
      await persistTypeColors({ ...typeColorsRef.current, [String(name)]: colorName });
    },
    [persistTypeColors]
  );

  // Assign a RANDOM palette color NAME to a NEW type (idempotent: keeps the
  // existing color if the type already has one). Call when a type is first created.
  const assignRandomTypeColor = useCallback(
    async (name) => {
      if (!name) return null;
      const current = typeColorsRef.current;
      if (current[name]) return current[name];
      const colorName = randomPaletteColor(Object.values(current));
      await persistTypeColors({ ...current, [String(name)]: colorName });
      return colorName;
    },
    [persistTypeColors]
  );

  return (
    <TemplatesContext.Provider
      value={{
        templates,
        participantTemplates,
        typeTemplates,
        typeColors,
        loading,
        createTemplate,
        updateTemplate,
        deleteTemplate,
        createParticipantTemplate,
        updateParticipantTemplate,
        deleteParticipantTemplate,
        upsertTypeTemplate,
        deleteTypeTemplate,
        typeColor,
        typeColorName,
        setTypeColor,
        assignRandomTypeColor,
      }}
    >
      {children}
    </TemplatesContext.Provider>
  );
}

export function useTemplates() {
  const ctx = useContext(TemplatesContext);
  if (!ctx) {
    if (!missingProviderWarned) {
      logger.warn('TemplatesContext', 'useTemplates called without TemplatesProvider; returning empty store.');
      missingProviderWarned = true;
    }
    return {
      templates: [],
      participantTemplates: [],
      typeTemplates: [],
      typeColors: {},
      loading: false,
      createTemplate: async () => null,
      updateTemplate: async () => null,
      deleteTemplate: async () => {},
      createParticipantTemplate: async () => null,
      updateParticipantTemplate: async () => null,
      deleteParticipantTemplate: async () => {},
      upsertTypeTemplate: async () => null,
      deleteTypeTemplate: async () => {},
      typeColor: (name) => colorNameToCss(stableColorForKey(name)),
      typeColorName: (name) => stableColorForKey(name),
      setTypeColor: async () => {},
      assignRandomTypeColor: async () => null,
    };
  }
  return ctx;
}
