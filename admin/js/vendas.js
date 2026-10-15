/* ==========================================================================
   vendas.js — Pérolas de Maria admin panel
   Aba "Vendas": números do período escolhido, calculados a partir dos
   pedidos que o painel já carregou (allOrders, em admin.js).
   Datas sempre no horário de Brasília. Pedidos cancelados nunca entram.
   ========================================================================== */

const SALES_PAID = ['pago', 'preparacao', 'enviado', 'entregue'];
const SALES_TZ = 'America/Sao_Paulo';

let salesProductNames = null;     // nomes dos produtos (para juntar cores/modelos no ranking)

/* ---------- datas ---------- */
function salesDateKey(iso){
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: SALES_TZ });        // "2026-10-15"
}
function salesAddDays(key, n){
  const d = new Date(key + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function salesRange(preset, now){
  const today = salesDateKey((now || new Date()).toISOString());
  const y = today.slice(0, 4), m = today.slice(5, 7);
  switch(preset){
    case 'mes':   return { start: y + '-' + m + '-01', end: today, label: 'este mês' };
    case 'mes_passado': {
      const firstThis = y + '-' + m + '-01';
      const end = salesAddDays(firstThis, -1);
      return { start: end.slice(0, 7) + '-01', end: end, label: 'mês passado' };
    }
    case '7d':    return { start: salesAddDays(today, -6),  end: today, label: 'últimos 7 dias' };
    case '30d':   return { start: salesAddDays(today, -29), end: today, label: 'últimos 30 dias' };
    case '90d':   return { start: salesAddDays(today, -89), end: today, label: 'últimos 90 dias' };
    case 'ano':   return { start: y + '-01-01', end: today, label: 'este ano' };
    default:      return { start: null, end: null, label: 'todo o período' };
  }
}
function salesInRange(o, range){
  const k = salesDateKey(o.created_at);
  return (!range.start || k >= range.start) && (!range.end || k <= range.end);
}

/* ---------- agregação ---------- */
function salesFilter(orders, range, paidOnly){
  return orders.filter(function(o){
    if(o.status === 'cancelado') return false;
    if(paidOnly && SALES_PAID.indexOf(o.status) === -1) return false;
    return salesInRange(o, range);
  });
}

function salesBaseName(item, productNames, split){
  const name = String(item.product_name || '').split(' — entremeio:')[0].trim();
  if((item.details && item.details.tipo) || /^(Terço simples|Só de pérolas)/.test(name)) return 'Terço personalizado';
  if(split) return name;
  const match = (productNames || []).filter(function(n){ return name === n || name.indexOf(n + ' ') === 0; })
    .sort(function(a, b){ return b.length - a.length; })[0];
  return match || name;
}

function salesAggregate(orders, opts){
  opts = opts || {};
  const out = { revenue: 0, count: orders.length, items: 0, discount: 0, avg: 0, byKey: {}, products: [], entremeios: [], coupons: [] };
  const prod = {}, ent = {}, cup = {};

  orders.forEach(function(o){
    const total = Number(o.total) || 0;
    out.revenue += total;
    out.discount += Number(o.discount) || 0;
    if(o.coupon_code){
      const c = cup[o.coupon_code] || (cup[o.coupon_code] = { code: o.coupon_code, orders: 0, discount: 0, revenue: 0 });
      c.orders += 1; c.discount += Number(o.discount) || 0; c.revenue += total;
    }
    (o.order_items || []).forEach(function(i){
      const qty = Number(i.quantity) || 0, line = Number(i.line_total) || 0;
      out.items += qty;
      const name = salesBaseName(i, opts.productNames, opts.split);
      const p = prod[name] || (prod[name] = { name: name, qty: 0, revenue: 0 });
      p.qty += qty; p.revenue += line;
      const e = i.details && i.details.entremeio;
      if(e){ ent[e] = (ent[e] || 0) + qty; }
    });
  });

  out.avg = out.count ? out.revenue / out.count : 0;
  out.products = Object.keys(prod).map(function(k){ return prod[k]; }).sort(function(a, b){ return b.revenue - a.revenue; });
  out.entremeios = Object.keys(ent).map(function(k){ return { name: k, qty: ent[k] }; }).sort(function(a, b){ return b.qty - a.qty; });
  out.coupons = Object.keys(cup).map(function(k){ return cup[k]; }).sort(function(a, b){ return b.orders - a.orders; });
  return out;
}

// série para o gráfico: por dia (períodos curtos) ou por mês (longos), com os vazios preenchidos
function salesSeries(orders, range){
  const keys = orders.map(function(o){ return salesDateKey(o.created_at); }).sort();
  const start = range.start || keys[0], end = range.end || keys[keys.length - 1];
  if(!start || !end) return { unit: 'day', points: [] };
  const days = Math.round((new Date(end + 'T12:00:00Z') - new Date(start + 'T12:00:00Z')) / 86400000) + 1;
  const unit = days <= 62 ? 'day' : 'month';
  const sums = {};
  orders.forEach(function(o){
    const k = salesDateKey(o.created_at), key = unit === 'day' ? k : k.slice(0, 7);
    sums[key] = (sums[key] || 0) + (Number(o.total) || 0);
  });
  const points = [];
  if(unit === 'day'){
    for(let k = start, guard = 0; k <= end && guard < 400; k = salesAddDays(k, 1), guard++) points.push({ key: k, value: sums[k] || 0 });
  } else {
    let y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7));
    const ey = Number(end.slice(0, 4)), em = Number(end.slice(5, 7));
    while((y < ey || (y === ey && m <= em)) && points.length < 240){
      const key = y + '-' + String(m).padStart(2, '0');
      points.push({ key: key, value: sums[key] || 0 });
      m++; if(m > 12){ m = 1; y++; }
    }
  }
  return { unit: unit, points: points };
}

/* ---------- CSV ---------- */
function salesCsv(orders){
  const esc = function(v){ return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
  const money = function(v){ return Number(v || 0).toFixed(2).replace('.', ','); };
  const lines = [['Pedido', 'Data', 'Cliente', 'Telefone', 'Status', 'Cupom', 'Desconto', 'Total', 'Itens'].map(esc).join(';')];
  orders.slice().sort(function(a, b){ return a.order_number - b.order_number; }).forEach(function(o){
    const d = new Date(o.created_at);
    const date = d.toLocaleDateString('pt-BR', { timeZone: SALES_TZ }) + ' ' + d.toLocaleTimeString('pt-BR', { timeZone: SALES_TZ, hour: '2-digit', minute: '2-digit' });
    const items = (o.order_items || []).map(function(i){ return i.quantity + 'x ' + i.product_name; }).join(' | ');
    lines.push([formatOrderNumber(o.order_number), date, o.customer_name, o.customer_phone,
      (STATUS_META[o.status] || { label: o.status }).label, o.coupon_code || '', money(o.discount), money(o.total), items].map(esc).join(';'));
  });
  return lines.join('\r\n');
}

/* ---------- tela ---------- */
function salesBarChartSvg(series){
  const pts = series.points;
  if(!pts.length || pts.every(function(p){ return p.value === 0; })) return '<p class="tab-hint">Sem vendas neste período.</p>';
  const W = 720, H = 220, padL = 8, padR = 8, padT = 22, padB = 30;
  const max = Math.max.apply(null, pts.map(function(p){ return p.value; })) || 1;
  const slot = (W - padL - padR) / pts.length;
  const bw = Math.max(2, Math.min(40, slot * 0.7));
  const every = Math.ceil(pts.length / 14);                       // no máximo ~14 rótulos
  const label = function(p){
    return series.unit === 'day' ? p.key.slice(8, 10) + '/' + p.key.slice(5, 7) : p.key.slice(5, 7) + '/' + p.key.slice(2, 4);
  };
  const bars = pts.map(function(p, i){
    const h = Math.round((H - padT - padB) * (p.value / max));
    const x = padL + slot * i + (slot - bw) / 2, y = H - padB - h;
    return '<g><rect class="sales-bar" x="' + x.toFixed(1) + '" y="' + y + '" width="' + bw.toFixed(1) + '" height="' + h + '" rx="3"><title>' +
      escapeHtml(label(p) + ': ' + formatBRL(p.value)) + '</title></rect>' +
      (i % every === 0 ? '<text class="sales-label" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle">' + escapeHtml(label(p)) + '</text>' : '') +
      (pts.length <= 12 && p.value > 0 ? '<text class="sales-value" x="' + (x + bw / 2).toFixed(1) + '" y="' + (y - 5) + '" text-anchor="middle">' + escapeHtml(formatBRL(p.value).replace('R$ ', '')) + '</text>' : '') +
      '</g>';
  }).join('');
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="sales-chart" role="img" aria-label="Faturamento no período">' + bars + '</svg>';
}

function salesTable(rows, cols){
  if(!rows.length) return '<p class="tab-hint">Nada por aqui neste período.</p>';
  return '<table class="sales-table"><tbody>' + rows.map(function(r){
    return '<tr>' + cols.map(function(c){ return '<td' + (c.right ? ' class="r"' : '') + '>' + c.fn(r) + '</td>'; }).join('') + '</tr>';
  }).join('') + '</tbody></table>';
}

let salesCurrent = [];            // pedidos do período atual (para exportar)

async function renderSales(){
  const preset = document.getElementById('salesPeriod').value;
  const paidOnly = document.getElementById('salesPaidOnly').checked;
  const split = document.getElementById('salesSplit').checked;

  if(salesProductNames === null){
    salesProductNames = [];
    try{
      const r = await sb.from('products').select('name');
      if(!r.error && r.data) salesProductNames = r.data.map(function(p){ return p.name; });
    }catch(e){ /* segue sem juntar por produto */ }
  }

  const range = salesRange(preset);
  const orders = salesFilter(allOrders, range, paidOnly);
  salesCurrent = orders;
  const agg = salesAggregate(orders, { productNames: salesProductNames, split: split });
  const pending = allOrders.filter(function(o){ return o.status === 'aguardando_pagamento' && salesInRange(o, range); })
    .reduce(function(s, o){ return s + (Number(o.total) || 0); }, 0);

  document.getElementById('salesNote').textContent = 'Mostrando ' + range.label + (paidOnly
    ? ' — só pedidos pagos (pago, em preparação, enviado e entregue). Cancelados nunca entram.'
    : ' — inclui pedidos aguardando pagamento. Cancelados nunca entram.');

  const cards = [
    { label: 'Faturamento', value: formatBRL(agg.revenue), money: true },
    { label: 'Pedidos', value: agg.count },
    { label: 'Ticket médio', value: formatBRL(agg.avg), money: true },
    { label: 'Itens vendidos', value: agg.items },
    { label: 'Descontos dados (cupons)', value: formatBRL(agg.discount), money: true }
  ];
  if(paidOnly) cards.push({ label: 'A receber (aguardando pagamento)', value: formatBRL(pending), money: true });
  document.getElementById('salesKpis').innerHTML = cards.map(function(c){
    return '<div class="stat-card' + (c.money ? ' money' : '') + '"><div class="label">' + c.label + '</div><div class="value">' + c.value + '</div></div>';
  }).join('');

  const series = salesSeries(orders, range);
  document.getElementById('salesChartTitle').textContent = 'Faturamento ' + (series.unit === 'day' ? 'por dia' : 'por mês');
  document.getElementById('salesChart').innerHTML = salesBarChartSvg(series);

  const totalRev = agg.revenue || 1;
  document.getElementById('salesProducts').innerHTML = salesTable(agg.products.slice(0, 10), [
    { fn: function(r){ return '<strong>' + escapeHtml(r.name) + '</strong>'; } },
    { right: true, fn: function(r){ return r.qty + ' un.'; } },
    { right: true, fn: function(r){ return formatBRL(r.revenue); } },
    { right: true, fn: function(r){ return Math.round(r.revenue / totalRev * 100) + '%'; } }
  ]);
  document.getElementById('salesEntremeios').innerHTML = salesTable(agg.entremeios.slice(0, 8), [
    { fn: function(r){ return escapeHtml(r.name); } },
    { right: true, fn: function(r){ return r.qty + ' un.'; } }
  ]);
  document.getElementById('salesCoupons').innerHTML = salesTable(agg.coupons, [
    { fn: function(r){ return '<strong>' + escapeHtml(r.code) + '</strong>'; } },
    { right: true, fn: function(r){ return r.orders + ' pedido' + (r.orders === 1 ? '' : 's'); } },
    { right: true, fn: function(r){ return 'desconto ' + formatBRL(r.discount); } },
    { right: true, fn: function(r){ return 'faturou ' + formatBRL(r.revenue); } }
  ]);
}

function exportSalesCsv(){
  if(!salesCurrent.length){ showToast('Não há pedidos neste período para exportar.'); return; }
  const blob = new Blob(['\ufeff' + salesCsv(salesCurrent)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pedidos-' + salesDateKey(new Date().toISOString()) + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
}

['salesPeriod', 'salesPaidOnly', 'salesSplit'].forEach(function(id){
  document.getElementById(id).addEventListener('change', renderSales);
});
document.getElementById('salesExport').addEventListener('click', exportSalesCsv);
document.querySelectorAll('.admin-tab').forEach(function(tab){
  tab.addEventListener('click', function(){
    if(tab.dataset.tab === 'vendas') renderSales();
  });
});
