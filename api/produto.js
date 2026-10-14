// Página de cada produto: /produto/<endereço>  (ver "rewrites" em vercel.json)
// Monta o HTML no servidor a partir do Supabase, para o Google e a prévia de link
// (WhatsApp, Instagram) enxergarem o nome, a foto e o preço do produto.
const fs = require('fs');
const path = require('path');
const R = require('../js/product-render.js');
const { rest } = require('./_supabase.js');

const SITE = 'https://perolas-de-maria.vercel.app';
let TEMPLATE = null;
function template() {
  return TEMPLATE || (TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'produto-template.html'), 'utf8'));
}

function send(res, status, html, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.end(html);
}

function simplePage(title, message) {
  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<meta name="robots" content="noindex"><title>' + R.esc(title) + ' | Pérolas de Maria</title>' +
    '<style>body{font-family:Georgia,serif;background:#FAF4E8;color:#2B2419;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center}' +
    'a{color:#AD8A3B;font-weight:bold}</style></head><body><div><h1>' + R.esc(title) + '</h1><p>' + R.esc(message) +
    '</p><p><a href="/#produtos">← Ver todos os produtos</a></p></div></body></html>';
}

module.exports = async function handler(req, res) {
  var slug = String((req.query && req.query.slug) || '').toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 60) {
    return send(res, 404, simplePage('Produto não encontrado', 'Esse endereço não existe mais.'), 'public, s-maxage=30');
  }

  var rows;
  try {
    rows = await rest('products?slug=eq.' + encodeURIComponent(slug) +
      '&active=eq.true&select=*,product_variants(*),product_images(*)&limit=1');
  } catch (e) {
    return send(res, 503, simplePage('Estamos com uma instabilidade', 'Não conseguimos carregar o produto agora. Tente de novo em instantes.'), 'no-store');
  }
  if (!rows || !rows.length) {
    return send(res, 404, simplePage('Produto não encontrado', 'Esse produto não está mais disponível.'), 'public, s-maxage=30');
  }

  var p = R.normalize(rows[0]);
  var url = SITE + '/produto/' + p.slug;
  var firstPara = String(p.description || '').split(/\n\s*\n/)[0].replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  var base = String(p.tagline || firstPara || p.name).trim().slice(0, 150);
  var priceTxt = (p.variants.some(function (v) { return v.price != null && Number(v.price) !== Number(p.price); }) ? 'A partir de ' : '') + R.brl(R.minPrice(p)).replace('R$ ', 'R$');
  var description = base + (/[.!?]$/.test(base) ? ' ' : '. ') + priceTxt + '.';
  var first = R.firstImage(p);
  var image = /^https?:/.test(R.imgUrl(first)) ? R.imgUrl(first) : SITE + R.imgUrl(first);

  var values = {
    TITLE: R.esc(p.name + ' | Pérolas de Maria'),
    DESCRIPTION: R.esc(description),
    URL: R.esc(url),
    IMAGE: R.esc(image),
    JSONLD: R.productJsonLd(p, SITE),
    PRODUCT: R.productCardHtml(p)
  };
  var html = template().replace(/\{\{(TITLE|DESCRIPTION|URL|IMAGE|JSONLD|PRODUCT)\}\}/g, function (_, k) { return values[k]; });

  // o navegador/CDN guarda por 1 minuto: mudanças feitas no painel aparecem em instantes
  return send(res, 200, html, 'public, s-maxage=60, stale-while-revalidate=300');
};
