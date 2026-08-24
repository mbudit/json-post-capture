const tbody = document.getElementById('captures-body');
const statusEl = document.getElementById('status');
const autoRefreshEl = document.getElementById('auto-refresh');
const refreshBtn = document.getElementById('refresh-btn');
const endpointUrlEl = document.getElementById('endpoint-url');
const previousPageBtn = document.getElementById('previous-page');
const nextPageBtn = document.getElementById('next-page');
const pageInfo = document.getElementById('page-info');

const forwardBody = document.getElementById('forward-body');
const forwardSummary = document.getElementById('forward-summary');
const forwardAddForm = document.getElementById('forward-add-form');
const newHost = document.getElementById('new-host');
const newPort = document.getElementById('new-port');
const newPath = document.getElementById('new-path');
const newTimeout = document.getElementById('new-timeout');
const forwardMessage = document.getElementById('forward-message');

const modal = document.getElementById('modal');
const modalId = document.getElementById('modal-id');
const modalMeta = document.getElementById('modal-meta');
const modalJson = document.getElementById('modal-json');
const modalClose = document.getElementById('modal-close');

endpointUrlEl.textContent = `${location.protocol}//${location.host}/api/capture`;

let refreshTimer = null;
let currentPage = 1;
const pageSize = 50;

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString();
}

async function loadCaptures() {
  try {
    const res = await fetch(`/api/captures?limit=${pageSize}&page=${currentPage}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();
    currentPage = result.page;
    renderRows(result.items);
    pageInfo.textContent = `Page ${result.page} of ${result.totalPages} (${result.total} captures)`;
    previousPageBtn.disabled = result.page <= 1;
    nextPageBtn.disabled = result.page >= result.totalPages;
    statusEl.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  }
}

function renderRows(rows) {
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">No captures yet.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((r) => `
    <tr data-id="${r.id}">
      <td>${fmtTime(r.received_at)}</td>
      <td>${r.station ? escapeHtml(r.station) : '<span class="empty">—</span>'}</td>
      <td>${escapeHtml(r.source_ip || '')}</td>
      <td>${escapeHtml(r.content_type || '')}</td>
      <td><span class="badge ${r.is_valid_json ? 'ok' : 'bad'}">${r.is_valid_json ? 'valid' : 'invalid'}</span></td>
      <td>${r.size} B</td>
      <td><span class="preview">${escapeHtml(r.preview)}</span></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', () => openModal(tr.dataset.id));
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function openModal(id) {
  const res = await fetch(`/api/captures/${id}`);
  if (!res.ok) return;
  const capture = await res.json();

  modalId.textContent = capture.id;
  modalMeta.innerHTML = `
    <dt>Received</dt><dd>${fmtTime(capture.received_at)}</dd>
    <dt>Station</dt><dd>${escapeHtml(capture.station || '—')}</dd>
    <dt>Source IP</dt><dd>${escapeHtml(capture.source_ip || '')}</dd>
    <dt>Content-Type</dt><dd>${escapeHtml(capture.content_type || '')}</dd>
  `;

  let body = capture.raw_body || '';
  if (capture.is_valid_json) {
    try {
      body = JSON.stringify(JSON.parse(capture.raw_body), null, 2);
    } catch (e) {
      // fall back to raw body
    }
  }
  modalJson.textContent = body;

  modal.classList.remove('hidden');
}

modalClose.addEventListener('click', () => modal.classList.add('hidden'));
modal.addEventListener('click', (e) => {
  if (e.target === modal) modal.classList.add('hidden');
});

refreshBtn.addEventListener('click', loadCaptures);
previousPageBtn.addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage -= 1;
    loadCaptures();
  }
});
nextPageBtn.addEventListener('click', () => {
  currentPage += 1;
  loadCaptures();
});

function scheduleRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (autoRefreshEl.checked) {
    refreshTimer = setInterval(() => {
      loadCaptures();
      refreshForwardResults();
    }, 5000);
  }
}

autoRefreshEl.addEventListener('change', scheduleRefresh);

let forwardTargets = [];

function setMessage(text, isError) {
  forwardMessage.textContent = text;
  forwardMessage.className = isError ? 'error' : 'success';
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

function lastResultHtml(lastResult) {
  if (!lastResult) return '<span class="empty">—</span>';
  const outcome = lastResult.ok
    ? `OK (${lastResult.status})`
    : `failed — ${escapeHtml(lastResult.error || `HTTP ${lastResult.status}`)}`;
  return `<span class="${lastResult.ok ? 'success' : 'error'}">${outcome}</span><br><span class="hint">${fmtTime(lastResult.at)}</span>`;
}

function renderForwardTable() {
  const activeCount = forwardTargets.filter((t) => t.enabled).length;
  forwardSummary.textContent = activeCount ? `${activeCount} active` : 'off';
  forwardSummary.className = `badge ${activeCount ? 'ok' : ''}`;

  if (!forwardTargets.length) {
    forwardBody.innerHTML = '<tr><td colspan="7" class="empty">No forwarding targets yet.</td></tr>';
    return;
  }

  forwardBody.innerHTML = forwardTargets.map((t) => `
    <tr data-id="${t.id}">
      <td><input type="checkbox" class="row-enabled" ${t.enabled ? 'checked' : ''}></td>
      <td><input type="text" class="row-host" value="${escapeAttr(t.host)}"></td>
      <td><input type="number" class="row-port" value="${t.port}" min="1" max="65535"></td>
      <td><input type="text" class="row-path" value="${escapeAttr(t.path)}"></td>
      <td><input type="number" class="row-timeout" value="${t.timeout_ms}" min="100" max="60000"></td>
      <td class="row-last">${lastResultHtml(t.lastResult)}</td>
      <td class="row-actions">
        <button type="button" class="row-save">Save</button>
        <button type="button" class="row-test">Test</button>
        <button type="button" class="row-delete">Delete</button>
      </td>
    </tr>
  `).join('');

  forwardBody.querySelectorAll('tr[data-id]').forEach((tr) => {
    const id = Number(tr.dataset.id);
    tr.querySelector('.row-enabled').addEventListener('change', () => saveRow(id, tr));
    tr.querySelector('.row-save').addEventListener('click', () => saveRow(id, tr));
    tr.querySelector('.row-test').addEventListener('click', () => testRow(id));
    tr.querySelector('.row-delete').addEventListener('click', () => deleteRow(id));
  });
}

async function loadForward() {
  try {
    const res = await fetch('/api/forward/targets');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    forwardTargets = (await res.json()).targets;
    renderForwardTable();
  } catch (err) {
    setMessage(`Error: ${err.message}`, true);
  }
}

// Updates only the "Last result" cells, so a periodic refresh can't clobber
// edits in progress in the row inputs. Ignores targets added/removed
// elsewhere in the meantime — those show up on the next full loadForward().
async function refreshForwardResults() {
  try {
    const res = await fetch('/api/forward/targets');
    if (!res.ok) return;
    const { targets } = await res.json();
    targets.forEach((t) => {
      const idx = forwardTargets.findIndex((x) => x.id === t.id);
      if (idx === -1) return;
      forwardTargets[idx].lastResult = t.lastResult;
      const cell = forwardBody.querySelector(`tr[data-id="${t.id}"] .row-last`);
      if (cell) cell.innerHTML = lastResultHtml(t.lastResult);
    });
  } catch (err) {
    // Silent — the next manual action will surface a real error if the server is down.
  }
}

function rowValues(tr) {
  return {
    enabled: tr.querySelector('.row-enabled').checked,
    host: tr.querySelector('.row-host').value,
    port: Number(tr.querySelector('.row-port').value) || 80,
    path: tr.querySelector('.row-path').value || '/',
    timeout_ms: Number(tr.querySelector('.row-timeout').value) || 5000,
  };
}

async function saveRow(id, tr) {
  setMessage('Saving…', false);
  try {
    const res = await fetch(`/api/forward/targets/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rowValues(tr)),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    forwardTargets[forwardTargets.findIndex((t) => t.id === id)] = data.target;
    renderForwardTable();
    setMessage('Saved.', false);
  } catch (err) {
    setMessage(err.message, true);
  }
}

async function testRow(id) {
  setMessage('Sending test…', false);
  try {
    const res = await fetch(`/api/forward/targets/${id}/test`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const idx = forwardTargets.findIndex((t) => t.id === id);
    forwardTargets[idx] = { ...forwardTargets[idx], lastResult: data.result };
    renderForwardTable();
    setMessage(data.result.ok ? `Test OK (HTTP ${data.result.status})` : 'Test failed', !data.result.ok);
  } catch (err) {
    setMessage(err.message, true);
  }
}

async function deleteRow(id) {
  try {
    const res = await fetch(`/api/forward/targets/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    forwardTargets = forwardTargets.filter((t) => t.id !== id);
    renderForwardTable();
    setMessage('Deleted.', false);
  } catch (err) {
    setMessage(err.message, true);
  }
}

forwardAddForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setMessage('Adding…', false);
  try {
    const res = await fetch('/api/forward/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: newHost.value,
        port: Number(newPort.value) || 80,
        path: newPath.value || '/',
        timeout_ms: Number(newTimeout.value) || 5000,
        enabled: true,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    forwardTargets.push(data.target);
    renderForwardTable();
    forwardAddForm.reset();
    setMessage('Added.', false);
  } catch (err) {
    setMessage(err.message, true);
  }
});

loadCaptures();
loadForward();
scheduleRefresh();
