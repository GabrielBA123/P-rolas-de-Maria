/* ==========================================================================
   calculadora.js — Pérolas de Maria admin panel
   Materials + terço-model pricing calculator (tab: "Calculadora de Preço").
   Nothing here talks to the orders tables — see admin.js for that.
   ========================================================================== */

const MATERIAL_KEYS = ['perolas', 'crucifixo', 'entremeio', 'fio', 'embalagem', 'outros'];

let materials = [];        // [{id, key, label, unit_cost}, ...] — loaded from price_materials
let savedModels = [];      // [{id, name, qty_..., margin_percent}, ...] — loaded from price_models
let editingModelId = null; // set while editing an existing saved model
let calcTabLoaded = false; // lazy-load guard, only fetch once the tab is opened

function calcFormatBRL(v){
  return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
}

/* ==========================================================================
   Tab switching
   ========================================================================== */
document.querySelectorAll('.admin-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab' + capitalize(tab.dataset.tab)).classList.add('active');
    if(tab.dataset.tab === 'calculadora' && !calcTabLoaded){
      calcTabLoaded = true;
      initCalculadora();
    }
  });
});
function capitalize(s){ return s.charAt(0).toUpperCase() + s.slice(1); }

/* ==========================================================================
   Init: load materials + saved models, render the material cost inputs
   and the (empty) model quantity inputs
   ========================================================================== */
async function initCalculadora(){
  renderMaterialsList([]); // placeholder rows while loading
  renderModelQtyInputs();
  wireMarginChoice();
  wireLiveCalc();
  await loadMaterials();
  await loadModels();
}

async function loadMaterials(){
  const { data, error } = await sb.from('price_materials').select('*').order('key');
  if(error){ showToast('Erro ao carregar materiais.'); console.error(error); return; }
  materials = data;
  renderMaterialsList(materials);
  updateCalcResult();
  renderModelsList();
}

function renderMaterialsList(list){
  const el = document.getElementById('materialsList');
  if(list.length === 0){
    el.innerHTML = MATERIAL_KEYS.map(k =>
      `<div class="material-row"><label>Carregando...</label><div></div></div>`
    ).join('');
    return;
  }
  el.innerHTML = list.map(m => `
    <div class="material-row">
      <label for="mat-${m.key}">${m.label}</label>
      <div class="cost-input">
        <span>R$</span>
        <input type="number" id="mat-${m.key}" min="0" step="0.0001" value="${m.unit_cost}">
      </div>
    </div>
  `).join('');
  // any edit to a material cost updates the live preview immediately
  list.forEach(m => {
    document.getElementById('mat-' + m.key).addEventListener('input', updateCalcResult);
  });
}

document.getElementById('saveMaterialsBtn').addEventListener('click', async () => {
  const updates = materials.map(m => {
    const val = parseFloat(document.getElementById('mat-' + m.key).value) || 0;
    return sb.from('price_materials').update({ unit_cost: val }).eq('id', m.id);
  });
  const results = await Promise.all(updates);
  const failed = results.find(r => r.error);
  if(failed){ showToast('Erro ao salvar custos.'); console.error(failed.error); return; }
  showToast('Custos dos materiais salvos.');
  await loadMaterials();
});

/* ==========================================================================
   Model quantity inputs (the "how many units does this model use" form)
   ========================================================================== */
function renderModelQtyInputs(){
  const labels = { perolas: 'Pérolas (un)', crucifixo: 'Crucifixo (un)', entremeio: 'Entremeio (un)',
    fio: 'Fio (un)', embalagem: 'Embalagem (un)', outros: 'Outros (un)' };
  const el = document.getElementById('modelQtyInputs');
  el.innerHTML = MATERIAL_KEYS.map(k => `
    <div class="field">
      <label for="qty-${k}">${labels[k]}</label>
      <input type="number" id="qty-${k}" min="0" step="1" value="0">
    </div>
  `).join('');
  MATERIAL_KEYS.forEach(k => {
    document.getElementById('qty-' + k).addEventListener('input', updateCalcResult);
  });
}

function wireMarginChoice(){
  document.querySelectorAll('#marginChoice .choice-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#marginChoice .choice-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('marginCustom').value = '';
      updateCalcResult();
    });
  });
}

function wireLiveCalc(){
  document.getElementById('modelName').addEventListener('input', () => {}); // name doesn't affect price, no-op
  document.getElementById('marginCustom').addEventListener('input', (e) => {
    if(e.target.value !== ''){
      document.querySelectorAll('#marginChoice .choice-btn').forEach(b => b.classList.remove('selected'));
    }
    updateCalcResult();
  });
}

function getCurrentMargin(){
  const custom = document.getElementById('marginCustom').value;
  if(custom !== '') return parseFloat(custom) || 0;
  const selected = document.querySelector('#marginChoice .choice-btn.selected');
  return selected ? parseFloat(selected.dataset.margin) : 50;
}

function getMaterialCost(key){
  const m = materials.find(x => x.key === key);
  return m ? Number(m.unit_cost) : 0;
}

function calcModelPrice(qtyByKey, marginPercent){
  const custo = MATERIAL_KEYS.reduce((sum, k) => sum + getMaterialCost(k) * (qtyByKey[k] || 0), 0);
  const lucro = custo * (marginPercent / 100);
  const preco = custo + lucro;
  return { custo, lucro, preco };
}

function updateCalcResult(){
  const qty = {};
  MATERIAL_KEYS.forEach(k => {
    const input = document.getElementById('qty-' + k);
    qty[k] = input ? parseFloat(input.value) || 0 : 0;
  });
  const margin = getCurrentMargin();
  const { custo, lucro, preco } = calcModelPrice(qty, margin);

  document.getElementById('calcResult').innerHTML = `
    <div class="row"><strong>Custo total:</strong><span>${calcFormatBRL(custo)}</span></div>
    <div class="row"><strong>Margem:</strong><span>${margin}%</span></div>
    <div class="row"><strong>Lucro:</strong><span>${calcFormatBRL(lucro)}</span></div>
    <div class="total"><span>Preço final</span><span>${calcFormatBRL(preco)}</span></div>
  `;
}

/* ==========================================================================
   Clear / Save / Edit / Delete model
   ========================================================================== */
document.getElementById('clearModelBtn').addEventListener('click', () => {
  editingModelId = null;
  document.getElementById('modelFormTitle').textContent = 'Novo modelo de terço';
  document.getElementById('modelName').value = '';
  MATERIAL_KEYS.forEach(k => { document.getElementById('qty-' + k).value = 0; });
  document.getElementById('marginCustom').value = '';
  document.querySelectorAll('#marginChoice .choice-btn').forEach(b =>
    b.classList.toggle('selected', b.dataset.margin === '50')
  );
  updateCalcResult();
});

document.getElementById('saveModelBtn').addEventListener('click', async () => {
  const name = document.getElementById('modelName').value.trim();
  if(!name){ showToast('Dê um nome para o modelo.'); return; }

  const payload = { name, margin_percent: getCurrentMargin() };
  MATERIAL_KEYS.forEach(k => {
    payload['qty_' + k] = parseFloat(document.getElementById('qty-' + k).value) || 0;
  });

  const query = editingModelId
    ? sb.from('price_models').update(payload).eq('id', editingModelId)
    : sb.from('price_models').insert(payload);

  const { error } = await query;
  if(error){ showToast('Erro ao salvar modelo.'); console.error(error); return; }

  showToast(editingModelId ? 'Modelo atualizado.' : 'Modelo salvo.');
  document.getElementById('clearModelBtn').click();
  await loadModels();
});

async function loadModels(){
  const { data, error } = await sb.from('price_models').select('*').order('name');
  if(error){ showToast('Erro ao carregar modelos.'); console.error(error); return; }
  savedModels = data;
  renderModelsList();
}

function renderModelsList(){
  const el = document.getElementById('modelsList');
  if(savedModels.length === 0){
    el.innerHTML = '<p class="sub">Nenhum modelo salvo ainda.</p>';
    return;
  }
  el.innerHTML = savedModels.map(m => {
    const qty = {};
    MATERIAL_KEYS.forEach(k => { qty[k] = m['qty_' + k]; });
    const { preco } = calcModelPrice(qty, m.margin_percent);
    return `
      <div class="model-card">
        <div class="model-head">
          <div>
            <h5>${escapeHtmlCalc(m.name)}</h5>
            <div class="model-price">${calcFormatBRL(preco)} · margem ${m.margin_percent}%</div>
          </div>
          <div class="model-actions">
            <button onclick="editModel('${m.id}')">Editar</button>
            <button class="danger" onclick="deleteModel('${m.id}')">Excluir</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function editModel(id){
  const m = savedModels.find(x => x.id === id);
  if(!m) return;
  editingModelId = id;
  document.getElementById('modelFormTitle').textContent = 'Editando: ' + m.name;
  document.getElementById('modelName').value = m.name;
  MATERIAL_KEYS.forEach(k => { document.getElementById('qty-' + k).value = m['qty_' + k]; });

  const presetBtn = document.querySelector('#marginChoice .choice-btn[data-margin="' + m.margin_percent + '"]');
  document.querySelectorAll('#marginChoice .choice-btn').forEach(b => b.classList.remove('selected'));
  if(presetBtn){
    presetBtn.classList.add('selected');
    document.getElementById('marginCustom').value = '';
  } else {
    document.getElementById('marginCustom').value = m.margin_percent;
  }
  updateCalcResult();
  document.getElementById('modelFormTitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function deleteModel(id){
  const m = savedModels.find(x => x.id === id);
  if(!m) return;
  if(!window.confirm('Excluir o modelo "' + m.name + '"?')) return;
  const { error } = await sb.from('price_models').delete().eq('id', id);
  if(error){ showToast('Erro ao excluir modelo.'); console.error(error); return; }
  showToast('Modelo excluído.');
  if(editingModelId === id) document.getElementById('clearModelBtn').click();
  await loadModels();
}

function escapeHtmlCalc(s){
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}
