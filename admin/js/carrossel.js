/* ==========================================================================
   carrossel.js (painel) — Pérolas de Maria admin panel
   Aba "Carrossel": edita os slides do topo da home (tabela carousel_slides).
   A imagem do slide pode ser escolhida entre as fotos que o site já tem
   (produtos e slides) — não precisa enviar nada. Enviar uma foto nova é
   opcional (vai para o mesmo armazenamento dos produtos).
   ========================================================================== */

let slideList = [];            // slides (todos, inclusive desligados), na ordem
let slideLoaded = false;
let slideDraft = null;
let slidePhotoChoices = [];    // fotos disponíveis para escolher: [{ url, label }]
let slideProducts = [];        // produtos, para o campo "Para onde leva"

function slideImgSrc(u){
  if(!u) return '/assets/images/logo.jpg';
  if(/^(blob:|data:|https?:)/.test(u)) return u;
  return '/' + String(u).replace(/^\/+/, '');
}

/* ---------- carregar ---------- */
async function loadSlides(){
  const [s, p] = await Promise.all([
    sb.from('carousel_slides').select('*').order('sort_order', { ascending: true }),
    sb.from('products').select('slug, name, product_images(url, sort_order)').order('sort_order', { ascending: true })
  ]);
  if(s.error || p.error){ console.error(s.error || p.error); showToast('Erro ao carregar o carrossel.'); return; }
  slideList = s.data || [];
  slideProducts = p.data || [];

  // fotos para escolher: as dos produtos + as que já estão em slides (sem repetir)
  const seen = {}; slidePhotoChoices = [];
  const add = function(url, label){ if(url && !seen[url]){ seen[url] = true; slidePhotoChoices.push({ url: url, label: label }); } };
  slideProducts.forEach(function(prod){
    (prod.product_images || []).slice().sort(function(a, b){ return a.sort_order - b.sort_order; }).forEach(function(im){ add(im.url, prod.name); });
  });
  slideList.forEach(function(sl){ add(sl.image_url, sl.title); });

  slideLoaded = true;
  renderSlides();
}

function renderSlides(){
  document.getElementById('slideList').innerHTML = slideList.map(function(s, i){
    const id = escapeHtml(s.id);
    return '<div class="prod-row' + (s.active ? '' : ' hidden-prod') + '">' +
      '<div class="move-btns">' +
        '<button class="mini-btn" type="button" onclick="moveSlide(\'' + id + '\',-1)"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
        '<button class="mini-btn" type="button" onclick="moveSlide(\'' + id + '\',1)"' + (i === slideList.length - 1 ? ' disabled' : '') + '>▼</button>' +
      '</div>' +
      '<img class="slide-thumb" src="' + escapeHtml(slideImgSrc(s.image_url)) + '" alt="">' +
      '<div class="prod-main">' +
        '<div class="prod-name">' + escapeHtml(s.title) + '</div>' +
        '<div class="prod-meta">' + (s.eyebrow ? '<span class="chip">' + escapeHtml(s.eyebrow) + '</span>' : '') +
          '<span>' + escapeHtml(s.text || '') + '</span></div>' +
      '</div>' +
      '<div class="prod-actions">' +
        '<button class="mini-btn' + (s.active ? ' on' : '') + '" type="button" onclick="toggleSlide(\'' + id + '\')">' + (s.active ? 'Visível' : 'Oculto') + '</button>' +
        '<button class="mini-btn" type="button" onclick="openSlideEditor(\'' + id + '\')">✏️ Editar</button>' +
      '</div>' +
    '</div>';
  }).join('');
  document.getElementById('slideEmpty').style.display = slideList.length ? 'none' : 'block';
}

async function toggleSlide(id){
  const s = slideList.find(function(x){ return x.id === id; });
  if(!s) return;
  const { error } = await sb.from('carousel_slides').update({ active: !s.active }).eq('id', id);
  if(error){ console.error(error); showToast('Não foi possível salvar.'); return; }
  s.active = !s.active;
  renderSlides();
  showToast('Slide ' + (s.active ? 'visível' : 'oculto') + ' (aparece na home em instantes)');
}

async function moveSlide(id, dir){
  const i = slideList.findIndex(function(x){ return x.id === id; });
  const j = i + dir;
  if(i < 0 || j < 0 || j >= slideList.length) return;
  const a = slideList[i], b = slideList[j];
  let sa = a.sort_order, sb_ = b.sort_order;
  if(sa === sb_){ sb_ = sa + (dir > 0 ? 1 : -1); }
  const r1 = await sb.from('carousel_slides').update({ sort_order: sb_ }).eq('id', a.id);
  const r2 = await sb.from('carousel_slides').update({ sort_order: sa }).eq('id', b.id);
  if(r1.error || r2.error){ showToast('Não foi possível reordenar.'); return; }
  await loadSlides();
}

document.getElementById('slideNewBtn').addEventListener('click', function(){ openSlideEditor(null); });
document.querySelectorAll('.admin-tab').forEach(function(tab){
  tab.addEventListener('click', function(){
    if(tab.dataset.tab === 'carrossel') loadSlides();
  });
});

/* ==========================================================================
   EDITOR
   ========================================================================== */
const slideOverlay = document.getElementById('slideOverlay');
const slidePanel = document.getElementById('slidePanel');
document.getElementById('slidePanelClose').addEventListener('click', closeSlideEditor);
slideOverlay.addEventListener('click', closeSlideEditor);

function closeSlideEditor(){
  slideOverlay.classList.remove('show');
  slidePanel.classList.remove('show');
  slideDraft = null;
}

// "Para onde leva": os caminhos comuns viram opções; qualquer outro vira "outro endereço"
function slideLinkChoice(link){
  if(link === '#produtos' || link === '#personalizados') return link;
  const m = /^\/produto\/([a-z0-9-]+)$/.exec(link || '');
  if(m && slideProducts.some(function(p){ return p.slug === m[1]; })) return link;
  return '__outro__';
}

function openSlideEditor(id){
  const s = id ? slideList.find(function(x){ return x.id === id; }) : null;
  const link = s ? s.link : '#produtos';
  slideDraft = {
    id: s ? s.id : null,
    isNew: !s,
    image_url: s ? s.image_url : '',
    pendingFile: null,
    pendingPreview: null,
    eyebrow: s && s.eyebrow || '',
    title: s ? s.title : '',
    text: s && s.text || '',
    cta_text: s && s.cta_text || '',
    linkChoice: slideLinkChoice(link),
    linkCustom: slideLinkChoice(link) === '__outro__' ? link : '',
    active: s ? s.active : true,
    sort_order: s ? s.sort_order : (slideList.reduce(function(m, x){ return Math.max(m, x.sort_order); }, 0) + 10)
  };
  if(!slideLoaded){ loadSlides().then(renderSlideEditor); }
  renderSlideEditor();
  slideOverlay.classList.add('show');
  slidePanel.classList.add('show');
}

function collectSlideForm(){
  const root = document.getElementById('slidePanelBody');
  if(!slideDraft || !root.querySelector('#sf-title')) return;
  const d = slideDraft;
  d.eyebrow = root.querySelector('#sf-eyebrow').value;
  d.title = root.querySelector('#sf-title').value;
  d.text = root.querySelector('#sf-text').value;
  d.cta_text = root.querySelector('#sf-cta').value;
  d.linkChoice = root.querySelector('#sf-link').value;
  d.linkCustom = root.querySelector('#sf-linkcustom').value;
  d.active = root.querySelector('#sf-active').checked;
}

function slidePreviewUrl(d){ return d.pendingPreview || d.image_url; }

function renderSlideEditor(){
  const d = slideDraft;
  if(!d) return;
  document.getElementById('slidePanelTitle').textContent = d.isNew ? 'Novo slide' : 'Editar slide';
  document.getElementById('slidePanelSub').textContent = '';

  const linkOptions = [
    ['#produtos', 'Lista de produtos (rola até os terços)'],
    ['#personalizados', 'Terços personalizados']
  ].concat(slideProducts.map(function(p){ return ['/produto/' + p.slug, 'Página: ' + p.name]; }))
   .concat([['__outro__', 'Outro endereço...']]);

  const photos = slidePhotoChoices.map(function(ph){
    return '<button type="button" class="' + (ph.url === d.image_url && !d.pendingFile ? 'selected' : '') + '" title="' + escapeHtml(ph.label) +
      '" onclick="slidePickPhoto(' + escapeHtml(JSON.stringify(ph.url)) + ')"><img src="' + escapeHtml(slideImgSrc(ph.url)) + '" alt=""></button>';
  }).join('');

  document.getElementById('slidePanelBody').innerHTML =
    '<div class="slide-preview">' +
      (slidePreviewUrl(d) ? '<img src="' + escapeHtml(slideImgSrc(slidePreviewUrl(d))) + '" alt="">' : '') +
      '<div class="ov"><small>' + escapeHtml(d.eyebrow) + '</small><strong>' + escapeHtml(d.title || 'Título do slide') + '</strong><span>' + escapeHtml(d.text) + '</span><span style="color:var(--gold-light);font-weight:600;">' + escapeHtml(d.cta_text) + '</span></div>' +
    '</div>' +
    '<div class="ed-section">' +
      '<h3>Imagem</h3>' +
      '<p class="ed-hint" style="margin:0 0 8px;">Toque numa foto que o site já tem. A imagem fica melhor se for larga (horizontal); ela é cortada para caber no formato do carrossel.</p>' +
      '<div class="pick-grid">' + photos + '</div>' +
      '<div style="margin-top:10px;"><label class="mini-btn file-btn">' + (d.pendingFile ? 'Trocar a foto enviada' : '＋ Enviar uma foto nova (opcional)') +
        '<input type="file" accept="image/*" onchange="slidePickFile(this)"></label></div>' +
    '</div>' +
    '<div class="ed-section">' +
      '<h3>Textos</h3>' +
      '<div class="ed-field"><label for="sf-title">Título*</label><input type="text" id="sf-title" maxlength="80" value="' + escapeHtml(d.title) + '" oninput="slideLivePreview()"></div>' +
      '<div class="ed-field"><label for="sf-text">Frase de apoio</label><input type="text" id="sf-text" maxlength="160" value="' + escapeHtml(d.text) + '" oninput="slideLivePreview()" placeholder="Ex.: Feitos à mão, um a um."></div>' +
      '<div class="ed-grid">' +
        '<div class="ed-field"><label for="sf-eyebrow">Etiqueta pequena</label><input type="text" id="sf-eyebrow" maxlength="40" value="' + escapeHtml(d.eyebrow) + '" oninput="slideLivePreview()" placeholder="Ex.: ✦ Novidade"></div>' +
        '<div class="ed-field"><label for="sf-cta">Texto do link</label><input type="text" id="sf-cta" maxlength="30" value="' + escapeHtml(d.cta_text) + '" oninput="slideLivePreview()" placeholder="Ex.: Ver terço →"></div>' +
      '</div>' +
      '<p class="ed-hint">Se você citar preço no texto, lembre de atualizar aqui quando o preço mudar no painel.</p>' +
    '</div>' +
    '<div class="ed-section">' +
      '<h3>Para onde leva</h3>' +
      '<div class="ed-field"><select id="sf-link" onchange="slideLinkChanged()">' + linkOptions.map(function(o){
        return '<option value="' + escapeHtml(o[0]) + '"' + (o[0] === d.linkChoice ? ' selected' : '') + '>' + escapeHtml(o[1]) + '</option>';
      }).join('') + '</select></div>' +
      '<div class="ed-field" id="sf-linkcustom-wrap" style="display:' + (d.linkChoice === '__outro__' ? 'block' : 'none') + ';">' +
        '<input type="text" id="sf-linkcustom" maxlength="300" value="' + escapeHtml(d.linkCustom) + '" placeholder="/produto/nome  ou  https://...">' +
        '<p class="ed-hint">Só endereços do próprio site (começando com / ou #) ou https://.</p></div>' +
      '<div class="ed-checks"><label class="ed-check"><input type="checkbox" id="sf-active"' + (d.active ? ' checked' : '') + '><span>Visível no carrossel</span></label></div>' +
    '</div>' +
    '<div class="editor-foot">' +
      (d.isNew ? '' : '<button type="button" class="btn-danger" style="width:auto;padding:0 16px;" onclick="deleteSlide()">🗑</button>') +
      '<button type="button" class="btn-ghost" onclick="closeSlideEditor()">Cancelar</button>' +
      '<button type="button" class="btn-primary" id="slideSaveBtn" onclick="saveSlide()">Salvar slide</button>' +
    '</div>';
}

function slideLivePreview(){
  collectSlideForm();
  const d = slideDraft, ov = document.querySelector('#slidePanelBody .slide-preview .ov');
  if(!ov) return;
  ov.innerHTML = '<small>' + escapeHtml(d.eyebrow) + '</small><strong>' + escapeHtml(d.title || 'Título do slide') + '</strong><span>' + escapeHtml(d.text) +
    '</span><span style="color:var(--gold-light);font-weight:600;">' + escapeHtml(d.cta_text) + '</span>';
}
function slideLinkChanged(){
  const v = document.getElementById('sf-link').value;
  document.getElementById('sf-linkcustom-wrap').style.display = v === '__outro__' ? 'block' : 'none';
}
function slidePickPhoto(url){
  collectSlideForm();
  slideDraft.image_url = url;
  slideDraft.pendingFile = null; slideDraft.pendingPreview = null;
  renderSlideEditor();
}
function slidePickFile(input){
  collectSlideForm();
  const file = input.files && input.files[0];
  if(!file) return;
  slideDraft.pendingFile = file;
  slideDraft.pendingPreview = URL.createObjectURL(file);
  renderSlideEditor();
}

/* ---------- salvar ---------- */
function slideFinalLink(d){
  return d.linkChoice === '__outro__' ? d.linkCustom.trim() : d.linkChoice;
}

async function saveSlide(){
  collectSlideForm();
  const d = slideDraft;
  if(!d.title.trim()){ showToast('Dê um título ao slide.'); return; }
  if(!d.image_url && !d.pendingFile){ showToast('Escolha uma imagem para o slide.'); return; }
  const link = slideFinalLink(d);
  if(!/^(\/|#|https:\/\/)/.test(link) || link.length > 300){ showToast('O endereço do link precisa começar com /, # ou https://'); return; }

  const btn = document.getElementById('slideSaveBtn');
  btn.disabled = true; btn.textContent = 'Salvando...';
  try{
    if(d.pendingFile){
      d.image_url = await prodUploadFile(d.pendingFile, 'carrossel');     // mesma rotina de envio dos produtos
      d.pendingFile = null; d.pendingPreview = null;
    }
    const row = {
      image_url: d.image_url, eyebrow: d.eyebrow.trim() || null, title: d.title.trim(), text: d.text.trim() || null,
      cta_text: d.cta_text.trim() || null, link: link, active: d.active, sort_order: d.sort_order
    };
    if(d.isNew){
      const r = await sb.from('carousel_slides').insert(row);
      if(r.error) throw r.error;
    } else {
      const r = await sb.from('carousel_slides').update(row).eq('id', d.id);
      if(r.error) throw r.error;
    }
    showToast('Slide salvo ✓ (aparece na home em instantes)');
    closeSlideEditor();
    await loadSlides();
  } catch(e){
    console.error(e);
    const msg = String(e && e.message || '');
    if(/violates row-level security|permission denied/i.test(msg)) showToast('Sem permissão. Entre de novo no painel.');
    else showToast('Não foi possível salvar: ' + (msg || 'erro desconhecido'));
    btn.disabled = false; btn.textContent = 'Salvar slide';
  }
}

async function deleteSlide(){
  const d = slideDraft;
  if(!d || !d.id) return;
  if(!window.confirm('Excluir o slide "' + d.title + '"?\n\nSe só quer tirar por um tempo, use "Visível".')) return;
  const r = await sb.from('carousel_slides').delete().eq('id', d.id);
  if(r.error){ console.error(r.error); showToast('Não foi possível excluir.'); return; }
  showToast('Slide excluído.');
  closeSlideEditor();
  await loadSlides();
}
