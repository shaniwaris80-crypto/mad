const STORAGE_KEY = 'arslan_pedidos_15_v2';
const UNITS = ['CAJA', 'UD', 'MANOJO'];
const DEFAULT_PRODUCTS = [
  'MACHO MADURO', 'MACHO VERDE', 'BONIATO', 'AGUACATE PREMIUM', 'AGUACATE GRANEL', 'AVOCADO', 'YUCA', 'BANANA',
  'GUINEO ECUATORIAL', 'JENGIBRE', 'ALOE VERA', 'AJO', 'CEBOLLA NORMAL', 'CEBOLLA ROJA', 'PATATA', 'KIWI', 'GUINDILLA',
  'PLATANO CANARIO', 'PLATANO CANARIO PLUS', 'MANGO', 'COCO', 'CILANTRO', 'LIMA', 'LIMON', 'CALABAZA', 'JALAPEÑO',
  'NARANJA', 'MANZANA', 'MANDARINA', 'TOMATE', 'TOMATE PREMIUM', 'PAPAYA', 'JUDIA', 'CHAYOTE', 'OKRA'
];

const state = loadState();
let currentView = 'dashboard';
let selectedClientId = state.ui.selectedClientId || null;
let providerTab = state.ui.providerTab || 'total';

function makeId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function niceDate(dateStr) {
  const d = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function eur(value) {
  return Number(value || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
}

function qtyFormat(value) {
  return Number(value || 0).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function clampMinZero(value) {
  return Math.max(0, round2(value));
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(value = '') {
  return escapeHtml(value).replace(/`/g, '&#096;');
}

function lineKey(product, unit) {
  return `${normalizeName(product)}__${String(unit || 'CAJA').toUpperCase()}`;
}

function statusLabel(status) {
  if (status === 'unavailable') return 'NO TIENE';
  if (status === 'external') return 'EXTERNO';
  return 'DISPONIBLE';
}

function statusClass(status) {
  if (status === 'pagado' || status === 'available') return 'status-ok';
  if (status === 'parcial' || status === 'external') return 'status-warn';
  if (status === 'pendiente' || status === 'unavailable') return 'status-danger';
  return 'status-neutral';
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return normalizeState({});
  try {
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    console.error('No se pudo leer el estado', error);
    return normalizeState({});
  }
}

function normalizeState(input) {
  const s = input || {};
  return {
    dayKey: s.dayKey || todayStr(),
    settings: {
      appName: s.settings?.appName || 'ARSLAN PEDIDOS 15%',
      defaultCommissionPct: Number(s.settings?.defaultCommissionPct ?? 15),
      defaultUnit: s.settings?.defaultUnit || 'CAJA',
      theme: s.settings?.theme || 'light'
    },
    products: Array.isArray(s.products) && s.products.length
      ? s.products.map(p => ({ id: p.id || makeId('prod'), name: normalizeName(p.name), active: p.active !== false }))
      : DEFAULT_PRODUCTS.map(name => ({ id: makeId('prod'), name, active: true })),
    clients: Array.isArray(s.clients)
      ? s.clients.map(c => ({
          id: c.id || makeId('client'),
          name: String(c.name || '').trim(),
          phone: String(c.phone || '').trim(),
          commissionPct: Number(c.commissionPct ?? s.settings?.defaultCommissionPct ?? 15),
          notes: String(c.notes || '').trim(),
          active: c.active !== false,
          createdAt: c.createdAt || Date.now()
        }))
      : [],
    orders: s.orders && typeof s.orders === 'object' ? s.orders : {},
    payments: s.payments && typeof s.payments === 'object' ? s.payments : {},
    availability: s.availability && typeof s.availability === 'object' ? s.availability : {},
    history: Array.isArray(s.history) ? s.history : [],
    ui: {
      selectedClientId: s.ui?.selectedClientId || null,
      providerTab: s.ui?.providerTab || 'total'
    }
  };
}

function saveState(render = true) {
  state.ui.selectedClientId = selectedClientId;
  state.ui.providerTab = providerTab;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (render) renderAll();
}

function ensureDay() {
  if (state.dayKey !== todayStr() && !hasActiveData()) {
    state.dayKey = todayStr();
  }
}

function hasActiveData() {
  const hasOrders = Object.values(state.orders).some(lines => Array.isArray(lines) && lines.length > 0);
  const hasPayments = Object.values(state.payments).some(p => Number(p?.base || 0) > 0 || Number(p?.paid || 0) > 0);
  return hasOrders || hasPayments;
}

function getActiveProducts() {
  return state.products.filter(p => p.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function getActiveClients() {
  return state.clients.filter(c => c.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function getClient(clientId) {
  return state.clients.find(c => c.id === clientId) || null;
}

function ensureOrder(clientId) {
  if (!state.orders[clientId]) state.orders[clientId] = [];
  return state.orders[clientId];
}

function ensurePayment(clientId) {
  if (!state.payments[clientId]) {
    const client = getClient(clientId);
    state.payments[clientId] = {
      base: 0,
      paid: 0,
      note: '',
      commissionPct: Number(client?.commissionPct ?? state.settings.defaultCommissionPct)
    };
  }
  return state.payments[clientId];
}

function getOrderStats(clientId) {
  const lines = state.orders[clientId] || [];
  const totalLines = lines.length;
  const totalQty = round2(lines.reduce((acc, line) => acc + Number(line.qty || 0), 0));
  return { totalLines, totalQty };
}

function computePayment(clientId) {
  const payment = ensurePayment(clientId);
  const base = round2(payment.base || 0);
  const pct = Number(payment.commissionPct || 0);
  const mine = round2(base * pct / 100);
  const total = round2(base + mine);
  const paid = round2(payment.paid || 0);
  const pending = clampMinZero(total - paid);
  let status = 'pendiente';
  if (total === 0 && paid === 0) status = 'sin importe';
  else if (pending === 0) status = 'pagado';
  else if (paid > 0 && pending > 0) status = 'parcial';
  return { base, pct, mine, total, paid, pending, status };
}

function getAggregatedProviderItems() {
  const map = new Map();

  getActiveClients().forEach(client => {
    (state.orders[client.id] || []).forEach(line => {
      const product = normalizeName(line.product);
      const unit = String(line.unit || state.settings.defaultUnit || 'CAJA').toUpperCase();
      const key = lineKey(product, unit);
      if (!map.has(key)) {
        map.set(key, {
          key,
          product,
          unit,
          qty: 0,
          status: state.availability[key] || 'available',
          clients: []
        });
      }
      const item = map.get(key);
      item.qty = round2(item.qty + Number(line.qty || 0));
      item.clients.push({ clientId: client.id, clientName: client.name, qty: round2(line.qty || 0), note: line.note || '' });
      item.status = state.availability[key] || item.status || 'available';
    });
  });

  return [...map.values()].sort((a, b) => {
    const byProduct = a.product.localeCompare(b.product, 'es');
    return byProduct !== 0 ? byProduct : a.unit.localeCompare(b.unit, 'es');
  });
}

function getProviderSections() {
  const all = getAggregatedProviderItems();
  return {
    all,
    available: all.filter(item => item.status === 'available'),
    unavailable: all.filter(item => item.status === 'unavailable'),
    external: all.filter(item => item.status === 'external')
  };
}

function getClientOrderFromHistory(clientId) {
  const orderedHistory = [...state.history].sort((a, b) => (b.dayKey || '').localeCompare(a.dayKey || ''));
  for (const snapshot of orderedHistory) {
    const found = snapshot.ordersByClient?.find(row => row.clientId === clientId && row.lines?.length);
    if (found) return found.lines;
  }
  return null;
}

function computeGlobal() {
  const clients = getActiveClients();
  let totalProvider = 0;
  let totalMine = 0;
  let totalGeneral = 0;
  let totalPaid = 0;
  let totalPending = 0;
  let totalQty = 0;
  let clientsWithActivity = 0;

  clients.forEach(client => {
    const orderStats = getOrderStats(client.id);
    const pay = computePayment(client.id);
    totalProvider += pay.base;
    totalMine += pay.mine;
    totalGeneral += pay.total;
    totalPaid += pay.paid;
    totalPending += pay.pending;
    totalQty += orderStats.totalQty;
    if (orderStats.totalLines > 0 || pay.base > 0 || pay.paid > 0) clientsWithActivity += 1;
  });

  const providerSections = getProviderSections();
  const topClients = clients
    .map(client => ({ client, ...computePayment(client.id) }))
    .sort((a, b) => b.base - a.base)
    .slice(0, 3);

  return {
    totalProvider: round2(totalProvider),
    totalMine: round2(totalMine),
    totalGeneral: round2(totalGeneral),
    totalPaid: round2(totalPaid),
    totalPending: round2(totalPending),
    totalQty: round2(totalQty),
    clientsWithActivity,
    topClients,
    providerSections
  };
}

function applyTheme(theme) {
  state.settings.theme = theme === 'dark' ? 'dark' : 'light';
  document.body.classList.toggle('dark', state.settings.theme === 'dark');
  const themeBtn = document.getElementById('themeToggleBtn');
  if (themeBtn) themeBtn.textContent = state.settings.theme === 'dark' ? 'Modo día' : 'Modo nocturno';
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', state.settings.theme === 'dark' ? '#171a21' : '#f6f8fb');
}

function goTo(view) {
  currentView = view;
  document.querySelectorAll('.view').forEach(viewEl => viewEl.classList.remove('active'));
  const target = document.getElementById(`view-${view}`);
  if (target) target.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  if (view === 'orders' && !selectedClientId && getActiveClients()[0]) {
    selectedClientId = getActiveClients()[0].id;
  }
  renderAll();
}

function renderAll() {
  ensureDay();
  applyTheme(state.settings.theme);
  renderStats();
  renderDashboard();
  renderClients();
  renderOrders();
  renderProvider();
  renderPayments();
  renderHistory();
  renderSettings();
}

function renderStats() {
  const g = computeGlobal();
  const stats = [
    { label: 'Total proveedor', value: eur(g.totalProvider), sub: 'Lo que debes reunir para pagar proveedor' },
    { label: 'Mi 15%', value: eur(g.totalMine), sub: 'Tu comisión total' },
    { label: 'Total general', value: eur(g.totalGeneral), sub: 'Proveedor + tu comisión' },
    { label: 'Cobrado', value: eur(g.totalPaid), sub: 'Importe ya recibido' },
    { label: 'Pendiente', value: eur(g.totalPending), sub: `${g.clientsWithActivity} clientes activos · ${qtyFormat(g.totalQty)} líneas totales` }
  ];

  document.getElementById('dashboardStats').innerHTML = stats.map(item => `
    <article class="stat-card">
      <div class="label">${item.label}</div>
      <div class="value">${item.value}</div>
      <div class="sub">${item.sub}</div>
    </article>
  `).join('');
}

function renderDashboard() {
  const root = document.getElementById('view-dashboard');
  const g = computeGlobal();
  root.innerHTML = `
    <div class="dashboard-grid">
      <section class="summary-card">
        <div class="section-title">
          <div>
            <h2>Resumen de hoy</h2>
            <div class="subline">${niceDate(state.dayKey)}</div>
          </div>
        </div>
        <div class="summary-row"><span>Total proveedor</span><strong>${eur(g.totalProvider)}</strong></div>
        <div class="summary-row"><span>Mi 15%</span><strong class="highlight">${eur(g.totalMine)}</strong></div>
        <div class="summary-row"><span>Total general a cobrar</span><strong>${eur(g.totalGeneral)}</strong></div>
        <div class="summary-row"><span>Cobrado</span><strong>${eur(g.totalPaid)}</strong></div>
        <div class="summary-row"><span>Pendiente</span><strong>${eur(g.totalPending)}</strong></div>
        <div class="inline-actions">
          <button class="btn btn-accent" type="button" onclick="goTo('orders')">Ir a pedidos</button>
          <button class="btn btn-sky" type="button" onclick="goTo('provider')">Proveedor</button>
          <button class="btn btn-soft" type="button" onclick="goTo('payments')">Cobros</button>
          <button class="btn btn-warn" type="button" onclick="shareProviderTotal()">WhatsApp total</button>
        </div>
      </section>

      <section class="card">
        <div class="section-title">
          <div>
            <h2>Top clientes por base</h2>
            <div class="subline">Quién mueve más importe base</div>
          </div>
        </div>
        <div class="top-list">
          ${g.topClients.length ? g.topClients.map((item, idx) => `
            <article class="client-card">
              <div class="client-header">
                <div>
                  <h3>${idx + 1}. ${escapeHtml(item.client.name)}</h3>
                  <div class="tiny">Base ${eur(item.base)} · Mi ${eur(item.mine)} · Total ${eur(item.total)}</div>
                </div>
                <span class="status-pill ${statusClass(item.status)}">${item.status.toUpperCase()}</span>
              </div>
            </article>
          `).join('') : '<div class="empty">Todavía no hay importes base introducidos.</div>'}
        </div>
      </section>
    </div>

    <section class="card" style="margin-top:12px">
      <div class="section-title">
        <div>
          <h2>Acciones rápidas</h2>
          <div class="subline">Exportación, impresión y WhatsApp</div>
        </div>
      </div>
      <div class="toolbar">
        <button class="btn btn-soft" type="button" onclick="printProviderTotal()">PDF proveedor total</button>
        <button class="btn btn-soft" type="button" onclick="printProviderByClient()">PDF proveedor por cliente</button>
        <button class="btn btn-soft" type="button" onclick="printMissingExternal()">PDF faltantes / externos</button>
        <button class="btn btn-soft" type="button" onclick="printDailySummary()">PDF resumen diario</button>
        <button class="btn btn-soft" type="button" onclick="shareProviderByClient()">WhatsApp por cliente</button>
        <button class="btn btn-danger" type="button" onclick="clearDay()">Limpiar día</button>
      </div>
    </section>
  `;
}

function renderClients() {
  const root = document.getElementById('view-clients');
  const clients = getActiveClients();
  root.innerHTML = `
    <section class="card">
      <div class="section-title">
        <div>
          <h2>Clientes</h2>
          <div class="subline">Añade clientes y define su % de comisión</div>
        </div>
      </div>
      <div class="field-grid cols-3">
        <div class="field">
          <label>Nombre</label>
          <input class="input" id="clientNameInput" placeholder="Ej. Adnan" />
        </div>
        <div class="field">
          <label>Teléfono</label>
          <input class="input" id="clientPhoneInput" placeholder="WhatsApp opcional" />
        </div>
        <div class="field">
          <label>% comisión</label>
          <input class="input" id="clientPctInput" type="number" step="0.01" value="${state.settings.defaultCommissionPct}" />
        </div>
      </div>
      <div class="field-grid cols-2" style="margin-top:12px">
        <div class="field">
          <label>Notas</label>
          <input class="input" id="clientNotesInput" placeholder="Opcional" />
        </div>
        <div class="field" style="justify-content:end">
          <label>&nbsp;</label>
          <button class="btn btn-accent" id="addClientBtn" type="button">Añadir cliente</button>
        </div>
      </div>
    </section>

    <section class="card" style="margin-top:12px">
      <div class="section-title">
        <div>
          <h2>Lista de clientes</h2>
          <div class="subline">Pedido, base, comisión y pendiente</div>
        </div>
      </div>
      <div class="field-grid cols-2">
        <div class="field">
          <label>Buscar cliente</label>
          <input class="input" id="clientSearchInput" placeholder="Buscar por nombre" />
        </div>
        <div class="field">
          <label>Filtro</label>
          <select class="select" id="clientFilterSelect">
            <option value="all">Todos</option>
            <option value="orders">Con pedido</option>
            <option value="pending">Pendientes</option>
            <option value="paid">Pagados</option>
          </select>
        </div>
      </div>
      <div class="client-list" id="clientsListWrap" style="margin-top:12px"></div>
    </section>
  `;

  root.querySelector('#addClientBtn').addEventListener('click', addClient);
  root.querySelector('#clientSearchInput').addEventListener('input', renderClientCards);
  root.querySelector('#clientFilterSelect').addEventListener('change', renderClientCards);
  renderClientCards();
}

function renderClientCards() {
  const root = document.getElementById('view-clients');
  if (!root) return;
  const search = root.querySelector('#clientSearchInput')?.value.trim().toUpperCase() || '';
  const filter = root.querySelector('#clientFilterSelect')?.value || 'all';
  const wrap = root.querySelector('#clientsListWrap');
  if (!wrap) return;

  const filtered = getActiveClients().filter(client => {
    const stats = getOrderStats(client.id);
    const pay = computePayment(client.id);
    const textMatch = !search || client.name.toUpperCase().includes(search);
    if (!textMatch) return false;
    if (filter === 'orders') return stats.totalLines > 0;
    if (filter === 'pending') return pay.pending > 0;
    if (filter === 'paid') return pay.total > 0 && pay.pending === 0;
    return true;
  });

  wrap.innerHTML = filtered.length ? filtered.map(client => {
    const order = getOrderStats(client.id);
    const pay = computePayment(client.id);
    return `
      <article class="client-card">
        <div class="client-header">
          <div>
            <h3>${escapeHtml(client.name)}</h3>
            <div class="tiny">${escapeHtml(client.phone || 'Sin teléfono')} · ${client.commissionPct}%</div>
          </div>
          <span class="status-pill ${statusClass(pay.status)}">${pay.status.toUpperCase()}</span>
        </div>
        <div class="badges" style="margin-top:10px">
          <span class="pill">${order.totalLines} líneas</span>
          <span class="pill">${qtyFormat(order.totalQty)} unidades</span>
          <span class="pill">Base ${eur(pay.base)}</span>
          <span class="pill">Mi ${eur(pay.mine)}</span>
          <span class="pill">Pendiente ${eur(pay.pending)}</span>
        </div>
        <div class="toolbar" style="margin-top:12px">
          <button class="btn btn-soft btn-xs" type="button" onclick="openClientOrders('${client.id}')">Abrir pedido</button>
          <button class="btn btn-soft btn-xs" type="button" onclick="openClientPayments('${client.id}')">Cobro</button>
          <button class="btn btn-soft btn-xs" type="button" onclick="loadLastOrder('${client.id}')">Último pedido</button>
          <button class="btn btn-warn btn-xs" type="button" onclick="shareClientOrder('${client.id}')">WhatsApp</button>
          <button class="btn btn-danger btn-xs" type="button" onclick="removeClient('${client.id}')">Eliminar</button>
        </div>
      </article>
    `;
  }).join('') : '<div class="empty">No hay clientes que coincidan con el filtro.</div>';
}

function renderOrders() {
  const root = document.getElementById('view-orders');
  const clients = getActiveClients();
  if (!selectedClientId && clients[0]) selectedClientId = clients[0].id;
  const selected = getClient(selectedClientId);
  const lines = selected ? (state.orders[selected.id] || []) : [];
  const stats = selected ? getOrderStats(selected.id) : { totalLines: 0, totalQty: 0 };

  root.innerHTML = `
    <section class="card">
      <div class="section-title">
        <div>
          <h2>Pedidos</h2>
          <div class="subline">Unidad por defecto: ${state.settings.defaultUnit}</div>
        </div>
        <div class="toolbar">
          <button class="btn btn-soft btn-xs" type="button" onclick="goTo('clients')">Gestionar clientes</button>
          ${selected ? `<button class="btn btn-soft btn-xs" type="button" onclick="printClientOrder('${selected.id}')">PDF cliente</button>` : ''}
        </div>
      </div>
      ${clients.length ? `
        <div class="field-grid cols-3">
          <div class="field">
            <label>Cliente</label>
            <select class="select" id="ordersClientSelect">
              ${clients.map(client => `<option value="${client.id}" ${client.id === selected?.id ? 'selected' : ''}>${escapeHtml(client.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Buscar producto</label>
            <input class="input" id="ordersProductSearch" placeholder="Buscar en diccionario" />
          </div>
          <div class="field">
            <label>Añadir producto manual</label>
            <div class="search-row">
              <input class="input" id="manualProductInput" placeholder="Ej. ÑAME" />
              <button class="btn btn-accent btn-xs" type="button" id="addManualProductBtn">Añadir</button>
            </div>
          </div>
        </div>
      ` : '<div class="empty">Primero añade un cliente.</div>'}
    </section>

    ${selected ? `
      <div class="orders-layout" style="margin-top:12px">
        <section class="card">
          <div class="section-title">
            <div>
              <h3>Diccionario</h3>
              <div class="subline">Toque rápido para añadir +1 ${state.settings.defaultUnit}</div>
            </div>
          </div>
          <div class="product-grid" id="productGridWrap">
            ${getActiveProducts().map(product => `
              <button class="product-chip" type="button" data-product="${escapeAttr(product.name)}">
                <span>${escapeHtml(product.name)}</span>
                <span>+1</span>
              </button>
            `).join('')}
          </div>
        </section>

        <section class="card">
          <div class="section-title">
            <div>
              <h3>${escapeHtml(selected.name)}</h3>
              <div class="subline">${stats.totalLines} líneas · ${qtyFormat(stats.totalQty)} unidades</div>
            </div>
            <div class="toolbar">
              <button class="btn btn-soft btn-xs" type="button" onclick="loadLastOrder('${selected.id}')">Cargar último pedido</button>
              <button class="btn btn-warn btn-xs" type="button" onclick="shareClientOrder('${selected.id}')">WhatsApp</button>
              <button class="btn btn-danger btn-xs" type="button" onclick="clearClientOrder('${selected.id}')">Vaciar</button>
            </div>
          </div>
          <div class="order-list">
            ${lines.length ? lines.map(line => `
              <article class="order-line">
                <div class="row-top">
                  <div>
                    <strong>${escapeHtml(line.product)}</strong>
                    <div class="tiny">Unidad: ${escapeHtml(line.unit || state.settings.defaultUnit)}</div>
                  </div>
                  <button class="btn btn-danger btn-xs" type="button" onclick="removeOrderLine('${selected.id}', '${line.id}')">Eliminar</button>
                </div>
                <div class="qty-controls" style="margin-top:12px">
                  <button class="qty-btn" type="button" onclick="changeQty('${selected.id}', '${line.id}', -5)">-5</button>
                  <button class="qty-btn" type="button" onclick="changeQty('${selected.id}', '${line.id}', -1)">-</button>
                  <input class="qty-input" type="number" step="0.01" value="${line.qty}" oninput="setQty('${selected.id}', '${line.id}', this.value)" />
                  <button class="qty-btn primary" type="button" onclick="changeQty('${selected.id}', '${line.id}', 1)">+</button>
                  <button class="qty-btn primary" type="button" onclick="changeQty('${selected.id}', '${line.id}', 5)">+5</button>
                  <select class="unit-select" onchange="setLineUnit('${selected.id}', '${line.id}', this.value)">
                    ${UNITS.map(unit => `<option value="${unit}" ${unit === (line.unit || state.settings.defaultUnit) ? 'selected' : ''}>${unit}</option>`).join('')}
                  </select>
                </div>
                <div class="field" style="margin-top:12px">
                  <label>Nota línea</label>
                  <input class="input" value="${escapeAttr(line.note || '')}" oninput="setLineNote('${selected.id}', '${line.id}', this.value)" placeholder="Opcional" />
                </div>
              </article>
            `).join('') : '<div class="empty">Este cliente todavía no tiene pedido. Toca un producto para empezar.</div>'}
          </div>
        </section>
      </div>
    ` : ''}
  `;

  const select = root.querySelector('#ordersClientSelect');
  if (select) {
    select.addEventListener('change', event => {
      selectedClientId = event.target.value;
      saveState();
      goTo('orders');
    });
  }

  const grid = root.querySelector('#productGridWrap');
  if (grid) {
    grid.querySelectorAll('.product-chip').forEach(btn => {
      btn.addEventListener('click', () => addProductToOrder(selected.id, btn.dataset.product));
    });
  }

  const search = root.querySelector('#ordersProductSearch');
  if (search) {
    search.addEventListener('input', event => {
      const term = normalizeName(event.target.value);
      root.querySelectorAll('.product-chip').forEach(btn => {
        btn.style.display = !term || btn.dataset.product.includes(term) ? '' : 'none';
      });
    });
  }

  const addManual = root.querySelector('#addManualProductBtn');
  if (addManual) {
    addManual.addEventListener('click', () => {
      const input = root.querySelector('#manualProductInput');
      const value = normalizeName(input.value);
      if (!value) return alert('Introduce un producto.');
      addProductToCatalog(value);
      addProductToOrder(selected.id, value);
      input.value = '';
    });
  }
}

function renderProvider() {
  const root = document.getElementById('view-provider');
  const sections = getProviderSections();
  root.innerHTML = `
    <section class="card">
      <div class="section-title">
        <div>
          <h2>Proveedor</h2>
          <div class="subline">Total general, detalle por cliente y faltantes / externos</div>
        </div>
        <div class="toolbar">
          <button class="btn btn-warn btn-xs" type="button" onclick="shareProviderTotal()">WhatsApp total</button>
          <button class="btn btn-soft btn-xs" type="button" onclick="shareProviderByClient()">WhatsApp por cliente</button>
          <button class="btn btn-soft btn-xs" type="button" onclick="shareMissingExternal()">WhatsApp faltantes</button>
        </div>
      </div>
      <div class="segmented">
        <button class="${providerTab === 'total' ? 'active' : ''}" type="button" onclick="setProviderTab('total')">Total</button>
        <button class="${providerTab === 'byClient' ? 'active' : ''}" type="button" onclick="setProviderTab('byClient')">Por cliente</button>
        <button class="${providerTab === 'missing' ? 'active' : ''}" type="button" onclick="setProviderTab('missing')">Faltantes / externos</button>
      </div>
    </section>

    <div class="provider-layout" style="margin-top:12px">
      ${providerTab === 'total' ? renderProviderTotalTab(sections) : ''}
      ${providerTab === 'byClient' ? renderProviderByClientTab() : ''}
      ${providerTab === 'missing' ? renderProviderMissingTab(sections) : ''}
    </div>
  `;
}

function renderProviderTotalTab(sections) {
  return `
    <section class="card tab-pane">
      <div class="section-title">
        <div>
          <h3>Total proveedor</h3>
          <div class="subline">Marca si el proveedor no tiene un producto o si irá por compra externa</div>
        </div>
        <div class="toolbar">
          <button class="btn btn-soft btn-xs" type="button" onclick="printProviderTotal()">PDF total</button>
          <button class="btn btn-soft btn-xs" type="button" onclick="copyProviderTotalText()">Copiar</button>
        </div>
      </div>
      <div class="provider-list">
        ${sections.all.length ? sections.all.map(item => `
          <article class="provider-row">
            <div class="provider-top">
              <div>
                <h3>${escapeHtml(item.product)}</h3>
                <div class="tiny">${qtyFormat(item.qty)} ${escapeHtml(item.unit)} · ${item.clients.length} líneas de clientes</div>
              </div>
              <span class="status-pill ${statusClass(item.status)}">${statusLabel(item.status)}</span>
            </div>
            <div class="toolbar" style="margin-top:12px">
              <button class="tag-btn ${item.status === 'available' ? 'active available' : ''}" type="button" onclick="setAvailability('${item.key}', 'available')">Disponible</button>
              <button class="tag-btn ${item.status === 'unavailable' ? 'active unavailable' : ''}" type="button" onclick="setAvailability('${item.key}', 'unavailable')">No tiene</button>
              <button class="tag-btn ${item.status === 'external' ? 'active external' : ''}" type="button" onclick="setAvailability('${item.key}', 'external')">Externo</button>
            </div>
          </article>
        `).join('') : '<div class="empty">Aún no hay productos acumulados.</div>'}
      </div>
    </section>
  `;
}

function renderProviderByClientTab() {
  const clients = getActiveClients();
  return `
    <section class="card tab-pane">
      <div class="section-title">
        <div>
          <h3>Detalle individual por cliente</h3>
          <div class="subline">Nombre del cliente y todas sus líneas de producto</div>
        </div>
        <div class="toolbar">
          <button class="btn btn-soft btn-xs" type="button" onclick="printProviderByClient()">PDF por cliente</button>
        </div>
      </div>
      <div class="provider-list">
        ${clients.length ? clients.map(client => {
          const lines = state.orders[client.id] || [];
          return `
            <article class="provider-row">
              <div class="provider-top">
                <div>
                  <h3>${escapeHtml(client.name)}</h3>
                  <div class="tiny">${lines.length} líneas</div>
                </div>
              </div>
              ${lines.length ? `
                <div class="table-wrap" style="margin-top:12px">
                  <table class="table">
                    <thead><tr><th>Producto</th><th>Cantidad</th><th>Unidad</th><th>Nota</th></tr></thead>
                    <tbody>
                      ${lines.map(line => `
                        <tr>
                          <td>${escapeHtml(line.product)}</td>
                          <td>${qtyFormat(line.qty)}</td>
                          <td>${escapeHtml(line.unit || state.settings.defaultUnit)}</td>
                          <td>${escapeHtml(line.note || '')}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              ` : '<div class="empty" style="margin-top:12px">Sin pedido</div>'}
            </article>
          `;
        }).join('') : '<div class="empty">Todavía no hay clientes.</div>'}
      </div>
    </section>
  `;
}

function renderProviderMissingTab(sections) {
  const combined = [...sections.unavailable, ...sections.external];
  return `
    <section class="card tab-pane">
      <div class="section-title">
        <div>
          <h3>Faltantes y compra externa</h3>
          <div class="subline">Productos que el proveedor no tiene o que debes comprar fuera</div>
        </div>
        <div class="toolbar">
          <button class="btn btn-soft btn-xs" type="button" onclick="printMissingExternal()">PDF faltantes</button>
          <button class="btn btn-soft btn-xs" type="button" onclick="copyMissingText()">Copiar</button>
        </div>
      </div>
      <div class="provider-list">
        ${combined.length ? combined.map(item => `
          <article class="provider-row">
            <div class="provider-top">
              <div>
                <h3>${escapeHtml(item.product)}</h3>
                <div class="tiny">Total ${qtyFormat(item.qty)} ${escapeHtml(item.unit)}</div>
              </div>
              <span class="status-pill ${statusClass(item.status)}">${statusLabel(item.status)}</span>
            </div>
            <div class="table-wrap" style="margin-top:12px">
              <table class="table">
                <thead><tr><th>Cliente</th><th>Cantidad</th><th>Unidad</th><th>Nota</th></tr></thead>
                <tbody>
                  ${item.clients.map(row => `
                    <tr>
                      <td>${escapeHtml(row.clientName)}</td>
                      <td>${qtyFormat(row.qty)}</td>
                      <td>${escapeHtml(item.unit)}</td>
                      <td>${escapeHtml(row.note || '')}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </article>
        `).join('') : '<div class="empty">Todavía no hay productos marcados como faltantes o externos.</div>'}
      </div>
    </section>
  `;
}

function renderPayments() {
  const root = document.getElementById('view-payments');
  const g = computeGlobal();
  root.innerHTML = `
    <section class="card">
      <div class="section-title">
        <div>
          <h2>Cobros</h2>
          <div class="subline">Introduce la base del proveedor y la app calcula tu % automáticamente</div>
        </div>
        <div class="toolbar">
          <button class="btn btn-soft btn-xs" type="button" onclick="printDailySummary()">PDF resumen</button>
        </div>
      </div>
      <div class="mini-grid">
        <article class="mini-box"><div class="label">Total proveedor</div><div class="value">${eur(g.totalProvider)}</div></article>
        <article class="mini-box"><div class="label">Mi 15%</div><div class="value">${eur(g.totalMine)}</div></article>
        <article class="mini-box"><div class="label">Total cobrar</div><div class="value">${eur(g.totalGeneral)}</div></article>
      </div>
    </section>

    <section class="card" style="margin-top:12px">
      <div class="section-title">
        <div>
          <h2>Detalle de cobros</h2>
          <div class="subline">Base proveedor, comisión, total y estado</div>
        </div>
      </div>
      <div class="payment-list">
        ${getActiveClients().length ? getActiveClients().map(client => {
          const payment = ensurePayment(client.id);
          const calc = computePayment(client.id);
          return `
            <article class="payment-row">
              <div class="payment-top">
                <div>
                  <h3>${escapeHtml(client.name)}</h3>
                  <div class="tiny">${getOrderStats(client.id).totalLines} líneas · ${getOrderStats(client.id).totalQty} unidades</div>
                </div>
                <span class="status-pill ${statusClass(calc.status)}">${calc.status.toUpperCase()}</span>
              </div>
              <div class="field-grid cols-3" style="margin-top:12px">
                <div class="field">
                  <label>Base proveedor</label>
                  <input class="input" type="number" step="0.01" value="${payment.base || ''}" oninput="setPaymentField('${client.id}', 'base', this.value)" />
                </div>
                <div class="field">
                  <label>% comisión</label>
                  <input class="input" type="number" step="0.01" value="${payment.commissionPct}" oninput="setPaymentField('${client.id}', 'commissionPct', this.value)" />
                </div>
                <div class="field">
                  <label>Pagado</label>
                  <input class="input" type="number" step="0.01" value="${payment.paid || ''}" oninput="setPaymentField('${client.id}', 'paid', this.value)" />
                </div>
              </div>
              <div class="field" style="margin-top:12px">
                <label>Nota</label>
                <input class="input" value="${escapeAttr(payment.note || '')}" oninput="setPaymentField('${client.id}', 'note', this.value)" />
              </div>
              <div class="mini-grid" style="margin-top:12px">
                <article class="mini-box"><div class="label">Mi comisión</div><div class="value">${eur(calc.mine)}</div></article>
                <article class="mini-box"><div class="label">Total cobrar</div><div class="value">${eur(calc.total)}</div></article>
                <article class="mini-box"><div class="label">Pendiente</div><div class="value">${eur(calc.pending)}</div></article>
              </div>
              <div class="toolbar" style="margin-top:12px">
                <button class="btn btn-soft btn-xs" type="button" onclick="addQuickPaid('${client.id}', 50)">+50</button>
                <button class="btn btn-soft btn-xs" type="button" onclick="addQuickPaid('${client.id}', 100)">+100</button>
                <button class="btn btn-soft btn-xs" type="button" onclick="addQuickPaid('${client.id}', 200)">+200</button>
                <button class="btn btn-soft btn-xs" type="button" onclick="markPaidFull('${client.id}')">Marcar pagado</button>
                <button class="btn btn-warn btn-xs" type="button" onclick="shareClientOrder('${client.id}')">WhatsApp</button>
              </div>
            </article>
          `;
        }).join('') : '<div class="empty">No hay clientes todavía.</div>'}
      </div>
    </section>
  `;
}

function renderHistory() {
  const root = document.getElementById('view-history');
  const items = [...state.history].sort((a, b) => (b.dayKey || '').localeCompare(a.dayKey || ''));
  root.innerHTML = `
    <section class="card">
      <div class="section-title">
        <div>
          <h2>Historial</h2>
          <div class="subline">Se guarda al limpiar el día</div>
        </div>
      </div>
      <div class="history-list">
        ${items.length ? items.map(item => `
          <article class="history-card">
            <div class="history-top">
              <div>
                <h3>${niceDate(item.dayKey)}</h3>
                <div class="tiny">${item.totalClients} clientes · ${item.totalProductGroups} productos agrupados</div>
              </div>
              <span class="status-pill status-ok">${eur(item.totals.totalGeneral)}</span>
            </div>
            <div class="mini-grid" style="margin-top:12px">
              <article class="mini-box"><div class="label">Proveedor</div><div class="value">${eur(item.totals.totalProvider)}</div></article>
              <article class="mini-box"><div class="label">Mi %</div><div class="value">${eur(item.totals.totalMine)}</div></article>
              <article class="mini-box"><div class="label">Pendiente</div><div class="value">${eur(item.totals.totalPending)}</div></article>
            </div>
            <details style="margin-top:12px">
              <summary>Ver detalle</summary>
              <div class="history-list" style="margin-top:12px">
                ${item.clientRows.map(row => `
                  <article class="provider-row">
                    <div class="provider-top">
                      <div>
                        <h3>${escapeHtml(row.name)}</h3>
                        <div class="tiny">Base ${eur(row.base)} · Mi ${eur(row.mine)} · Total ${eur(row.total)}</div>
                      </div>
                      <span class="status-pill ${statusClass(row.status)}">${row.status.toUpperCase()}</span>
                    </div>
                  </article>
                `).join('')}
              </div>
            </details>
          </article>
        `).join('') : '<div class="empty">Aún no hay historial guardado.</div>'}
      </div>
    </section>
  `;
}

function renderSettings() {
  const root = document.getElementById('view-settings');
  root.innerHTML = `
    <section class="card">
      <div class="section-title">
        <div>
          <h2>Ajustes</h2>
          <div class="subline">Modo día por defecto, % y unidad</div>
        </div>
      </div>
      <div class="field-grid cols-3">
        <div class="field">
          <label>Nombre app</label>
          <input class="input" id="settingsAppName" value="${escapeAttr(state.settings.appName)}" />
        </div>
        <div class="field">
          <label>% por defecto</label>
          <input class="input" id="settingsDefaultPct" type="number" step="0.01" value="${state.settings.defaultCommissionPct}" />
        </div>
        <div class="field">
          <label>Unidad por defecto</label>
          <select class="select" id="settingsDefaultUnit">
            ${UNITS.map(unit => `<option value="${unit}" ${unit === state.settings.defaultUnit ? 'selected' : ''}>${unit}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="toolbar" style="margin-top:12px">
        <button class="btn btn-accent" type="button" id="saveSettingsBtn">Guardar ajustes</button>
      </div>
    </section>
  `;

  root.querySelector('#saveSettingsBtn').addEventListener('click', () => {
    state.settings.appName = root.querySelector('#settingsAppName').value.trim() || 'ARSLAN PEDIDOS 15%';
    state.settings.defaultCommissionPct = Number(root.querySelector('#settingsDefaultPct').value || 15);
    state.settings.defaultUnit = root.querySelector('#settingsDefaultUnit').value || 'CAJA';
    saveState();
    alert('Ajustes guardados.');
  });
}

function addClient() {
  const name = document.getElementById('clientNameInput').value.trim();
  const phone = document.getElementById('clientPhoneInput').value.trim();
  const commissionPct = Number(document.getElementById('clientPctInput').value || state.settings.defaultCommissionPct);
  const notes = document.getElementById('clientNotesInput').value.trim();

  if (!name) return alert('Introduce un nombre de cliente.');
  const duplicate = state.clients.find(client => client.active !== false && client.name.toUpperCase() === name.toUpperCase());
  if (duplicate) return alert('Ese cliente ya existe.');

  const client = {
    id: makeId('client'),
    name,
    phone,
    commissionPct,
    notes,
    active: true,
    createdAt: Date.now()
  };
  state.clients.push(client);
  ensureOrder(client.id);
  ensurePayment(client.id);
  selectedClientId = client.id;

  document.getElementById('clientNameInput').value = '';
  document.getElementById('clientPhoneInput').value = '';
  document.getElementById('clientNotesInput').value = '';
  saveState();
  goTo('orders');
}

function removeClient(clientId) {
  const client = getClient(clientId);
  if (!client) return;
  if (!confirm(`¿Eliminar cliente ${client.name}?`)) return;
  client.active = false;
  delete state.orders[clientId];
  delete state.payments[clientId];
  if (selectedClientId === clientId) selectedClientId = getActiveClients()[0]?.id || null;
  saveState();
}

function addProductToCatalog(productName) {
  const normalized = normalizeName(productName);
  if (!normalized) return;
  const existing = state.products.find(product => product.name === normalized);
  if (existing) {
    existing.active = true;
  } else {
    state.products.push({ id: makeId('prod'), name: normalized, active: true });
  }
  saveState(false);
}

function addProductToOrder(clientId, productName) {
  if (!clientId) return alert('Selecciona un cliente.');
  const product = normalizeName(productName);
  const unit = state.settings.defaultUnit || 'CAJA';
  const lines = ensureOrder(clientId);
  const found = lines.find(line => normalizeName(line.product) === product && (line.unit || unit) === unit);
  if (found) {
    found.qty = round2(Number(found.qty || 0) + 1);
  } else {
    lines.push({ id: makeId('line'), product, qty: 1, unit, note: '' });
  }
  saveState();
}

function changeQty(clientId, lineId, delta) {
  const line = (state.orders[clientId] || []).find(item => item.id === lineId);
  if (!line) return;
  line.qty = clampMinZero(Number(line.qty || 0) + Number(delta || 0));
  if (line.qty === 0) {
    state.orders[clientId] = (state.orders[clientId] || []).filter(item => item.id !== lineId);
  }
  saveState();
}

function setQty(clientId, lineId, value) {
  const line = (state.orders[clientId] || []).find(item => item.id === lineId);
  if (!line) return;
  line.qty = clampMinZero(value);
  if (line.qty === 0) {
    state.orders[clientId] = (state.orders[clientId] || []).filter(item => item.id !== lineId);
  }
  saveState();
}

function setLineUnit(clientId, lineId, unit) {
  const lines = state.orders[clientId] || [];
  const line = lines.find(item => item.id === lineId);
  if (!line) return;
  line.unit = unit || state.settings.defaultUnit || 'CAJA';
  saveState();
}

function setLineNote(clientId, lineId, note) {
  const line = (state.orders[clientId] || []).find(item => item.id === lineId);
  if (!line) return;
  line.note = note;
  saveState();
}

function removeOrderLine(clientId, lineId) {
  if (!confirm('¿Eliminar esta línea?')) return;
  state.orders[clientId] = (state.orders[clientId] || []).filter(item => item.id !== lineId);
  saveState();
}

function clearClientOrder(clientId) {
  const client = getClient(clientId);
  if (!client) return;
  if (!confirm(`¿Vaciar pedido de ${client.name}?`)) return;
  state.orders[clientId] = [];
  saveState();
}

function loadLastOrder(clientId) {
  const client = getClient(clientId);
  if (!client) return;
  const last = getClientOrderFromHistory(clientId);
  if (!last || !last.length) return alert('No hay un pedido anterior guardado para este cliente.');
  if (!confirm(`Cargar el último pedido guardado de ${client.name}? Reemplazará el pedido actual.`)) return;
  state.orders[clientId] = last.map(line => ({
    id: makeId('line'),
    product: normalizeName(line.product),
    qty: round2(line.qty || 0),
    unit: line.unit || state.settings.defaultUnit || 'CAJA',
    note: line.note || ''
  }));
  saveState();
}

function setPaymentField(clientId, field, value) {
  const payment = ensurePayment(clientId);
  if (field === 'note') payment[field] = value;
  else payment[field] = clampMinZero(value);
  saveState();
}

function addQuickPaid(clientId, amount) {
  const payment = ensurePayment(clientId);
  payment.paid = round2(Number(payment.paid || 0) + Number(amount || 0));
  saveState();
}

function markPaidFull(clientId) {
  const payment = ensurePayment(clientId);
  payment.paid = computePayment(clientId).total;
  saveState();
}

function setAvailability(key, status) {
  state.availability[key] = status;
  saveState();
}

function setProviderTab(tab) {
  providerTab = tab;
  saveState();
}

function openClientOrders(clientId) {
  selectedClientId = clientId;
  goTo('orders');
}

function openClientPayments(clientId) {
  goTo('payments');
  setTimeout(() => {
    const name = getClient(clientId)?.name || '';
    const rows = [...document.querySelectorAll('.payment-row')];
    const found = rows.find(row => row.textContent.includes(name));
    found?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 70);
}

function buildProviderTotalText() {
  const sections = getProviderSections();
  const lines = sections.available.map(item => `${item.product} ${qtyFormat(item.qty)} ${item.unit}`);
  return `PEDIDO TOTAL PROVEEDOR ${niceDate(state.dayKey)}\n\n${lines.join('\n') || '- SIN PRODUCTOS -'}`;
}

function buildProviderByClientText() {
  const blocks = getActiveClients().map(client => {
    const lines = state.orders[client.id] || [];
    const textLines = lines.map(line => `- ${line.product} ${qtyFormat(line.qty)} ${line.unit || state.settings.defaultUnit}${line.note ? ` (${line.note})` : ''}`);
    return `${client.name}\n${textLines.join('\n') || '- SIN PEDIDO -'}`;
  });
  return `PEDIDO POR CLIENTE ${niceDate(state.dayKey)}\n\n${blocks.join('\n\n') || '- SIN CLIENTES -'}`;
}

function buildMissingExternalText() {
  const sections = getProviderSections();
  const items = [...sections.unavailable, ...sections.external];
  if (!items.length) return `FALTANTES / EXTERNOS ${niceDate(state.dayKey)}\n\nSIN PRODUCTOS MARCADOS.`;
  const blocks = items.map(item => {
    const clientLines = item.clients.map(row => `- ${row.clientName}: ${qtyFormat(row.qty)} ${item.unit}${row.note ? ` (${row.note})` : ''}`);
    return `${item.product} · ${statusLabel(item.status)}\nTOTAL: ${qtyFormat(item.qty)} ${item.unit}\n${clientLines.join('\n')}`;
  });
  return `FALTANTES / EXTERNOS ${niceDate(state.dayKey)}\n\n${blocks.join('\n\n')}`;
}

function buildClientOrderText(clientId) {
  const client = getClient(clientId);
  if (!client) return '';
  const lines = state.orders[clientId] || [];
  const calc = computePayment(clientId);
  const textLines = lines.map(line => `- ${line.product} ${qtyFormat(line.qty)} ${line.unit || state.settings.defaultUnit}${line.note ? ` (${line.note})` : ''}`);
  return `${client.name}\n${niceDate(state.dayKey)}\n\nPEDIDO:\n${textLines.join('\n') || '- SIN PEDIDO -'}\n\nBASE PROVEEDOR: ${eur(calc.base)}\nMI ${calc.pct}%: ${eur(calc.mine)}\nTOTAL A COBRAR: ${eur(calc.total)}\nPAGADO: ${eur(calc.paid)}\nPENDIENTE: ${eur(calc.pending)}`;
}

async function tryShare(title, text) {
  if (!navigator.share) return false;
  try {
    await navigator.share({ title, text });
    return true;
  } catch {
    return false;
  }
}

function openWhatsApp(text, phone = '') {
  const cleanPhone = String(phone || '').replace(/[^\d+]/g, '');
  const base = cleanPhone ? `https://wa.me/${cleanPhone}?text=` : 'https://wa.me/?text=';
  window.open(base + encodeURIComponent(text), '_blank');
}

async function shareProviderTotal() {
  const text = buildProviderTotalText();
  const shared = await tryShare('Pedido total proveedor', text);
  if (!shared) openWhatsApp(text);
}

async function shareProviderByClient() {
  const text = buildProviderByClientText();
  const shared = await tryShare('Pedido proveedor por cliente', text);
  if (!shared) openWhatsApp(text);
}

async function shareMissingExternal() {
  const text = buildMissingExternalText();
  const shared = await tryShare('Faltantes y externos', text);
  if (!shared) openWhatsApp(text);
}

async function shareClientOrder(clientId) {
  const client = getClient(clientId);
  if (!client) return;
  const text = buildClientOrderText(clientId);
  const shared = await tryShare(client.name, text);
  if (!shared) openWhatsApp(text, client.phone);
}

function copyText(text, message = 'Texto copiado.') {
  navigator.clipboard.writeText(text).then(() => alert(message)).catch(() => alert(text));
}

function copyProviderTotalText() {
  copyText(buildProviderTotalText());
}

function copyMissingText() {
  copyText(buildMissingExternalText());
}

function buildPrintShell(title, body) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<style>
body{font-family:Arial,sans-serif;color:#111;padding:28px}
h1,h2,h3{margin:0 0 8px}small{color:#555}.box{border:1px solid #ccc;border-radius:12px;padding:12px;margin:10px 0}.row{display:flex;justify-content:space-between;gap:12px}.table{width:100%;border-collapse:collapse;margin-top:10px}.table th,.table td{padding:8px;border:1px solid #ccc;text-align:left}.table th{background:#f5f5f5}.badge{display:inline-block;padding:4px 8px;border:1px solid #aaa;border-radius:999px;font-size:12px;margin-top:8px}@media print{button{display:none}body{padding:10px}}
</style>
</head>
<body>
<button onclick="window.print()">Imprimir / Guardar PDF</button>
${body}
</body>
</html>`;
}

function openPrintWindow(title, body) {
  const html = buildPrintShell(title, body);
  const win = window.open('', '_blank');
  if (!win) return alert('El navegador ha bloqueado la ventana emergente.');
  win.document.open();
  win.document.write(html);
  win.document.close();
}

function printProviderTotal() {
  const sections = getProviderSections();
  const rows = sections.available.map(item => `<tr><td>${escapeHtml(item.product)}</td><td>${qtyFormat(item.qty)}</td><td>${escapeHtml(item.unit)}</td></tr>`).join('');
  openPrintWindow('Proveedor total', `
    <h1>${escapeHtml(state.settings.appName)}</h1>
    <small>Pedido total proveedor · ${niceDate(state.dayKey)}</small>
    <table class="table">
      <thead><tr><th>Producto</th><th>Cantidad</th><th>Unidad</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3">Sin productos disponibles</td></tr>'}</tbody>
    </table>
  `);
}

function printProviderByClient() {
  const sections = getActiveClients().map(client => {
    const rows = (state.orders[client.id] || []).map(line => `
      <tr>
        <td>${escapeHtml(line.product)}</td>
        <td>${qtyFormat(line.qty)}</td>
        <td>${escapeHtml(line.unit || state.settings.defaultUnit)}</td>
        <td>${escapeHtml(line.note || '')}</td>
      </tr>
    `).join('');
    return `
      <h2>${escapeHtml(client.name)}</h2>
      <table class="table">
        <thead><tr><th>Producto</th><th>Cantidad</th><th>Unidad</th><th>Nota</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4">Sin pedido</td></tr>'}</tbody>
      </table>
    `;
  }).join('');
  openPrintWindow('Proveedor por cliente', `
    <h1>${escapeHtml(state.settings.appName)}</h1>
    <small>Detalle por cliente · ${niceDate(state.dayKey)}</small>
    ${sections || '<p>Sin clientes.</p>'}
  `);
}

function printMissingExternal() {
  const sections = getProviderSections();
  const items = [...sections.unavailable, ...sections.external];
  const blocks = items.map(item => `
    <h2>${escapeHtml(item.product)} <small>(${statusLabel(item.status)})</small></h2>
    <div class="box"><div class="row"><span>Total</span><strong>${qtyFormat(item.qty)} ${escapeHtml(item.unit)}</strong></div></div>
    <table class="table">
      <thead><tr><th>Cliente</th><th>Cantidad</th><th>Unidad</th><th>Nota</th></tr></thead>
      <tbody>
        ${item.clients.map(row => `
          <tr>
            <td>${escapeHtml(row.clientName)}</td>
            <td>${qtyFormat(row.qty)}</td>
            <td>${escapeHtml(item.unit)}</td>
            <td>${escapeHtml(row.note || '')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `).join('');
  openPrintWindow('Faltantes y externos', `
    <h1>${escapeHtml(state.settings.appName)}</h1>
    <small>Faltantes / Externos · ${niceDate(state.dayKey)}</small>
    ${blocks || '<p>Sin productos faltantes o externos.</p>'}
  `);
}

function printClientOrder(clientId) {
  const client = getClient(clientId);
  if (!client) return;
  const rows = (state.orders[clientId] || []).map(line => `
    <tr>
      <td>${escapeHtml(line.product)}</td>
      <td>${qtyFormat(line.qty)}</td>
      <td>${escapeHtml(line.unit || state.settings.defaultUnit)}</td>
      <td>${escapeHtml(line.note || '')}</td>
    </tr>
  `).join('');
  const calc = computePayment(clientId);
  openPrintWindow(client.name, `
    <h1>${escapeHtml(client.name)}</h1>
    <small>${niceDate(state.dayKey)}</small>
    <table class="table">
      <thead><tr><th>Producto</th><th>Cantidad</th><th>Unidad</th><th>Nota</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">Sin pedido</td></tr>'}</tbody>
    </table>
    <div class="box">
      <div class="row"><span>Base proveedor</span><strong>${eur(calc.base)}</strong></div>
      <div class="row"><span>Mi ${calc.pct}%</span><strong>${eur(calc.mine)}</strong></div>
      <div class="row"><span>Total cobrar</span><strong>${eur(calc.total)}</strong></div>
      <div class="row"><span>Pagado</span><strong>${eur(calc.paid)}</strong></div>
      <div class="row"><span>Pendiente</span><strong>${eur(calc.pending)}</strong></div>
      <div class="badge">${calc.status.toUpperCase()}</div>
    </div>
  `);
}

function printDailySummary() {
  const g = computeGlobal();
  const rows = getActiveClients().map(client => {
    const calc = computePayment(client.id);
    return `<tr><td>${escapeHtml(client.name)}</td><td>${eur(calc.base)}</td><td>${eur(calc.mine)}</td><td>${eur(calc.total)}</td><td>${eur(calc.paid)}</td><td>${eur(calc.pending)}</td><td>${calc.status}</td></tr>`;
  }).join('');
  openPrintWindow('Resumen diario', `
    <h1>${escapeHtml(state.settings.appName)}</h1>
    <small>Resumen diario · ${niceDate(state.dayKey)}</small>
    <div class="box">
      <div class="row"><span>Total proveedor</span><strong>${eur(g.totalProvider)}</strong></div>
      <div class="row"><span>Mi 15%</span><strong>${eur(g.totalMine)}</strong></div>
      <div class="row"><span>Total general</span><strong>${eur(g.totalGeneral)}</strong></div>
      <div class="row"><span>Cobrado</span><strong>${eur(g.totalPaid)}</strong></div>
      <div class="row"><span>Pendiente</span><strong>${eur(g.totalPending)}</strong></div>
    </div>
    <table class="table">
      <thead><tr><th>Cliente</th><th>Base</th><th>Mi %</th><th>Total</th><th>Pagado</th><th>Pendiente</th><th>Estado</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7">Sin datos</td></tr>'}</tbody>
    </table>
  `);
}

function buildHistorySnapshot() {
  const g = computeGlobal();
  const providerSections = getProviderSections();
  return {
    id: makeId('hist'),
    dayKey: state.dayKey,
    totals: {
      totalProvider: g.totalProvider,
      totalMine: g.totalMine,
      totalGeneral: g.totalGeneral,
      totalPaid: g.totalPaid,
      totalPending: g.totalPending
    },
    totalClients: getActiveClients().length,
    totalProductGroups: providerSections.all.length,
    clientRows: getActiveClients().map(client => ({ name: client.name, ...computePayment(client.id) })),
    ordersByClient: getActiveClients().map(client => ({
      clientId: client.id,
      clientName: client.name,
      lines: (state.orders[client.id] || []).map(line => ({
        product: line.product,
        qty: line.qty,
        unit: line.unit || state.settings.defaultUnit,
        note: line.note || ''
      }))
    })),
    createdAt: Date.now()
  };
}

function clearDay() {
  if (!confirm('Se guardará un resumen en historial y se limpiará el día actual. ¿Continuar?')) return;
  state.history.unshift(buildHistorySnapshot());
  state.orders = {};
  state.payments = {};
  state.availability = {};
  state.dayKey = todayStr();
  saveState();
  goTo('dashboard');
  alert('Día limpiado y guardado en historial.');
}

function exportBackup() {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = `arslan-pedidos-15-backup-${state.dayKey}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const normalized = normalizeState(parsed);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      location.reload();
    } catch {
      alert('El archivo no es un backup válido.');
    }
  };
  reader.readAsText(file);
}

function setupGlobalEvents() {
  document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => goTo(btn.dataset.view)));
  document.getElementById('themeToggleBtn').addEventListener('click', () => {
    applyTheme(state.settings.theme === 'dark' ? 'light' : 'dark');
    saveState(false);
  });
  document.getElementById('backupBtn').addEventListener('click', exportBackup);
  document.getElementById('restoreBtn').addEventListener('click', () => document.getElementById('restoreInput').click());
  document.getElementById('restoreInput').addEventListener('change', event => {
    if (event.target.files[0]) importBackup(event.target.files[0]);
    event.target.value = '';
  });
  document.getElementById('clearDayTopBtn').addEventListener('click', clearDay);
}

window.goTo = goTo;
window.openClientOrders = openClientOrders;
window.openClientPayments = openClientPayments;
window.removeClient = removeClient;
window.loadLastOrder = loadLastOrder;
window.changeQty = changeQty;
window.setQty = setQty;
window.setLineUnit = setLineUnit;
window.setLineNote = setLineNote;
window.removeOrderLine = removeOrderLine;
window.clearClientOrder = clearClientOrder;
window.setPaymentField = setPaymentField;
window.addQuickPaid = addQuickPaid;
window.markPaidFull = markPaidFull;
window.setAvailability = setAvailability;
window.setProviderTab = setProviderTab;
window.shareProviderTotal = shareProviderTotal;
window.shareProviderByClient = shareProviderByClient;
window.shareMissingExternal = shareMissingExternal;
window.shareClientOrder = shareClientOrder;
window.copyProviderTotalText = copyProviderTotalText;
window.copyMissingText = copyMissingText;
window.printProviderTotal = printProviderTotal;
window.printProviderByClient = printProviderByClient;
window.printMissingExternal = printMissingExternal;
window.printClientOrder = printClientOrder;
window.printDailySummary = printDailySummary;
window.clearDay = clearDay;

setupGlobalEvents();
renderAll();
