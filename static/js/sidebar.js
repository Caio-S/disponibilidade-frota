// ─── State ────────────────────────────────────────────────────────────────────
// frentes = [{id, name, color, atividades: [{id, name, color, frotas:[int,...]}]}]
let frentes = [];
let catalogAll = [];

let _editingFrenteId = null;
let _editingAtivId   = null;

const COLORS = [
  '#4f8ef7','#22c55e','#f59e0b','#ef4444','#a78bfa',
  '#2dd4bf','#f472b6','#fb923c','#34d399','#60a5fa',
];

function nextColor(list) {
  return COLORS[list.length % COLORS.length];
}

// ─── Sidebar toggle ───────────────────────────────────────────────────────────
function toggleSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const layout   = document.getElementById('layout');
  const backdrop = document.getElementById('sidebar-backdrop');
  const isOpen   = sidebar.classList.toggle('open');
  layout.classList.toggle('shifted', isOpen);
  backdrop.classList.toggle('visible', isOpen);
}

// ─── Persist ──────────────────────────────────────────────────────────────────
async function persistFrente() {
  await fetch('/api/activities', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(frentes),
  });
  if (typeof rebuildActivityFilters === 'function') rebuildActivityFilters();
}

// ─── Migration from old flat activities format ────────────────────────────────
function migrateIfNeeded(data) {
  if (!Array.isArray(data) || data.length === 0) return [];
  // Old format has `frotas` directly; new format has `atividades`
  if (data[0].atividades !== undefined) return data; // already new format
  // Wrap each old activity as a frente with one atividade
  return data.map(act => ({
    id:         act.id,
    name:       act.name,
    color:      act.color,
    atividades: [{
      id:     crypto.randomUUID(),
      name:   act.name,
      color:  act.color,
      frotas: act.frotas || [],
    }],
  }));
}

// ─── New frente ───────────────────────────────────────────────────────────────
function startNewFrente() {
  document.getElementById('new-frente-form').classList.remove('d-none');
  document.getElementById('btn-new-frente').classList.add('d-none');
  const inp = document.getElementById('new-frente-name');
  inp.value = '';
  inp.focus();
}
function cancelNewFrente() {
  document.getElementById('new-frente-form').classList.add('d-none');
  document.getElementById('btn-new-frente').classList.remove('d-none');
}
function confirmNewFrente() {
  const name = document.getElementById('new-frente-name').value.trim();
  if (!name) return;
  frentes.push({ id: crypto.randomUUID(), name, color: nextColor(frentes), atividades: [] });
  cancelNewFrente();
  renderSidebar();
  persistFrente();
}

// ─── Frente actions ───────────────────────────────────────────────────────────
function renameFrente(id, name) {
  const f = frentes.find(f => f.id === id);
  if (!f || !name.trim() || f.name === name.trim()) return;
  f.name = name.trim();
  persistFrente();
}

function deleteFrente(id, e) {
  e.stopPropagation();
  frentes = frentes.filter(f => f.id !== id);
  renderSidebar();
  persistFrente();
}

function toggleFrenteCard(id) {
  const body = document.getElementById(`fbody-${id}`);
  const icon = document.getElementById(`ficon-${id}`);
  if (!body) return;
  const hidden = body.style.display === 'none';
  body.style.display = hidden ? 'block' : 'none';
  if (icon) icon.style.transform = hidden ? 'rotate(0deg)' : 'rotate(-90deg)';
}

// ─── New atividade ────────────────────────────────────────────────────────────
function startNewAtiv(frenteId) {
  document.getElementById(`new-ativ-form-${frenteId}`).classList.remove('d-none');
  document.getElementById(`btn-new-ativ-${frenteId}`).classList.add('d-none');
  const inp = document.getElementById(`new-ativ-name-${frenteId}`);
  inp.value = '';
  inp.focus();
}
function cancelNewAtiv(frenteId) {
  document.getElementById(`new-ativ-form-${frenteId}`)?.classList.add('d-none');
  document.getElementById(`btn-new-ativ-${frenteId}`)?.classList.remove('d-none');
}
function confirmNewAtiv(frenteId) {
  const name = document.getElementById(`new-ativ-name-${frenteId}`).value.trim();
  if (!name) return;
  const f = frentes.find(f => f.id === frenteId);
  if (!f) return;
  f.atividades.push({ id: crypto.randomUUID(), name, color: nextColor(f.atividades), frotas: [] });
  cancelNewAtiv(frenteId);
  renderSidebar();
  persistFrente();
}

// ─── Atividade actions ────────────────────────────────────────────────────────
function renameAtiv(frenteId, ativId, name) {
  const a = _findAtiv(frenteId, ativId);
  if (!a || !name.trim() || a.name === name.trim()) return;
  a.name = name.trim();
  persistFrente();
}

function deleteAtiv(frenteId, ativId, e) {
  e.stopPropagation();
  const f = frentes.find(f => f.id === frenteId);
  if (!f) return;
  f.atividades = f.atividades.filter(a => a.id !== ativId);
  renderSidebar();
  persistFrente();
}

function _findAtiv(frenteId, ativId) {
  const f = frentes.find(f => f.id === frenteId);
  return f ? f.atividades.find(a => a.id === ativId) : null;
}

// ─── Render sidebar ───────────────────────────────────────────────────────────
function renderSidebar() {
  const container = document.getElementById('frente-list');

  if (frentes.length === 0) {
    container.innerHTML = `
      <div style="padding:1.5rem 1rem;text-align:center;color:#8892a4;font-size:.82rem">
        <i class="bi bi-grid-3x3-gap" style="font-size:2rem;display:block;opacity:.3;margin-bottom:.5rem"></i>
        Crie uma frente para começar.
      </div>`;
    return;
  }

  container.innerHTML = frentes.map(f => {
    const ativCount = f.atividades.length;
    const frotaCount = f.atividades.reduce((s, a) => s + a.frotas.length, 0);

    const ativHTML = f.atividades.map(a => `
      <div class="ativ-item">
        <span class="ativ-dot" style="background:${a.color}"></span>
        <input class="ativ-name-input" value="${escHtml(a.name)}" title="Clique para renomear"
               onclick="event.stopPropagation()"
               onblur="renameAtiv('${f.id}','${a.id}',this.value)"
               onkeydown="if(event.key==='Enter')this.blur()" />
        <span class="activity-badge">${a.frotas.length}</span>
        <div class="activity-actions">
          <button class="act-btn" onclick="openFleetModal('${f.id}','${a.id}')" title="Gerenciar frotas">
            <i class="bi bi-pencil-square"></i>
          </button>
          <button class="act-btn danger" onclick="deleteAtiv('${f.id}','${a.id}',event)" title="Remover">
            <i class="bi bi-trash3"></i>
          </button>
        </div>
      </div>`).join('');

    return `
      <div class="frente-card" id="fcard-${f.id}">
        <div class="frente-header" onclick="toggleFrenteCard('${f.id}')">
          <i class="bi bi-chevron-down" id="ficon-${f.id}" style="font-size:.75rem;color:#8892a4;transition:transform .2s"></i>
          <span class="frente-dot" style="background:${f.color}"></span>
          <input class="frente-name-input" value="${escHtml(f.name)}" title="Clique para renomear"
                 onclick="event.stopPropagation()"
                 onblur="renameFrente('${f.id}',this.value)"
                 onkeydown="if(event.key==='Enter')this.blur()" />
          <span class="frente-meta">${ativCount} ativ · ${frotaCount} frotas</span>
          <button class="act-btn danger" onclick="deleteFrente('${f.id}',event)" title="Remover frente">
            <i class="bi bi-trash3"></i>
          </button>
        </div>

        <div class="frente-body" id="fbody-${f.id}">
          ${ativHTML}

          <div id="new-ativ-form-${f.id}" class="new-ativ-form d-none">
            <input id="new-ativ-name-${f.id}" type="text" class="form-control form-control-sm"
                   placeholder="Nome da atividade" maxlength="40"
                   onkeydown="if(event.key==='Enter')confirmNewAtiv('${f.id}');if(event.key==='Escape')cancelNewAtiv('${f.id}')" />
            <div class="d-flex gap-1 mt-1">
              <button class="btn btn-sm btn-accent flex-fill" onclick="confirmNewAtiv('${f.id}')">Criar</button>
              <button class="btn btn-sm btn-ghost" onclick="cancelNewAtiv('${f.id}')">Cancelar</button>
            </div>
          </div>

          <button class="btn-new-ativ" id="btn-new-ativ-${f.id}" onclick="startNewAtiv('${f.id}')">
            <i class="bi bi-plus-lg me-1"></i> Nova Atividade
          </button>
        </div>
      </div>`;
  }).join('');
}

// ─── Fleet modal ──────────────────────────────────────────────────────────────
let _modalChecked = new Set();
let _modalFiltered = [];
let _uploadModal = null;

async function openFleetModal(frenteId, ativId) {
  _editingFrenteId = frenteId;
  _editingAtivId   = ativId;
  const a = _findAtiv(frenteId, ativId);
  if (!a) return;

  document.getElementById('fleet-modal-title').textContent = `Frotas — ${a.name}`;
  _modalChecked = new Set(a.frotas);

  if (catalogAll.length === 0) {
    const res = await fetch('/api/catalog');
    catalogAll = await res.json();
    const specialties = [...new Set(catalogAll.map(f => f.descricao_especialidade))].sort();
    const sel = document.getElementById('modal-filter-esp');
    sel.innerHTML = '<option value="">Todas as especialidades</option>' +
      specialties.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');
  }

  applyModalFilter();
  const modal = new bootstrap.Modal(document.getElementById('fleet-modal'));
  modal.show();
}

function applyModalFilter() {
  const q   = document.getElementById('modal-search').value.toLowerCase();
  const esp = document.getElementById('modal-filter-esp').value;
  _modalFiltered = catalogAll.filter(f => {
    const matchQ   = !q || String(f.frota).includes(q) || f.descricao_especialidade.toLowerCase().includes(q);
    const matchEsp = !esp || f.descricao_especialidade === esp;
    return matchQ && matchEsp;
  });
  renderModalList();
}

function renderModalList() {
  document.getElementById('modal-fleet-list').innerHTML = _modalFiltered.map(f => `
    <label class="fleet-check-row">
      <input type="checkbox" value="${f.frota}" ${_modalChecked.has(f.frota) ? 'checked' : ''}
             onchange="toggleModalFleet(${f.frota}, this.checked)" />
      <span class="fleet-check-frota">${f.frota}</span>
      <span class="fleet-check-esp">${escHtml(f.descricao_especialidade)}</span>
    </label>`).join('');
  document.getElementById('modal-sel-count').textContent =
    `${_modalChecked.size} selecionada${_modalChecked.size !== 1 ? 's' : ''}`;
}

function toggleModalFleet(frota, checked) {
  checked ? _modalChecked.add(frota) : _modalChecked.delete(frota);
  document.getElementById('modal-sel-count').textContent =
    `${_modalChecked.size} selecionada${_modalChecked.size !== 1 ? 's' : ''}`;
}

function selectAllModal()   { _modalFiltered.forEach(f => _modalChecked.add(f.frota));    renderModalList(); }
function deselectAllModal() { _modalFiltered.forEach(f => _modalChecked.delete(f.frota)); renderModalList(); }

function saveModalSelection() {
  const a = _findAtiv(_editingFrenteId, _editingAtivId);
  if (!a) return;
  a.frotas = [..._modalChecked].sort((a, b) => a - b);
  bootstrap.Modal.getInstance(document.getElementById('fleet-modal')).hide();
  renderSidebar();
  persistFrente();
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function initSidebar() {
  const res  = await fetch('/api/activities');
  const data = await res.json();
  frentes = migrateIfNeeded(data);
  renderSidebar();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modal-search')?.addEventListener('input', applyModalFilter);
  document.getElementById('modal-filter-esp')?.addEventListener('change', applyModalFilter);
  document.getElementById('new-frente-name')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmNewFrente();
    if (e.key === 'Escape') cancelNewFrente();
  });
  initSidebar();
});

// ─── Expose to dashboard ──────────────────────────────────────────────────────
function getFrente() { return frentes; }

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
