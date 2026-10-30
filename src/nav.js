// Navegación: Mapbox Directions API directo (sin el plugin), instrucciones paso a paso,
// paradas intermedias, recálculo por desvío y alertas de hotspots cercanos con sus aves.
import { CFG, esc, haversineKm, distMinARutaM, rumbo, difAngulo, fmtDist, fmtNum, toast, feedback, prefs, ICON } from './util.js';
import { map, registrarCapas, setDatos, fc } from './mapa.js';
import * as geo from './geo.js';
import { cercanos, cerrarPopups } from './hotspots.js';
import { obsRecientes } from './ebird.js';
import { precioPromedio } from './bencineras.js';

const UMBRAL_DESVIO_M = 45;
const COOLDOWN_RECALCULO_MS = 8000;
const LLEGADA_M = 40;

export const nav = {
  activo: false, destino: null, paradas: [], ruta: null, pasos: [], pasoIdx: 0,
  recalculando: false, ultimoRecalculo: 0, seguir: true, alertados: new Set(), wakeLock: null, llegado: false
};

registrarCapas((m) => {
  if (!m.getSource('ruta')) m.addSource('ruta', { type: 'geojson', data: rutaGeojson() });
  if (!m.getLayer('ruta-borde')) {
    const antes = m.getLayer('hs-clusters') ? 'hs-clusters' : undefined;
    m.addLayer({ id: 'ruta-borde', type: 'line', source: 'ruta', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1e3a8a', 'line-width': 11 } }, antes);
    m.addLayer({ id: 'ruta-linea', type: 'line', source: 'ruta', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#3b82f6', 'line-width': 7 } }, antes);
  }
});

const rutaGeojson = () => fc(nav.ruta ? [{ type: 'Feature', geometry: nav.ruta.geometry, properties: {} }] : []);

// ---------- API pública ----------
export async function navegarA(destino) {
  geo.pedirPermisoBrujula();
  cerrarPopups();
  Object.assign(nav, { activo: true, destino, paradas: [], ruta: null, pasos: [], pasoIdx: 0, seguir: true, llegado: false });
  nav.alertados.clear();
  document.body.classList.add('modo-nav');
  geo.modoNavegacionMarcador(true);
  hud('instruccion', `Hacia ${destino.nombre}`);
  hud('sub', 'Buscando tu ubicación…');
  hud('tiempo', 'Calculando…');
  hud('detalle', '');
  hud('combustible', '');
  actualizarBotonParada();
  pedirWakeLock();
  try {
    const pos = await geo.obtenerUna();
    await calcularRuta(pos);
  } catch {
    hud('sub', 'Activa el GPS para calcular la ruta');
    toast('No se pudo obtener tu ubicación. Revisa los permisos de GPS (requiere HTTPS).', { tipo: 'error' });
  }
}

export async function agregarParada(p) {
  if (!nav.activo) return navegarA(p);
  nav.paradas = [p];
  actualizarBotonParada();
  feedback();
  toast(`Parada agregada: <strong>${esc(p.nombre)}</strong>`, { ms: 3500 });
  if (geo.ultima) await calcularRuta(geo.ultima);
}

export async function quitarParada() {
  if (!nav.paradas.length) return;
  nav.paradas = [];
  actualizarBotonParada();
  if (geo.ultima) await calcularRuta(geo.ultima);
}

export function salir() {
  Object.assign(nav, { activo: false, destino: null, paradas: [], ruta: null, pasos: [], recalculando: false, llegado: false });
  document.body.classList.remove('modo-nav');
  geo.modoNavegacionMarcador(false);
  setDatos('ruta', rutaGeojson());
  document.getElementById('desvio-card')?.classList.remove('visible');
  liberarWakeLock();
  map.easeTo({ pitch: 45, bearing: 0, zoom: 13, duration: 800 });
}

export function centrar() {
  nav.seguir = true;
  document.getElementById('btn-centrar').classList.remove('visible');
  const p = geo.ultima;
  if (p) {
    map.easeTo({ center: [p.lng, p.lat], zoom: nav.activo ? 16.5 : 15, pitch: nav.activo ? 55 : 45, bearing: nav.activo ? (geo.rumboActual() ?? 0) : 0, duration: 700 });
  } else {
    geo.obtenerUna().then((q) => map.flyTo({ center: [q.lng, q.lat], zoom: 15, essential: true }))
      .catch(() => toast('GPS sin permisos o desactivado. La ubicación requiere HTTPS.', { tipo: 'error' }));
  }
}

// ---------- Cálculo de ruta ----------
async function calcularRuta(origen) {
  const puntos = [origen, ...nav.paradas, nav.destino].map((p) => `${(+p.lng).toFixed(6)},${(+p.lat).toFixed(6)}`).join(';');
  const rumboInicial = geo.rumboActual();
  // bearings: que la ruta parta en la dirección en que ya vas (evita U innecesarias)
  const bearings = rumboInicial !== null && rumboInicial !== undefined && origen.speed > 3
    ? `&bearings=${Math.round(rumboInicial)},45${';'.repeat(nav.paradas.length + 1)}` : '';
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${puntos}?geometries=geojson&overview=full&steps=true&language=es${bearings}&access_token=${CFG.MAPBOX_TOKEN}`;
  try {
    const r = await fetch(url);
    const data = await r.json();
    if (!r.ok || !data.routes || !data.routes.length) throw new Error(data.message || 'Sin ruta');
    nav.ruta = data.routes[0];
    nav.pasos = nav.ruta.legs.flatMap((l) => l.steps);
    nav.pasoIdx = nav.pasos.length > 1 ? 1 : 0;
    setDatos('ruta', rutaGeojson());
    if (!nav.recalculando) {
      const b = new mapboxgl.LngLatBounds();
      nav.ruta.geometry.coordinates.forEach((c) => b.extend(c));
      map.fitBounds(b, { padding: { top: 140, bottom: 170, left: 40, right: 40 }, duration: 900, pitch: 0, bearing: 0 });
      nav.seguir = false;
      setTimeout(() => { if (nav.activo) centrar(); }, 2200);
    }
    nav.recalculando = false;
    actualizarHUD(origen);
  } catch (e) {
    nav.recalculando = false;
    hud('sub', 'No se encontró una ruta en auto hacia ese punto');
    console.error('Directions:', e);
  }
}

function recalcular(pos) {
  if (nav.recalculando) return;
  nav.recalculando = true;
  nav.ultimoRecalculo = Date.now();
  feedback('recalculo');
  hud('instruccion', 'Recalculando ruta…');
  hud('sub', 'Te desviaste, buscando un nuevo camino');
  calcularRuta(pos);
}

// ---------- Seguimiento en cada posición GPS ----------
export function onPosicion(p) {
  vigilarHotspots(p);
  if (!nav.activo) return;

  const kmh = p.speed ? Math.round(p.speed * 3.6) : 0;
  document.getElementById('speedometer-value').textContent = kmh;

  if (nav.seguir) {
    map.easeTo({ center: [p.lng, p.lat], zoom: 16.5, pitch: 55, bearing: geo.rumboActual() ?? map.getBearing(), duration: 900, easing: (t) => t });
  }
  if (!nav.ruta) return;

  // Llegada a la parada intermedia o al destino
  if (nav.paradas.length && haversineKm(p.lat, p.lng, nav.paradas[0].lat, nav.paradas[0].lng) * 1000 < LLEGADA_M) {
    const parada = nav.paradas.shift();
    actualizarBotonParada();
    feedback();
    toast(`Llegaste a <strong>${esc(parada.nombre)}</strong>. Continuando a ${esc(nav.destino.nombre)}.`, { ms: 5000 });
    nav.recalculando = true;
    calcularRuta(p);
    return;
  }
  if (!nav.llegado && haversineKm(p.lat, p.lng, nav.destino.lat, nav.destino.lng) * 1000 < LLEGADA_M) {
    nav.llegado = true;
    feedback();
    hud('instruccion', `Llegaste a ${nav.destino.nombre}`);
    hud('sub', 'Toca “Salir” para terminar la navegación');
    hud('tiempo', '0 min');
    return;
  }
  if (nav.llegado) return;

  // Desvío (solo si la precisión del GPS es confiable)
  if (p.accuracy <= 50 && !nav.recalculando && Date.now() - nav.ultimoRecalculo > COOLDOWN_RECALCULO_MS
      && distMinARutaM(p.lng, p.lat, nav.ruta.geometry.coordinates) > UMBRAL_DESVIO_M) {
    recalcular(p);
    return;
  }

  // Avanzar de paso al pasar por la maniobra
  while (nav.pasoIdx < nav.pasos.length - 1) {
    const [lng, lat] = nav.pasos[nav.pasoIdx].maneuver.location;
    if (haversineKm(p.lat, p.lng, lat, lng) * 1000 < 25) nav.pasoIdx++;
    else break;
  }
  actualizarHUD(p);
}

// ---------- HUD ----------
const hud = (id, txt) => { const el = document.getElementById('nav-' + id); if (el) el.textContent = txt; };

const GIRO = { 'sharp left': -135, left: -90, 'slight left': -45, straight: 0, 'slight right': 45, right: 90, 'sharp right': 135, uturn: 180 };

function actualizarHUD(p) {
  if (!nav.ruta || !nav.pasos.length) return;
  const paso = nav.pasos[nav.pasoIdx];
  const [mLng, mLat] = paso.maneuver.location;
  const aManiobraKm = p ? haversineKm(p.lat, p.lng, mLat, mLng) : 0;

  hud('instruccion', paso.maneuver.instruction || `Hacia ${nav.destino.nombre}`);
  hud('sub', p ? `En ${fmtDist(aManiobraKm)}${paso.name ? ' · ' + paso.name : ''}` : 'Sigue el trazado de la ruta');
  const flecha = document.getElementById('nav-flecha');
  if (flecha) flecha.style.transform = `rotate(${GIRO[paso.maneuver.modifier] ?? 0}deg)`;

  const restanteM = nav.pasos.slice(nav.pasoIdx).reduce((s, x) => s + x.distance, 0) + aManiobraKm * 1000;
  const fraccion = nav.ruta.distance ? Math.min(1, restanteM / nav.ruta.distance) : 1;
  const minutos = Math.max(1, Math.round((nav.ruta.duration * fraccion) / 60));
  const llegada = new Date(Date.now() + minutos * 60000).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  const km = restanteM / 1000;
  hud('tiempo', minutos >= 60 ? `${Math.floor(minutos / 60)} h ${minutos % 60} min` : `${minutos} min`);
  hud('detalle', `${fmtNum(km, 1)} km · Llegada ${llegada}`);

  const kmL = prefs.get('kmPorLitro', CFG.KM_POR_LITRO || 12);
  const litros = km / kmL;
  const precio = CFG.PRECIO_LITRO_REFERENCIA || precioPromedio();
  hud('combustible', `Combustible ≈ ${fmtNum(litros, 1)} L${precio ? ` · $${fmtNum(litros * precio)}` : ''} (${kmL} km/L)`);
}

function actualizarBotonParada() {
  const b = document.getElementById('btn-quitar-parada');
  if (!b) return;
  b.hidden = !nav.paradas.length;
  if (nav.paradas.length) b.title = `Quitar parada: ${nav.paradas[0].nombre}`;
}

// ---------- Alertas de hotspots cercanos en ruta ----------
let ultimaRevision = 0;
function vigilarHotspots(p) {
  if (!prefs.get('alertasRuta', true)) return;
  const enMovimiento = nav.activo || (p.speed && p.speed > 3); // >~11 km/h
  if (!enMovimiento || Date.now() - ultimaRevision < 4000) return;
  ultimaRevision = Date.now();

  const radio = CFG.RADIO_ALERTA_HOTSPOT_KM || 1.5;
  const r = geo.rumboActual();
  const candidato = cercanos(p.lat, p.lng, radio).find(({ h }) => {
    if (nav.alertados.has(h.locId)) return false;
    if (nav.destino && haversineKm(h.lat, h.lng, nav.destino.lat, nav.destino.lng) < 0.1) return false;
    // Preferir los que están adelante, no los que ya quedaron atrás
    return r === null || r === undefined || difAngulo(r, rumbo(p.lat, p.lng, h.lat, h.lng)) < 80;
  });
  if (!candidato) return;
  nav.alertados.add(candidato.h.locId);
  mostrarAlerta(candidato.h, candidato.d);
}

async function mostrarAlerta(h, distKm) {
  const card = document.getElementById('desvio-card');
  const pintar = (avesHtml) => {
    card.innerHTML = `
      <div class="desvio-info">
        <span class="desvio-tag">Hotspot cercano · ${fmtDist(distKm)}</span>
        <strong>${esc(h.nombre)}</strong>
        <div class="desvio-aves">${avesHtml}</div>
      </div>
      <div class="desvio-botones">
        <button class="btn btn-verde" data-accion="parada" data-lng="${h.lng}" data-lat="${h.lat}" data-nombre="${esc(h.nombre)}">${ICON.parada}Desviarme</button>
        <button class="btn btn-sec" data-accion="ver-hotspot" data-loc="${esc(h.locId)}">${ICON.ave}Ver aves</button>
        <button class="btn-icono" data-accion="cerrar-desvio" aria-label="Cerrar">×</button>
      </div>`;
  };
  pintar('<small>Buscando aves de los últimos 7 días…</small>');
  card.classList.add('visible');
  feedback();
  clearTimeout(card._t);
  card._t = setTimeout(() => card.classList.remove('visible'), 15000);

  try {
    const obs = await obsRecientes(h.locId, 7);
    if (!Array.isArray(obs) || !obs.length) { pintar('<small>Sin registros en los últimos 7 días</small>'); return; }
    const top = [...obs].sort((a, b) => (b.howMany || 1) - (a.howMany || 1)).slice(0, 4).map((o) => esc(o.comName));
    pintar(`<small><strong>${obs.length} especies</strong> en 7 días: ${top.join(', ')}${obs.length > 4 ? '…' : ''}</small>`);
  } catch {
    pintar('<small>No se pudieron cargar las aves</small>');
  }
}

// ---------- Pantalla encendida mientras navegas ----------
async function pedirWakeLock() {
  try { nav.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* no soportado */ }
}
function liberarWakeLock() {
  try { nav.wakeLock?.release(); } catch { /* nada */ }
  nav.wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && nav.activo && (!nav.wakeLock || nav.wakeLock.released)) pedirWakeLock();
});

// El usuario movió el mapa: dejar de seguirlo y ofrecer re-centrar
export function iniciarNav() {
  const soltar = (e) => {
    if (!e.originalEvent) return;
    nav.seguir = false;
    document.getElementById('btn-centrar').classList.add('visible');
  };
  map.on('dragstart', soltar);
  map.on('rotatestart', soltar);
  map.on('pitchstart', soltar);
}
