const tbody = document.getElementById('captures-body');
const statusEl = document.getElementById('status');
const autoRefreshEl = document.getElementById('auto-refresh');
const refreshBtn = document.getElementById('refresh-btn');
const endpointUrlEl = document.getElementById('endpoint-url');
const previousPageBtn = document.getElementById('previous-page');
const nextPageBtn = document.getElementById('next-page');
const pageInfo = document.getElementById('page-info');

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
    refreshTimer = setInterval(loadCaptures, 5000);
  }
}

autoRefreshEl.addEventListener('change', scheduleRefresh);

loadCaptures();
scheduleRefresh();
