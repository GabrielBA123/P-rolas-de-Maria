// /sitemap.xml gerado a partir dos produtos ativos (ver "rewrites" em vercel.json)
const R = require('../js/product-render.js');
const { rest } = require('./_supabase.js');
const SITE = 'https://perolas-de-maria.vercel.app';

module.exports = async function handler(req, res) {
  var rows = [], ok = true;
  try { rows = await rest('products?active=eq.true&select=slug,updated_at&order=sort_order'); } catch (e) { ok = false; }

  var urls = '  <url>\n    <loc>' + SITE + '/</loc>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n' +
    rows.map(function (r) {
      return '  <url>\n    <loc>' + R.esc(SITE + '/produto/' + r.slug) + '</loc>\n' +
        (r.updated_at ? '    <lastmod>' + R.esc(String(r.updated_at).slice(0, 10)) + '</lastmod>\n' : '') +
        '    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>\n';
    }).join('');

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', ok ? 'public, s-maxage=3600, stale-while-revalidate=86400' : 'no-store');
  res.end('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '</urlset>\n');
};
