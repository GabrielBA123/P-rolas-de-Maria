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

async function finalizarPedido(){
  if(submittingOrder) return; // already in flight — ignore extra clicks
  if(cart.length === 0) return;

  const errorEl = document.getElementById('checkoutError');
  errorEl.style.display = 'none';

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
    // recomputes the total from the items, and returns just {id, order_number}
    const { data, error } = await sb.rpc('create_order', {
      p_customer_name: name,
      p_customer_phone: phone,
      p_customer_address: address,
      p_notes: notes,
      p_items: items
    });

    if(error) throw error;
    const created = Array.isArray(data) ? data[0] : data;

    // hand off to WhatsApp with the order number already in the message
    const orderNumber = '#' + String(created.order_number).padStart(6, '0');
    sendWhatsAppMessage(orderNumber, name, total);

    // 4) reset the cart + modal for a clean next visit
    cart = [];
    renderCart();
    closeCheckoutModal();
    document.getElementById('buyerName').value = '';
    document.getElementById('buyerPhone').value = '';
    document.getElementById('buyerAddress').value = '';
    document.getElementById('buyerNotes').value = '';

  } catch(err){
    console.error('Erro ao salvar pedido:', err);
    if(!navigator.onLine){
      errorEl.textContent = 'Você está sem internet no momento. Verifique sua conexão e tente novamente.';
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

function sendWhatsAppMessage(orderNumber, name, total){
  const lines = cart.map(function(i){
    return '- ' + i.qty + 'x ' + i.name + ' (' + formatBRL(i.price * i.qty) + ')';
  });
  const msg = 'Olá! Fiz um pedido na Pérolas de Maria ' + orderNumber + ':\n\n' +
    lines.join('\n') +
    '\n\nTotal: ' + formatBRL(total) +
    '\nNome: ' + name +
    '\n\nJá vou enviar o comprovante do Pix aqui.';
  const url = 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(msg);
  window.open(url, '_blank');
}
