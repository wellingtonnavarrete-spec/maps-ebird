// Hotspots: carga, capas, búsqueda, región, detalle con frecuencia de 7 días y hotspots activos
import { CFG, esc, normalizar, haversineKm, fmtFecha, diasDesde, parseFecha, mapLimit, mapsLink, toast, debounce, ICON } from './util.js';
import { map, registrarCapas, setDatos, fc, punto, cursorPuntero } from './mapa.js';
import * as ebird from './ebird.js';
import { abrirPanel, setPanel, nuevoToken, tokenVigente, registrarCompartible } from './panel.js';

export const REGIONES = {
  'CL-AP': 'Arica y Parinacota', 'CL-TA': 'Tarapacá', 'CL-AN': 'Antofagasta', 'CL-AT': 'Atacama',
  'CL-CO': 'Coquimbo', 'CL-VS': 'Valparaíso', 'CL-RM': 'Metropolitana', 'CL-LI': "O'Higgins",
  'CL-ML': 'Maule', 'CL-NB': 'Ñuble', 'CL-BI': 'Biobío', 'CL-AR': 'La Araucanía',
  'CL-LR': 'Los Ríos', 'CL-LL': 'Los Lagos', 'CL-AI': 'Aysén', 'CL-MA': 'Magallanes'
};

export const db = new Map(); // locId → hotspot
const regionesCargadas = new Set();
const celdasCargadas = new Set();
const alCambiarRegion = [];
export let regionActual = null;
export let regionManual = false;
export const onRegion = (fn) => alCambiarRegion.push(fn);

// ---------- Carga ----------
function agregar(lista) {
  if (!Array.isArray(lista)) return 0;
  let nuevos = 0;
  for (const h of lista) {
    if (!h || !h.locId || db.has(h.locId)) continue;
    db.set(h.locId, {
      locId: h.locId,
      nombre: h.locName,
      lat: +h.lat,
      lng: +h.lng,
      region: h.subnational1Code,
      ultimo: h.latestObsDt || null,
      especies: h.numSpeciesAllTime || 0
    });
    nuevos++;
  }
  if (nuevos) refrescarCapa();
  return nuevos;
}

export async function cargarRegion(region) {
  if (!region || regionesCargadas.has(region)) return;
  regionesCargadas.add(region);
  try { agregar(await ebird.hotspotsRegion(region)); } catch (e) { regionesCargadas.delete(region); avisarError(e); }
}

export async function cargarAlrededor(lat, lng) {
  const clave = `${Math.round(lat / 0.4)},${Math.round(lng / 0.4)}`;
  if (celdasCargadas.has(clave)) return;
  celdasCargadas.add(clave);
  try { agregar(await ebird.hotspotsGeo(lat, lng, 35)); } catch (e) { celdasCargadas.delete(clave); }
}

let errorMostrado = false;
export function avisarError(e) {
  if (errorMostrado) return;
  errorMostrado = true;
  const sinConfig = e && e.codigo === 'SIN_CONFIG';
  toast(sinConfig
    ? '<strong>eBird no está configurado.</strong> Define EBIRD_PROXY_URL en config.js (ver README).'
    : '<strong>No se pudo conectar con eBird.</strong> Revisa tu conexión o el proxy.', { tipo: 'error', ms: 10000 });
}

// ---------- Región ----------
export function setRegionManual(region) {
  regionManual = Boolean(region);
  if (region) cambiarRegion(region);
}

export function cambiarRegion(region) {
  if (!region || region === regionActual) return;
  regionActual = region;
  cargarRegion(region);
  alCambiarRegion.forEach((fn) => fn(region));
}

export function detectarRegion(lat, lng) {
  if (regionManual) return;
  const h = masCercano(lat, lng, 40);
  if (h && h.region && REGIONES[h.region]) cambiarRegion(h.region);
}

export function masCercano(lat, lng, maxKm = Infinity) {
  let mejor = null, min = maxKm;
  for (const h of db.values()) {
    const d = haversineKm(lat, lng, h.lat, h.lng);
    if (d < min) { min = d; mejor = h; }
  }
  return mejor;
}

export function cercanos(lat, lng, radioKm) {
  const out = [];
  for (const h of db.values()) {
    const d = haversineKm(lat, lng, h.lat, h.lng);
    if (d <= radioKm) out.push({ h, d });
  }
  return out.sort((a, b) => a.d - b.d);
}

// ---------- Capas ----------
const geojson = () => fc([...db.values()].map((h) => punto(h.lng, h.lat, {
  locId: h.locId, nombre: h.nombre, especies: h.especies, dias: Math.min(9999, Math.round(diasDesde(h.ultimo)))
})));

const refrescarCapa = debounce(() => setDatos('hotspots', geojson()), 150);

registrarCapas((m) => {
  if (!m.getSource('hotspots')) {
    m.addSource('hotspots', { type: 'geojson', data: geojson(), cluster: true, clusterMaxZoom: 9, clusterRadius: 45 });
  }
  if (!m.getLayer('hs-clusters')) {
    m.addLayer({
      id: 'hs-clusters', type: 'circle', source: 'hotspots', filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#0e7490', 'circle-opacity': 0.88,
        'circle-radius': ['step', ['get', 'point_count'], 16, 25, 20, 100, 26],
        'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff'
      }
    });
    m.addLayer({
      id: 'hs-cluster-num', type: 'symbol', source: 'hotspots', filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 13, 'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'] },
      paint: { 'text-color': '#ffffff' }
    });
    m.addLayer({
      id: 'hs-puntos', type: 'circle', source: 'hotspots', filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['step', ['get', 'dias'], '#22c55e', 7.5, '#00b4d8', 30.5, '#94a3b8'],
        'circle-radius': ['interpolate', ['linear'], ['get', 'especies'], 0, 5, 100, 7, 250, 10],
        'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff'
      }
    });
  }
  if (!m.getSource('activos')) m.addSource('activos', { type: 'geojson', data: fc(activosFeatures) });
  if (!m.getLayer('activos')) {
    m.addLayer({
      id: 'activos', type: 'circle', source: 'activos',
      paint: {
        'circle-color': '#ef4444', 'circle-opacity': 0.25,
        'circle-radius': ['interpolate', ['linear'], ['get', 'listas'], 1, 12, 5, 18, 15, 26],
        'circle-stroke-width': 3, 'circle-stroke-color': '#ef4444'
      }
    }, 'hs-puntos');
  }
});

export function iniciarHotspots() {
  map.on('click', 'hs-clusters', (e) => {
    const f = e.features[0];
    map.getSource('hotspots').getClusterExpansionZoom(f.properties.cluster_id, (err, zoom) => {
      if (!err) map.easeTo({ center: f.geometry.coordinates, zoom: zoom + 0.5 });
    });
  });
  map.on('click', 'hs-puntos', (e) => popupHotspot(e.features[0].properties.locId));
  map.on('click', 'activos', (e) => {
    if (map.queryRenderedFeatures(e.point, { layers: ['hs-puntos'] }).length) return;
    popupHotspot(e.features[0].properties.locId);
  });
  ['hs-clusters', 'hs-puntos', 'activos'].forEach(cursorPuntero);

  map.on('moveend', debounce(() => {
    if (map.getZoom() < 8) return;
    const c = map.getCenter();
    cargarAlrededor(c.lat, c.lng);
  }, 400));
}

// ---------- Popup ----------
let popupAbierto = null;
export function popupHotspot(locId, enNavegacion = document.body.classList.contains('modo-nav')) {
  const h = db.get(locId);
  if (!h) return;
  popupAbierto?.remove();
  const foto = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${h.lng},${h.lat},14,0/300x150?access_token=${CFG.MAPBOX_TOKEN}`;
  const ult = h.ultimo ? `Último registro: ${fmtFecha(h.ultimo, false)}` : 'Sin registros recientes';
  const html = `
    <div class="popup-card">
      <img src="${foto}" class="popup-img" alt="">
      <div class="popup-body">
        <h3>${esc(h.nombre)}</h3>
        <p class="popup-meta">${h.especies ? `${h.especies} especies registradas · ` : ''}${esc(ult)}</p>
        <div class="popup-acciones">
          <button class="btn btn-primario" data-accion="ver-hotspot" data-loc="${esc(h.locId)}">${ICON.ave}Aves últimos 7 días</button>
          <button class="btn btn-verde" data-accion="ir" data-lng="${h.lng}" data-lat="${h.lat}" data-nombre="${esc(h.nombre)}">${ICON.ir}Ir hacia aquí</button>
          ${enNavegacion ? `<button class="btn btn-sec" data-accion="parada" data-lng="${h.lng}" data-lat="${h.lat}" data-nombre="${esc(h.nombre)}">${ICON.parada}Agregar como parada</button>` : ''}
          <a class="btn btn-link" href="https://ebird.org/hotspot/${encodeURIComponent(h.locId)}" target="_blank" rel="noopener">Ver en eBird ${ICON.externo}</a>
        </div>
      </div>
    </div>`;
  popupAbierto = new mapboxgl.Popup({ maxWidth: '300px', offset: 10 }).setLngLat([h.lng, h.lat]).setHTML(html).addTo(map);
}

export function cerrarPopups() { popupAbierto?.remove(); popupAbierto = null; }

// ---------- Búsqueda ----------
export function buscar(texto) {
  const q = normalizar(texto);
  if (q.length < 2) return [];
  const res = [];
  for (const h of db.values()) {
    const n = normalizar(h.nombre);
    const i = n.indexOf(q);
    if (i >= 0) res.push({ h, score: i === 0 ? 0 : 1 });
  }
  return res.sort((a, b) => a.score - b.score || b.h.especies - a.h.especies).slice(0, 8).map((r) => r.h);
}

// ---------- Detalle: especies de los últimos 7 días, frecuencia y observadores ----------
const MAX_LISTAS = 10;

export async function abrirHotspot(locId) {
  const h = db.get(locId);
  if (!h) return;
  const t = nuevoToken();
  abrirPanel(h.nombre, '<p class="cargando">Cargando aves de los últimos 7 días…</p>');

  const [rObs, rListas] = await Promise.allSettled([ebird.obsRecientes(locId, 7), ebird.listasRecientes(locId, 60)]);
  if (!tokenVigente(t)) return;
  if (rObs.status === 'rejected') { setPanel('<p class="vacio">No se pudo conectar con eBird.</p>'); avisarError(rObs.reason); return; }

  const obs = Array.isArray(rObs.value) ? rObs.value : [];
  const listas = (rListas.status === 'fulfilled' && Array.isArray(rListas.value) ? rListas.value : [])
    .filter((l) => diasDesde(ebird.fechaLista(l)) <= 7);
  const observadorDe = new Map(listas.map((l) => [l.subId, l.userDisplayName]));

  const especies = obs.map((o) => ({
    code: o.speciesCode, nombre: o.comName, sci: o.sciName, fecha: o.obsDt, cantidad: o.howMany,
    observador: observadorDe.get(o.subId) || null, enListas: 0
  }));

  const estado = { h, especies, listas, analizadas: 0 };
  render(estado);
  if (!especies.length || !listas.length) return;

  // Frecuencia = en cuántas de las últimas listas aparece cada especie (igual que la "frecuencia" de eBird)
  const muestra = listas.slice(0, MAX_LISTAS);
  const vistas = await mapLimit(muestra, 4, (l) => ebird.verLista(l.subId));
  if (!tokenVigente(t)) return;
  const conteo = new Map();
  let analizadas = 0;
  vistas.forEach((v) => {
    if (!v || !Array.isArray(v.obs)) return;
    analizadas++;
    new Set(v.obs.map((o) => o.speciesCode)).forEach((c) => conteo.set(c, (conteo.get(c) || 0) + 1));
  });
  especies.forEach((e) => { e.enListas = conteo.get(e.code) || 0; });
  estado.analizadas = analizadas;
  render(estado);
}

function render({ h, especies, listas, analizadas }) {
  if (!especies.length) {
    setPanel(`${cabecera(h, null)}<p class="vacio">No hay observaciones en los últimos 7 días.</p>`);
    return;
  }
  const orden = [...especies].sort((a, b) =>
    b.enListas - a.enListas || (parseFecha(b.fecha) - parseFecha(a.fecha)) || a.nombre.localeCompare(b.nombre, 'es'));
  const observadores = [...new Set(listas.map((l) => l.userDisplayName).filter(Boolean))];
  const idLista = registrarCompartible(textoLista(h, orden, analizadas, observadores));

  const resumen = `
    <div class="resumen">
      <div><strong>${especies.length}</strong><span>especies</span></div>
      <div><strong>${listas.length}</strong><span>listas</span></div>
      <div><strong>${observadores.length}</strong><span>observadores</span></div>
    </div>
    ${observadores.length ? `<p class="observadores"><strong>Observaron:</strong> ${esc(observadores.slice(0, 12).join(', '))}${observadores.length > 12 ? '…' : ''}</p>` : ''}
    <p class="nota">${analizadas ? `Ordenadas por frecuencia en las últimas ${analizadas} listas.` : listas.length ? 'Calculando frecuencia…' : 'Ordenadas por fecha.'}</p>`;

  const filas = orden.map((e) => {
    const pct = analizadas ? Math.round((e.enListas / analizadas) * 100) : 0;
    const idEsp = registrarCompartible(textoEspecie(e, h));
    return `
      <div class="ave">
        <img data-sci="${esc(e.sci)}" alt="" loading="lazy">
        <div class="ave-info">
          <div class="ave-nombre">${esc(e.nombre)}</div>
          <div class="ave-sci">${esc(e.sci)}</div>
          ${analizadas ? `<div class="frec"><div class="frec-barra"><span style="width:${pct}%"></span></div><small>${e.enListas} de ${analizadas} listas</small></div>` : ''}
          <div class="ave-meta">${esc(fmtFecha(e.fecha))}${e.cantidad ? ` · ${e.cantidad} ind.` : ''}${e.observador ? ` · ${esc(e.observador)}` : ''}</div>
        </div>
        <button class="btn-icono wa" data-accion="compartir" data-id="${idEsp}" title="Compartir por WhatsApp" aria-label="Compartir ${esc(e.nombre)} por WhatsApp">${ICON.whatsapp}</button>
      </div>`;
  }).join('');

  setPanel(`${cabecera(h, idLista)}${resumen}<div class="lista-aves">${filas}</div>`);
}

function cabecera(h, idLista) {
  return `
    <div class="panel-acciones">
      ${idLista ? `<button class="btn btn-wa" data-accion="compartir" data-id="${idLista}">${ICON.whatsapp}Compartir lista</button>` : ''}
      <button class="btn btn-verde" data-accion="ir" data-lng="${h.lng}" data-lat="${h.lat}" data-nombre="${esc(h.nombre)}">${ICON.ir}Ir</button>
      <a class="btn btn-link" href="https://ebird.org/hotspot/${encodeURIComponent(h.locId)}" target="_blank" rel="noopener">eBird ${ICON.externo}</a>
    </div>`;
}

// ---------- Textos para WhatsApp ----------
export function textoEspecie(e, lugar) {
  return [
    `🐦 *${e.nombre}* (_${e.sci}_)`,
    `📍 ${lugar.nombre}`,
    `🗺️ ${mapsLink(lugar.lat, lugar.lng)}`,
    `📅 ${fmtFecha(e.fecha)}`,
    `👤 Observador: ${e.observador || 'no informado'}`,
    e.cantidad ? `🔢 Cantidad: ${e.cantidad}` : null,
    'Fuente: eBird'
  ].filter(Boolean).join('\n');
}

function textoLista(h, orden, analizadas, observadores) {
  const hoy = new Date();
  const desde = new Date(hoy.getTime() - 7 * 86400000);
  const lineas = orden.slice(0, 40).map((e, i) => {
    const frec = analizadas ? ` — ${e.enListas}/${analizadas} listas` : '';
    const quien = e.observador ? ` (${e.observador})` : '';
    return `${i + 1}. ${e.nombre}${frec} · ${fmtFecha(e.fecha, false)}${quien}`;
  });
  return [
    `🐦 *Aves en ${h.nombre}*`,
    `📅 Del ${fmtFecha(desde, false)} al ${fmtFecha(hoy, false)} (últimos 7 días)`,
    `📍 ${mapsLink(h.lat, h.lng)}`,
    '',
    ...lineas,
    orden.length > 40 ? `… y ${orden.length - 40} especies más` : null,
    '',
    observadores.length ? `👥 Observadores: ${observadores.join(', ')}` : null,
    'Fuente: eBird'
  ].filter((l) => l !== null).join('\n');
}

// ---------- Hotspots activos (últimos 7 días) ----------
let activosFeatures = [];
export let activosVisibles = false;

export async function alternarActivos() {
  if (activosVisibles) {
    activosVisibles = false;
    activosFeatures = [];
    setDatos('activos', fc([]));
    return { visible: false };
  }
  const region = regionActual || CFG.REGION_INICIAL;
  const listas = await ebird.listasRecientes(region, 200);
  const porLoc = new Map();
  for (const l of Array.isArray(listas) ? listas : []) {
    if (diasDesde(ebird.fechaLista(l)) > 7) continue;
    const h = db.get(l.locId);
    if (!h) continue; // solo hotspots públicos
    const a = porLoc.get(l.locId) || { h, listas: 0 };
    a.listas++;
    porLoc.set(l.locId, a);
  }
  // Hotspots con registro ≤7 días que no alcanzaron a salir en las 200 listas más recientes
  for (const h of db.values()) {
    if (h.region === region && !porLoc.has(h.locId) && diasDesde(h.ultimo) <= 7) porLoc.set(h.locId, { h, listas: 1 });
  }
  activosFeatures = [...porLoc.values()].map(({ h, listas: n }) => punto(h.lng, h.lat, { locId: h.locId, nombre: h.nombre, listas: n }));
  activosVisibles = true;
  setDatos('activos', fc(activosFeatures));
  return { visible: true, total: activosFeatures.length, region };
}

export function refrescarActivosSiVisibles() {
  if (!activosVisibles) return;
  activosVisibles = false;
  alternarActivos().catch(avisarError);
}
