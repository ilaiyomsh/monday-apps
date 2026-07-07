const logEl = document.getElementById('log');
const rowsEl = document.getElementById('rows');

function getIdentityHeaders() {
  return {
    'x-account-id': document.getElementById('accountId').value.trim(),
    'x-user-id': document.getElementById('userId').value.trim(),
    'x-user-role': document.getElementById('role').value.trim(),
  };
}

function log(value) {
  const next = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  logEl.textContent = `${next}\n\n${logEl.textContent}`.slice(0, 15000);
}

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...getIdentityHeaders(),
    ...(options.headers || {}),
  };
  const res = await fetch(path, { ...options, headers });
  const contentType = res.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    throw new Error(typeof body === 'string' ? body : JSON.stringify(body));
  }
  return body;
}

function rowButtons(row) {
  return `
    <button data-action="google" data-id="${row.configId}">Connect Google</button>
    <button data-action="monday" data-id="${row.configId}">Connect monday</button>
    <button data-action="sync" data-id="${row.configId}">Force Sync</button>
  `;
}

function renderRows(rows) {
  rowsEl.innerHTML = rows
    .map(
      (row) => `
      <div class="card">
        <div><strong>Config:</strong> ${row.configId}</div>
        <div><strong>User:</strong> ${row.userId}</div>
        <div><strong>Google:</strong> ${row.googleUserEmail || 'not connected'}</div>
        <div><strong>Status:</strong> ${row.status}</div>
        <div style="margin-top:8px">${rowButtons(row)}</div>
      </div>
    `
    )
    .join('');
}

async function loadRows() {
  const objectId = document.getElementById('objectId').value.trim();
  const data = await api(`/api/configs?objectId=${encodeURIComponent(objectId)}`);
  renderRows(data.rows || []);
  log({ loadedRows: (data.rows || []).length });
}

document.getElementById('savePolicyBtn').addEventListener('click', async () => {
  try {
    const objectId = document.getElementById('objectId').value.trim();
    const body = {
      objectId,
      boardId: document.getElementById('boardId').value.trim() || null,
      linkColumnId: document.getElementById('linkColumnId').value.trim() || null,
      peopleColumnId: document.getElementById('peopleColumnId').value.trim() || null,
      columnMapping: JSON.parse(document.getElementById('columnMapping').value || '{}'),
    };
    const out = await api('/api/policy', {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    log(out);
  } catch (err) {
    log(`save policy failed: ${err.message}`);
  }
});

document.getElementById('loadRowsBtn').addEventListener('click', async () => {
  try {
    await loadRows();
  } catch (err) {
    log(`load rows failed: ${err.message}`);
  }
});

rowsEl.addEventListener('click', async (evt) => {
  const button = evt.target.closest('button');
  if (!button) return;
  const action = button.dataset.action;
  const configId = button.dataset.id;

  try {
    if (action === 'google') {
      const data = await api('/api/oauth/google/start', {
        method: 'POST',
        body: JSON.stringify({ configId }),
      });
      window.open(data.authUrl, '_blank');
      log({ googleStart: data });
      return;
    }
    if (action === 'monday') {
      const data = await api('/api/oauth/monday/start', {
        method: 'POST',
        body: JSON.stringify({ configId }),
      });
      window.open(data.authUrl, '_blank');
      log({ mondayStart: data });
      return;
    }
    if (action === 'sync') {
      const data = await api(`/api/configs/${encodeURIComponent(configId)}/force-sync`, {
        method: 'POST',
      });
      log(data);
      await loadRows();
    }
  } catch (err) {
    log(`${action} failed: ${err.message}`);
  }
});

loadRows().catch((err) => log(`initial load failed: ${err.message}`));
