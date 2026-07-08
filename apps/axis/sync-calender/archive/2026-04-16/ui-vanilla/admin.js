// Minimal vanilla UI for the Calendar Sync Admin Custom Object.
// Assumes monday-sdk-js is loaded globally (window.mondaySdk).

const monday = window.mondaySdk ? window.mondaySdk() : null;

const state = {
  context: null,
  sessionToken: null,
  objectId: null,
  me: null,        // { id, email }
  policy: null,
  rows: [],
  isOwner: false,
};

const $ = (id) => document.getElementById(id);
const logEl = $('log');

function log(msg) {
  const line = typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2);
  logEl.textContent = `${line}\n\n${logEl.textContent}`.slice(0, 20000);
}

function pickObjectId(ctx) {
  // Monday passes the Custom Object instance ID as `?instanceId=<id>` on the
  // iframe URL; this is the same ID sent as `data.payload.object_id` in the
  // AppFeatureObject:create lifecycle webhook. Everything else is fallback.
  const p = new URLSearchParams(window.location.search);
  const fromQuery = p.get('instanceId') || p.get('objectId');
  if (fromQuery) return String(fromQuery);
  const fromCtx =
    ctx?.instanceId ||
    ctx?.appFeatureObjectId ||
    ctx?.objectId ||
    ctx?.appFeatureId ||
    ctx?.boardId;
  return fromCtx ? String(fromCtx) : '';
}

async function apiFetch(path, options = {}) {
  if (!state.sessionToken) throw new Error('sessionToken not ready');
  const headers = Object.assign(
    { 'Content-Type': 'application/json', Authorization: state.sessionToken },
    options.headers || {}
  );
  const res = await fetch(path, { ...options, headers });
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error(typeof body === 'string' ? body : body.error || 'request_failed');
    err.response = body;
    throw err;
  }
  return body;
}

async function bootMondayContext() {
  if (!monday) {
    log('monday-sdk-js did not load — check CDN/CSP.');
    $('identity').textContent = 'SDK failed to load';
    return;
  }
  try {
    const [ctxRes, tokenRes] = await Promise.all([
      monday.get('context'),
      monday.get('sessionToken'),
    ]);
    state.context = ctxRes?.data || ctxRes || {};
    state.sessionToken = tokenRes?.data || tokenRes || null;
    state.objectId = pickObjectId(state.context);
    const ctx = state.context || {};
    $('identity').textContent = `Account ${ctx.account?.id || '?'} · User ${ctx.user?.id || '?'} (${ctx.user?.name || ''}) · Object ${state.objectId || '(unknown)'}`;
  } catch (err) {
    log('failed to read monday context: ' + err.message);
    throw err;
  }
}

async function loadMeViaMondayApi() {
  try {
    const res = await monday.api('query { me { id name email } }');
    state.me = res?.data?.me || null;
  } catch (err) {
    log('monday.api me{} failed: ' + err.message);
  }
}

async function loadPolicy() {
  if (!state.objectId) return;
  try {
    const res = await apiFetch(`/api/policy?objectId=${encodeURIComponent(state.objectId)}`);
    state.policy = res.policy;
  } catch (err) {
    if (err.response?.error === 'policy_not_found') {
      state.policy = null;
      return;
    }
    log('GET /api/policy failed: ' + err.message);
  }
}

function renderPolicy() {
  const ownerId = state.policy?.ownerUserId;
  const myId = String(state.context?.user?.id || state.me?.id || '');
  state.isOwner = Boolean(ownerId && myId && String(ownerId) === myId);

  const card = $('policyCard');
  card.classList.remove('hidden');

  $('policyOwnerIndicator').textContent = state.isOwner ? '(you are the owner)' : `(owner: ${ownerId || 'unknown'})`;

  if (!state.policy) {
    $('policyHint').textContent = 'No policy yet — the lifecycle webhook will provision one when the Custom Object is installed.';
    return;
  }

  // Disable inputs if not owner
  const canEdit = state.isOwner;
  ['boardSelect', 'linkColumnSelect', 'peopleColumnSelect', 'columnMapping', 'savePolicyBtn'].forEach((id) => {
    $(id).disabled = !canEdit;
  });
  $('columnMapping').value = JSON.stringify(state.policy.columnMapping || {}, null, 2);
}

async function loadBoards() {
  try {
    const res = await monday.api('query { boards(limit: 100) { id name } }');
    const boards = res?.data?.boards || [];
    const sel = $('boardSelect');
    sel.innerHTML = '<option value="">(choose…)</option>' +
      boards.map((b) => `<option value="${b.id}">${b.name} (${b.id})</option>`).join('');
    if (state.policy?.boardId) sel.value = String(state.policy.boardId);
    sel.onchange = () => loadColumnsForBoard(sel.value);
    if (sel.value) loadColumnsForBoard(sel.value);
  } catch (err) {
    log('loadBoards failed: ' + err.message);
  }
}

async function loadColumnsForBoard(boardId) {
  if (!boardId) return;
  try {
    const res = await monday.api(`query { boards(ids: [${boardId}]) { columns { id title type } } }`);
    const cols = res?.data?.boards?.[0]?.columns || [];
    const linkSel = $('linkColumnSelect');
    const peopleSel = $('peopleColumnSelect');
    const linkCols = cols.filter((c) => c.type === 'link');
    const peopleCols = cols.filter((c) => c.type === 'people');
    linkSel.innerHTML = '<option value="">(choose…)</option>' + linkCols.map((c) => `<option value="${c.id}">${c.title} (${c.id})</option>`).join('');
    peopleSel.innerHTML = '<option value="">(none)</option>' + peopleCols.map((c) => `<option value="${c.id}">${c.title} (${c.id})</option>`).join('');
    if (state.policy?.linkColumnId) linkSel.value = state.policy.linkColumnId;
    if (state.policy?.peopleColumnId) peopleSel.value = state.policy.peopleColumnId;
  } catch (err) {
    log('loadColumns failed: ' + err.message);
  }
}

async function savePolicy() {
  const mapping = (() => {
    try {
      return JSON.parse($('columnMapping').value || '{}');
    } catch (e) {
      alert('columnMapping must be valid JSON: ' + e.message);
      return null;
    }
  })();
  if (!mapping) return;

  const body = {
    objectId: state.objectId,
    boardId: $('boardSelect').value || null,
    linkColumnId: $('linkColumnSelect').value || null,
    peopleColumnId: $('peopleColumnSelect').value || null,
    columnMapping: mapping,
  };

  try {
    const res = await apiFetch('/api/policy', { method: 'PATCH', body: JSON.stringify(body) });
    state.policy = res.policy;
    $('policySaveStatus').textContent = 'saved ' + new Date().toLocaleTimeString();
    log({ savedPolicy: res.policy });
  } catch (err) {
    log('PATCH /api/policy failed: ' + err.message);
    alert('save failed: ' + err.message);
  }
}

async function loadRows() {
  $('rowsStatus').textContent = 'loading rows…';
  try {
    const res = await apiFetch(`/api/configs?objectId=${encodeURIComponent(state.objectId)}`);
    state.rows = res.rows || [];
    renderRows();
  } catch (err) {
    $('rowsStatus').textContent = 'failed to load: ' + err.message;
    log('GET /api/configs failed: ' + err.message);
  }
}

function statusBadge(status) {
  if (status === 'active') return '<span class="badge active">active</span>';
  if (status?.includes('disconnected') || status === 'pending_policy') return `<span class="badge error">${status}</span>`;
  return `<span class="badge pending">${status || 'pending'}</span>`;
}

function renderRows() {
  const tbody = $('rowsTbody');
  if (!state.rows.length) {
    $('rowsStatus').textContent = 'no rows yet';
    return;
  }
  $('rowsStatus').classList.add('hidden');
  $('rowsTable').classList.remove('hidden');

  const myId = String(state.context?.user?.id || state.me?.id || '');

  tbody.innerHTML = state.rows.map((r) => {
    const mine = String(r.userId) === myId;
    const connectGoogle = !r.hasGoogleConnection;
    const connectMonday = !r.hasMondayConnection;
    const lastSync = r.lastSyncAt ? new Date(r.lastSyncAt).toLocaleString() : '—';
    const actions = [];
    if (mine) {
      if (connectGoogle) actions.push(`<button class="small-btn" data-action="google" data-id="${r.configId}">Connect Google</button>`);
      if (connectMonday) actions.push(`<button class="small-btn" data-action="monday" data-id="${r.configId}">Authorize monday</button>`);
      actions.push(`<button class="small-btn secondary" data-action="sync" data-id="${r.configId}">Force sync</button>`);
      actions.push(`<button class="small-btn danger" data-action="delete" data-id="${r.configId}">Disconnect</button>`);
    }
    return `<tr>
      <td><strong>${r.userId}</strong>${mine ? ' (me)' : ''}${r.googleUserEmail ? `<br/><span class="muted" style="font-size:11px;">${r.googleUserEmail}</span>` : ''}</td>
      <td>${r.hasGoogleConnection ? '✓' : '—'}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${lastSync}</td>
      <td>${r.lastError ? `<span class="muted">${r.lastError.slice(0, 60)}</span>` : '—'}</td>
      <td>${actions.join(' ')}</td>
    </tr>`;
  }).join('');

  tbody.onclick = async (evt) => {
    const btn = evt.target.closest('button');
    if (!btn) return;
    const { action, id: configId } = btn.dataset;
    try {
      if (action === 'google') {
        const r = await apiFetch('/oauth/google/start', { method: 'POST', body: JSON.stringify({ configId }) });
        window.open(r.authUrl, '_blank');
        log({ googleStart: { configId } });
      } else if (action === 'monday') {
        const r = await apiFetch('/oauth/monday/start', { method: 'POST', body: JSON.stringify({ configId }) });
        window.open(r.authUrl, '_blank');
        log({ mondayStart: { configId } });
      } else if (action === 'sync') {
        log({ forceSyncStart: { configId } });
        const r = await apiFetch(`/api/configs/${encodeURIComponent(configId)}/force-sync`, { method: 'POST' });
        log({ forceSyncResult: r });
        await loadRows();
      } else if (action === 'delete') {
        if (!confirm('Disconnect this row? Google watch will be stopped and config deleted.')) return;
        await apiFetch(`/api/configs/${encodeURIComponent(configId)}`, { method: 'DELETE' });
        log({ deleted: configId });
        await loadRows();
      }
    } catch (err) {
      log(`${action} failed: ${err.message}`);
    }
  };
}

async function init() {
  await bootMondayContext();
  if (!state.sessionToken) {
    log('no sessionToken — UI cannot proceed.');
    return;
  }
  await loadMeViaMondayApi();
  await loadPolicy();
  renderPolicy();
  await loadBoards();
  await loadRows();
}

$('savePolicyBtn').addEventListener('click', savePolicy);

init().catch((err) => log('init failed: ' + err.message));
