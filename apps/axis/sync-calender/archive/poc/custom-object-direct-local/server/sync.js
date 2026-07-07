import { listGoogleEvents, refreshGoogleAccessToken } from './google-client.js';
import { createItem, deleteItem, findItemByLink, renameItem, updateItem } from './monday-client.js';
import { updateConfig } from './storage.js';

function eventDurationHours(event) {
  const start = event.start?.dateTime ? new Date(event.start.dateTime).getTime() : null;
  const end = event.end?.dateTime ? new Date(event.end.dateTime).getTime() : null;
  if (!start || !end || end <= start) return '';
  const hours = (end - start) / (1000 * 60 * 60);
  return String(Number(hours.toFixed(2)));
}

function shouldSync(event) {
  if (event.status === 'cancelled') return true;
  if (event.start && !event.start.dateTime) return false;
  if (!event.attendees?.length) return true;
  const self = event.attendees.find((a) => a.self === true);
  return self?.responseStatus === 'accepted';
}

function toMondayDate(iso) {
  if (!iso) return '';
  // All-day events come as YYYY-MM-DD (no time)
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { date: iso };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  // monday Date column accepts { date: "YYYY-MM-DD", time: "HH:MM:SS" } in UTC
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
  };
}

function mapEventToColumns(event, policy, rowOwnerUserId) {
  const source = {
    eventName: event.summary || '',
    startDate: toMondayDate(event.start?.dateTime || event.start?.date || ''),
    endDate: toMondayDate(event.end?.dateTime || event.end?.date || ''),
    description: event.description || '',
    duration: eventDurationHours(event),
    eventLink: event.htmlLink || '',
  };

  const values = {};
  for (const [columnId, map] of Object.entries(policy.columnMapping || {})) {
    if (map?.literal !== undefined) {
      values[columnId] = map.literal;
      continue;
    }
    values[columnId] = source[map?.source] ?? '';
  }

  if (policy.linkColumnId && source.eventLink) {
    values[policy.linkColumnId] = { url: source.eventLink, text: source.eventLink };
  }

  if (policy.peopleColumnId) {
    values[policy.peopleColumnId] = {
      personsAndTeams: [{ id: Number(rowOwnerUserId), kind: 'person' }],
    };
  }

  return values;
}

async function ensureGoogleAccess(config) {
  const now = Date.now();
  if (config.googleAccessToken && config.googleAccessTokenExpiresAt && config.googleAccessTokenExpiresAt - 60_000 > now) {
    return config.googleAccessToken;
  }
  if (!config.googleRefreshToken) {
    throw new Error('google refresh token missing');
  }
  const refreshed = await refreshGoogleAccessToken({
    refreshToken: config.googleRefreshToken,
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  });
  const nextExpiry = Date.now() + Number(refreshed.expires_in || 3600) * 1000;
  const updated = await updateConfig(config.configId, {
    googleAccessToken: refreshed.access_token,
    googleAccessTokenExpiresAt: nextExpiry,
  });
  return updated.googleAccessToken;
}

export async function syncConfig({ config, policy }) {
  const accessToken = await ensureGoogleAccess(config);
  if (!config.mondayAccessToken) {
    throw new Error('monday access token missing');
  }
  if (!policy?.boardId || !policy?.linkColumnId) {
    throw new Error('instance policy is not configured');
  }

  const { items, nextSyncToken } = await listGoogleEvents({
    accessToken,
    syncToken: config.googleSyncToken,
  });

  let processed = 0;
  for (const event of items) {
    if (!shouldSync(event)) continue;
    const eventLink = event.htmlLink || '';
    const itemName = event.summary || 'Google Calendar Event';
    const existing = eventLink
      ? await findItemByLink({
          token: config.mondayAccessToken,
          boardId: policy.boardId,
          linkColumnId: policy.linkColumnId,
          linkValue: eventLink,
        })
      : null;

    if (event.status === 'cancelled') {
      if (existing) {
        await deleteItem({ token: config.mondayAccessToken, itemId: existing.id });
      }
      processed += 1;
      continue;
    }

    const columnValues = mapEventToColumns(event, policy, config.mondayUserId || config.userId);
    if (!existing) {
      await createItem({
        token: config.mondayAccessToken,
        boardId: policy.boardId,
        itemName,
        columnValues,
      });
    } else {
      await updateItem({
        token: config.mondayAccessToken,
        boardId: policy.boardId,
        itemId: existing.id,
        columnValues,
      });
      await renameItem({
        token: config.mondayAccessToken,
        boardId: policy.boardId,
        itemId: existing.id,
        itemName,
      });
    }
    processed += 1;
  }

  await updateConfig(config.configId, {
    googleSyncToken: nextSyncToken || config.googleSyncToken,
    lastSyncAt: Date.now(),
    lastError: null,
    status: 'active',
  });

  return { processed, nextSyncToken };
}
