// ─── Sidebar state ────────────────────────────────────────────────────────────
let activities = [];     // [{id, name, color, frotas:[int,...]}]
let catalogAll = [];     // flat list from /api/catalog
let _editingId = null;   // activity id currently in the fleet modal

const COLORS = [
  '#4f8ef7','#22c55e','#f59e0b','#ef4444','#a78bfa',
  '#2dd4bf','#f472b6','#fb923c','#34d399','#60a5fa',
];

function nextColor() {
  return COLORS[activities.length % COLORS.length];
}

// ─── Sidebar open/close ───────────────────────────────────────────────────────
function toggleSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const layout   = document.getElementById('layout');
  const backdrop = document.getElementById('sidebar-backdrop');
  const isOpen   = sidebar.classList.toggle('open');
  layout.classList.toggle('shifted', isOpen);
  backdrop.classList.toggle('visible', isOpen);
}

// ─── Persist activities ───────────────────────────────────────────────────────
async function persistActivities() {
  await fetch('/api/activities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(activities),
  });
  if (typeof rebuildActivityFilters === 'function') rebuildActivityFilters();
  else {
    if (typeof rebuildGauges === 'function') rebuildGauges();
    if (typeof rebuildAllTables === 'function') rebuildAllTables();
  }
}

// ─── New activity form ────────────────────────────────────────────────────────
function startNewActivity() {
  document.getElementById('new-activity-form').classList.remove('d-none');
  document.getElementById('btn-new-activity').classList.add('d-none');
  const inp = document.getElementById('new-activity-name');
  inp.value = '';
  inp.focus();
}
function cancelNewActivity() {
  document.getElementById('new-activity-form').classList.add('d-none');
  document.getElementById('btn-new-activity').classList.remove('d-none');
}
function confirmNewActivity() {
  const name = document.getElementById('new-activity-name').value.trim();
  if (!name) return;
  activities.push({ id: crypto.randomUUID(), name, color: nextColor(), frotas: [] });
  cancelNewActivity();
  renderActivityList();
  persistActivities();
}

// Keyboard enter on new activity input
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('new-activity-name')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmNewActivity();
    if (e.key === 'Escape') cancelNewActivity();
  });
});

// ─── Render sidebar list ──────────────────────────────────────────────────────
function renderActivityList() {
  const container = document.getElementById('activity-list');
  if (activities.length === 0) {
    container.innerHTML = `
      <div style="padding:1.5rem 1rem;text-align:center;color:#8892a4;font-size:.82rem">
        <i class="bi bi-folder-plus" style="font-size:2rem;display:block;opacity:.3;margin-bottom:.5rem"></i>
        Crie uma atividade e associe frotas a ela.
      </div>`;
    return;
  }

  container.innerHTML = activities.map(act => {
    const count = act.frotas.length;
    const preview = act.frotas.slice(0, 5).join(', ') + (act.frotas.length > 5 ? ` +${act.frotas.length - 5}` : '');
    return `
      <div class="activity-card" id="acard-${act.id}">
        <div class="activity-card-header" onclick="toggleActivityCard('${act.id}')">
          <span class="activity-dot" style="background:${act.color}"></span>
          <input class="activity-name-input" value="${escHtml(act.name)}"
                 title="Clique para renomear"
                 onclick="event.stopPropagation()"
                 onblur="renameActivity('${act.id}', this.value)"
                 onkeydown="if(event.key==='Enter')this.blur()" />
          <span class="activity-badge">${count}</span>
          <div class="activity-actions">
            <button class="act-btn danger" onclick="deleteActivity('${act.id}',event)" title="Remover atividade">
              <i class="bi bi-trash3"></i>
            </button>
          </div>
        </div>
        <div class="activity-card-body" id="abody-${act.id}" style="display:none">
          <div class="activity-frotas-preview">
            ${count === 0
              ? '<span style="font-style:italic">Nenhuma frota associada.</span>'
              : preview}
          </div>
          <button class="btn-manage-frotas" onclick="openFleetModal('${act.id}')">
            <i class="bi bi-pencil-square me-1"></i> Gerenciar frotas
          </button>
        </div>
      </div>`;
  }).join('');
}

function toggleActivityCard(id) {
  const body = document.getElementById(`abody-${id}`);
  if (!body) return;
  const hidden = body.style.display === 'none';
  body.style.display = hidden ? 'block' : 'none';
}

function renameActivity(id, name) {
  const act = activities.find(a => a.id === id);
  if (!act || !name.trim() || act.name === name.trim()) return;
  act.name = name.trim();
  persistActivities();
}

function deleteActivity(id, event) {
  event.stopPropagation();
  activities = activities.filter(a => a.id !== id);
  renderActivityList();
  persistActivities();
}

// ─── Fleet modal ──────────────────────────────────────────────────────────────
let _modalChecked = new Set();
let _modalFiltered = [];

async function openFleetModal(actId) {
  _editingId = actId;
  const act = activities.find(a => a.id === actId);
  if (!act) return;

  document.getElementById('fleet-modal-title').textContent = `Frotas — ${act.name}`;
  _modalChecked = new Set(act.frotas);

  // Load catalog if not yet loaded
  if (catalogAll.length === 0) {
    const res = await fetch('/api/catalog');
    catalogAll = await res.json();
    // Populate specialty filter
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
  const list = document.getElementById('modal-fleet-list');
  const checked = _modalChecked;

  list.innerHTML = _modalFiltered.map(f => `
    <label class="fleet-check-row">
      <input type="checkbox" value="${f.frota}" ${checked.has(f.frota) ? 'checked' : ''}
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

function selectAllModal() {
  _modalFiltered.forEach(f => _modalChecked.add(f.frota));
  renderModalList();
}
function deselectAllModal() {
  _modalFiltered.forEach(f => _modalChecked.delete(f.frota));
  renderModalList();
}

function saveModalSelection() {
  const act = activities.find(a => a.id === _editingId);
  if (!act) return;
  act.frotas = [..._modalChecked].sort((a, b) => a - b);
  bootstrap.Modal.getInstance(document.getElementById('fleet-modal')).hide();
  renderActivityList();
  persistActivities();
}

// ─── Load & init ──────────────────────────────────────────────────────────────
async function initSidebar() {
  const res = await fetch('/api/activities');
  activities = await res.json();
  renderActivityList();
}

// Wire modal search + filter
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modal-search')?.addEventListener('input', applyModalFilter);
  document.getElementById('modal-filter-esp')?.addEventListener('change', applyModalFilter);
  initSidebar();
});

// ─── Util ─────────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Expose activities to dashboard ──────────────────────────────────────────
function getActivities() { return activities; }
