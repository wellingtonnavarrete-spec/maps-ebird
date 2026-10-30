// Cloudflare Worker: proxy para eBird y CNE.
// - Guarda la key de eBird y las credenciales de la CNE como "secrets" (nunca llegan al navegador).
// - Agrega CORS solo para los orígenes permitidos.
// - Cachea respuestas para no gastar cuota ni hacer lenta la app.
//
// Rutas:
//   GET /ebird/<ruta API v2>?<params>   →  https://api.ebird.org/v2/<ruta>
//   GET /cne/estaciones?bbox=w,s,e,n    →  estaciones + precios (api.cne.cl, requiere login)

const EBIRD = 'https://api.ebird.org/v2/';
const CNE = 'https://api.cne.cl';

const memoria = new Map(); // caché en memoria del isolate (además de la Cache API)
let tokenCne = null;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origen = request.headers.get('Origin');
    const permitidos = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const permitido = permitidos.length === 0 || (origen && permitidos.includes(origen));
    const cors = {
      'Access-Control-Allow-Origin': permitidos.length === 0 ? '*' : (permitido ? origen : 'null'),
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin'
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json({ error: 'Método no permitido' }, 405, cors);
    // Nota: el chequeo de Origin evita el uso desde otras webs, pero no es autenticación fuerte.
    if (!permitido) return json({ error: 'Origen no permitido' }, 403, cors);

    try {
      if (url.pathname.startsWith('/ebird/')) return await proxyEbird(url, env, ctx, cors);
      if (url.pathname === '/cne/estaciones') return await proxyCne(url, env, cors);
      return json({ ok: true, servicio: 'maps-ebird proxy' }, 200, cors);
    } catch (e) {
      return json({ error: String(e && e.message ? e.message : e) }, 502, cors);
    }
  }
};

function json(data, status, cors, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors, ...extra } });
}

function ttlEbird(ruta) {
  if (ruta.startsWith('ref/taxonomy')) return 7 * 86400;
  if (ruta.startsWith('ref/')) return 86400;
  if (ruta.startsWith('product/checklist/')) return 3600;
  return 300;
}

async function proxyEbird(url, env, ctx, cors) {
  if (!env.EBIRD_API_KEY) return json({ error: 'Falta el secret EBIRD_API_KEY' }, 500, cors);
  const ruta = url.pathname.slice('/ebird/'.length);
  if (!/^(ref|data|product)\/[\w\-./]+$/.test(ruta) || ruta.includes('..')) return json({ error: 'Ruta no permitida' }, 400, cors);

  const params = new URLSearchParams(url.search);
  params.delete('key');
  params.sort();
  const destino = EBIRD + ruta + (params.toString() ? '?' + params : '');
  const ttl = ttlEbird(ruta);

  const mem = memoria.get(destino);
  if (mem && mem.exp > Date.now()) return new Response(mem.body, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}`, ...cors } });

  const cache = caches.default;
  const claveCache = new Request(destino);
  let resp = await cache.match(claveCache);
  if (!resp) {
    const r = await fetch(destino, { headers: { 'X-eBirdApiToken': env.EBIRD_API_KEY } });
    const body = await r.text();
    resp = new Response(body, { status: r.status, headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/json', 'Cache-Control': `public, max-age=${ttl}` } });
    if (r.ok) {
      ctx.waitUntil(cache.put(claveCache, resp.clone()));
      if (body.length < 2_000_000) memoria.set(destino, { body, exp: Date.now() + ttl * 1000 });
      if (memoria.size > 300) memoria.delete(memoria.keys().next().value);
    }
  }
  const h = new Headers(resp.headers);
  Object.entries(cors).forEach(([k, v]) => h.set(k, v));
  return new Response(resp.body, { status: resp.status, headers: h });
}

// ---------------- CNE (precios de combustibles) ----------------
// API oficial: https://api.cne.cl (registro gratuito). Login → token Bearer → /api/v4/estaciones
async function loginCne(env) {
  if (!env.CNE_EMAIL || !env.CNE_PASSWORD) throw new Error('Faltan los secrets CNE_EMAIL / CNE_PASSWORD');
  const r = await fetch(`${CNE}/api/login`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: env.CNE_EMAIL, password: env.CNE_PASSWORD })
  });
  const j = await r.json().catch(() => null);
  if (!j || !j.token) throw new Error('La CNE rechazó el login');
  tokenCne = j.token;
}

function compactar(e) {
  const u = e.ubicacion || {};
  const lat = parseFloat(u.latitud), lng = parseFloat(u.longitud);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const precios = {};
  for (const [k, v] of Object.entries(e.precios || {})) {
    const p = parseFloat(v && v.precio);
    if (p > 0) precios[k] = { precio: p, fecha: (v && v.fecha_actualizacion) || null };
  }
  return { codigo: e.codigo, marca: (e.distribuidor && e.distribuidor.marca) || 'Sin marca', direccion: u.direccion || '', lat, lng, precios };
}

async function estacionesCne(env) {
  const mem = memoria.get('cne');
  if (mem && mem.exp > Date.now()) return mem.data;
  for (let intento = 0; intento < 2; intento++) {
    if (!tokenCne) await loginCne(env);
    const r = await fetch(`${CNE}/api/v4/estaciones`, { headers: { Accept: 'application/json', Authorization: `Bearer ${tokenCne}` } });
    const j = await r.json().catch(() => null);
    // La CNE informa token vencido con HTTP 200 y un objeto { status: "..." }
    if (r.status === 401 || !Array.isArray(j)) { tokenCne = null; continue; }
    const data = j.map(compactar).filter(Boolean);
    memoria.set('cne', { data, exp: Date.now() + 30 * 60 * 1000 });
    return data;
  }
  throw new Error('No fue posible consultar la CNE');
}

async function proxyCne(url, env, cors) {
  const data = await estacionesCne(env);
  const bbox = (url.searchParams.get('bbox') || '').split(',').map(Number);
  let salida = data;
  if (bbox.length === 4 && bbox.every(Number.isFinite)) {
    const [w, s, e, n] = bbox;
    salida = data.filter((x) => x.lng >= w && x.lng <= e && x.lat >= s && x.lat <= n).slice(0, 400);
  }
  return json(salida, 200, cors, { 'Cache-Control': 'public, max-age=600' });
}
