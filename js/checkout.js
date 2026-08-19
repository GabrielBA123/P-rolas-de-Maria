/* ==========================================================================
   checkout.js
   Runs when the customer clicks "Enviar pedido no WhatsApp" in the
   checkout modal. Relies on `cart`, `cartTotal()`, `formatBRL()` and
   `closeCheckoutModal()` from main.js, and on `sb` from
   supabase-client.js.
   ========================================================================== */

const WHATSAPP_NUMBER = '5532999976067'; // country+area+number, no symbols
const PIX_KEY = '32999976067';

let submittingOrder = false; // guards against double-clicks / duplicate orders

// Client-side throttle: this is just a cheap first line of defense to
// discourage casual abuse (a person mashing the button, or a very basic
// bot). It does NOT stop a determined attacker — anyone can bypass
// client-side JS entirely — so the real protection is the rate limit
// inside create_order() in sql/schema.sql, which runs on the server and
// can't be skipped. Keep both: this one gives instant feedback without
// a network round-trip, the DB one is the actual security boundary.
const ORDER_TIMES_KEY = 'pdm-order-times';
function getRecentOrderTimes(){
  try{
    const raw = sessionStorage.getItem(ORDER_TIMES_KEY);
    const times = raw ? JSON.parse(raw) : [];
    const cutoff = Date.now() - 10 * 60 * 1000; // 10 minutes
    return times.filter(function(t){ return t > cutoff; });
  }catch(e){ return []; }
}
function recordOrderTime(){
  try{
    const times = getRecentOrderTimes();
    times.push(Date.now());
    sessionStorage.setItem(ORDER_TIMES_KEY, JSON.stringify(times));
  }catch(e){ /* sessionStorage unavailable — skip, DB rate limit still applies */ }
}

async function finalizarPedido(){
  if(submittingOrder) return; // already in flight — ignore extra clicks
  if(cart.length === 0) return;

  const errorEl = document.getElementById('checkoutError');
  errorEl.style.display = 'none';

  // Honeypot: real visitors never see or fill this field (see the CSS in
  // the HTML). If it's filled, a bot's autofill did it — pretend the
  // submission worked (don't tip the bot off) but never touch Supabase.
  const honeypot = document.getElementById('buyerWebsite');
  if(honeypot && honeypot.value.trim() !== ''){
    return;
  }

  if(getRecentOrderTimes().length >= 3){
    errorEl.textContent = 'Você já enviou pedidos recentemente. Aguarde alguns minutos antes de tentar novamente, ou fale com a gente pelo WhatsApp.';
    errorEl.style.display = 'block';
    return;
  }

  // If js/supabase-client.js still has the placeholder URL/key, `sb` is
  // null on purpose (see that file) — fail with a clear, honest message
  // instead of letting every attempt blame "sem internet".
  if(!SUPABASE_CONFIGURED){
    errorEl.textContent = 'O site ainda não está conectado ao banco de dados (Supabase). Veja o passo 3 do README.';
    errorEl.style.display = 'block';
    return;
  }

  const name = document.getElementById('buyerName').value.trim();
  const phone = document.getElementById('buyerPhone').value.trim();
  const address = document.getElementById('buyerAddress').value.trim();
  const notes = document.getElementById('buyerNotes').value.trim();

  // ---- basic validation (the real validation is the DB's NOT NULL /
  // CHECK constraints — this is just to give the customer a fast,
  // friendly error instead of a failed network request) ----
  if(!name || !phone || !address){
    errorEl.textContent = 'Preencha nome, telefone e endereço para continuar.';
    errorEl.style.display = 'block';
    return;
  }

  const whatsBtn = document.getElementById('whatsBtn');
  submittingOrder = true;
  whatsBtn.disabled = true;
  const originalLabel = whatsBtn.textContent;
  whatsBtn.textContent = 'Enviando pedido...';

  try{
    const total = cartTotal();

    // build the items payload the create_order() RPC expects
    const items = cart.map(function(i){
      return {
        product_name: i.name,
        quantity: i.qty,
        unit_price: i.price,
        line_total: i.price * i.qty,
        details: i.customDetails || null
      };
    });

    // one atomic call: creates the order + all its items server-side,
    // recomputes the total from the items, and returns just {id, order_number}.
    // Wrapped with a timeout so a hung connection doesn't leave the
    // customer staring at "Enviando pedido..." forever.
    const rpcPromise = sb.rpc('create_order', {
      p_customer_name: name,
      p_customer_phone: phone,
      p_customer_address: address,
      p_notes: notes,
      p_items: items
    });
    const timeoutPromise = new Promise(function(_, reject){
      setTimeout(function(){ reject(new Error('TIMEOUT')); }, 15000);
    });
    const { data, error } = await Promise.race([rpcPromise, timeoutPromise]);

    if(error) throw error;
    const created = Array.isArray(data) ? data[0] : data;
    recordOrderTime();

    // hand off to WhatsApp with the order number already in the message
    const orderNumber = '#' + String(created.order_number).padStart(6, '0');
    const whatsappUrl = buildWhatsAppUrl(orderNumber, name, total);
    window.open(whatsappUrl, '_blank');

    // show a confirmation screen instead of silently closing the modal —
    // if the WhatsApp tab didn't open (common on iOS Safari) the customer
    // still sees their order was saved and gets a button to retry it
    showCheckoutSuccess(orderNumber, whatsappUrl);

    // reset the cart for a clean next visit
    cart = [];
    renderCart();
    document.getElementById('buyerName').value = '';
    document.getElementById('buyerPhone').value = '';
    document.getElementById('buyerAddress').value = '';
    document.getElementById('buyerNotes').value = '';

  } catch(err){
    console.error('Erro ao salvar pedido:', err);
    if(err && err.message === 'TIMEOUT'){
      errorEl.textContent = 'A conexão está demorando mais que o normal. Verifique sua internet e tente novamente — se o problema continuar, chame a gente no WhatsApp.';
    } else if(!navigator.onLine){
      errorEl.textContent = 'Você está sem internet no momento. Verifique sua conexão e tente novamente.';
    } else if(err && err.message && err.message.indexOf('Você já enviou pedidos') === 0){
      // Server-side rate limit from create_order() — already a complete,
      // friendly sentence, so show it as-is instead of prefixing it.
      errorEl.textContent = err.message;
    } else if(err && err.message){
      // Supabase/Postgres errors come with a readable .message
      // (e.g. our own "O pedido precisa ter ao menos um item.")
      errorEl.textContent = 'Não foi possível registrar o pedido: ' + err.message;
    } else {
      errorEl.textContent = 'Não foi possível registrar o pedido agora. Tente novamente em instantes.';
    }
    errorEl.style.display = 'block';
  } finally {
    submittingOrder = false;
    whatsBtn.disabled = false;
    whatsBtn.textContent = originalLabel;
  }
}

function buildWhatsAppMessage(orderNumber, name, total){
  const lines = cart.map(function(i){
    return '- ' + i.qty + 'x ' + i.name + ' (' + formatBRL(i.price * i.qty) + ')';
  });
  return 'Olá! Fiz um pedido na Pérolas de Maria ' + orderNumber + ':\n\n' +
    lines.join('\n') +
    '\n\nTotal: ' + formatBRL(total) +
    '\nNome: ' + name +
    '\n\nJá vou enviar o comprovante do Pix aqui.';
}

function buildWhatsAppUrl(orderNumber, name, total){
  const msg = buildWhatsAppMessage(orderNumber, name, total);
  return 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(msg);
}
