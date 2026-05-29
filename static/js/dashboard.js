// ─── Sidebar toggle (defined here so it's available even if sidebar.js is slow) ──
function toggleSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const layout   = document.getElementById('layout');
  const backdrop = document.getElementById('sidebar-backdrop');
  const isOpen   = sidebar.classList.toggle('open');
  layout.classList.toggle('shifted', isOpen);
  backdrop.classList.toggle('visible', isOpen);
}

// ─── Constants ────────────────────────────────────────────────────────────────
const PERIOD_ORDER = ['dia', 'semana', 'mes', 'acumulado'];
const PERIOD_LABEL = { dia: 'DIA', semana: 'SEMANA', mes: 'MÊS', acumulado: 'ACUMULADO' };
const PAGE_SIZE = 25;

// ─── Active filter state ──────────────────────────────────────────────────────
let _activeFrenteId = null;   // null = todas as frentes
let _activeAtivId   = null;   // null = todas as atividades da frente selecionada

// ─── Per-period state ─────────────────────────────────────────────────────────
// state[period] = { data, filtered, page, sortCol, sortDir }
const state = {};
let _allPeriodsData = {};   // raw data from /api/grouped, kept for re-grouping

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtH(h) {
  if (h == null) return '—';
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(3,'0')}:${String(mm).padStart(2,'0')}`;
}
function fmtPct(v) { return v == null ? '—' : v.toFixed(2) + '%'; }
function dispClass(v) {
  if (v == null) return 'disp-none';
  return v >= 95 ? 'disp-high' : v >= 90 ? 'disp-mid' : 'disp-low';
}
function gaugeColor(v) {
  if (v == null) return '#2a2d3e';
  return v >= 95 ? '#22c55e' : v >= 90 ? '#f59e0b' : '#ef4444';
}

// ─── Build flat row list ──────────────────────────────────────────────────────
function buildRows(vehicles, query) {
  const q       = query ? query.toLowerCase() : '';
  const frentes = _getFrentes();

  const filtered = vehicles.filter(v => !q ||
    String(v.frota).includes(q) ||
    (v.atividade || '').toLowerCase().includes(q) ||
    (v.especialidade || '').toLowerCase().includes(q) ||
    (v.descricao || '').toLowerCase().includes(q)
  );

  const rows = [];

  if (frentes.length > 0) {
    const visibleFrentes = _activeFrenteId
      ? frentes.filter(f => f.id === _activeFrenteId)
      : frentes;

    // frota → {frenteId, atividade}
    const frotaMap = {};
    frentes.forEach(f => f.atividades.forEach(a => a.frotas.forEach(fr => {
      frotaMap[fr] = { frenteId: f.id, ativ: a };
    })));

    visibleFrentes.forEach(f => {
      const visibleAtvs = _activeAtivId
        ? f.atividades.filter(a => a.id === _activeAtivId)
        : f.atividades;

      const byAtiv = {};
      filtered.forEach(v => {
        const m = frotaMap[v.frota];
        if (m && m.frenteId === f.id && visibleAtvs.find(a => a.id === m.ativ.id)) {
          const id = m.ativ.id;
          if (!byAtiv[id]) byAtiv[id] = [];
          byAtiv[id].push(v);
        }
      });

      const hasAny = visibleAtvs.some(a => (byAtiv[a.id] || []).length > 0);
      if (!hasAny) return;

      // Frente header
      const total = visibleAtvs.reduce((s, a) => s + (byAtiv[a.id] || []).length, 0);
      rows.push({ isGroup: true, isFrente: true,  label: f.name, color: f.color, count: total });

      // Atividade sub-headers
      visibleAtvs.forEach(a => {
        const vlist = byAtiv[a.id] || [];
        if (!vlist.length) return;
        rows.push({ isGroup: true, isFrente: false, label: a.name, color: a.color, count: vlist.length });
        vlist.forEach(v => rows.push({ isGroup: false, ...v }));
      });
    });
  } else {
    // Default: group by specialty
    const bySpec = {};
    filtered.forEach(v => {
      const key = v.descricao_especialidade || v.especialidade || 'Outros';
      if (!bySpec[key]) bySpec[key] = [];
      bySpec[key].push(v);
    });
    Object.entries(bySpec).sort(([a],[b]) => a.localeCompare(b)).forEach(([key, vlist]) => {
      rows.push({ isGroup: true, isFrente: false, label: key, color: '#4f8ef7', count: vlist.length });
      vlist.forEach(v => rows.push({ isGroup: false, ...v }));
    });
  }

  return rows;
}

// ─── Helpers: frente/atividade data ──────────────────────────────────────────
function _getFrentes() {
  return (typeof getFrente === 'function') ? getFrente() : [];
}

/** Flat set of frotas matching current filter. null = no frentes defined. */
function _filteredFrotaSet() {
  const frentes = _getFrentes();
  if (frentes.length === 0) return null;

  let ativs = [];
  if (_activeFrenteId) {
    const f = frentes.find(f => f.id === _activeFrenteId);
    if (!f) return new Set();
    ativs = _activeAtivId
      ? f.atividades.filter(a => a.id === _activeAtivId)
      : f.atividades;
  } else {
    ativs = frentes.flatMap(f => f.atividades);
  }
  return new Set(ativs.flatMap(a => a.frotas));
}

// ─── Availability based on active filter ─────────────────────────────────────
function calcActivityDisp(vehicles) {
  const frotaSet = _filteredFrotaSet();
  let pool = frotaSet === null ? vehicles : vehicles.filter(v => frotaSet.has(v.frota));
  const withDisp = pool.filter(v => v.disponibilidade != null);
  if (!withDisp.length) return null;
  return Math.round(withDisp.reduce((s, v) => s + v.disponibilidade, 0) / withDisp.length * 100) / 100;
}

// ─── Filter bar: Frentes + Atividades ────────────────────────────────────────
function renderActivityFilters() {
  const frentes = _getFrentes();
  const bar     = document.getElementById('activity-filter-bar');
  if (!bar) return;

  if (frentes.length === 0) { bar.classList.add('d-none'); return; }
  bar.classList.remove('d-none');

  // Row 1: frente chips
  const frenteChips = document.getElementById('frente-chips');
  if (frenteChips) {
    frenteChips.innerHTML = frentes.map(f => {
      const active = _activeFrenteId === f.id;
      return `<span class="chip ${active ? 'active' : ''}"
                    style="${active ? `background:${f.color};border-color:${f.color}` : ''}"
                    onclick="filterFrente('${f.id}','${f.color}')">
                <span class="chip-dot" style="background:${f.color}"></span>${f.name}
              </span>`;
    }).join('');
  }
  document.getElementById('chip-all-frente')?.classList.toggle('active', !_activeFrenteId);

  // Row 2: atividade chips (only when a frente is selected)
  const ativRow = document.getElementById('ativ-filter-row');
  if (!ativRow) return;

  if (!_activeFrenteId) { ativRow.classList.add('d-none'); return; }
  ativRow.classList.remove('d-none');

  const f = frentes.find(f => f.id === _activeFrenteId);
  const ativChips = document.getElementById('atividade-chips');
  if (ativChips && f) {
    ativChips.innerHTML = f.atividades.map(a => {
      const active = _activeAtivId === a.id;
      return `<span class="chip ${active ? 'active' : ''}"
                    style="${active ? `background:${a.color};border-color:${a.color}` : ''}"
                    onclick="filterAtiv('${a.id}','${a.color}')">
                <span class="chip-dot" style="background:${a.color}"></span>${a.name}
              </span>`;
    }).join('');
  }
  document.getElementById('chip-all-ativ')?.classList.toggle('active', !_activeAtivId);
}

function filterFrente(id) {
  _activeFrenteId = _activeFrenteId === id ? null : id;
  _activeAtivId   = null;
  renderActivityFilters();
  rebuildGauges();
  rebuildAllTables();
}

function filterAtiv(id) {
  _activeAtivId = _activeAtivId === id ? null : id;
  renderActivityFilters();
  rebuildGauges();
  rebuildAllTables();
}

function filterSelectAll() {
  _activeFrenteId = null;
  _activeAtivId   = null;
  renderActivityFilters();
  rebuildGauges();
  rebuildAllTables();
}

function rebuildActivityFilters() {
  // Validate stale IDs
  const frentes = _getFrentes();
  const fIds = new Set(frentes.map(f => f.id));
  if (_activeFrenteId && !fIds.has(_activeFrenteId)) { _activeFrenteId = null; _activeAtivId = null; }
  if (_activeFrenteId && _activeAtivId) {
    const f = frentes.find(f => f.id === _activeFrenteId);
    if (!f || !f.atividades.find(a => a.id === _activeAtivId)) _activeAtivId = null;
  }
  renderActivityFilters();
  rebuildGauges();
  rebuildAllTables();
}

/** Recompute and re-render all 4 gauges (called after activity changes). */
function rebuildGauges() {
  for (const p of PERIOD_ORDER) {
    const pd = _allPeriodsData[p] || null;
    renderGauge(p, pd ? calcActivityDisp(pd.vehicles) : null);
    const wrap = document.getElementById(`gauge-${p}`);
    if (wrap) wrap.classList.toggle('has-data', !!pd);
  }
}

// ─── Speedometer gauge ────────────────────────────────────────────────────────
const _gaugeInstances = {};
function renderGauge(periodKey, value) {
  if (_gaugeInstances[periodKey]) {
    _gaugeInstances[periodKey].destroy();
    delete _gaugeInstances[periodKey];
  }
  const valEl = document.getElementById(`gv-${periodKey}`);
  const hasData = value != null;
  const color = gaugeColor(value);
  const val = hasData ? Math.min(Math.max(value, 0), 100) : 0;

  valEl.textContent = hasData ? fmtPct(value) : 'Sem dados';
  valEl.style.color = hasData ? color : '#8892a4';

  const ctx = document.getElementById(`c-gauge-${periodKey}`).getContext('2d');
  _gaugeInstances[periodKey] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [val, 100 - val],
        backgroundColor: [color, '#1e2130'],
        borderWidth: 0,
        borderRadius: 3,
      }],
    },
    options: {
      rotation: -90,
      circumference: 180,
      cutout: '72%',
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      animation: { duration: 700, easing: 'easeOutQuart' },
    },
  });
}

// ─── Sort + filter per period ─────────────────────────────────────────────────
function applyFilter(periodKey) {
  const s = state[periodKey];
  if (!s) return;
  const query = document.getElementById('global-search').value;
  const rows = buildRows(s.data.vehicles, query);

  // Sort data rows within each group block, preserving group headers
  const sorted = [];
  let buf = [];
  function flushBuf() {
    buf.sort((a, b) => {
      const av = a[s.sortCol] ?? (s.sortDir > 0 ? Infinity : -Infinity);
      const bv = b[s.sortCol] ?? (s.sortDir > 0 ? Infinity : -Infinity);
      if (av < bv) return -s.sortDir;
      if (av > bv) return s.sortDir;
      return 0;
    });
    sorted.push(...buf);
    buf = [];
  }
  for (const r of rows) {
    if (r.isGroup) { flushBuf(); sorted.push(r); }
    else buf.push(r);
  }
  flushBuf();

  s.filtered = sorted;
  s.page = 1;
  renderPeriodTable(periodKey);
}

function sortPeriod(periodKey, col) {
  const s = state[periodKey];
  if (!s) return;
  if (s.sortCol === col) s.sortDir *= -1;
  else { s.sortCol = col; s.sortDir = 1; }
  applyFilter(periodKey);
}

function changePage(periodKey, delta) {
  const s = state[periodKey];
  if (!s) return;
  s.page += delta;
  renderPeriodTable(periodKey);
}

// ─── Render table ─────────────────────────────────────────────────────────────
function renderPeriodTable(periodKey) {
  const s = state[periodKey];
  if (!s) return;

  const rows = s.filtered;
  const dataRows = rows.filter(r => !r.isGroup);
  const total = dataRows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  s.page = Math.min(s.page, totalPages);
  const start = (s.page - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;

  const tbody = document.getElementById(`tbody-${periodKey}`);
  const html = [];
  let dataIdx = 0;

  for (const row of rows) {
    if (row.isGroup) {
      if (row.isFrente) {
        html.push(`
          <tr class="frente-row">
            <td colspan="7">
              <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${row.color};margin-right:7px;vertical-align:middle"></span>
              ${row.label}
              <span style="font-weight:400;color:#8892a4;font-size:.75rem;margin-left:5px">(${row.count} frotas)</span>
            </td>
          </tr>`);
      } else {
        html.push(`
          <tr class="activity-row">
            <td colspan="7">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${row.color};margin-right:6px;vertical-align:middle;margin-left:12px"></span>
              ${row.label}
              <span style="font-weight:400;color:#8892a4;margin-left:4px">(${row.count})</span>
            </td>
          </tr>`);
      }
      continue;
    }
    if (dataIdx >= start && dataIdx < end) {
      const dc = dispClass(row.disponibilidade);
      html.push(`<tr>
        <td class="fw-semibold">${row.frota ?? '—'}</td>
        <td>${row.atividade || '—'}</td>
        <td>${row.descricao_especialidade || row.especialidade || '—'}</td>
        <td style="color:#8892a4">${row.descricao || '—'}</td>
        <td class="text-end"><span class="badge-disp ${dc}">${fmtPct(row.disponibilidade)}</span></td>
        <td class="text-end font-monospace">${fmtH(row.mttr_h)}</td>
        <td class="text-end font-monospace">${fmtH(row.mtbf_h)}</td>
      </tr>`);
    }
    dataIdx++;
  }
  tbody.innerHTML = html.join('');

  const s1 = Math.min(start + 1, total);
  const s2 = Math.min(end, total);
  document.getElementById(`tinfo-${periodKey}`).textContent =
    total > 0 ? `${s1}–${s2} de ${total} frotas` : 'Nenhuma frota encontrada';
  document.getElementById(`tpage-${periodKey}`).textContent = `${s.page} / ${totalPages}`;
  document.getElementById(`btn-prev-${periodKey}`).disabled = s.page <= 1;
  document.getElementById(`btn-next-${periodKey}`).disabled = s.page >= totalPages;
}

// ─── Period section HTML ──────────────────────────────────────────────────────
function calcPeriodAvg(periodData) {
  if (!periodData) return null;
  return calcActivityDisp(periodData.vehicles);
}

function createPeriodSection(periodKey, periodData) {
  const hasData = !!periodData;
  const label = PERIOD_LABEL[periodKey];
  const rangeText = hasData ? `${periodData.periodo_inicio} a ${periodData.periodo_fim}` : '';
  const avg = hasData ? calcPeriodAvg(periodData) : null;
  const avgText = avg != null
    ? `<span class="period-avg" style="color:${gaugeColor(avg)}">${fmtPct(avg)}</span>`
    : '';

  const el = document.createElement('div');
  el.className = 'period-section';
  el.id = `section-${periodKey}`;
  el.innerHTML = `
    <div class="period-header" onclick="toggleSection('${periodKey}')">
      <span class="period-badge badge-${periodKey}">${label}</span>
      <span class="period-title">${hasData ? (periodData.cliente || 'Frota') : 'Sem dados carregados'}</span>
      <span class="period-range">${rangeText}</span>
      ${avgText}
      <i class="bi bi-chevron-down period-toggle open" id="toggle-icon-${periodKey}"></i>
    </div>
    <div class="period-body" id="body-${periodKey}">
      ${hasData ? tableHTML(periodKey) : noDataHTML(periodKey)}
    </div>`;
  return el;
}

function noDataHTML(periodKey) {
  return `
    <div class="no-data-banner">
      <i class="bi bi-cloud-upload"></i>
      Nenhum relatório para <strong>${PERIOD_LABEL[periodKey]}</strong>.<br>
      Use o seletor no topo, escolha "${PERIOD_LABEL[periodKey]}" e envie o .xlsx.
    </div>`;
}

function tableHTML(periodKey) {
  return `
    <div class="table-responsive">
      <table class="fleet-table">
        <thead>
          <tr>
            <th onclick="sortPeriod('${periodKey}','frota')">Frota <i class="bi bi-arrow-down-up" style="font-size:.65rem;opacity:.4"></i></th>
            <th onclick="sortPeriod('${periodKey}','atividade')">Atividade</th>
            <th onclick="sortPeriod('${periodKey}','especialidade')">Especialidade</th>
            <th>Descrição</th>
            <th class="text-end" onclick="sortPeriod('${periodKey}','disponibilidade')">Disp. %</th>
            <th class="text-end" onclick="sortPeriod('${periodKey}','mttr_h')">MTTR</th>
            <th class="text-end" onclick="sortPeriod('${periodKey}','mtbf_h')">MTBF</th>
          </tr>
        </thead>
        <tbody id="tbody-${periodKey}"></tbody>
      </table>
    </div>
    <div class="table-footer">
      <small id="tinfo-${periodKey}" class="text-muted"></small>
      <div style="display:flex;gap:4px;align-items:center">
        <button class="btn-pg" id="btn-prev-${periodKey}" onclick="changePage('${periodKey}',-1)">
          <i class="bi bi-chevron-left"></i>
        </button>
        <span id="tpage-${periodKey}" style="font-size:.78rem;color:#8892a4;min-width:60px;text-align:center"></span>
        <button class="btn-pg" id="btn-next-${periodKey}" onclick="changePage('${periodKey}',1)">
          <i class="bi bi-chevron-right"></i>
        </button>
      </div>
    </div>`;
}

function toggleSection(periodKey) {
  const body = document.getElementById(`body-${periodKey}`);
  const icon = document.getElementById(`toggle-icon-${periodKey}`);
  const hidden = body.style.display === 'none';
  body.style.display = hidden ? '' : 'none';
  icon.classList.toggle('open', hidden);
}

// ─── Rebuild all tables (called by sidebar when activities change) ─────────────
function rebuildAllTables() {
  for (const p of PERIOD_ORDER) {
    if (state[p]) applyFilter(p);
  }
}

// ─── Init dashboard ───────────────────────────────────────────────────────────
async function init() {
  const loadingEl = document.getElementById('loading');
  const dashEl    = document.getElementById('dashboard');
  const errEl     = document.getElementById('error-alert');

  loadingEl.classList.remove('d-none');
  dashEl.classList.add('d-none');
  errEl.classList.add('d-none');

  try {
    // 90s timeout — Render free tier cold start can be slow
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);
    const res = await fetch('/api/grouped', { signal: controller.signal });
    clearTimeout(timer);
    const allData = await res.json();
    if (!res.ok) throw new Error(allData.error || 'Erro na API');

    _allPeriodsData = allData;

    // Set client header
    const first = Object.values(allData)[0];
    if (first?.cliente) document.getElementById('header-client').textContent = first.cliente;

    // Render gauges — use activity-filtered availability
    for (const p of PERIOD_ORDER) {
      const pd = allData[p] || null;
      const wrap = document.getElementById(`gauge-${p}`);
      renderGauge(p, pd ? calcActivityDisp(pd.vehicles) : null);
      if (pd) {
        const el = document.getElementById(`gp-${p}`);
        if (el) el.textContent = `${pd.periodo_inicio} – ${pd.periodo_fim}`;
        if (wrap) wrap.classList.add('has-data');
      } else {
        if (wrap) wrap.classList.remove('has-data');
      }
    }

    // Render period sections
    const container = document.getElementById('periods-container');
    container.innerHTML = '';
    for (const p of PERIOD_ORDER) {
      const pd = allData[p] || null;
      if (pd) state[p] = { data: pd, filtered: [], page: 1, sortCol: 'frota', sortDir: 1 };
      container.appendChild(createPeriodSection(p, pd));
      if (pd) applyFilter(p);
    }

    renderActivityFilters();

    loadingEl.classList.add('d-none');
    dashEl.classList.remove('d-none');
  } catch (err) {
    loadingEl.classList.add('d-none');
    errEl.classList.remove('d-none');
    const msg = err.name === 'AbortError'
      ? 'Tempo limite esgotado. O servidor pode estar iniciando — aguarde 30s e recarregue.'
      : err.message;
    document.getElementById('error-msg').textContent = msg;
  }
}

// ─── Upload modal ─────────────────────────────────────────────────────────────
const PERIOD_HINTS = {
  dia:       'Exporte no CHB o relatório com a data de ontem apenas (1 dia).',
  semana:    'Exporte no CHB o relatório com os 7 dias da semana passada.',
  mes:       'Exporte no CHB o relatório do mês atual completo.',
  acumulado: 'Exporte no CHB o relatório desde o início da safra até hoje.',
};

let _uploadPeriodKey = null;
let _uploadModal = null;

function openUploadModal(periodKey) {
  _uploadPeriodKey = periodKey;
  const label = PERIOD_LABEL[periodKey];

  document.getElementById('upload-modal-title').textContent = `Carregar Relatório — ${label}`;
  document.getElementById('upload-modal-hint').textContent = PERIOD_HINTS[periodKey] || '';
  document.getElementById('upload-drop-name').textContent = '';
  document.getElementById('upload-drop-label').textContent = 'Clique ou arraste o arquivo .xlsx aqui';
  document.getElementById('upload-drop-icon').className = 'bi bi-file-earmark-spreadsheet';
  document.getElementById('upload-confirm-btn').disabled = true;
  document.getElementById('upload-progress').classList.add('d-none');
  document.getElementById('upload-success').classList.add('d-none');
  document.getElementById('upload-error').classList.add('d-none');
  document.getElementById('upload-file-input').value = '';

  if (!_uploadModal) _uploadModal = new bootstrap.Modal(document.getElementById('upload-modal'));
  _uploadModal.show();
}

async function confirmUpload() {
  const input = document.getElementById('upload-file-input');
  if (!input.files.length || !_uploadPeriodKey) return;

  const confirmBtn = document.getElementById('upload-confirm-btn');
  confirmBtn.disabled = true;
  document.getElementById('upload-progress').classList.remove('d-none');
  document.getElementById('upload-success').classList.add('d-none');
  document.getElementById('upload-error').classList.add('d-none');

  const form = new FormData();
  form.append('file', input.files[0]);
  form.append('period', _uploadPeriodKey);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: form });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);

    document.getElementById('upload-progress').classList.add('d-none');
    document.getElementById('upload-success').classList.remove('d-none');
    document.getElementById('upload-success-msg').textContent =
      `${PERIOD_LABEL[_uploadPeriodKey]} carregado: ${result.periodo_inicio} a ${result.periodo_fim}`;

    // Reload dashboard after short delay so user sees the success message
    setTimeout(async () => {
      _uploadModal.hide();
      await init();
    }, 1200);
  } catch (err) {
    document.getElementById('upload-progress').classList.add('d-none');
    document.getElementById('upload-error').classList.remove('d-none');
    document.getElementById('upload-error-msg').textContent = err.message;
    confirmBtn.disabled = false;
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  init();

  document.getElementById('global-search').addEventListener('input', () => {
    for (const p of PERIOD_ORDER) { if (state[p]) applyFilter(p); }
  });

  // Upload modal: file input
  const fileInput = document.getElementById('upload-file-input');
  fileInput.addEventListener('change', function () {
    if (!this.files.length) return;
    document.getElementById('upload-drop-label').textContent = this.files[0].name;
    document.getElementById('upload-drop-icon').className = 'bi bi-file-earmark-check text-success';
    document.getElementById('upload-drop-name').textContent = `(${(this.files[0].size/1024).toFixed(0)} KB)`;
    document.getElementById('upload-confirm-btn').disabled = false;
  });

  // Upload modal: drag & drop
  const dropZone = document.getElementById('upload-drop-zone');
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file || !file.name.endsWith('.xlsx')) { alert('Apenas arquivos .xlsx são aceitos.'); return; }
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change'));
  });

  // Sidebar events
  document.getElementById('modal-search')?.addEventListener('input', applyModalFilter);
  document.getElementById('modal-filter-esp')?.addEventListener('change', applyModalFilter);
  document.getElementById('new-frente-name')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmNewFrente();
    if (e.key === 'Escape') cancelNewFrente();
  });
  initSidebar();
});

// ══════════════════════════════════════════════════════════════════════════════
// SIDEBAR — Frentes & Atividades
// ══════════════════════════════════════════════════════════════════════════════

let frentes = [];
let catalogAll = [];
let _editingFrenteId = null;
let _editingAtivId   = null;
const COLORS = ['#4f8ef7','#22c55e','#f59e0b','#ef4444','#a78bfa','#2dd4bf','#f472b6','#fb923c','#34d399','#60a5fa'];
function nextColor(list) { return COLORS[list.length % COLORS.length]; }

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Persist ──────────────────────────────────────────────────────────────────
async function persistFrente() {
  await fetch('/api/activities', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(frentes),
  });
  rebuildActivityFilters();
}

// ─── Migration from old flat format ──────────────────────────────────────────
function migrateIfNeeded(data) {
  if (!Array.isArray(data) || data.length === 0) return [];
  if (data[0].atividades !== undefined) return data;
  return data.map(act => ({
    id: act.id, name: act.name, color: act.color,
    atividades: [{ id: crypto.randomUUID(), name: act.name, color: act.color, frotas: act.frotas || [] }],
  }));
}

// ─── New frente ───────────────────────────────────────────────────────────────
function startNewFrente() {
  document.getElementById('new-frente-form').classList.remove('d-none');
  document.getElementById('btn-new-frente').classList.add('d-none');
  const inp = document.getElementById('new-frente-name');
  inp.value = ''; inp.focus();
}
function cancelNewFrente() {
  document.getElementById('new-frente-form').classList.add('d-none');
  document.getElementById('btn-new-frente').classList.remove('d-none');
}
function confirmNewFrente() {
  const name = document.getElementById('new-frente-name').value.trim();
  if (!name) return;
  frentes.push({ id: crypto.randomUUID(), name, color: nextColor(frentes), atividades: [] });
  cancelNewFrente(); renderSidebar(); persistFrente();
}

// ─── Frente actions ───────────────────────────────────────────────────────────
function renameFrente(id, name) {
  const f = frentes.find(f => f.id === id);
  if (!f || !name.trim() || f.name === name.trim()) return;
  f.name = name.trim(); persistFrente();
}
function deleteFrente(id, e) {
  e.stopPropagation();
  frentes = frentes.filter(f => f.id !== id);
  renderSidebar(); persistFrente();
}
function toggleFrenteCard(id) {
  const body = document.getElementById('fbody-' + id);
  const icon = document.getElementById('ficon-' + id);
  if (!body) return;
  const hidden = body.style.display === 'none';
  body.style.display = hidden ? 'block' : 'none';
  if (icon) icon.style.transform = hidden ? 'rotate(0deg)' : 'rotate(-90deg)';
}

// ─── New atividade ────────────────────────────────────────────────────────────
function startNewAtiv(frenteId) {
  document.getElementById('new-ativ-form-' + frenteId).classList.remove('d-none');
  document.getElementById('btn-new-ativ-' + frenteId).classList.add('d-none');
  const inp = document.getElementById('new-ativ-name-' + frenteId);
  inp.value = ''; inp.focus();
}
function cancelNewAtiv(frenteId) {
  document.getElementById('new-ativ-form-' + frenteId)?.classList.add('d-none');
  document.getElementById('btn-new-ativ-' + frenteId)?.classList.remove('d-none');
}
function confirmNewAtiv(frenteId) {
  const name = document.getElementById('new-ativ-name-' + frenteId).value.trim();
  if (!name) return;
  const f = frentes.find(f => f.id === frenteId);
  if (!f) return;
  f.atividades.push({ id: crypto.randomUUID(), name, color: nextColor(f.atividades), frotas: [] });
  cancelNewAtiv(frenteId); renderSidebar(); persistFrente();
}

// ─── Atividade actions ────────────────────────────────────────────────────────
function renameAtiv(frenteId, ativId, name) {
  const a = _findAtiv(frenteId, ativId);
  if (!a || !name.trim() || a.name === name.trim()) return;
  a.name = name.trim(); persistFrente();
}
function deleteAtiv(frenteId, ativId, e) {
  e.stopPropagation();
  const f = frentes.find(f => f.id === frenteId);
  if (!f) return;
  f.atividades = f.atividades.filter(a => a.id !== ativId);
  renderSidebar(); persistFrente();
}
function _findAtiv(frenteId, ativId) {
  const f = frentes.find(f => f.id === frenteId);
  return f ? f.atividades.find(a => a.id === ativId) : null;
}

// ─── Render sidebar ───────────────────────────────────────────────────────────
function renderSidebar() {
  const container = document.getElementById('frente-list');
  if (frentes.length === 0) {
    container.innerHTML = '<div style="padding:1.5rem 1rem;text-align:center;color:#8892a4;font-size:.82rem">' +
      '<i class="bi bi-grid-3x3-gap" style="font-size:2rem;display:block;opacity:.3;margin-bottom:.5rem"></i>' +
      'Crie uma frente para começar.</div>';
    return;
  }
  container.innerHTML = frentes.map(function(f) {
    var ativCount  = f.atividades.length;
    var frotaCount = f.atividades.reduce(function(s,a){ return s + a.frotas.length; }, 0);
    var ativHTML   = f.atividades.map(function(a) {
      return '<div class="ativ-item">' +
        '<span class="ativ-dot" style="background:' + a.color + '"></span>' +
        '<input class="ativ-name-input" value="' + escHtml(a.name) + '" title="Clique para renomear"' +
        ' onclick="event.stopPropagation()"' +
        ' onblur="renameAtiv(\'' + f.id + '\',\'' + a.id + '\',this.value)"' +
        ' onkeydown="if(event.key===\'Enter\')this.blur()" />' +
        '<span class="activity-badge">' + a.frotas.length + '</span>' +
        '<div class="activity-actions">' +
        '<button class="act-btn" onclick="openFleetModal(\'' + f.id + '\',\'' + a.id + '\')" title="Gerenciar frotas"><i class="bi bi-pencil-square"></i></button>' +
        '<button class="act-btn danger" onclick="deleteAtiv(\'' + f.id + '\',\'' + a.id + '\',event)" title="Remover"><i class="bi bi-trash3"></i></button>' +
        '</div></div>';
    }).join('');
    return '<div class="frente-card" id="fcard-' + f.id + '">' +
      '<div class="frente-header" onclick="toggleFrenteCard(\'' + f.id + '\')">' +
      '<i class="bi bi-chevron-down" id="ficon-' + f.id + '" style="font-size:.75rem;color:#8892a4;transition:transform .2s"></i>' +
      '<span class="frente-dot" style="background:' + f.color + '"></span>' +
      '<input class="frente-name-input" value="' + escHtml(f.name) + '" title="Clique para renomear"' +
      ' onclick="event.stopPropagation()"' +
      ' onblur="renameFrente(\'' + f.id + '\',this.value)"' +
      ' onkeydown="if(event.key===\'Enter\')this.blur()" />' +
      '<span class="frente-meta">' + ativCount + ' ativ &middot; ' + frotaCount + ' frotas</span>' +
      '<button class="act-btn danger" onclick="deleteFrente(\'' + f.id + '\',event)" title="Remover frente"><i class="bi bi-trash3"></i></button>' +
      '</div>' +
      '<div class="frente-body" id="fbody-' + f.id + '">' +
      ativHTML +
      '<div id="new-ativ-form-' + f.id + '" class="new-ativ-form d-none">' +
      '<input id="new-ativ-name-' + f.id + '" type="text" class="form-control form-control-sm" placeholder="Nome da atividade" maxlength="40"' +
      ' onkeydown="if(event.key===\'Enter\')confirmNewAtiv(\'' + f.id + '\');if(event.key===\'Escape\')cancelNewAtiv(\'' + f.id + '\')" />' +
      '<div class="d-flex gap-1 mt-1">' +
      '<button class="btn btn-sm btn-accent flex-fill" onclick="confirmNewAtiv(\'' + f.id + '\')">Criar</button>' +
      '<button class="btn btn-sm btn-ghost" onclick="cancelNewAtiv(\'' + f.id + '\')">Cancelar</button>' +
      '</div></div>' +
      '<button class="btn-new-ativ" id="btn-new-ativ-' + f.id + '" onclick="startNewAtiv(\'' + f.id + '\')">' +
      '<i class="bi bi-plus-lg me-1"></i> Nova Atividade</button>' +
      '</div></div>';
  }).join('');
}

// ─── Fleet modal ──────────────────────────────────────────────────────────────
let _modalChecked  = new Set();
let _modalFiltered = [];
let _fleetModal    = null;

async function openFleetModal(frenteId, ativId) {
  _editingFrenteId = frenteId;
  _editingAtivId   = ativId;
  const a = _findAtiv(frenteId, ativId);
  if (!a) return;
  document.getElementById('fleet-modal-title').textContent = 'Frotas — ' + a.name;
  _modalChecked = new Set(a.frotas);
  if (catalogAll.length === 0) {
    const res = await fetch('/api/catalog');
    catalogAll = await res.json();
    const specs = [...new Set(catalogAll.map(f => f.descricao_especialidade))].sort();
    const sel = document.getElementById('modal-filter-esp');
    sel.innerHTML = '<option value="">Todas as especialidades</option>' +
      specs.map(s => '<option value="' + escHtml(s) + '">' + escHtml(s) + '</option>').join('');
  }
  applyModalFilter();
  if (!_fleetModal) _fleetModal = new bootstrap.Modal(document.getElementById('fleet-modal'));
  _fleetModal.show();
}
function applyModalFilter() {
  const q   = document.getElementById('modal-search').value.toLowerCase();
  const esp = document.getElementById('modal-filter-esp').value;
  _modalFiltered = catalogAll.filter(f => {
    return (!q || String(f.frota).includes(q) || f.descricao_especialidade.toLowerCase().includes(q)) &&
           (!esp || f.descricao_especialidade === esp);
  });
  renderModalList();
}
function renderModalList() {
  document.getElementById('modal-fleet-list').innerHTML = _modalFiltered.map(f =>
    '<label class="fleet-check-row">' +
    '<input type="checkbox" value="' + f.frota + '" ' + (_modalChecked.has(f.frota) ? 'checked' : '') +
    ' onchange="toggleModalFleet(' + f.frota + ', this.checked)" />' +
    '<span class="fleet-check-frota">' + f.frota + '</span>' +
    '<span class="fleet-check-esp">' + escHtml(f.descricao_especialidade) + '</span>' +
    '</label>'
  ).join('');
  document.getElementById('modal-sel-count').textContent =
    _modalChecked.size + ' selecionada' + (_modalChecked.size !== 1 ? 's' : '');
}
function toggleModalFleet(frota, checked) {
  checked ? _modalChecked.add(frota) : _modalChecked.delete(frota);
  document.getElementById('modal-sel-count').textContent =
    _modalChecked.size + ' selecionada' + (_modalChecked.size !== 1 ? 's' : '');
}
function selectAllModal()   { _modalFiltered.forEach(f => _modalChecked.add(f.frota));    renderModalList(); }
function deselectAllModal() { _modalFiltered.forEach(f => _modalChecked.delete(f.frota)); renderModalList(); }
function saveModalSelection() {
  const a = _findAtiv(_editingFrenteId, _editingAtivId);
  if (!a) return;
  a.frotas = [..._modalChecked].sort((a,b) => a - b);
  bootstrap.Modal.getInstance(document.getElementById('fleet-modal')).hide();
  renderSidebar(); persistFrente();
}

// ─── Init sidebar ─────────────────────────────────────────────────────────────
async function initSidebar() {
  const res  = await fetch('/api/activities');
  const data = await res.json();
  frentes = migrateIfNeeded(data);
  renderSidebar();
}
function getFrente() { return frentes; }
