// Cliente eBird API 2.0 (https://documenter.getpostman.com/view/664302/S1ENwy59)
// Usa el proxy propio si está configurado; si no, llamada directa con la key local.
import { CFG } from './util.js';

const MIN = 60 * 1000, HORA = 60 * MIN, DIA = 24 * HORA;
const cache = new Map();

export class EbirdError extends Error {
  constructor(codigo, msg) { super(msg || codigo); this.codigo = codigo; }
}

export const ebirdConfigurado = () => Boolean(CFG.EBIRD_PROXY_URL || CFG.EBIRD_API_KEY);
export const modoEbird = () => (CFG.EBIRD_PROXY_URL ? 'proxy' : CFG.EBIRD_API_KEY ? 'directo (solo pruebas)' : 'sin configurar');

export function ebirdGet(path, params = {}, ttl = 5 * MIN) {
  if (!ebirdConfigurado()) return Promise.reject(new EbirdError('SIN_CONFIG', 'eBird no está configurado'));
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.set(k, v); });
  const base = CFG.EBIRD_PROXY_URL ? CFG.EBIRD_PROXY_URL.replace(/\/$/, '') : 'https://api.ebird.org/v2';
  const claveCache = `${path}?${qs}`;
  // La key se agrega como parámetro (petición simple, sin preflight CORS). Nunca se usa en el modo proxy.
  if (!CFG.EBIRD_PROXY_URL) qs.set('key', CFG.EBIRD_API_KEY);
  const url = `${base}/${path}${qs.toString() ? '?' + qs : ''}`;

  const hit = cache.get(claveCache);
  if (hit && hit.exp > Date.now()) return hit.promesa;
  const promesa = fetch(url).then(async (r) => {
    if (!r.ok) throw new EbirdError(`HTTP_${r.status}`, `eBird respondió ${r.status}`);
    return r.json();
  });
  cache.set(claveCache, { exp: Date.now() + ttl, promesa });
  promesa.catch(() => cache.delete(claveCache));
  return promesa;
}

const loc = () => CFG.LOCALE || 'es_CL';
const c3 = (n) => (+n).toFixed(3);

// Hotspots
export const hotspotsRegion = (region) => ebirdGet(`ref/hotspot/${region}`, { fmt: 'json' }, DIA);
export const hotspotsGeo = (lat, lng, distKm = 30) => ebirdGet('ref/hotspot/geo', { lat: c3(lat), lng: c3(lng), dist: distKm, fmt: 'json' }, DIA);

// Observaciones (regionCode puede ser región, comuna o locId de hotspot)
export const obsRecientes = (codigo, back = 7) => ebirdGet(`data/obs/${codigo}/recent`, { back, sppLocale: loc() }, 5 * MIN);
export const notablesRegion = (region, back = 7) => ebirdGet(`data/obs/${region}/recent/notable`, { back, detail: 'full', sppLocale: loc() }, 10 * MIN);
export const notablesCerca = (lat, lng, distKm = 25, back = 2) =>
  ebirdGet('data/obs/geo/recent/notable', { lat: c3(lat), lng: c3(lng), dist: Math.min(50, distKm), back, detail: 'full', sppLocale: loc() }, 5 * MIN);

// Listas (checklists) con nombre del observador
export const listasRecientes = (codigo, max = 50) => ebirdGet(`product/lists/${codigo}`, { maxResults: max }, 5 * MIN);
export const verLista = (subId) => ebirdGet(`product/checklist/view/${subId}`, {}, HORA);

export const fechaLista = (l) => l.isoObsDate || (l.obsDt && l.obsTime ? `${l.obsDt} ${l.obsTime}` : l.obsDt);
