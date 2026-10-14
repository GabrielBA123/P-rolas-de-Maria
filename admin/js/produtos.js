/* ==========================================================================
   produtos.js — Pérolas de Maria admin panel
   Aba "Produtos": cadastra e edita produtos, opções (cores/modelos) e fotos.
   O site lê essas mesmas tabelas (products / product_variants / product_images),
   então tudo que muda aqui aparece na vitrine em até 1 minuto.
   As fotos vão para o armazenamento do Supabase (bucket "produtos").
   ========================================================================== */

const PROD_BUCKET = 'produtos';
const PROD_MAX_IMAGE_SIDE = 1200;
const PROD_SITE = 'https://perolas-de-maria.vercel.app';

let prodList = [];            // produtos carregados (com opções e fotos), na ordem da vitrine
let prodLoaded = false;
let prodDraft = null;         // o que está sendo editado no painel
let prodTempCounter = 0;      // chaves temporárias de opções novas (até o produto ser salvo)
function prodVarRef(v){ return v.key || v.tempKey; }

/* ---------- utilidades ---------- */
function prodSlugify(t){
  return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function prodImgSrc(u){
  if(!u) return '/assets/images/logo.jpg';
  if(/^(blob:|data:|https?:)/.test(u)) return u;
  return '/' + String(u).replace(/^\/+/, '');
}
function prodFirstImage(p){
  const imgs = (p.product_images || []).slice().sort(function(a, b){ return a.sort_order - b.sort_order; });
  const general = imgs.filter(function(i){ return !i.variant_id; })[0];
  return (general || imgs[0] || {}).url || null;
}
function prodNum(v){
  if(v === '' || v == null) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}
function prodStoragePath(url){
  const marker = '/storage/v1/object/public/' + PROD_BUCKET + '/';
  const i = String(url || '').indexOf(marker);
  return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length));
}

// foto do celular/computador → JPEG de no máximo 1200px (leve e rápido para o site)
function prodFileToJpeg(file){
  return new Promise(function(resolve, reject){
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function(){
      const scale = Math.min(1, PROD_MAX_IMAGE_SIDE / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(function(blob){
        URL.revokeObjectURL(url);
        blob ? resolve(blob) : reject(new Error('Não foi possível converter a foto.'));
      }, 'image/jpeg', 0.85);
    };
    img.onerror = function(){ URL.revokeObjectURL(url); reject(new Error('Não foi possível ler essa foto. Tente outra.')); };
    img.src = url;
  });
}

async function prodUploadFile(file, slug){
  const blob = await prodFileToJpeg(file);
  const path = slug + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.jpg';
  const up = await sb.storage.from(PROD_BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
  if(up.error) throw up.error;
  return sb.storage.from(PROD_BUCKET).getPublicUrl(path).data.publicUrl;
}

/* ==========================================================================
   LISTA
   ========================================================================== */
async function loadProducts(){
  const { data, error } = await sb.from('products')
    .select('*, product_variants(*), product_images(*)')
    .order('sort_order', { ascending: true });
  if(error){ console.error(error); showToast('Erro ao carregar os produtos.'); return; }
  prodList = data || [];
  prodLoaded = true;
  renderProducts();
}

function prodRowHtml(p, idx, total){
  const vars = p.product_variants || [];
  const chips = [];
  if(!p.active) chips.push('<span class="chip off">Oculto no site</span>');
  if(p.sold_out) chips.push('<span class="chip warn">Esgotado</span>');
  if(p.featured) chips.push('<span class="chip ok">Destaque</span>');
  if(p.is_new) chips.push('<span class="chip">Novidade</span>');
  if(vars.length) chips.push('<span class="chip">' + vars.length + ' ' + escapeHtml(String(p.option_title || 'opções').toLowerCase()) + '</span>');
  if(p.has_entremeio) chips.push('<span class="chip">entremeio</span>');
  const id = escapeHtml(p.id);
  return '<div class="prod-row' + (p.active ? '' : ' hidden-prod') + '" data-id="' + id + '">' +
    '<div class="move-btns">' +
      '<button class="mini-btn" type="button" title="Subir" onclick="moveProduct(\'' + id + '\',-1)"' + (idx === 0 ? ' disabled' : '') + '>▲</button>' +
      '<button class="mini-btn" type="button" title="Descer" onclick="moveProduct(\'' + id + '\',1)"' + (idx === total - 1 ? ' disabled' : '') + '>▼</button>' +
    '</div>' +
    '<img class="prod-thumb" src="' + escapeHtml(prodImgSrc(prodFirstImage(p))) + '" alt="">' +
    '<div class="prod-main">' +
      '<div class="prod-name">' + escapeHtml(p.name) + '</div>' +
      '<div class="prod-meta"><strong>' + formatBRL(p.price) + '</strong>' + chips.join('') + '</div>' +
    '</div>' +
    '<div class="prod-actions">' +
      '<button class="mini-btn' + (p.active ? ' on' : '') + '" type="button" onclick="toggleProductFlag(\'' + id + '\',\'active\')">' + (p.active ? 'Visível' : 'Oculto') + '</button>' +
      '<button class="mini-btn' + (p.sold_out ? ' on' : '') + '" type="button" onclick="toggleProductFlag(\'' + id + '\',\'sold_out\')">' + (p.sold_out ? 'Esgotado' : 'Em estoque') + '</button>' +
      '<button class="mini-btn" type="button" onclick="openProductEditor(\'' + id + '\')">✏️ Editar</button>' +
      '<a class="mini-btn" href="/produto/' + encodeURIComponent(p.slug) + '" target="_blank" rel="noopener" style="text-decoration:none;">Ver no site ↗</a>' +
    '</div>' +
  '</div>';
}

function renderProducts(){
  const q = (document.getElementById('prodSearch').value || '').trim().toLowerCase();
  const shown = prodList.filter(function(p){
    return !q || p.name.toLowerCase().indexOf(q) !== -1 || p.slug.indexOf(q) !== -1;
  });
  document.getElementById('prodList').innerHTML = shown.map(function(p){
    return prodRowHtml(p, prodList.indexOf(p), prodList.length);
  }).join('');
  document.getElementById('prodEmpty').style.display = shown.length ? 'none' : 'block';
}

async function toggleProductFlag(id, flag){
  const p = prodList.find(function(x){ return x.id === id; });
  if(!p) return;
  const value = !p[flag];
  const { error } = await sb.from('products').update(Object.fromEntries([[flag, value]])).eq('id', id);
  if(error){ console.error(error); showToast('Não foi possível salvar.'); return; }
  p[flag] = value;
  renderProducts();
  const label = flag === 'active' ? (value ? 'agora aparece no site' : 'foi ocultado do site') : (value ? 'marcado como esgotado' : 'voltou ao estoque');
  showToast(p.name + ': ' + label);
}

async function moveProduct(id, dir){
  const i = prodList.findIndex(function(x){ return x.id === id; });
  const j = i + dir;
  if(i < 0 || j < 0 || j >= prodList.length) return;
  const a = prodList[i], b = prodList[j];
  // troca as posições (garantindo valores diferentes mesmo se estiverem iguais)
  let sa = a.sort_order, sb_ = b.sort_order;
  if(sa === sb_){ sb_ = sa + (dir > 0 ? 1 : -1); }
  const r1 = await sb.from('products').update({ sort_order: sb_ }).eq('id', a.id);
  const r2 = await sb.from('products').update({ sort_order: sa }).eq('id', b.id);
  if(r1.error || r2.error){ showToast('Não foi possível reordenar.'); return; }
  await loadProducts();
}

document.getElementById('prodSearch').addEventListener('input', renderProducts);
document.getElementById('prodNewBtn').addEventListener('click', function(){ openProductEditor(null); });
document.querySelectorAll('.admin-tab').forEach(function(tab){
  tab.addEventListener('click', function(){
    if(tab.dataset.tab === 'produtos' && !prodLoaded) loadProducts();
  });
});

/* ==========================================================================
   EDITOR
   ========================================================================== */
const prodOverlay = document.getElementById('prodOverlay');
const prodPanel = document.getElementById('prodPanel');
document.getElementById('prodPanelClose').addEventListener('click', closeProductEditor);
prodOverlay.addEventListener('click', closeProductEditor);

function closeProductEditor(){
  prodOverlay.classList.remove('show');
  prodPanel.classList.remove('show');
  prodDraft = null;
}

function openProductEditor(id){
  const p = id ? prodList.find(function(x){ return x.id === id; }) : null;
  const variants = p ? (p.product_variants || []).slice().sort(function(a, b){ return a.sort_order - b.sort_order; }) : [];
  const imgs = p ? (p.product_images || []).slice().sort(function(a, b){ return a.sort_order - b.sort_order; }) : [];
  const keyById = {};
  variants.forEach(function(v){ keyById[v.id] = v.key; });

  prodDraft = {
    id: p ? p.id : null,
    isNew: !p,
    slugTouched: !!p,
    slug: p ? p.slug : '',
    name: p ? p.name : '',
    tagline: p && p.tagline || '',
    description: p && p.description || '',
    eyebrow: p && p.eyebrow || '',
    option_title: p ? p.option_title : 'Cor',
    price: p ? String(p.price) : '',
    has_entremeio: p ? p.has_entremeio : false,
    is_new: p ? p.is_new : true,
    featured: p ? p.featured : false,
    sold_out: p ? p.sold_out : false,
    active: p ? p.active : true,
    sort_order: p ? p.sort_order : ((prodList.reduce(function(m, x){ return Math.max(m, x.sort_order); }, 0)) + 10),
    variants: variants.map(function(v){
      return { id: v.id, key: v.key, cart_id: v.cart_id, label: v.label, color: v.color || '#cccccc', price: v.price == null ? '' : String(v.price),
               sold_out: v.sold_out, swatch_url: v.swatch_url || null, swatchFile: null };
    }),
    images: imgs.map(function(i){
      return { id: i.id, url: i.url, variantKey: i.variant_id ? (keyById[i.variant_id] || null) : null, file: null, preview: null };
    }),
    removedVariantIds: [], removedImageIds: [], removedPaths: []
  };
  renderProductEditor();
  prodOverlay.classList.add('show');
  prodPanel.classList.add('show');
}

// lê o que está digitado no painel para dentro do rascunho
function collectProductForm(){
  const root = document.getElementById('prodPanelBody');
  if(!prodDraft || !root.querySelector('#pf-name')) return;
  const d = prodDraft;
  d.name = root.querySelector('#pf-name').value;
  d.price = root.querySelector('#pf-price').value;
  d.slug = root.querySelector('#pf-slug').value;
  d.tagline = root.querySelector('#pf-tagline').value;
  d.eyebrow = root.querySelector('#pf-eyebrow').value;
  d.description = root.querySelector('#pf-description').value;
  d.option_title = root.querySelector('#pf-optiontitle').value;
  ['active', 'sold_out', 'is_new', 'featured', 'has_entremeio'].forEach(function(f){
    d[f] = root.querySelector('#pf-' + f).checked;
  });
  root.querySelectorAll('.var-row').forEach(function(row){
    const v = d.variants[Number(row.dataset.i)];
    if(!v) return;
    v.label = row.querySelector('.v-label').value;
    v.color = row.querySelector('.v-color').value;
    v.price = row.querySelector('.v-price').value;
    v.sold_out = row.querySelector('.v-soldout').checked;
  });
  root.querySelectorAll('.img-card').forEach(function(card){
    const im = d.images[Number(card.dataset.i)];
    if(!im) return;
    const sel = card.querySelector('.i-variant');
    im.variantKey = sel.value || null;
  });
}

function renderProductEditor(){
  const d = prodDraft;
  document.getElementById('prodPanelTitle').textContent = d.isNew ? 'Novo produto' : 'Editar produto';
  document.getElementById('prodPanelSub').textContent = d.isNew ? '' : '/produto/' + d.slug;

  const check = function(id, checked, title, hint){
    return '<label class="ed-check"><input type="checkbox" id="pf-' + id + '"' + (checked ? ' checked' : '') + '><span>' + title +
      (hint ? '<small>' + hint + '</small>' : '') + '</span></label>';
  };

  const varRows = d.variants.map(function(v, i){
    const swatch = v.swatchFile ? v.swatchFile.preview : v.swatch_url;
    return '<div class="var-row" data-i="' + i + '">' +
      '<div class="move-btns">' +
        '<button type="button" class="mini-btn" onclick="prodMoveVariant(' + i + ',-1)"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
        '<button type="button" class="mini-btn" onclick="prodMoveVariant(' + i + ',1)"' + (i === d.variants.length - 1 ? ' disabled' : '') + '>▼</button>' +
      '</div>' +
      '<div class="var-fields">' +
        '<div><label>Nome da opção*</label><input type="text" class="v-label" value="' + escapeHtml(v.label) + '" placeholder="Ex.: Azul"></div>' +
        '<div><label>Cor</label><input type="color" class="v-color" value="' + escapeHtml(v.color) + '"></div>' +
        '<div class="var-price"><label>Preço só desta opção</label><input type="number" class="v-price" min="0" step="0.01" value="' + escapeHtml(v.price) + '" placeholder="igual ao do produto"></div>' +
      '</div>' +
      '<div class="var-extra">' +
        '<label class="ed-check"><input type="checkbox" class="v-soldout"' + (v.sold_out ? ' checked' : '') + '><span>Esgotada</span></label>' +
        '<span class="swatch-pick">' + (swatch ? '<img src="' + escapeHtml(prodImgSrc(swatch)) + '" alt="">' : '') +
          '<label class="mini-btn file-btn">' + (swatch ? 'Trocar foto da amostra' : '＋ Foto da amostra (ex.: da pérola)') +
          '<input type="file" accept="image/*" onchange="prodPickSwatch(' + i + ', this)"></label>' +
          (swatch ? '<button type="button" class="mini-btn danger" onclick="prodClearSwatch(' + i + ')">Remover</button>' : '') +
        '</span>' +
        '<button type="button" class="mini-btn danger" style="margin-left:auto;" onclick="prodRemoveVariant(' + i + ')">Excluir opção</button>' +
      '</div>' +
    '</div>';
  }).join('');

  const varOptions = '<option value="">Foto geral (aparece sempre)</option>' + d.variants.map(function(v){
    return '<option value="' + escapeHtml(prodVarRef(v)) + '">' + escapeHtml(v.label || '(sem nome)') + '</option>';
  }).join('');

  const imgCards = d.images.map(function(im, i){
    return '<div class="img-card" data-i="' + i + '">' +
      '<img src="' + escapeHtml(prodImgSrc(im.preview || im.url)) + '" alt="">' +
      '<select class="i-variant">' + varOptions.replace('value="' + (im.variantKey || '') + '"', 'value="' + (im.variantKey || '') + '" selected') + '</select>' +
      '<div class="img-actions">' +
        '<button type="button" class="mini-btn" onclick="prodMoveImage(' + i + ',-1)"' + (i === 0 ? ' disabled' : '') + '>◀</button>' +
        '<button type="button" class="mini-btn" onclick="prodMoveImage(' + i + ',1)"' + (i === d.images.length - 1 ? ' disabled' : '') + '>▶</button>' +
        '<button type="button" class="mini-btn danger" onclick="prodRemoveImage(' + i + ')">✕</button>' +
      '</div>' +
    '</div>';
  }).join('');

  document.getElementById('prodPanelBody').innerHTML =
    '<div class="ed-section">' +
      '<h3>Informações</h3>' +
      '<div class="ed-grid">' +
        '<div class="ed-field"><label for="pf-name">Nome do produto*</label><input type="text" id="pf-name" maxlength="120" value="' + escapeHtml(d.name) + '" oninput="prodNameTyped()"></div>' +
        '<div class="ed-field"><label for="pf-price">Preço (R$)*</label><input type="number" id="pf-price" min="0" step="0.01" value="' + escapeHtml(d.price) + '"></div>' +
      '</div>' +
      '<div class="ed-field"><label for="pf-slug">Endereço no site</label>' +
        '<input type="text" id="pf-slug" maxlength="60" value="' + escapeHtml(d.slug) + '"' + (d.isNew ? ' oninput="prodSlugTyped()"' : ' readonly') + '>' +
        '<p class="ed-hint">' + (d.isNew ? 'Gerado do nome. Fica assim: <strong>' + escapeHtml(PROD_SITE) + '/produto/' + escapeHtml(d.slug || '...') + '</strong>' : 'Não muda depois de criado (é o que mantém cupons e links funcionando).') + '</p></div>' +
      '<div class="ed-field"><label for="pf-tagline">Frase curta (aparece no card da home)</label><input type="text" id="pf-tagline" maxlength="200" value="' + escapeHtml(d.tagline) + '" placeholder="Ex.: Metal dourado com strass e base adesiva."></div>' +
      '<div class="ed-field"><label for="pf-eyebrow">Etiqueta pequena acima do nome (opcional)</label><input type="text" id="pf-eyebrow" maxlength="80" value="' + escapeHtml(d.eyebrow) + '" placeholder="Ex.: Edição devocional"></div>' +
      '<div class="ed-field"><label for="pf-description">Descrição</label><textarea id="pf-description" maxlength="4000">' + escapeHtml(d.description) + '</textarea>' +
        '<p class="ed-hint">Linha em branco separa parágrafos. Linhas começando com <strong>- </strong> viram tópicos. Use <strong>**texto**</strong> para negrito.</p></div>' +
    '</div>' +

    '<div class="ed-section">' +
      '<h3>Como aparece e como vende</h3>' +
      '<div class="ed-checks">' +
        check('active', d.active, 'Visível no site', 'Desmarque para esconder sem apagar.') +
        check('sold_out', d.sold_out, 'Esgotado', 'Continua aparecendo, mas ninguém consegue comprar.') +
        check('is_new', d.is_new, 'Selo "Novidade"') +
        check('featured', d.featured, 'Card grande na home (destaque)', 'Aparece em tamanho grande, acima da lista.') +
        check('has_entremeio', d.has_entremeio, 'A cliente escolhe o santo(a) do entremeio', 'Mostra a lista de entremeios e exige a escolha para comprar.') +
      '</div>' +
    '</div>' +

    '<div class="ed-section">' +
      '<h3>Opções (cores, modelos...)</h3>' +
      '<p class="ed-hint" style="margin:0 0 10px;">Deixe vazio se o produto não tem opções. Cada opção vira uma linha própria no pedido.</p>' +
      '<div class="ed-field" style="max-width:260px;"><label for="pf-optiontitle">Como chamar o seletor</label><input type="text" id="pf-optiontitle" maxlength="30" value="' + escapeHtml(d.option_title) + '" placeholder="Cor, Modelo, Tamanho..."></div>' +
      varRows +
      '<button type="button" class="mini-btn" onclick="prodAddVariant()">＋ Adicionar opção</button>' +
    '</div>' +

    '<div class="ed-section">' +
      '<h3>Fotos</h3>' +
      '<p class="ed-hint" style="margin:0 0 10px;">As fotos são reduzidas automaticamente para carregar rápido. A primeira foto geral é a capa. Você pode ligar uma foto a uma opção (ela aparece quando a cliente escolhe aquela opção).</p>' +
      '<div class="img-grid">' + imgCards + '</div>' +
      '<div style="margin-top:10px;"><label class="mini-btn file-btn">＋ Adicionar fotos<input type="file" accept="image/*" multiple onchange="prodAddImages(this)"></label></div>' +
    '</div>' +

    '<div class="editor-foot">' +
      (d.isNew ? '' : '<button type="button" class="btn-danger" style="width:auto;padding:0 16px;" onclick="deleteProduct()">🗑</button>') +
      '<button type="button" class="btn-ghost" onclick="closeProductEditor()">Cancelar</button>' +
      '<button type="button" class="btn-primary" id="prodSaveBtn" onclick="saveProduct()">Salvar produto</button>' +
    '</div>';
}

/* ---------- ações do editor (sempre "lê o formulário → muda → redesenha") ---------- */
function prodNameTyped(){
  if(!prodDraft || !prodDraft.isNew || prodDraft.slugTouched) return;
  const name = document.getElementById('pf-name').value;
  const slug = prodSlugify(name).slice(0, 60);
  document.getElementById('pf-slug').value = slug;
  prodDraft.slug = slug;
}
function prodSlugTyped(){
  if(!prodDraft) return;
  prodDraft.slugTouched = true;
}
function prodAddVariant(){
  collectProductForm();
  prodDraft.variants.push({ id: null, key: null, tempKey: 'novo' + (++prodTempCounter), cart_id: null, label: '', color: '#cccccc', price: '', sold_out: false, swatch_url: null, swatchFile: null });
  renderProductEditor();
}
function prodRemoveVariant(i){
  collectProductForm();
  const v = prodDraft.variants[i];
  const ref = prodVarRef(v);
  const hasPhotos = prodDraft.images.some(function(im){ return im.variantKey && im.variantKey === ref; });
  if(!window.confirm('Excluir a opção "' + (v.label || 'sem nome') + '"' + (hasPhotos ? ' e as fotos ligadas a ela' : '') + '?')) return;
  if(v.id) prodDraft.removedVariantIds.push(v.id);
  const swPath = prodStoragePath(v.swatch_url); if(swPath) prodDraft.removedPaths.push(swPath);
  prodDraft.images = prodDraft.images.filter(function(im){
    if(im.variantKey === ref){
      if(im.id) prodDraft.removedImageIds.push(im.id);
      const pa = prodStoragePath(im.url); if(pa) prodDraft.removedPaths.push(pa);
      return false;
    }
    return true;
  });
  prodDraft.variants.splice(i, 1);
  renderProductEditor();
}
function prodMoveVariant(i, dir){
  collectProductForm();
  const j = i + dir, arr = prodDraft.variants;
  if(j < 0 || j >= arr.length) return;
  const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  renderProductEditor();
}
function prodPickSwatch(i, input){
  collectProductForm();
  const file = input.files && input.files[0];
  if(!file) return;
  const oldPath = prodStoragePath(prodDraft.variants[i].swatch_url);
  if(oldPath){ prodDraft.removedPaths.push(oldPath); prodDraft.variants[i].swatch_url = null; }
  prodDraft.variants[i].swatchFile = { file: file, preview: URL.createObjectURL(file) };
  renderProductEditor();
}
function prodClearSwatch(i){
  collectProductForm();
  const oldPath = prodStoragePath(prodDraft.variants[i].swatch_url);
  if(oldPath) prodDraft.removedPaths.push(oldPath);
  prodDraft.variants[i].swatchFile = null;
  prodDraft.variants[i].swatch_url = null;
  renderProductEditor();
}
function prodAddImages(input){
  collectProductForm();
  Array.prototype.forEach.call(input.files || [], function(file){
    prodDraft.images.push({ id: null, url: null, variantKey: null, file: file, preview: URL.createObjectURL(file) });
  });
  renderProductEditor();
}
function prodMoveImage(i, dir){
  collectProductForm();
  const j = i + dir, arr = prodDraft.images;
  if(j < 0 || j >= arr.length) return;
  const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  renderProductEditor();
}
function prodRemoveImage(i){
  collectProductForm();
  const im = prodDraft.images[i];
  if(im.id) prodDraft.removedImageIds.push(im.id);
  const pa = prodStoragePath(im.url); if(pa) prodDraft.removedPaths.push(pa);
  prodDraft.images.splice(i, 1);
  renderProductEditor();
}

/* ---------- salvar ---------- */
function validateProductDraft(d){
  if(!d.name.trim()) return 'Dê um nome ao produto.';
  const price = prodNum(d.price);
  if(price == null || Number.isNaN(price) || price < 0 || price > 5000) return 'Informe um preço válido (de 0 a 5.000).';
  if(!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.slug) || d.slug.length > 60) return 'O endereço do produto só pode ter letras minúsculas, números e hífen (ex.: colar-de-perolas).';
  if(d.variants.length && !d.option_title.trim()) return 'Dê um nome ao seletor de opções (ex.: Cor).';
  const seen = {};
  for(let i = 0; i < d.variants.length; i++){
    const v = d.variants[i];
    if(!v.label.trim()) return 'Toda opção precisa de um nome.';
    const vp = prodNum(v.price);
    if(Number.isNaN(vp) || (vp != null && (vp < 0 || vp > 5000))) return 'Preço inválido na opção "' + v.label + '".';
    const k = v.key || prodSlugify(v.label);
    if(!k) return 'O nome da opção "' + v.label + '" precisa ter letras ou números.';
    if(seen[k]) return 'Duas opções têm nomes parecidos demais ("' + v.label + '"). Mude um deles.';
    seen[k] = true;
  }
  if(d.images.length > 30) return 'Muitas fotos (máximo 30).';
  return null;
}

async function saveProduct(){
  collectProductForm();
  const d = prodDraft;
  const err = validateProductDraft(d);
  if(err){ showToast(err); return; }

  const btn = document.getElementById('prodSaveBtn');
  btn.disabled = true; btn.textContent = 'Salvando...';

  try{
    // 1) chaves das opções novas (única dentro do produto) e códigos de carrinho
    const usedKeys = d.variants.filter(function(v){ return v.key; }).map(function(v){ return v.key; });
    const remap = {};
    d.variants.forEach(function(v){
      if(v.key) return;
      let base = prodSlugify(v.label) || 'opcao', k = base, n = 2;
      while(usedKeys.indexOf(k) !== -1){ k = base + '-' + n; n++; }
      remap[v.tempKey] = k;
      v.key = k; usedKeys.push(k);
      v.cart_id = (d.slug + '-' + k).slice(0, 80);
    });
    // fotos ligadas a opções novas passam a apontar para a chave definitiva
    d.images.forEach(function(im){ if(im.variantKey && remap[im.variantKey]) im.variantKey = remap[im.variantKey]; });

    // 2) envia as fotos novas (antes de mexer no banco). Se algo falhar, o rascunho guarda o que já
    //    foi enviado e "Salvar" de novo continua de onde parou, sem enviar tudo outra vez.
    for(const im of d.images){
      if(im.file){ im.url = await prodUploadFile(im.file, d.slug); im.file = null; }
    }
    for(const v of d.variants){
      if(v.swatchFile){ v.swatch_url = await prodUploadFile(v.swatchFile.file, d.slug); v.swatchFile = null; }
    }

    // 3) produto
    const payload = {
      slug: d.slug, name: d.name.trim(), tagline: d.tagline.trim() || null, description: d.description.trim() || null,
      eyebrow: d.eyebrow.trim() || null, option_title: d.option_title.trim() || 'Cor', price: prodNum(d.price),
      has_entremeio: d.has_entremeio, is_new: d.is_new, featured: d.featured, sold_out: d.sold_out, active: d.active,
      sort_order: d.sort_order
    };
    let productId = d.id;
    if(d.isNew){
      const r = await sb.from('products').insert(payload).select().single();
      if(r.error) throw r.error;
      productId = r.data.id; d.id = productId; d.isNew = false;
    } else {
      const r = await sb.from('products').update(payload).eq('id', productId);
      if(r.error) throw r.error;
    }

    // 4) opções: remove, atualiza, cria
    if(d.removedVariantIds.length){
      const r = await sb.from('product_variants').delete().in('id', d.removedVariantIds);
      if(r.error) throw r.error;
    }
    const idByKey = {};
    for(let i = 0; i < d.variants.length; i++){
      const v = d.variants[i];
      const row = { label: v.label.trim(), color: v.color || null, price: prodNum(v.price), sold_out: v.sold_out, swatch_url: v.swatch_url || null, sort_order: (i + 1) * 10 };
      if(v.id){
        const r = await sb.from('product_variants').update(row).eq('id', v.id);
        if(r.error) throw r.error;
        idByKey[v.key] = v.id;
      } else {
        const r = await sb.from('product_variants').insert(Object.assign({ product_id: productId, key: v.key, cart_id: v.cart_id }, row)).select().single();
        if(r.error) throw r.error;
        v.id = r.data.id; idByKey[v.key] = v.id;
      }
    }

    // 5) fotos: remove, atualiza, cria
    if(d.removedImageIds.length){
      const r = await sb.from('product_images').delete().in('id', d.removedImageIds);
      if(r.error) throw r.error;
    }
    for(let i = 0; i < d.images.length; i++){
      const im = d.images[i];
      const row = { variant_id: im.variantKey ? (idByKey[im.variantKey] || null) : null, sort_order: (i + 1) * 10 };
      if(im.id){
        const r = await sb.from('product_images').update(row).eq('id', im.id);
        if(r.error) throw r.error;
      } else {
        const r = await sb.from('product_images').insert(Object.assign({ product_id: productId, url: im.url }, row)).select().single();
        if(r.error) throw r.error;
        im.id = r.data.id;
      }
    }

    // 6) apaga do armazenamento as fotos removidas que estavam lá (melhor esforço)
    const paths = d.removedPaths.concat([]);
    if(paths.length){ try{ await sb.storage.from(PROD_BUCKET).remove(paths); }catch(e){ /* sem problema */ } }

    showToast('Produto salvo ✓');
    closeProductEditor();
    await loadProducts();
  } catch(e){
    console.error(e);
    const msg = String(e && e.message || '');
    if(/duplicate key|already exists|products_slug_key|unique/i.test(msg)) showToast('Já existe um produto (ou opção) com esse nome/endereço. Mude o nome.');
    else if(/violates row-level security|permission denied/i.test(msg)) showToast('Sem permissão. Entre de novo no painel.');
    else showToast('Não foi possível salvar: ' + (msg || 'erro desconhecido'));
    btn.disabled = false; btn.textContent = 'Salvar produto';
  }
}

async function deleteProduct(){
  const d = prodDraft;
  if(!d || !d.id) return;
  if(!window.confirm('Excluir "' + d.name + '" de vez? As fotos e opções dele também serão apagadas. Os pedidos antigos continuam guardados.\n\nSe só quer tirar do site por um tempo, use "Visível" ou "Esgotado".')) return;
  const p = prodList.find(function(x){ return x.id === d.id; });
  const paths = [];
  if(p){
    (p.product_images || []).forEach(function(i){ const pa = prodStoragePath(i.url); if(pa) paths.push(pa); });
    (p.product_variants || []).forEach(function(v){ const pa = prodStoragePath(v.swatch_url); if(pa) paths.push(pa); });
  }
  const r = await sb.from('products').delete().eq('id', d.id);
  if(r.error){ console.error(r.error); showToast('Não foi possível excluir.'); return; }
  if(paths.length){ try{ await sb.storage.from(PROD_BUCKET).remove(paths); }catch(e){} }
  showToast('Produto excluído.');
  closeProductEditor();
  await loadProducts();
}
