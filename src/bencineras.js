// Bencineras con precios oficiales de la CNE (api.cne.cl, vía el proxy porque requiere login)
import { CFG, esc, fmtFecha, fmtNum, toast, debounce, ICON } from './util.js';
import { map, registrarCapas, setDatos, fc, punto, cursorPuntero } from './mapa.js';

// Códigos de la CNE: asistido / autoservicio (A*)
const COMBUSTIBLES = [
  ['93', 'Gasolina 93', '#16a34a'],
  ['95', 'Gasolina 95', '#f97316'],
  ['97', 'Gasolina 97', '#dc2626'],
  ['DI', 'Diésel', '#475569']
];

let estaciones = [];
export let bencinerasVisibles = false;

registrarCapas((m) => {
  if (!m.getSource('bencineras')) m.addSource('bencineras', { type: 'geojson', data: geojson() });
  if (!m.getLayer('bencineras')) {
    m.addLayer({
      id: 'bencineras', type: 'circle', source: 'bencineras', minzoom: 9,
      paint: { 'circle-color': '#0284c7', 'circle-radius': 7, 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' }
    });
  }
});

const geojson = () => fc(bencinerasVisibles ? estaciones.map((e, i) => punto(e.lng, e.lat, { i })) : []);

const precio = (e, cod) => (e.precios[cod] || e.precios['A' + cod] || null);

export function precioPromedio(cod = '93') {
  const vals = estaciones.map((e) => precio(e, cod)?.precio).filter((p) => p > 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

async function cargar() {
  if (!CFG.CNE_PROXY_URL) throw new Error('SIN_CNE');
  const b = map.getBounds();
  const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(3)).join(',');
  const r = await fetch(`${CFG.CNE_PROXY_URL.replace(/\/$/, '')}/estaciones?bbox=${bbox}`);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const data = await r.json();
  estaciones = Array.isArray(data) ? data : [];
  setDatos('bencineras', geojson());
}

export async function alternarBencineras(activar) {
  bencinerasVisibles = activar;
  if (!activar) { setDatos('bencineras', geojson()); return; }
  if (map.getZoom() < 9) toast('Acércate un poco al mapa para ver las bencineras.', { ms: 3000 });
  try { await cargar(); } catch (e) {
    bencinerasVisibles = false;
    toast(e.message === 'SIN_CNE'
      ? 'Las bencineras usan la API oficial de la CNE y necesitan el proxy: define CNE_PROXY_URL en config.js (ver README).'
      : 'No se pudieron cargar las bencineras de la CNE.', { tipo: 'error', ms: 8000 });
    throw e;
  }
}

export function iniciarBencineras() {
  map.on('moveend', debounce(() => { if (bencinerasVisibles && map.getZoom() >= 9) cargar().catch(() => {}); }, 600));
  map.on('click', 'bencineras', (e) => {
    const est = estaciones[e.features[0].properties.i];
    if (!est) return;
    const filas = COMBUSTIBLES.map(([cod, nombre, color]) => {
      const p = precio(est, cod);
      return `<div class="precio"><span><i style="background:${color}"></i>${nombre}</span><strong>${p ? '$' + fmtNum(p.precio) : 'N/D'}</strong></div>`;
    }).join('');
    const fecha = Object.values(est.precios).map((p) => p.fecha).filter(Boolean).sort().pop();
    new mapboxgl.Popup({ maxWidth: '290px', offset: 10 }).setLngLat([est.lng, est.lat]).setHTML(`
      <div class="popup-body">
        <h3>${esc(est.marca)}</h3>
        <p class="popup-meta">${esc(est.direccion)}</p>
        <div class="precios">${filas}</div>
        <p class="popup-meta">Precios por litro · CNE${fecha ? ' · act. ' + esc(fmtFecha(fecha, false)) : ''}</p>
        <div class="popup-acciones">
          <button class="btn btn-primario" data-accion="parada" data-lng="${est.lng}" data-lat="${est.lat}" data-nombre="${esc(est.marca)}">${ICON.parada}Parar aquí</button>
        </div>
      </div>`).addTo(map);
  });
  cursorPuntero('bencineras');
}
