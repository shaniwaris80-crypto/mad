const STORAGE_KEY = 'pedidos_madrid_v4';
const DEFAULT_PRODUCTS = [
  'MACHO MADURO','MACHO VERDE','BONIATO','AGUACATE PREMIUM','AGUACATE GRANEL','AVOCADO','YUCA','BANANA',
  'GUINEO ECUATORIAL','JENGIBRE','ALOE VERA','AJO','CEBOLLA NORMAL','CEBOLLA ROJA','PATATA','KIWI','GUINDILLA',
  'PLATANO CANARIO','PLATANO CANARIO PLUS','MANGO','COCO','CILANTRO','LIMA','LIMON','CALABAZA','JALAPEÑO',
  'NARANJA','MANZANA','MANDARINA','TOMATE','TOMATE PREMIUM','PAPAYA','JUDIA','CHAYOTE','OKRA'
];
const UNITS = ['CAJA','UD','MANOJO'];
const PROVIDER_TABS = ['total','clientes','faltantes'];

const state = loadState();
let currentView = 'dashboard';
let selectedClientId = state.ui.selectedClientId || null;
let providerTab = state.ui.providerTab || 'total';

function makeId(prefix='id'){ return `${prefix}_${Math.random().toString(36).slice(2,9)}${Date.now().toString(36).slice(-4)}`; }
function todayStr(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function niceDate(dateStr){ const d=dateStr?new Date(`${dateStr}T00:00:00`):new Date(); return d.toLocaleDateString('es-ES',{day:'2-digit',month:'2-digit',year:'numeric'}); }
function round2(v){ return Math.round((Number(v||0)+Number.EPSILON)*100)/100; }
function clampMinZero(v){ return Math.max(0, round2(v)); }
function eur(v){ return Number(v||0).toLocaleString('es-ES',{style:'currency',currency:'EUR'}); }
function qtyFormat(v){ return Number(v||0).toLocaleString('es-ES',{minimumFractionDigits:0,maximumFractionDigits:2}); }
function escapeHtml(v=''){ return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
function escapeAttr(v=''){ return escapeHtml(v).replace(/`/g,'&#096;'); }
function normalizeName(v){ return String(v||'').trim().replace(/\s+/g,' ').toUpperCase(); }
function lineKey(product, unit){ return `${normalizeName(product)}__${String(unit||'CAJA').toUpperCase()}`; }

function parseDecimalInput(raw){
  let s = String(raw ?? '').trim();
  if(!s) return 0;
  s = s.replace(/\s+/g,'');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if(lastComma > -1 && lastDot > -1){
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const otherSep = decimalSep === ',' ? /\./g : /,/g;
    s = s.replace(otherSep,'');
    if(decimalSep === ',') s = s.replace(',', '.');
  } else {
    s = s.replace(',', '.');
  }
  s = s.replace(/[^0-9.-]/g,'');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function formatInputNumber(v){
  const n = Number(v || 0);
  if(!n) return '';
  return String(round2(n)).replace('.', ',');
}

function loadState(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(!raw) return normalizeState({});
  try { return normalizeState(JSON.parse(raw)); }
  catch { return normalizeState({}); }
}

function normalizeState(input){
  const s = input || {};
  return {
    dayKey: s.dayKey || todayStr(),
    settings: {
      appName: s.settings?.appName || 'PEDIDOS MADRID',
      defaultCommissionPct: Number(s.settings?.defaultCommissionPct ?? 15),
      defaultUnit: s.settings?.defaultUnit || 'CAJA',
      theme: s.settings?.theme || 'light'
    },
    products: Array.isArray(s.products) && s.products.length ? s.products : DEFAULT_PRODUCTS.map(name => ({id:makeId('prod'), name, active:true})),
    clients: Array.isArray(s.clients) ? s.clients : [],
    orders: s.orders && typeof s.orders === 'object' ? s.orders : {},
    payments: s.payments && typeof s.payments === 'object' ? s.payments : {},
    providerStatus: s.providerStatus && typeof s.providerStatus === 'object' ? s.providerStatus : {},
    history: Array.isArray(s.history) ? s.history : [],
    ui: { selectedClientId: s.ui?.selectedClientId || null, providerTab: s.ui?.providerTab || 'total' }
  };
}

function saveState(render=true){
  state.ui.selectedClientId = selectedClientId;
  state.ui.providerTab = providerTab;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if(render) renderAll();
}

function applyTheme(){
  document.body.classList.toggle('dark', state.settings.theme === 'dark');
  document.getElementById('themeToggleBtn').textContent = state.settings.theme === 'dark' ? 'Modo día' : 'Modo nocturno';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', state.settings.theme === 'dark' ? '#171a21' : '#f6f7fb');
}

function activeClients(){ return state.clients.filter(c => c.active !== false); }
function activeProducts(){ return state.products.filter(p => p.active !== false).sort((a,b)=>a.name.localeCompare(b.name,'es')); }
function getClient(id){ return state.clients.find(c => c.id === id) || null; }
function ensureOrder(clientId){ if(!state.orders[clientId]) state.orders[clientId] = []; return state.orders[clientId]; }
function ensurePayment(clientId){
  if(!state.payments[clientId]){
    const client = getClient(clientId);
    state.payments[clientId] = { base:0, commissionPct:Number(client?.commissionPct ?? state.settings.defaultCommissionPct), paid:0, note:'' };
  }
  return state.payments[clientId];
}

function computePayment(clientId){
  const payment = ensurePayment(clientId);
  const base = round2(payment.base || 0);
  const pct = Number(payment.commissionPct || 0);
  const mine = round2(base * pct / 100);
  const total = round2(base + mine);
  const paid = round2(payment.paid || 0);
  const pending = clampMinZero(total - paid);
  let status = 'pendiente';
  if(total === 0 && paid === 0) status = 'sin importe';
  else if(pending === 0 && total > 0) status = 'pagado';
  else if(paid > 0 && pending > 0) status = 'parcial';
  return { base, pct, mine, total, paid, pending, status };
}

function orderStats(clientId){
  const lines = state.orders[clientId] || [];
  return { totalLines: lines.length, totalQty: round2(lines.reduce((a,l)=>a+Number(l.qty||0),0)) };
}

function computeGlobal(){
  const ids = activeClients().map(c => c.id);
  let totalProvider=0, totalMine=0, totalGeneral=0, totalPaid=0, totalPending=0, totalQty=0, activeCount=0;
  ids.forEach(id => {
    const o = orderStats(id);
    totalQty += o.totalQty;
    if(o.totalLines || Number(state.payments[id]?.base || 0) > 0) activeCount++;
    const p = computePayment(id);
    totalProvider += p.base; totalMine += p.mine; totalGeneral += p.total; totalPaid += p.paid; totalPending += p.pending;
  });
  const topClients = activeClients().map(client => ({ client, ...computePayment(client.id) })).sort((a,b)=>b.base-a.base).slice(0,3);
  return { totalProvider:round2(totalProvider), totalMine:round2(totalMine), totalGeneral:round2(totalGeneral), totalPaid:round2(totalPaid), totalPending:round2(totalPending), totalQty:round2(totalQty), activeCount, topClients };
}

function providerGroups(){
  const map = new Map();
  activeClients().forEach(client => {
    (state.orders[client.id] || []).forEach(line => {
      const unit = (line.unit || state.settings.defaultUnit).toUpperCase();
      const key = lineKey(line.product, unit);
      const current = map.get(key) || { key, product: normalizeName(line.product), unit, qty:0, clients:[], status: state.providerStatus[key] || 'available' };
      current.qty = round2(current.qty + Number(line.qty || 0));
      current.clients.push({ clientId: client.id, clientName: client.name, qty: round2(Number(line.qty || 0)), note: line.note || '' });
      current.status = state.providerStatus[key] || 'available';
      map.set(key, current);
    });
  });
  const all = [...map.values()].sort((a,b)=>a.product.localeCompare(b.product,'es') || a.unit.localeCompare(b.unit,'es'));
  return {
    all,
    total: all.filter(i => i.status === 'available'),
    unavailable: all.filter(i => i.status === 'unavailable'),
    external: all.filter(i => i.status === 'external')
  };
}

function shareText(text, title='Compartir'){
  if(navigator.share){ navigator.share({ title, text }).catch(()=>{}); return; }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}

function copyText(text){ navigator.clipboard?.writeText(text).then(()=>alert('Texto copiado.')).catch(()=>alert(text)); }

function goTo(view){
  currentView = view;
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  if(view === 'orders' && !selectedClientId && activeClients()[0]) selectedClientId = activeClients()[0].id;
  renderAll();
}

function renderAll(){
  applyTheme();
  document.getElementById('appTitle').textContent = state.settings.appName || 'PEDIDOS MADRID';
  renderDashboard();
  renderClients();
  renderOrders();
  renderProvider();
  renderPayments();
  renderMore();
}

function renderDashboard(){
  const root = document.getElementById('view-dashboard');
  const g = computeGlobal();
  root.innerHTML = `
    <section class="stats-grid">
      ${[
        ['Total proveedor', eur(g.totalProvider), 'Lo que tienes que reunir'],
        ['Mi comisión', eur(g.totalMine), 'Tu parte total'],
        ['Total cobrar', eur(g.totalGeneral), 'Proveedor + tu comisión'],
        ['Cobrado', eur(g.totalPaid), 'Ya recibido'],
        ['Pendiente', eur(g.totalPending), `${g.activeCount} clientes activos · ${qtyFormat(g.totalQty)} uds`]
      ].map(item => `<article class="stat-card"><div class="label">${item[0]}</div><div class="value">${item[1]}</div><div class="sub">${item[2]}</div></article>`).join('')}
    </section>

    <section class="grid-2" style="margin-top:12px">
      <article class="card">
        <div class="section-title"><div><h2>Resumen de hoy</h2><div class="subline">${niceDate(state.dayKey)}</div></div></div>
        <div class="mini-grid">
          <article class="mini-box"><div class="label">Proveedor</div><div class="value">${eur(g.totalProvider)}</div></article>
          <article class="mini-box"><div class="label">Mi comisión</div><div class="value">${eur(g.totalMine)}</div></article>
          <article class="mini-box"><div class="label">Total</div><div class="value">${eur(g.totalGeneral)}</div></article>
        </div>
        <div class="toolbar" style="margin-top:12px">
          <button class="btn btn-accent" type="button" data-goto="orders">Ir a pedidos</button>
          <button class="btn btn-sky" type="button" data-goto="provider">Ver proveedor</button>
          <button class="btn btn-soft" type="button" id="shareProviderBtn">WhatsApp proveedor</button>
        </div>
      </article>
      <article class="card">
        <div class="section-title"><div><h2>Top clientes</h2><div class="subline">Ordenados por base proveedor</div></div></div>
        <div class="history-list">
          ${g.topClients.length ? g.topClients.map((item, i) => `<article class="history-card"><div class="history-top"><div><h3>${i+1}. ${escapeHtml(item.client.name)}</h3><div class="tiny">Base ${eur(item.base)} · Mi ${eur(item.mine)} · Total ${eur(item.total)}</div></div><span class="status-pill ${statusClass(item.status)}">${item.status.toUpperCase()}</span></div></article>`).join('') : '<div class="empty">Todavía no hay importes base.</div>'}
        </div>
      </article>
    </section>
  `;
}

function renderClients(){
  const root = document.getElementById('view-clients');
  root.innerHTML = `
    <section class="editor-card">
      <div class="section-title"><div><h2>Clientes</h2><div class="subline">Añadir y gestionar clientes</div></div></div>
      <div class="field-grid cols-3">
        <div class="field"><label>Nombre</label><input class="input" id="newClientName" placeholder="Ej. Adnan" /></div>
        <div class="field"><label>Teléfono</label><input class="input" id="newClientPhone" placeholder="WhatsApp opcional" /></div>
        <div class="field"><label>% comisión</label><input class="input" id="newClientPct" value="${formatInputNumber(state.settings.defaultCommissionPct)}" inputmode="decimal" /></div>
      </div>
      <div class="field" style="margin-top:12px"><label>Notas</label><input class="input" id="newClientNotes" placeholder="Opcional" /></div>
      <div class="toolbar" style="margin-top:12px"><button class="btn btn-accent" type="button" id="addClientBtn">Añadir cliente</button></div>
    </section>
    <section class="card" style="margin-top:12px">
      <div class="section-title"><div><h2>Lista de clientes</h2><div class="subline">Pedidos y cobros por cliente</div></div></div>
      <div class="client-list">
        ${activeClients().length ? activeClients().sort((a,b)=>a.name.localeCompare(b.name,'es')).map(client => {
          const stats = orderStats(client.id); const pay = computePayment(client.id);
          return `<article class="client-card"><div class="client-top"><div><h3>${escapeHtml(client.name)}</h3><div class="tiny">${escapeHtml(client.phone || 'Sin teléfono')} · ${client.commissionPct ?? state.settings.defaultCommissionPct}%</div></div><span class="status-pill ${statusClass(pay.status)}">${pay.status.toUpperCase()}</span></div><div class="tiny-actions" style="margin-top:10px"><span class="badge">${stats.totalLines} líneas</span><span class="badge">${qtyFormat(stats.totalQty)} uds</span><span class="badge">Base ${eur(pay.base)}</span><span class="badge">Pendiente ${eur(pay.pending)}</span></div><div class="toolbar" style="margin-top:12px"><button class="btn btn-soft btn-xs" type="button" data-open-orders="${client.id}">Abrir pedido</button><button class="btn btn-soft btn-xs" type="button" data-open-payments="${client.id}">Cobro</button><button class="btn btn-warn btn-xs" type="button" data-share-client="${client.id}">WhatsApp</button><button class="btn btn-danger btn-xs" type="button" data-remove-client="${client.id}">Eliminar</button></div></article>`;
        }).join('') : '<div class="empty">No hay clientes todavía.</div>'}
      </div>
    </section>
  `;
}

function renderOrders(){
  const root = document.getElementById('view-orders');
  const clients = activeClients().sort((a,b)=>a.name.localeCompare(b.name,'es'));
  const selected = selectedClientId ? getClient(selectedClientId) : clients[0] || null;
  if(selected && !selectedClientId) selectedClientId = selected.id;
  const lines = selected ? (state.orders[selected.id] || []) : [];
  root.innerHTML = `
    <section class="editor-card">
      <div class="section-title"><div><h2>Pedidos</h2><div class="subline">Cantidad manual fluida, con decimales y sin saltos</div></div></div>
      ${clients.length ? `
        <div class="field-grid cols-2">
          <div class="field"><label>Cliente</label><select class="select" id="orderClientSelect">${clients.map(c => `<option value="${c.id}" ${selected?.id===c.id?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Buscar producto</label><input class="input" id="productSearchInput" placeholder="Buscar producto" /></div>
        </div>
        <div class="quick-add">
          <input class="input" id="manualProductInput" placeholder="Producto manual" />
          <input class="input qty" id="quickQtyInput" inputmode="decimal" value="1" />
          <select class="select" id="quickUnitSelect">${UNITS.map(u => `<option value="${u}" ${u===state.settings.defaultUnit?'selected':''}>${u}</option>`).join('')}</select>
        </div>
        <div class="tiny" style="margin-top:8px">Toca un producto para añadir la cantidad indicada arriba. Usa coma o punto para decimales.</div>
      ` : '<div class="empty">Añade un cliente primero.</div>'}
    </section>

    ${selected ? `
      <section class="order-layout" style="margin-top:12px">
        <article class="card product-browser">
          <div class="section-title"><div><h2>Diccionario</h2><div class="subline">Productos disponibles</div></div></div>
          <div class="product-grid" id="productGrid">${activeProducts().map(p => `<button class="product-btn" type="button" data-add-product="${escapeAttr(p.name)}"><span>${escapeHtml(p.name)}</span><strong>Añadir</strong></button>`).join('')}</div>
        </article>
        <article class="card">
          <div class="section-title"><div><h2>${escapeHtml(selected.name)}</h2><div class="subline">${orderStats(selected.id).totalLines} líneas · ${qtyFormat(orderStats(selected.id).totalQty)} uds</div></div><div class="toolbar"><button class="btn btn-warn btn-xs" type="button" data-share-client="${selected.id}">WhatsApp</button><button class="btn btn-danger btn-xs" type="button" data-clear-order="${selected.id}">Vaciar</button></div></div>
          <div class="order-lines">
            ${lines.length ? lines.map(line => `<article class="order-line"><div class="line-top"><div><strong>${escapeHtml(line.product)}</strong><div class="tiny">Edita y guarda al salir del campo o con Enter</div></div><button class="btn btn-danger btn-xs" type="button" data-remove-line="${selected.id}|${line.id}">Eliminar</button></div><div class="qty-wrap" style="margin-top:10px"><button class="qty-btn" type="button" data-bump-line="${selected.id}|${line.id}|-1">−</button><button class="qty-btn" type="button" data-bump-line="${selected.id}|${line.id}|1">+</button></div><div class="line-grid"><div class="field"><label>Cantidad</label><input class="input qty js-line-qty" inputmode="decimal" data-client-id="${selected.id}" data-line-id="${line.id}" value="${formatInputNumber(line.qty)}" /></div><div class="field"><label>Unidad</label><select class="select compact js-line-unit" data-client-id="${selected.id}" data-line-id="${line.id}">${UNITS.map(u => `<option value="${u}" ${u===(line.unit||state.settings.defaultUnit)?'selected':''}>${u}</option>`).join('')}</select></div><div class="field"><label>Nota</label><input class="input compact js-line-note" data-client-id="${selected.id}" data-line-id="${line.id}" value="${escapeAttr(line.note||'')}" placeholder="Opcional" /></div></div></article>`).join('') : '<div class="empty">Sin pedido todavía. Añade productos desde la izquierda.</div>'}
          </div>
        </article>
      </section>
    ` : ''}
  `;
}

function renderProvider(){
  const root = document.getElementById('view-provider');
  const groups = providerGroups();
  root.innerHTML = `
    <section class="card">
      <div class="section-title"><div><h2>Proveedor</h2><div class="subline">Total, detalle por cliente y faltantes</div></div><div class="toolbar"><button class="btn btn-soft btn-xs" type="button" id="shareProviderTotalBtn">WhatsApp total</button><button class="btn btn-soft btn-xs" type="button" id="copyProviderTotalBtn">Copiar</button></div></div>
      <div class="tabs-row">${[{id:'total',label:'Total proveedor'},{id:'clientes',label:'Por cliente'},{id:'faltantes',label:'Faltantes / externos'}].map(tab => `<button class="tab-btn ${providerTab===tab.id?'active':''}" type="button" data-provider-tab="${tab.id}">${tab.label}</button>`).join('')}</div>
      ${providerTab === 'total' ? renderProviderTotal(groups) : providerTab === 'clientes' ? renderProviderClients() : renderProviderMissing(groups)}
    </section>
  `;
}

function renderProviderTotal(groups){
  return groups.all.length ? `<div class="provider-list">${groups.all.map(item => `<article class="provider-row"><div class="provider-top"><div><h3>${escapeHtml(item.product)}</h3><div class="tiny">Total ${qtyFormat(item.qty)} ${escapeHtml(item.unit)}</div></div><span class="status-pill ${statusClass(item.status)}">${statusLabel(item.status)}</span></div><div class="toolbar" style="margin-top:12px"><button class="btn btn-soft btn-xs" type="button" data-provider-status="${item.key}|available">Disponible</button><button class="btn btn-soft btn-xs" type="button" data-provider-status="${item.key}|unavailable">No tiene</button><button class="btn btn-soft btn-xs" type="button" data-provider-status="${item.key}|external">Externo</button></div><div class="table-wrap" style="margin-top:10px"><table class="table"><thead><tr><th>Cliente</th><th>Cantidad</th><th>Unidad</th><th>Nota</th></tr></thead><tbody>${item.clients.map(c => `<tr><td>${escapeHtml(c.clientName)}</td><td>${qtyFormat(c.qty)}</td><td>${escapeHtml(item.unit)}</td><td>${escapeHtml(c.note||'')}</td></tr>`).join('')}</tbody></table></div></article>`).join('')}</div>` : '<div class="empty">No hay productos acumulados.</div>';
}

function renderProviderClients(){
  return activeClients().length ? `<div class="provider-list">${activeClients().map(client => { const lines = state.orders[client.id] || []; return `<article class="provider-row"><div class="provider-top"><div><h3>${escapeHtml(client.name)}</h3><div class="tiny">${lines.length} líneas</div></div><button class="btn btn-warn btn-xs" type="button" data-share-client="${client.id}">WhatsApp</button></div>${lines.length ? `<div class="table-wrap" style="margin-top:10px"><table class="table"><thead><tr><th>Producto</th><th>Cantidad</th><th>Unidad</th><th>Nota</th></tr></thead><tbody>${lines.map(line => `<tr><td>${escapeHtml(line.product)}</td><td>${qtyFormat(line.qty)}</td><td>${escapeHtml(line.unit||state.settings.defaultUnit)}</td><td>${escapeHtml(line.note||'')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty" style="margin-top:10px">Sin pedido</div>'}</article>`; }).join('')}</div>` : '<div class="empty">No hay clientes todavía.</div>';
}

function renderProviderMissing(groups){
  const combined = [...groups.unavailable, ...groups.external];
  return combined.length ? `<div class="provider-list">${combined.map(item => `<article class="provider-row"><div class="provider-top"><div><h3>${escapeHtml(item.product)}</h3><div class="tiny">Total ${qtyFormat(item.qty)} ${escapeHtml(item.unit)}</div></div><span class="status-pill ${statusClass(item.status)}">${statusLabel(item.status)}</span></div><div class="table-wrap" style="margin-top:10px"><table class="table"><thead><tr><th>Cliente</th><th>Cantidad</th><th>Unidad</th><th>Nota</th></tr></thead><tbody>${item.clients.map(c => `<tr><td>${escapeHtml(c.clientName)}</td><td>${qtyFormat(c.qty)}</td><td>${escapeHtml(item.unit)}</td><td>${escapeHtml(c.note||'')}</td></tr>`).join('')}</tbody></table></div></article>`).join('')}</div>` : '<div class="empty">Todavía no hay faltantes ni externos.</div>';
}

function renderPayments(){
  const root = document.getElementById('view-payments');
  const g = computeGlobal();
  root.innerHTML = `
    <section class="card">
      <div class="section-title"><div><h2>Cobros</h2><div class="subline">Escribe tranquilo: se guarda al salir del campo o con Enter</div></div></div>
      <div class="mini-grid"><article class="mini-box"><div class="label">Proveedor</div><div class="value">${eur(g.totalProvider)}</div></article><article class="mini-box"><div class="label">Mi comisión</div><div class="value">${eur(g.totalMine)}</div></article><article class="mini-box"><div class="label">Total</div><div class="value">${eur(g.totalGeneral)}</div></article></div>
    </section>
    <section class="card" style="margin-top:12px"><div class="section-title"><div><h2>Detalle de cobros</h2><div class="subline">Base proveedor, comisión, total y pendiente</div></div></div><div class="payment-list">${activeClients().length ? activeClients().map(client => { const payment=ensurePayment(client.id); const calc=computePayment(client.id); const stats=orderStats(client.id); return `<article class="payment-row"><div class="payment-top"><div><h3>${escapeHtml(client.name)}</h3><div class="tiny">${stats.totalLines} líneas · ${qtyFormat(stats.totalQty)} uds</div></div><span class="status-pill ${statusClass(calc.status)}">${calc.status.toUpperCase()}</span></div><div class="field-grid cols-3" style="margin-top:12px"><div class="field"><label>Base proveedor</label><input class="input js-payment-field" inputmode="decimal" data-client-id="${client.id}" data-field="base" value="${formatInputNumber(payment.base)}" /></div><div class="field"><label>% comisión</label><input class="input js-payment-field" inputmode="decimal" data-client-id="${client.id}" data-field="commissionPct" value="${formatInputNumber(payment.commissionPct)}" /></div><div class="field"><label>Pagado</label><input class="input js-payment-field" inputmode="decimal" data-client-id="${client.id}" data-field="paid" value="${formatInputNumber(payment.paid)}" /></div></div><div class="field" style="margin-top:12px"><label>Nota</label><input class="input js-payment-note" data-client-id="${client.id}" value="${escapeAttr(payment.note||'')}" /></div><div class="mini-grid" style="margin-top:12px"><article class="mini-box"><div class="label">Mi comisión</div><div class="value">${eur(calc.mine)}</div></article><article class="mini-box"><div class="label">Total cobrar</div><div class="value">${eur(calc.total)}</div></article><article class="mini-box"><div class="label">Pendiente</div><div class="value">${eur(calc.pending)}</div></article></div><div class="toolbar" style="margin-top:12px"><button class="btn btn-soft btn-xs" type="button" data-quick-paid="${client.id}|50">+50</button><button class="btn btn-soft btn-xs" type="button" data-quick-paid="${client.id}|100">+100</button><button class="btn btn-soft btn-xs" type="button" data-quick-paid="${client.id}|200">+200</button><button class="btn btn-soft btn-xs" type="button" data-mark-paid="${client.id}">Marcar pagado</button><button class="btn btn-warn btn-xs" type="button" data-share-client="${client.id}">WhatsApp</button></div></article>`; }).join('') : '<div class="empty">No hay clientes todavía.</div>'}</div></section>
  `;
}

function renderMore(){
  const root = document.getElementById('view-more');
  root.innerHTML = `
    <section class="grid-2">
      <article class="editor-card">
        <div class="section-title"><div><h2>Ajustes</h2><div class="subline">Nombre de la app y valores por defecto</div></div></div>
        <div class="field-grid cols-2">
          <div class="field"><label>Nombre app</label><input class="input" id="settingsAppName" value="${escapeAttr(state.settings.appName)}" /></div>
          <div class="field"><label>% comisión por defecto</label><input class="input" id="settingsDefaultPct" inputmode="decimal" value="${formatInputNumber(state.settings.defaultCommissionPct)}" /></div>
        </div>
        <div class="field" style="margin-top:12px"><label>Unidad por defecto</label><select class="select" id="settingsDefaultUnit">${UNITS.map(u => `<option value="${u}" ${u===state.settings.defaultUnit?'selected':''}>${u}</option>`).join('')}</select></div>
        <div class="toolbar" style="margin-top:12px"><button class="btn btn-accent" type="button" id="saveSettingsBtn">Guardar ajustes</button></div>
      </article>
      <article class="editor-card">
        <div class="section-title"><div><h2>Historial y limpieza</h2><div class="subline">Guarda un resumen antes de limpiar el día</div></div></div>
        <div class="toolbar"><button class="btn btn-soft" type="button" id="printSummaryBtn">PDF resumen</button><button class="btn btn-soft" type="button" id="copyMissingBtn">Copiar faltantes</button><button class="btn btn-danger" type="button" id="clearDayBtn">Limpiar día</button></div>
        <div class="history-list" style="margin-top:12px">${state.history.length ? [...state.history].sort((a,b)=>(b.dayKey||'').localeCompare(a.dayKey||'')).map(item => `<article class="history-card"><div class="history-top"><div><h3>${niceDate(item.dayKey)}</h3><div class="tiny">${item.totalClients} clientes · ${item.totalProductGroups} grupos</div></div><span class="status-pill status-ok">${eur(item.totals.totalGeneral)}</span></div><div class="mini-grid" style="margin-top:12px"><article class="mini-box"><div class="label">Proveedor</div><div class="value">${eur(item.totals.totalProvider)}</div></article><article class="mini-box"><div class="label">Mi comisión</div><div class="value">${eur(item.totals.totalMine)}</div></article><article class="mini-box"><div class="label">Pendiente</div><div class="value">${eur(item.totals.totalPending)}</div></article></div></article>`).join('') : '<div class="empty">Aún no hay historial guardado.</div>'}</div>
      </article>
    </section>
  `;
}

function statusLabel(status){ if(status==='unavailable') return 'NO TIENE'; if(status==='external') return 'EXTERNO'; return 'DISPONIBLE'; }
function statusClass(status){ if(status==='pagado'||status==='available') return 'status-ok'; if(status==='parcial'||status==='external') return 'status-warn'; if(status==='pendiente'||status==='unavailable') return 'status-danger'; return 'status-neutral'; }

function addClient(){
  const name = document.getElementById('newClientName').value.trim();
  const phone = document.getElementById('newClientPhone').value.trim();
  const commissionPct = parseDecimalInput(document.getElementById('newClientPct').value || state.settings.defaultCommissionPct);
  const notes = document.getElementById('newClientNotes').value.trim();
  if(!name) return alert('Introduce un nombre.');
  if(state.clients.some(c => c.active !== false && c.name.toUpperCase() === name.toUpperCase())) return alert('Ese cliente ya existe.');
  const client = { id:makeId('client'), name, phone, commissionPct: commissionPct || state.settings.defaultCommissionPct, notes, active:true };
  state.clients.push(client); ensureOrder(client.id); ensurePayment(client.id); selectedClientId = client.id;
  saveState(); goTo('orders');
}

function removeClient(clientId){
  const client = getClient(clientId); if(!client) return;
  if(!confirm(`Eliminar cliente ${client.name}?`)) return;
  client.active = false; delete state.orders[clientId]; delete state.payments[clientId];
  if(selectedClientId === clientId) selectedClientId = activeClients()[0]?.id || null;
  saveState();
}

function addProductToCatalog(name){
  const normalized = normalizeName(name); if(!normalized) return;
  const existing = state.products.find(p => p.name === normalized);
  if(existing) existing.active = true;
  else state.products.push({ id:makeId('prod'), name:normalized, active:true });
}

function addOrderLine(clientId, product, qty, unit){
  const lines = ensureOrder(clientId);
  const normalizedProduct = normalizeName(product);
  const normalizedUnit = String(unit || state.settings.defaultUnit).toUpperCase();
  const existing = lines.find(line => normalizeName(line.product) === normalizedProduct && String(line.unit || state.settings.defaultUnit).toUpperCase() === normalizedUnit);
  if(existing) existing.qty = round2(Number(existing.qty || 0) + Number(qty || 0));
  else lines.push({ id:makeId('line'), product: normalizedProduct, qty: round2(Number(qty || 0)), unit: normalizedUnit, note:'' });
}

function handleQuickAdd(productName){
  if(!selectedClientId) return alert('Selecciona un cliente.');
  const qty = parseDecimalInput(document.getElementById('quickQtyInput')?.value || '1');
  const unit = document.getElementById('quickUnitSelect')?.value || state.settings.defaultUnit;
  if(qty <= 0) return alert('La cantidad debe ser mayor que 0.');
  const manualName = document.getElementById('manualProductInput')?.value.trim();
  const product = normalizeName(productName || manualName);
  if(!product) return alert('Introduce o selecciona un producto.');
  addProductToCatalog(product);
  addOrderLine(selectedClientId, product, qty, unit);
  const manualInput = document.getElementById('manualProductInput'); if(manualInput) manualInput.value = '';
  saveState();
}

function bumpLine(clientId, lineId, delta){
  const line = (state.orders[clientId] || []).find(l => l.id === lineId); if(!line) return;
  line.qty = clampMinZero(Number(line.qty || 0) + Number(delta || 0));
  if(line.qty <= 0) state.orders[clientId] = (state.orders[clientId] || []).filter(l => l.id !== lineId);
  saveState();
}

function commitLineQty(input){
  const { clientId, lineId } = input.dataset;
  const line = (state.orders[clientId] || []).find(l => l.id === lineId); if(!line) return;
  const qty = clampMinZero(parseDecimalInput(input.value));
  if(qty <= 0){ state.orders[clientId] = (state.orders[clientId] || []).filter(l => l.id !== lineId); }
  else line.qty = qty;
  saveState();
}

function commitLineUnit(select){
  const { clientId, lineId } = select.dataset;
  const lines = state.orders[clientId] || [];
  const line = lines.find(l => l.id === lineId); if(!line) return;
  const newUnit = String(select.value || state.settings.defaultUnit).toUpperCase();
  const merge = lines.find(l => l.id !== lineId && normalizeName(l.product) === normalizeName(line.product) && String(l.unit || state.settings.defaultUnit).toUpperCase() === newUnit);
  if(merge){ merge.qty = round2(Number(merge.qty || 0) + Number(line.qty || 0)); state.orders[clientId] = lines.filter(l => l.id !== lineId); }
  else line.unit = newUnit;
  saveState();
}

function commitLineNote(input){
  const { clientId, lineId } = input.dataset;
  const line = (state.orders[clientId] || []).find(l => l.id === lineId); if(!line) return;
  line.note = input.value; saveState();
}

function removeLine(clientId, lineId){ state.orders[clientId] = (state.orders[clientId] || []).filter(l => l.id !== lineId); saveState(); }
function clearOrder(clientId){ const client=getClient(clientId); if(!client) return; if(!confirm(`Vaciar pedido de ${client.name}?`)) return; state.orders[clientId] = []; saveState(); }

function commitPaymentField(input){
  const { clientId, field } = input.dataset; const payment = ensurePayment(clientId);
  payment[field] = clampMinZero(parseDecimalInput(input.value)); saveState();
}
function commitPaymentNote(input){ const payment = ensurePayment(input.dataset.clientId); payment.note = input.value; saveState(); }
function addQuickPaid(clientId, amount){ const payment = ensurePayment(clientId); payment.paid = round2(Number(payment.paid || 0) + Number(amount || 0)); saveState(); }
function markPaid(clientId){ const payment = ensurePayment(clientId); payment.paid = computePayment(clientId).total; saveState(); }

function setProviderStatus(key, status){ state.providerStatus[key] = status; saveState(); }

function buildProviderTotalText(){
  const groups = providerGroups().total;
  return `PEDIDO TOTAL ${niceDate(state.dayKey)}\n\n${groups.map(item => `${item.product} ${qtyFormat(item.qty)} ${item.unit}`).join('\n')}`;
}
function buildClientText(clientId){
  const client = getClient(clientId); if(!client) return '';
  const lines = state.orders[clientId] || []; const pay = computePayment(clientId);
  return `${client.name}\n${niceDate(state.dayKey)}\n\n${lines.map(line => `${line.product} ${qtyFormat(line.qty)} ${line.unit}${line.note ? ` (${line.note})` : ''}`).join('\n') || '-'}\n\nBase proveedor: ${eur(pay.base)}\nMi comisión: ${eur(pay.mine)}\nTotal cobrar: ${eur(pay.total)}\nPagado: ${eur(pay.paid)}\nPendiente: ${eur(pay.pending)}`;
}
function buildMissingText(){
  const combined = [...providerGroups().unavailable, ...providerGroups().external];
  return `FALTANTES / EXTERNOS ${niceDate(state.dayKey)}\n\n${combined.map(item => `${item.product} ${qtyFormat(item.qty)} ${item.unit}\n${item.clients.map(c => `- ${c.clientName}: ${qtyFormat(c.qty)} ${item.unit}`).join('\n')}`).join('\n\n')}`;
}

function openPrintable(title, bodyHtml){
  const w = window.open('', '_blank');
  if(!w) return;
  w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#111}h1{margin:0 0 6px;font-size:24px}h2{margin:20px 0 8px;font-size:18px}small{color:#666}.box{border:1px solid #ccc;border-radius:10px;padding:12px;margin:10px 0}.row{display:flex;justify-content:space-between;gap:10px}.table{width:100%;border-collapse:collapse;margin-top:10px}.table th,.table td{border:1px solid #ccc;padding:8px;text-align:left}.table th{background:#f3f3f3}@media print{button{display:none}body{padding:10px}}</style></head><body><button onclick="window.print()">Imprimir / Guardar PDF</button>${bodyHtml}</body></html>`);
  w.document.close();
}

function printSummary(){
  const g = computeGlobal();
  const rows = activeClients().map(client => { const p = computePayment(client.id); return `<tr><td>${escapeHtml(client.name)}</td><td>${eur(p.base)}</td><td>${eur(p.mine)}</td><td>${eur(p.total)}</td><td>${eur(p.paid)}</td><td>${eur(p.pending)}</td></tr>`; }).join('');
  openPrintable('Resumen del día', `<h1>${escapeHtml(state.settings.appName)}</h1><small>${niceDate(state.dayKey)}</small><div class="box"><div class="row"><span>Total proveedor</span><strong>${eur(g.totalProvider)}</strong></div><div class="row"><span>Mi comisión</span><strong>${eur(g.totalMine)}</strong></div><div class="row"><span>Total cobrar</span><strong>${eur(g.totalGeneral)}</strong></div><div class="row"><span>Cobrado</span><strong>${eur(g.totalPaid)}</strong></div><div class="row"><span>Pendiente</span><strong>${eur(g.totalPending)}</strong></div></div><table class="table"><thead><tr><th>Cliente</th><th>Base</th><th>Mi comisión</th><th>Total</th><th>Pagado</th><th>Pendiente</th></tr></thead><tbody>${rows || '<tr><td colspan="6">Sin datos</td></tr>'}</tbody></table>`);
}

function snapshotDay(){
  const groups = providerGroups().all;
  return { id: makeId('hist'), dayKey: state.dayKey, totals: computeGlobal(), totalClients: activeClients().length, totalProductGroups: groups.length, clientRows: activeClients().map(client => ({ name: client.name, ...computePayment(client.id) })), createdAt: Date.now() };
}
function clearDay(){
  if(!confirm('Se guardará un resumen y se limpiará el día actual. ¿Continuar?')) return;
  state.history.unshift(snapshotDay());
  state.orders = {}; state.payments = {}; state.providerStatus = {}; state.dayKey = todayStr();
  saveState(); goTo('dashboard'); alert('Día limpiado y guardado en historial.');
}

function exportBackup(){
  const blob = new Blob([JSON.stringify(state, null, 2)], { type:'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `pedidos-madrid-backup-${state.dayKey}.json`; a.click(); URL.revokeObjectURL(a.href);
}
function importBackup(file){
  const reader = new FileReader(); reader.onload = () => { try { const parsed = normalizeState(JSON.parse(reader.result)); localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed)); location.reload(); } catch { alert('Backup no válido.'); } }; reader.readAsText(file);
}

// Global events

document.addEventListener('click', (e) => {
  const nav = e.target.closest('.nav-btn'); if(nav){ goTo(nav.dataset.view); return; }
  const goto = e.target.closest('[data-goto]'); if(goto){ goTo(goto.dataset.goto); return; }
  if(e.target.id === 'addClientBtn'){ addClient(); return; }
  if(e.target.id === 'themeToggleBtn'){ state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark'; saveState(); return; }
  if(e.target.id === 'backupBtn'){ exportBackup(); return; }
  if(e.target.id === 'restoreBtn'){ document.getElementById('restoreInput').click(); return; }
  if(e.target.id === 'shareProviderBtn' || e.target.id === 'shareProviderTotalBtn'){ shareText(buildProviderTotalText(), 'Pedido proveedor'); return; }
  if(e.target.id === 'copyProviderTotalBtn'){ copyText(buildProviderTotalText()); return; }
  if(e.target.id === 'copyMissingBtn'){ copyText(buildMissingText()); return; }
  if(e.target.id === 'printSummaryBtn'){ printSummary(); return; }
  if(e.target.id === 'clearDayBtn'){ clearDay(); return; }
  if(e.target.id === 'saveSettingsBtn'){
    state.settings.appName = document.getElementById('settingsAppName').value.trim() || 'PEDIDOS MADRID';
    state.settings.defaultCommissionPct = parseDecimalInput(document.getElementById('settingsDefaultPct').value || 15) || 15;
    state.settings.defaultUnit = document.getElementById('settingsDefaultUnit').value || 'CAJA';
    saveState(); alert('Ajustes guardados.'); return;
  }

  const addProduct = e.target.closest('[data-add-product]'); if(addProduct){ handleQuickAdd(addProduct.dataset.addProduct); return; }
  const openOrders = e.target.closest('[data-open-orders]'); if(openOrders){ selectedClientId = openOrders.dataset.openOrders; goTo('orders'); return; }
  const openPayments = e.target.closest('[data-open-payments]'); if(openPayments){ goTo('payments'); setTimeout(()=>document.querySelector(`[data-client-id="${openPayments.dataset.openPayments}"]`)?.scrollIntoView({behavior:'smooth', block:'center'}),30); return; }
  const shareClient = e.target.closest('[data-share-client]'); if(shareClient){ shareText(buildClientText(shareClient.dataset.shareClient), getClient(shareClient.dataset.shareClient)?.name || 'Cliente'); return; }
  const removeClientBtn = e.target.closest('[data-remove-client]'); if(removeClientBtn){ removeClient(removeClientBtn.dataset.removeClient); return; }
  const clearOrderBtn = e.target.closest('[data-clear-order]'); if(clearOrderBtn){ clearOrder(clearOrderBtn.dataset.clearOrder); return; }
  const removeLineBtn = e.target.closest('[data-remove-line]'); if(removeLineBtn){ const [clientId,lineId] = removeLineBtn.dataset.removeLine.split('|'); removeLine(clientId,lineId); return; }
  const bumpBtn = e.target.closest('[data-bump-line]'); if(bumpBtn){ const [clientId,lineId,delta] = bumpBtn.dataset.bumpLine.split('|'); bumpLine(clientId,lineId,Number(delta)); return; }
  const pStatus = e.target.closest('[data-provider-status]'); if(pStatus){ const [key,status] = pStatus.dataset.providerStatus.split('|'); setProviderStatus(key,status); return; }
  const pTab = e.target.closest('[data-provider-tab]'); if(pTab){ providerTab = PROVIDER_TABS.includes(pTab.dataset.providerTab) ? pTab.dataset.providerTab : 'total'; saveState(); return; }
  const qPaid = e.target.closest('[data-quick-paid]'); if(qPaid){ const [clientId,amount] = qPaid.dataset.quickPaid.split('|'); addQuickPaid(clientId, Number(amount)); return; }
  const mPaid = e.target.closest('[data-mark-paid]'); if(mPaid){ markPaid(mPaid.dataset.markPaid); return; }
});

document.addEventListener('change', (e) => {
  if(e.target.id === 'orderClientSelect'){ selectedClientId = e.target.value; renderAll(); return; }
  if(e.target.classList.contains('js-line-unit')){ commitLineUnit(e.target); return; }
});

document.addEventListener('blur', (e) => {
  if(e.target.classList.contains('js-line-qty')){ commitLineQty(e.target); return; }
  if(e.target.classList.contains('js-line-note')){ commitLineNote(e.target); return; }
  if(e.target.classList.contains('js-payment-field')){ commitPaymentField(e.target); return; }
  if(e.target.classList.contains('js-payment-note')){ commitPaymentNote(e.target); return; }
}, true);

document.addEventListener('keydown', (e) => {
  if(e.key === 'Enter'){
    if(e.target.classList.contains('js-line-qty')){ e.preventDefault(); commitLineQty(e.target); e.target.blur(); return; }
    if(e.target.classList.contains('js-line-note')){ e.preventDefault(); commitLineNote(e.target); e.target.blur(); return; }
    if(e.target.classList.contains('js-payment-field')){ e.preventDefault(); commitPaymentField(e.target); e.target.blur(); return; }
    if(e.target.classList.contains('js-payment-note')){ e.preventDefault(); commitPaymentNote(e.target); e.target.blur(); return; }
    if(e.target.id === 'manualProductInput'){ e.preventDefault(); handleQuickAdd(); return; }
  }
});

document.addEventListener('input', (e) => {
  if(e.target.id === 'productSearchInput'){
    const term = normalizeName(e.target.value);
    document.querySelectorAll('[data-add-product]').forEach(btn => {
      btn.style.display = !term || btn.dataset.addProduct.includes(term) ? '' : 'none';
    });
  }
});

document.getElementById('restoreInput').addEventListener('change', (e) => { if(e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; });

renderAll();
