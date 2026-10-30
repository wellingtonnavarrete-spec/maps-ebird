// Mapa base, estilos y registro de capas (se re-dibujan al cambiar estilo)
import { CFG, prefs } from './util.js';

export const ESTILOS = {
  calles: 'mapbox://styles/mapbox/streets-v12',
  satelite: 'mapbox://styles/mapbox/satellite-streets-v12',
  relieve: 'mapbox://styles/mapbox/outdoors-v12'
};

export let map = null;
let estiloActual = prefs.get('estilo', 'satelite');
let estiloListo = false;
const capas = [];

export function crearMapa() {
  mapboxgl.accessToken = CFG.MAPBOX_TOKEN;
  map = new mapboxgl.Map({
    container: 'map',
    style: ESTILOS[estiloActual] || ESTILOS.satelite,
    center: CFG.CENTRO_INICIAL || [-72.59, -38.73],
    zoom: 12,
    pitch: 45,
    antialias: true,
    attributionControl: false
  });
  map.addControl(new mapboxgl.AttributionControl({ compact: true, customAttribution: 'Datos de aves: <a href="https://ebird.org" target="_blank" rel="noopener">eBird</a>' }), 'bottom-right');
  map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right');

  map.on('style.load', () => {
    estiloListo = true;
    agrandarEtiquetas();
    capas.forEach((fn) => { try { fn(map); } catch (e) { console.error('Error agregando capa', e); } });
  });
  marcarBotonEstilo();
  return map;
}

// Cada módulo registra una función idempotente que agrega sus fuentes/capas
export function registrarCapas(fn) {
  capas.push(fn);
  if (estiloListo) fn(map);
}

export function cambiarEstilo(nombre) {
  if (!ESTILOS[nombre] || nombre === estiloActual) return;
  estiloActual = nombre;
  prefs.set('estilo', nombre);
  marcarBotonEstilo();
  estiloListo = false;
  map.setStyle(ESTILOS[nombre]);
}

function marcarBotonEstilo() {
  document.querySelectorAll('[data-estilo]').forEach((b) => b.classList.toggle('active', b.dataset.estilo === estiloActual));
}

// Etiquetas más legibles para uso en ruta
function agrandarEtiquetas() {
  for (const capa of map.getStyle().layers) {
    if (capa.type === 'symbol' && capa.layout && capa.layout['text-field'] && /road|place|poi/.test(capa.id)) {
      map.setLayoutProperty(capa.id, 'text-size', 15);
    }
  }
}

export function setDatos(idFuente, datos) {
  const src = map && map.getSource(idFuente);
  if (src) src.setData(datos);
}

export const fc = (features) => ({ type: 'FeatureCollection', features });
export const punto = (lng, lat, props) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: props });

export function cursorPuntero(idCapa) {
  map.on('mouseenter', idCapa, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', idCapa, () => { map.getCanvas().style.cursor = ''; });
}
