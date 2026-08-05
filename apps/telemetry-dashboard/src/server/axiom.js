// Thin Axiom APL query client. Talks to the tabular _apl endpoint and returns
// the rows as an array of plain objects. The read token + org id live ONLY
// here (server env) — they are never logged and never leave the process.

const AXIOM_APL_URL = 'https://api.axiom.co/v1/datasets/_apl?format=tabular';

/**
 * Convert Axiom's tabular response into an array of row objects.
 * Tabular shape: { tables: [ { fields: [{name}], columns: [ [..values..], ... ] } ] }
 * columns are column-major (one inner array per field).
 * @param {any} json
 * @returns {Array<Record<string, unknown>>}
 */
export function tabularToRows(json) {
  const table = json?.tables?.[0];
  if (!table || !Array.isArray(table.fields) || !Array.isArray(table.columns)) return [];
  const names = table.fields.map((f) => f?.name);
  const columns = table.columns;
  const rowCount = columns[0]?.length ?? 0;
  const rows = [];
  for (let r = 0; r < rowCount; r++) {
    const row = {};
    for (let c = 0; c < names.length; c++) {
      row[names[c]] = columns[c]?.[r];
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Create a query runner bound to a token / org.
 * @param {{ token: string, orgId?: string, fetchImpl?: typeof fetch }} opts
 */
export function createAxiomClient({ token, orgId, fetchImpl }) {
  const doFetch = fetchImpl || fetch;

  /**
   * Run one APL query over an explicit ISO time window.
   * @param {string} apl  pipeline starting with ['dataset'] | where _time between (_startTime .. _endTime) | ...
   * @param {string} startTime ISO
   * @param {string} endTime ISO
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async function query(apl, startTime, endTime) {
    // Bind the _startTime/_endTime identifiers the shared prefix references,
    // and pass the same window in the body so Axiom scopes the scan too.
    const withBindings = `let _startTime = datetime('${startTime}');\nlet _endTime = datetime('${endTime}');\n${apl}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    if (orgId) headers['X-Axiom-Org-Id'] = orgId;

    const res = await doFetch(AXIOM_APL_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ apl: withBindings, startTime, endTime }),
    });
    if (!res.ok) {
      // Never include the token; surface only status + a short body snippet.
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 300);
      } catch {
        // body unreadable — status alone is the signal
      }
      const err = new Error(`axiom query failed: ${res.status} ${detail}`);
      err.status = res.status;
      throw err;
    }
    const json = await res.json();
    return tabularToRows(json);
  }

  return { query };
}
