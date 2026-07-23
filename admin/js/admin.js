/* ==========================================================================
   admin.js — Pérolas de Maria admin panel
   ========================================================================== */

const STATUS_META = {
  aguardando_pagamento: { label: 'Aguardando pagamento', emoji: '🟡' },
  pago:                 { label: 'Pago',                 emoji: '🟢' },
  preparacao:           { label: 'Em preparação',        emoji: '📦' },
  enviado:              { label: 'Enviado',               emoji: '🚚' },
  entregue:             { label: 'Entregue',              emoji: '✅' },
  cancelado:            { label: 'Cancelado',             emoji: '❌' }
};
const STATUS_ORDER = ['aguardando_pagamento','pago','preparacao','enviado','entregue','cancelado'];

let allOrders = [];        // everything loaded from Supabase, newest first
let currentFilter = 'todos';
let currentSearch = '';
let currentDetailOrderId = null;

function formatBRL(v){
  return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
}
function formatOrderNumber(n){
  return '#' + String(n).padStart(6, '0');
}
function formatDateTime(iso){
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
}

/* ==========================================================================
   AUTH
   ========================================================================== */

async function checkSession(){
  if(!SUPABASE_CONFIGURED){
    const msg = document.getElementById('loginMsg');
    msg.textContent = 'O painel ainda não está conectado ao Supabase. Veja o passo 3 do README.';
    msg.className = 'form-msg error';
    document.getElementById('loginBtn').disabled = true;
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  if(session){
    showApp(session);
  } else {
    showLogin();
  }
}

function showLogin(){
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('app').classList.remove('ready');
}

function showApp(session){
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').classList.add('ready');
  document.getElementById('adminEmail').textContent = session.user.email;
  loadOrders();
  subscribeRealtime();
}

document.getElementById('loginForm').addEventListener('submit', async function(e){
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const msg = document.getElementById('loginMsg');
  btn.disabled = true;
  msg.textContent = '';
  msg.className = 'form-msg';

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  const { data, error } = await sb.auth.signInWithPassword({ email, password });

  if(error){
    msg.textContent = 'E-mail ou senha incorretos.';
    msg.className = 'form-msg error';
    btn.disabled = false;
    return;
  }
  showApp(data.session);
  btn.disabled = false;
});

document.getElementById('forgotBtn').addEventListener('click', async function(){
  const email = document.getElementById('loginEmail').value.trim();
  const msg = document.getElementById('loginMsg');
  if(!email){
    msg.textContent = 'Digite seu e-mail acima primeiro.';
    msg.className = 'form-msg error';
    return;
  }
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/admin/update-password.html'
  });
  msg.className = error ? 'form-msg error' : 'form-msg ok';
  msg.textContent = error ? error.message : 'Enviamos um link para redefinir sua senha.';
});

document.getElementById('logoutBtn').addEventListener('click', async function(){
  await sb.auth.signOut();
  allOrders = [];
  showLogin();
});

checkSession();

/* ==========================================================================
   LOADING ORDERS
   ========================================================================== */

async function loadOrders(){
  // order_items(*) pulls each order's items in the same query, thanks to
  // the foreign key defined in sql/schema.sql
  const { data, error } = await sb
    .from('orders')
    .select('*, order_items(*)')
    .order('created_at', { ascending: false });

  if(error){
    console.error('Erro ao carregar pedidos:', error);
    showToast('Erro ao carregar pedidos. Veja o console.');
    return;
  }
  allOrders = data;
  renderStats();
  renderTable();
}

function subscribeRealtime(){
  sb.channel('orders-changes')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, function(){
      showToast('🔔 Novo pedido recebido');
      loadOrders();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, function(){
      loadOrders();
    })
    .subscribe();
}

/* ==========================================================================
   DASHBOARD STATS
   ========================================================================== */

function renderStats(){
  const today = new Date(); today.setHours(0,0,0,0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const counts = { total: allOrders.length };
  STATUS_ORDER.forEach(function(s){ counts[s] = 0; });

  let faturadoHoje = 0, faturadoMes = 0, totalVendido = 0;

  allOrders.forEach(function(o){
    counts[o.status] = (counts[o.status] || 0) + 1;
    // "faturado" / "vendido" only counts orders that were actually paid
    const isPaidLike = ['pago','preparacao','enviado','entregue'].includes(o.status);
    if(isPaidLike){
      totalVendido += Number(o.total);
      const created = new Date(o.created_at);
      if(created >= today) faturadoHoje += Number(o.total);
      if(created >= monthStart) faturadoMes += Number(o.total);
    }
  });

  const cards = [
    { label: 'Total de pedidos', value: counts.total },
    { label: 'Aguardando pagamento', value: counts.aguardando_pagamento },
    { label: 'Pagos', value: counts.pago },
    { label: 'Em preparação', value: counts.preparacao },
    { label: 'Enviados', value: counts.enviado },
    { label: 'Entregues', value: counts.entregue },
    { label: 'Cancelados', value: counts.cancelado },
    { label: 'Faturado hoje', value: formatBRL(faturadoHoje), money: true },
    { label: 'Faturado no mês', value: formatBRL(faturadoMes), money: true },
    { label: 'Total vendido', value: formatBRL(totalVendido), money: true }
  ];

  document.getElementById('statsGrid').innerHTML = cards.map(function(c){
    return '<div class="stat-card' + (c.money ? ' money' : '') + '">' +
      '<div class="label">' + c.label + '</div>' +
      '<div class="value">' + c.value + '</div>' +
    '</div>';
  }).join('');
}

/* ==========================================================================
   TABLE — search + filter + render
   ========================================================================== */

document.getElementById('searchBox').addEventListener('input', function(e){
  currentSearch = e.target.value.trim().toLowerCase();
  renderTable();
});

document.querySelectorAll('.filter-tab').forEach(function(tab){
  tab.addEventListener('click', function(){
    document.querySelectorAll('.filter-tab').forEach(function(t){t.classList.remove('active');});
    tab.classList.add('active');
    currentFilter = tab.dataset.status;
    renderTable();
  });
});

function getFilteredOrders(){
  return allOrders.filter(function(o){
    if(currentFilter !== 'todos' && o.status !== currentFilter) return false;
    if(!currentSearch) return true;
    const num = formatOrderNumber(o.order_number).toLowerCase();
    return (o.customer_name || '').toLowerCase().includes(currentSearch) ||
           (o.customer_phone || '').toLowerCase().includes(currentSearch) ||
           num.includes(currentSearch);
  });
}

function renderTable(){
  const orders = getFilteredOrders();
  const body = document.getElementById('ordersBody');
  const empty = document.getElementById('emptyState');

  if(orders.length === 0){
    body.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  body.innerHTML = orders.map(function(o){
    const items = o.order_items || [];
    const itemCount = items.reduce(function(s,i){return s + i.quantity;}, 0);
    const meta = STATUS_META[o.status] || { label: o.status, emoji: '' };
    return '<tr onclick="openDetail(\'' + o.id + '\')">' +
      '<td data-label="Pedido"><span class="order-num">' + formatOrderNumber(o.order_number) + '</span></td>' +
      '<td data-label="Data / hora">' + formatDateTime(o.created_at) + '</td>' +
      '<td data-label="Cliente">' + escapeHtml(o.customer_name) + '</td>' +
      '<td data-label="Telefone">' + escapeHtml(o.customer_phone) + '</td>' +
      '<td data-label="Itens">' + itemCount + '</td>' +
      '<td data-label="Total">' + formatBRL(o.total) + '</td>' +
      '<td data-label="Pagamento">' + escapeHtml(o.payment_method || '') + '</td>' +
      '<td data-label="Status"><span class="status-badge status-' + o.status + '">' + meta.emoji + ' ' + meta.label + '</span></td>' +
    '</tr>';
  }).join('');
}

function escapeHtml(s){
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

/* ==========================================================================
   ORDER DETAIL PANEL
   ========================================================================== */

const detailOverlay = document.getElementById('detailOverlay');
const detailPanel = document.getElementById('detailPanel');

document.getElementById('detailClose').addEventListener('click', closeDetail);
detailOverlay.addEventListener('click', closeDetail);

function closeDetail(){
  detailOverlay.classList.remove('show');
  detailPanel.classList.remove('show');
  currentDetailOrderId = null;
}

async function openDetail(orderId){
  currentDetailOrderId = orderId;
  const order = allOrders.find(function(o){ return o.id === orderId; });
  if(!order) return;

  document.getElementById('detailOrderNum').textContent = formatOrderNumber(order.order_number);
  document.getElementById('detailOrderDate').textContent = formatDateTime(order.created_at);

  const items = order.order_items || [];
  const itemsHtml = items.map(function(i){
    let detailsLine = '';
    if(i.details){
      const d = i.details;
      const parts = [];
      if(d.tipoLabel) parts.push(d.tipoLabel);
      if(d.cor) parts.push('cor ' + d.cor);
      if(d.estilo) parts.push('Pai Nosso ' + d.estilo);
      if(d.entremeio) parts.push('entremeio: ' + d.entremeio);
      detailsLine = '<div class="meta">' + escapeHtml(parts.join(' · ')) + '</div>';
    }
    return '<div class="item-line-wrap">' +
      '<div class="item-line"><span>' + i.quantity + 'x ' + escapeHtml(i.product_name) + '</span><span>' + formatBRL(i.line_total) + '</span></div>' +
      detailsLine +
    '</div>';
  }).join('');

  const statusButtons = STATUS_ORDER.map(function(s){
    const meta = STATUS_META[s];
    return '<button class="status-btn' + (s === order.status ? ' current' : '') + '" onclick="changeStatus(\'' + order.id + '\',\'' + s + '\')">' +
      meta.emoji + ' ' + meta.label + '</button>';
  }).join('');

  document.getElementById('detailBody').innerHTML =
    '<div class="detail-section">' +
      '<h3>Cliente</h3>' +
      '<div class="detail-row"><strong>Nome</strong><span>' + escapeHtml(order.customer_name) + '</span></div>' +
      '<div class="detail-row"><strong>Telefone</strong><span>' + escapeHtml(order.customer_phone) + '</span></div>' +
      '<div class="detail-row"><strong>Endereço</strong><span>' + escapeHtml(order.customer_address) + '</span></div>' +
      (order.notes ? '<div class="detail-row"><strong>Observações</strong><span>' + escapeHtml(order.notes) + '</span></div>' : '') +
    '</div>' +
    '<div class="detail-section">' +
      '<h3>Itens do pedido</h3>' +
      itemsHtml +
      '<div class="detail-row" style="margin-top:10px;"><strong>Total</strong><span>' + formatBRL(order.total) + '</span></div>' +
      '<div class="detail-row"><strong>Pagamento</strong><span>' + escapeHtml(order.payment_method) + '</span></div>' +
    '</div>' +
    '<div class="detail-section">' +
      '<h3>Status</h3>' +
      '<div class="status-actions">' + statusButtons + '</div>' +
    '</div>' +
    '<div class="detail-section">' +
      '<h3>Histórico</h3>' +
      '<div id="historyList">Carregando...</div>' +
    '</div>';

  detailOverlay.classList.add('show');
  detailPanel.classList.add('show');

  loadHistory(orderId);
}

async function loadHistory(orderId){
  const { data, error } = await sb
    .from('order_status_history')
    .select('*')
    .eq('order_id', orderId)
    .order('changed_at', { ascending: true });

  const el = document.getElementById('historyList');
  if(!el) return; // panel may have been closed already

  if(error){
    el.textContent = 'Não foi possível carregar o histórico.';
    return;
  }

  el.innerHTML = data.map(function(h){
    const meta = STATUS_META[h.status] || { label: h.status, emoji: '' };
    const time = new Date(h.changed_at).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
    const date = new Date(h.changed_at).toLocaleDateString('pt-BR');
    return '<div class="history-item"><span class="history-time">' + time + '</span>' +
      '<span>' + meta.emoji + ' ' + meta.label + (h.note ? ' — ' + escapeHtml(h.note) : '') + ' <em>(' + date + ')</em></span></div>';
  }).join('') || '<p style="color:var(--ink-soft);font-size:.85rem;">Sem histórico ainda.</p>';
}

async function changeStatus(orderId, newStatus){
  const { error } = await sb.from('orders').update({ status: newStatus }).eq('id', orderId);
  if(error){
    showToast('Erro ao atualizar status.');
    console.error(error);
    return;
  }
  showToast('Status atualizado para "' + STATUS_META[newStatus].label + '"');
  await loadOrders();
  // keep the detail panel open, refreshed with the new status
  if(currentDetailOrderId === orderId){
    openDetail(orderId);
  }
}

/* ==========================================================================
   TOAST
   ========================================================================== */

function showToast(text){
  const t = document.getElementById('toast');
  t.textContent = text;
  t.classList.add('show');
  setTimeout(function(){ t.classList.remove('show'); }, 3200);
}
