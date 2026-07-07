export async function exchangeGoogleCodeForTokens({ code, redirectUri, clientId, clientSecret }) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    throw new Error(`google token exchange failed: ${res.status}`);
  }

  return res.json();
}

export async function refreshGoogleAccessToken({ refreshToken, clientId, clientSecret }) {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    throw new Error(`google token refresh failed: ${res.status}`);
  }

  return res.json();
}

export async function getGoogleUserEmail(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`google userinfo failed: ${res.status}`);
  const data = await res.json();
  return data.email || null;
}

export async function listGoogleEvents({ accessToken, syncToken }) {
  // Initial fetch (no syncToken): pull events from NOW forward, expand recurring
  // events into concrete instances, paginate until we get nextSyncToken.
  // Incremental fetch (with syncToken): just paginate through the delta.
  const baseParams = {
    maxResults: '250',
    showDeleted: 'true',
  };
  if (syncToken) {
    baseParams.syncToken = syncToken;
  } else {
    baseParams.singleEvents = 'true';
    baseParams.timeMin = new Date().toISOString();
  }

  const allItems = [];
  let pageToken;
  let nextSyncToken = null;

  do {
    const params = new URLSearchParams({ ...baseParams });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`google events list failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    allItems.push(...(data.items || []));
    pageToken = data.nextPageToken;
    if (!pageToken) nextSyncToken = data.nextSyncToken || null;
  } while (pageToken);

  return { items: allItems, nextSyncToken };
}
