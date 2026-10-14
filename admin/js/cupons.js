/* ==========================================================================
   cupons.js — Pérolas de Maria admin panel
   Aba "Cupons": cria e gerencia cupons de desconto com PREÇO ESPECIAL por
   produto (ex.: APARECIDA → Santinha por R$ 6,00). O site e o pedido leem estas
   mesmas tabelas (coupons / coupon_prices), então um cupom novo já funciona
   na hora, sem mexer em código.
   ========================================================================== */

let cupList = [];          // cupons com seus preços
let cupProducts = [];      // produtos disponíveis para escolher no cupom
let cupLoaded = false;
let cupDraft = null;

/* ---------- carregar ---------- */
async function loadCoupons(){
  const [c, p] = await Promise.all([
    sb.from('coupons').select('*, coupon_prices(*)').order('created_at', { ascending: false }),
    sb.from('products').select('slug, name, price, product_variants(price)').order('sort_order', { ascending: true })
  ]);
  if(c.error || p.error){ console.error(c.error || p.error); showToast('Erro ao carregar os cupons.'); return; }
  cupList = c.data || [];
  cupProducts = p.data || [];
  cupLoaded = true;
  renderCoupons();
}

function cupStatus(c){
  if(c.expires_at && new Date(c.expires_at).getTime() <= Date.now()) return 'expired';
  return c.active ? 'on' : 'off';
}
function cupUses(code){
  return (typeof allOrders !== 'undefined' ? allOrders : []).filter(function(o){
    return o.coupon_code === code && o.status !== 'cancelado';
  }).length;
}
function cupDate(iso){
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function renderCoupons(){
  document.getElementById('cupList').innerHTML = cupList.map(function(c){
    const st = cupStatus(c);
    const n = (c.coupon_prices || []).length;
    const uses = cupUses(c.code);
    const code = escapeHtml(c.code);
    const chip = st === 'on' ? '<span class="chip ok">Ativo</span>'
      : st === 'expired' ? '<span class="chip off">Expirado</span>'
      : '<span class="chip warn">Desativado</span>';
    return '<div class="prod-row' + (st === 'on' ? '' : ' hidden-prod') + '">' +
      '<div class="prod-main">' +
        '<div class="prod-name" style="letter-spacing:.06em;">' + code + '</div>' +
        '<div class="prod-meta">' + chip +
          '<span class="chip">' + n + ' produto' + (n === 1 ? '' : 's') + '</span>' +
          (c.expires_at ? '<span class="chip">até ' + escapeHtml(cupDate(c.expires_at)) + '</span>' : '<span class="chip">sem prazo</span>') +
          '<span class="chip">usado em ' + uses + ' pedido' + (uses === 1 ? '' : 's') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="prod-actions">' +
        '<button class="mini-btn' + (c.active ? ' on' : '') + '" type="button" onclick="toggleCoupon(\'' + code + '\')">' + (c.active ? 'Ativo' : 'Desativado') + '</button>' +
        '<button class="mini-btn" type="button" onclick="openCouponEditor(\'' + code + '\')">✏️ Editar</button>' +
      '</div>' +
    '</div>';
  }).join('');
  document.getElementById('cupEmpty').style.display = cupList.length ? 'none' : 'block';
}

async function toggleCoupon(code){
  const c = cupList.find(function(x){ return x.code === code; });
  if(!c) return;
  const value = !c.active;
  const { error } = await sb.from('coupons').update({ active: value }).eq('code', code);
  if(error){ console.error(error); showToast('Não foi possível salvar.'); return; }
  c.active = value;
  renderCoupons();
  showToast('Cupom ' + code + (value ? ' ativado' : ' desativado'));
}

document.getElementById('cupNewBtn').addEventListener('click', function(){ openCouponEditor(null); });
document.querySelectorAll('.admin-tab').forEach(function(tab){
  tab.addEventListener('click', function(){
    if(tab.dataset.tab === 'cupons'){ loadCoupons(); }   // sempre atualiza (contagem de usos)
  });
});

/* ==========================================================================
   EDITOR
   ========================================================================== */
const cupOverlay = document.getElementById('cupOverlay');
const cupPanel = document.getElementById('cupPanel');
document.getElementById('cupPanelClose').addEventListener('click', closeCouponEditor);
cupOverlay.addEventListener('click', closeCouponEditor);

function closeCouponEditor(){
  cupOverlay.classList.remove('show');
  cupPanel.classList.remove('show');
  cupDraft = null;
}

function openCouponEditor(code){
  const c = code ? cupList.find(function(x){ return x.code === code; }) : null;
  cupDraft = {
    isNew: !c,
    code: c ? c.code : '',
    active: c ? c.active : true,
    expires: c && c.expires_at ? new Date(c.expires_at).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : '',
    prices: c ? (c.coupon_prices || []).map(function(r){ return { product_id: r.product_id, price: String(r.promo_price) }; }) : [],
    originalProducts: c ? (c.coupon_prices || []).map(function(r){ return r.product_id; }) : []
  };
  if(!cupLoaded){ loadCoupons().then(renderCouponEditor); }
  renderCouponEditor();
  cupOverlay.classList.add('show');
  cupPanel.classList.add('show');
}

function collectCouponForm(){
  const root = document.getElementById('cupPanelBody');
  if(!cupDraft || !root.querySelector('#cf-code')) return;
  cupDraft.code = root.querySelector('#cf-code').value;
  cupDraft.active = root.querySelector('#cf-active').checked;
  cupDraft.expires = root.querySelector('#cf-expires').value;
  root.querySelectorAll('.cp-row').forEach(function(row){
    const r = cupDraft.prices[Number(row.dataset.i)];
    if(!r) return;
    r.product_id = row.querySelector('.cp-product-sel').value;
    r.price = row.querySelector('.cp-price-in').value;
  });
}

function cupMaxPrice(prod){
  const prices = [Number(prod.price)];
  (prod.product_variants || []).forEach(function(v){ if(v.price != null) prices.push(Number(v.price)); });
  return Math.max.apply(null, prices);
}

function renderCouponEditor(){
  const d = cupDraft;
  if(!d) return;
  document.getElementById('cupPanelTitle').textContent = d.isNew ? 'Novo cupom' : 'Editar cupom';
  document.getElementById('cupPanelSub').textContent = d.isNew ? '' : d.code;

  const rows = d.prices.map(function(r, i){
    const options = '<option value="">Escolha o produto...</option>' + cupProducts.map(function(p){
      return '<option value="' + escapeHtml(p.slug) + '"' + (p.slug === r.product_id ? ' selected' : '') + '>' +
        escapeHtml(p.name) + ' — ' + formatBRL(p.price) + '</option>';
    }).join('');
    return '<div class="cp-row" data-i="' + i + '">' +
      '<div class="cp-product"><label>Produto</label><select class="cp-product-sel">' + options + '</select></div>' +
      '<div class="cp-price"><label>Preço com o cupom (R$)</label><input type="number" class="cp-price-in" min="0" step="0.01" value="' + escapeHtml(r.price) + '"></div>' +
      '<button type="button" class="mini-btn danger" onclick="cupRemoveRow(' + i + ')">✕</button>' +
    '</div>';
  }).join('');

  document.getElementById('cupPanelBody').innerHTML =
    '<div class="ed-section">' +
      '<div class="ed-field"><label for="cf-code">Código do cupom*</label>' +
        '<input type="text" id="cf-code" maxlength="30" value="' + escapeHtml(d.code) + '"' + (d.isNew ? '' : ' readonly') + ' style="text-transform:uppercase;letter-spacing:.06em;" placeholder="Ex.: NATAL">' +
        '<p class="ed-hint">' + (d.isNew ? 'Só letras, números, hífen e _ (de 3 a 30). É o que a cliente digita.' : 'O código não muda depois de criado — para trocar, crie outro cupom.') + '</p></div>' +
      '<div class="ed-checks" style="margin-bottom:14px;">' +
        '<label class="ed-check"><input type="checkbox" id="cf-active"' + (d.active ? ' checked' : '') + '><span>Ativo<small>Desmarque para desligar o cupom sem apagar.</small></span></label>' +
      '</div>' +
      '<div class="ed-field" style="max-width:240px;"><label for="cf-expires">Vale até (opcional)</label>' +
        '<input type="date" id="cf-expires" value="' + escapeHtml(d.expires) + '">' +
        '<p class="ed-hint">Vale até o fim desse dia. Vazio = sem prazo.</p></div>' +
    '</div>' +
    '<div class="ed-section">' +
      '<h3>Produtos e preços</h3>' +
      '<p class="ed-hint" style="margin:0 0 10px;">O cupom só vale para os produtos listados aqui, com o preço que você definir. Produtos com opções (cores) valem em todas as opções.</p>' +
      rows +
      '<button type="button" class="mini-btn" onclick="cupAddRow()">＋ Adicionar produto</button>' +
    '</div>' +
    '<div class="editor-foot">' +
      (d.isNew ? '' : '<button type="button" class="btn-danger" style="width:auto;padding:0 16px;" onclick="deleteCoupon()">🗑</button>') +
      '<button type="button" class="btn-ghost" onclick="closeCouponEditor()">Cancelar</button>' +
      '<button type="button" class="btn-primary" id="cupSaveBtn" onclick="saveCoupon()">Salvar cupom</button>' +
    '</div>';
}

function cupAddRow(){
  collectCouponForm();
  cupDraft.prices.push({ product_id: '', price: '' });
  renderCouponEditor();
}
function cupRemoveRow(i){
  collectCouponForm();
  cupDraft.prices.splice(i, 1);
  renderCouponEditor();
}

function validateCouponDraft(d){
  const code = d.code.trim().toUpperCase();
  if(!/^[A-Z0-9_-]{3,30}$/.test(code)) return 'O código precisa ter de 3 a 30 letras, números, hífen ou _ (sem espaços ou acentos).';
  if(!d.prices.length) return 'Adicione ao menos um produto ao cupom.';
  const seen = {};
  for(let i = 0; i < d.prices.length; i++){
    const r = d.prices[i];
    if(!r.product_id) return 'Escolha o produto em todas as linhas.';
    if(seen[r.product_id]) return 'O mesmo produto aparece duas vezes.';
    seen[r.product_id] = true;
    const price = r.price === '' ? NaN : Number(String(r.price).replace(',', '.'));
    if(!Number.isFinite(price) || price < 0) return 'Informe o preço do cupom em todas as linhas.';
    const prod = cupProducts.find(function(p){ return p.slug === r.product_id; });
    if(prod && price >= cupMaxPrice(prod)) return 'O preço do cupom de "' + prod.name + '" precisa ser menor que o preço normal (' + formatBRL(cupMaxPrice(prod)) + ').';
  }
  return null;
}

async function saveCoupon(){
  collectCouponForm();
  const d = cupDraft;
  const err = validateCouponDraft(d);
  if(err){ showToast(err); return; }
  const code = d.code.trim().toUpperCase();
  const btn = document.getElementById('cupSaveBtn');
  btn.disabled = true; btn.textContent = 'Salvando...';

  try{
    const expires_at = d.expires ? d.expires + 'T23:59:59-03:00' : null;
    if(d.isNew){
      const r = await sb.from('coupons').insert({ code: code, active: d.active, expires_at: expires_at });
      if(r.error) throw r.error;
      d.isNew = false; d.code = code;
    } else {
      const r = await sb.from('coupons').update({ active: d.active, expires_at: expires_at }).eq('code', code);
      if(r.error) throw r.error;
    }

    const rows = d.prices.map(function(r){
      return { coupon_code: code, product_id: r.product_id, promo_price: Number(String(r.price).replace(',', '.')) };
    });
    const up = await sb.from('coupon_prices').upsert(rows, { onConflict: 'coupon_code,product_id' });
    if(up.error) throw up.error;

    const keep = d.prices.map(function(r){ return r.product_id; });
    const removed = d.originalProducts.filter(function(slug){ return keep.indexOf(slug) === -1; });
    if(removed.length){
      const del = await sb.from('coupon_prices').delete().eq('coupon_code', code).in('product_id', removed);
      if(del.error) throw del.error;
    }

    showToast('Cupom ' + code + ' salvo ✓');
    closeCouponEditor();
    await loadCoupons();
  } catch(e){
    console.error(e);
    const msg = String(e && e.message || '');
    if(/duplicate key|already exists|unique/i.test(msg)) showToast('Já existe um cupom com esse código.');
    else if(/violates row-level security|permission denied/i.test(msg)) showToast('Sem permissão. Entre de novo no painel.');
    else showToast('Não foi possível salvar: ' + (msg || 'erro desconhecido'));
    btn.disabled = false; btn.textContent = 'Salvar cupom';
  }
}

async function deleteCoupon(){
  const d = cupDraft;
  if(!d || d.isNew) return;
  const uses = cupUses(d.code);
  if(!window.confirm('Excluir o cupom ' + d.code + '?' + (uses ? '\n\nEle foi usado em ' + uses + ' pedido(s) — os pedidos continuam guardados normalmente.' : '') +
    '\n\nSe só quer pausar, use o botão "Ativo".')) return;
  const r = await sb.from('coupons').delete().eq('code', d.code);
  if(r.error){ console.error(r.error); showToast('Não foi possível excluir.'); return; }
  showToast('Cupom excluído.');
  closeCouponEditor();
  await loadCoupons();
}
