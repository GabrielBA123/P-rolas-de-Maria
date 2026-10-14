// Leitura (somente leitura, chave pública) do Supabase para as funções do servidor.
// Usa as MESMAS credenciais do site (js/supabase-client.js) — nada novo para configurar.
const fs = require('fs');
const path = require('path');

let cfg = null;
function config() {
  if (cfg) return cfg;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    return (cfg = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_ANON_KEY });
  }
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'supabase-client.js'), 'utf8');
  const u = /SUPABASE_URL\s*=\s*'([^']+)'/.exec(src);
  const k = /SUPABASE_ANON_KEY\s*=\s*'([^']+)'/.exec(src);
  if (!u || !k) throw new Error('Credenciais do Supabase não encontradas');
  return (cfg = { url: u[1], key: k[1] });
}

async function rest(pathAndQuery, timeoutMs) {
  const { url, key } = config();
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 6000);
  try {
    const r = await fetch(url + '/rest/v1/' + pathAndQuery, {
      headers: { apikey: key, Accept: 'application/json' },
      signal: ctrl.signal
    });
    if (!r.ok) throw new Error('Supabase respondeu ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { config, rest };
