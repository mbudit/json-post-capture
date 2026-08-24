const tbody = document.getElementById('captures-body');
const statusEl = document.getElementById('status');
const autoRefreshEl = document.getElementById('auto-refresh');
const refreshBtn = document.getElementById('refresh-btn');
const endpointUrlEl = document.getElementById('endpoint-url');
const previousPageBtn = document.getElementById('previous-page');
const nextPageBtn = document.getElementById('next-page');
const pageInfo = document.getElementById('page-info');

const forwardForm = document.getElementById('forward-form');
const forwardEnabled = document.getElementById('forward-enabled');
const forwardHost = document.getElementById('forward-host');
const forwardPort = document.getElementById('forward-port');
const forwardPath = document.getElementById('forward-path');
const forwardTimeout = document.getElementById('forward-timeout');
const forwardTest = document.getElementById('forward-test');
const forwardMessage = document.getElementById('forward-message');
const forwardSummary = document.getElementById('forward-summary');
const forwardLast = document.getElementById('forward-last');

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
      loadForward(false);
    }, 5000);
  }
}

autoRefreshEl.addEventListener('change', scheduleRefresh);

function renderForward({ config, lastResult }) {
  if (config) {
    forwardEnabled.checked = config.enabled;
    forwardHost.value = config.host;
    forwardPort.value = config.port;
    forwardPath.value = config.path;
    forwardTimeout.value = config.timeout_ms;

    const on = config.enabled && config.host;
    forwardSummary.textContent = on ? `→ ${config.host}:${config.port}${config.path}` : 'off';
    forwardSummary.className = `badge ${on ? 'ok' : ''}`;
  }

  if (lastResult) {
    const outcome = lastResult.ok
      ? `OK (HTTP ${lastResult.status})`
      : `failed — ${lastResult.error || `HTTP ${lastResult.status}`}`;
    forwardLast.textContent = `Last forward at ${fmtTime(lastResult.at)}: ${outcome}`;
  } else {
    forwardLast.textContent = 'No forward attempted yet.';
  }
}

// withConfig=false leaves the form fields alone so a periodic refresh can't
// overwrite edits in progress — only the last-attempt line is updated.
async function loadForward(withConfig = true) {
  try {
    const res = await fetch('/api/forward');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderForward(withConfig ? data : { lastResult: data.lastResult });
  } catch (err) {
    forwardMessage.textContent = `Error: ${err.message}`;
  }
}

function formValues() {
  return {
    enabled: forwardEnabled.checked,
    host: forwardHost.value,
    port: Number(forwardPort.value) || 80,
    path: forwardPath.value || '/',
    timeout_ms: Number(forwardTimeout.value) || 5000,
  };
}

function setMessage(text, isError) {
  forwardMessage.textContent = text;
  forwardMessage.className = isError ? 'error' : 'success';
}

forwardForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setMessage('Saving…', false);
  try {
    const res = await fetch('/api/forward', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formValues()),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`);
    renderForward(result);
    setMessage('Saved.', false);
  } catch (err) {
    setMessage(err.message, true);
  }
});

forwardTest.addEventListener('click', async () => {
  setMessage('Sending test…', false);
  try {
    // Save first so the test uses whatever is currently in the form.
    const saveRes = await fetch('/api/forward', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formValues()),
    });
    const saved = await saveRes.json();
    if (!saveRes.ok) throw new Error(saved.error || `HTTP ${saveRes.status}`);

    const res = await fetch('/api/forward/test', { method: 'POST' });
    const { result } = await res.json();
    renderForward({ config: saved.config, lastResult: result });
    setMessage(result.ok ? `Test OK (HTTP ${result.status})` : `Test failed`, !result.ok);
  } catch (err) {
    setMessage(err.message, true);
  }
});

loadCaptures();
loadForward();
scheduleRefresh();
