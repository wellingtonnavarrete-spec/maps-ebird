// Aves raras (eBird "notable"): capa en el mapa, lista y avisos cerca de tu ubicación
import { CFG, esc, fmtFecha, parseFecha, haversineKm, fmtDist, mapsLink, toast, feedback, prefs, ICON } from './util.js';
import { map, registrarCapas, setDatos, fc, punto, cursorPuntero } from './mapa.js';
import * as ebird from './ebird.js';
import * as geo from './geo.js';
import { regionActual, REGIONES, avisarError } from './hotspots.js';
import { abrirPanel, registrarCompartible, compartir } from './panel.js';

const registros = new Map(); // clave especie|lugar → registro más reciente
export let rarasVisibles = false;

registrarCapas((m) => {
  if (!m.getSource('raras')) m.addSource('raras', { type: 'geojson', data: geojson() });
  if (!m.getLayer('raras')) {
    m.addLayer({
      id: 'raras', type: 'circle', source: 'raras',
      paint: { 'circle-color': '#f59e0b', 'circle-radius': 9, 'circle-stroke-width': 3, 'circle-stroke-color': '#7c2d12' }
    });
  }
});

const geojson = () => fc(rarasVisibles ? [...registros.entries()].map(([k, o]) => punto(o.lng, o.lat, { clave: k })) : []);

function agrupar(lista) {
  registros.clear();
  for (const o of Array.isArray(lista) ? lista : []) {
    const k = `${o.speciesCode}|${o.locId}`;
    const prev = registros.get(k);
    if (!prev) registros.set(k, { ...o, reportes: 1 });
    else {
      prev.reportes++;
      if (parseFecha(o.obsDt) > parseFecha(prev.obsDt)) Object.assign(prev, o, { reportes: prev.reportes });
    }
  }
}

export async function alternarRaras() {
  if (rarasVisibles) {
    rarasVisibles = false;
    setDatos('raras', geojson());
    return { visible: false };
  }
  const region = regionActual || CFG.REGION_INICIAL;
  agrupar(await ebird.notablesRegion(region, 7));
  rarasVisibles = true;
  setDatos('raras', geojson());
  abrirListaRaras(region);
  return { visible: true, total: registros.size };
}

export async function refrescarRarasSiVisibles() {
  if (!rarasVisibles) return;
  try {
    agrupar(await ebird.notablesRegion(regionActual, 7));
    setDatos('raras', geojson());
  } catch (e) { avisarError(e); }
}

function estado(o) {
  if (o.obsReviewed && o.obsValid) return '<span class="tag tag-ok">Confirmada</span>';
  return '<span class="tag tag-pend">Sin revisar</span>';
}

function textoRara(o) {
  return [
    '⚠️ *Ave rara reportada en eBird*',
    `🐦 *${o.comName}* (_${o.sciName}_)`,
    `📍 ${o.locName}`,
    `🗺️ ${mapsLink(o.lat, o.lng)}`,
    `📅 ${fmtFecha(o.obsDt)}`,
    `👤 Observador: ${o.userDisplayName || 'no informado'}`,
    o.howMany ? `🔢 Cantidad: ${o.howMany}` : null,
    o.subId ? `📝 https://ebird.org/checklist/${o.subId}` : null
  ].filter(Boolean).join('\n');
}

function filaRara(o) {
  const id = registrarCompartible(textoRara(o));
  return `
    <div class="ave rara">
      <img data-sci="${esc(o.sciName)}" alt="" loading="lazy">
      <div class="ave-info">
        <div class="ave-nombre">${esc(o.comName)} ${estado(o)}</div>
        <div class="ave-sci">${esc(o.sciName)}</div>
        <div class="ave-meta">${esc(o.locName)}</div>
        <div class="ave-meta">${esc(fmtFecha(o.obsDt))} · ${esc(o.userDisplayName || 'Observador no informado')}${o.reportes > 1 ? ` · ${o.reportes} reportes` : ''}</div>
        <div class="fila-botones">
          <button class="btn-mini" data-accion="ver-rara" data-lng="${o.lng}" data-lat="${o.lat}">Ver en mapa</button>
          <button class="btn-mini" data-accion="ir" data-lng="${o.lng}" data-lat="${o.lat}" data-nombre="${esc(o.locName)}">Ir</button>
        </div>
      </div>
      <button class="btn-icono wa" data-accion="compartir" data-id="${id}" title="Compartir por WhatsApp" aria-label="Compartir por WhatsApp">${ICON.whatsapp}</button>
    </div>`;
}

function abrirListaRaras(region) {
  const lista = [...registros.values()].sort((a, b) => parseFecha(b.obsDt) - parseFecha(a.obsDt));
  const html = lista.length
    ? `<p class="nota">${lista.length} especies raras reportadas en los últimos 7 días en ${esc(REGIONES[region] || region)}.</p><div class="lista-aves">${lista.map(filaRara).join('')}</div>`
    : '<p class="vacio">No hay aves raras reportadas en los últimos 7 días en esta región.</p>';
  abrirPanel('Aves raras', html);
}

let popup = null;
export function iniciarRaras() {
  map.on('click', 'raras', (e) => {
    const o = registros.get(e.features[0].properties.clave);
    if (!o) return;
    const id = registrarCompartible(textoRara(o));
    popup?.remove();
    popup = new mapboxgl.Popup({ maxWidth: '300px', offset: 12 }).setLngLat([o.lng, o.lat]).setHTML(`
      <div class="popup-body">
        <span class="desvio-tag rara-tag">Ave rara</span>
        <h3>${esc(o.comName)}</h3>
        <p class="popup-meta"><em>${esc(o.sciName)}</em> ${estado(o)}</p>
        <p class="popup-meta">${esc(o.locName)}<br>${esc(fmtFecha(o.obsDt))} · ${esc(o.userDisplayName || 'Observador no informado')}${o.howMany ? ` · ${o.howMany} ind.` : ''}</p>
        <div class="popup-acciones">
          <button class="btn btn-wa" data-accion="compartir" data-id="${id}">${ICON.whatsapp}Compartir por WhatsApp</button>
          <button class="btn btn-verde" data-accion="ir" data-lng="${o.lng}" data-lat="${o.lat}" data-nombre="${esc(o.locName)}">${ICON.ir}Ir hacia aquí</button>
          ${o.subId ? `<a class="btn btn-link" href="https://ebird.org/checklist/${encodeURIComponent(o.subId)}" target="_blank" rel="noopener">Ver lista en eBird ${ICON.externo}</a>` : ''}
        </div>
      </div>`).addTo(map);
  });
  cursorPuntero('raras');

  setTimeout(revisarCerca, 15000);
  setInterval(revisarCerca, (CFG.MINUTOS_REVISION_RARAS || 10) * 60000);
}

// ---------- Avisos de aves raras cerca de ti ----------
const vistas = new Set(prefs.get('rarasVistas', []));
let primeraRevision = true;

async function revisarCerca() {
  if (!prefs.get('avisosRaras', true) || !geo.ultima) return;
  const { lat, lng } = geo.ultima;
  let lista;
  try { lista = await ebird.notablesCerca(lat, lng, CFG.RADIO_AVES_RARAS_KM || 25, 2); } catch { return; }
  if (!Array.isArray(lista)) return;

  const nuevas = [];
  const especiesNuevas = new Set();
  for (const o of lista) {
    if (vistas.has(o.obsId)) continue;
    vistas.add(o.obsId);
    if (!especiesNuevas.has(o.speciesCode)) { especiesNuevas.add(o.speciesCode); nuevas.push(o); }
  }
  prefs.set('rarasVistas', [...vistas].slice(-800));

  if (primeraRevision) {
    primeraRevision = false;
    if (nuevas.length) {
      toast(`<strong>${nuevas.length} ave${nuevas.length > 1 ? 's raras' : ' rara'}</strong> reportada${nuevas.length > 1 ? 's' : ''} a menos de ${CFG.RADIO_AVES_RARAS_KM || 25} km (últimas 48 h).`, {
        ms: 12000, tipo: 'rara',
        acciones: [{ texto: 'Ver lista', fn: () => { if (!rarasVisibles) alternarRaras().catch(avisarError); else abrirListaRaras(regionActual); } }]
      });
    }
    return;
  }
  nuevas.slice(0, 3).forEach((o) => avisar(o, haversineKm(lat, lng, o.lat, o.lng)));
}

function avisar(o, distKm) {
  feedback('rara');
  const id = registrarCompartible(textoRara(o));
  toast(`<span class="desvio-tag rara-tag">Ave rara · ${fmtDist(distKm)}</span><br><strong>${esc(o.comName)}</strong><br><small>${esc(o.locName)} · ${esc(o.userDisplayName || '')}</small>`, {
    ms: 20000, tipo: 'rara',
    acciones: [
      { texto: 'Ver', fn: () => map.flyTo({ center: [o.lng, o.lat], zoom: 14 }) },
      { texto: 'Compartir', fn: () => compartir(id) }
    ]
  });
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification(`Ave rara cerca: ${o.comName}`, { body: `${o.locName} · a ${fmtDist(distKm)}\n${o.userDisplayName || ''}`, tag: o.obsId });
      n.onclick = () => { window.focus(); map.flyTo({ center: [o.lng, o.lat], zoom: 14 }); };
    } catch { /* algunos móviles exigen service worker para notificar */ }
  }
}

export async function activarNotificaciones() {
  if (!('Notification' in window)) { toast('Este navegador no soporta notificaciones.', { tipo: 'error' }); return false; }
  const r = await Notification.requestPermission();
  toast(r === 'granted' ? 'Notificaciones activadas.' : 'Permiso de notificaciones rechazado.', { ms: 3000 });
  return r === 'granted';
}
