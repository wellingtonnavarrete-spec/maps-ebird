// Un solo rastreador GPS para toda la app (antes había dos watchPosition en paralelo)
import { map } from './mapa.js';

export let ultima = null; // { lng, lat, accuracy, speed, heading, ts }
let brujula = null;
let marcador = null;
let watchId = null;
const suscriptores = [];

export const alMoverse = (fn) => suscriptores.push(fn);

export function iniciarGPS() {
  if (!('geolocation' in navigator)) return false;
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      const primera = !ultima;
      ultima = {
        lng: p.coords.longitude,
        lat: p.coords.latitude,
        accuracy: p.coords.accuracy,
        speed: p.coords.speed,           // m/s (puede ser null)
        heading: Number.isFinite(p.coords.heading) && p.coords.speed > 1 ? p.coords.heading : null,
        ts: Date.now()
      };
      dibujarMarcador();
      suscriptores.forEach((fn) => { try { fn(ultima, primera); } catch (e) { console.error(e); } });
    },
    (err) => { if (err.code !== err.TIMEOUT) console.warn('GPS:', err.message); },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
  );
  escucharBrujula();
  return true;
}

export function obtenerUna(timeout = 12000) {
  if (ultima && Date.now() - ultima.ts < 30000) return Promise.resolve(ultima);
  return new Promise((ok, fallo) => {
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lng: p.coords.longitude, lat: p.coords.latitude, accuracy: p.coords.accuracy, speed: p.coords.speed, heading: null, ts: Date.now() }),
      fallo,
      { enableHighAccuracy: true, timeout, maximumAge: 10000 }
    );
  });
}

// Rumbo: GPS cuando hay velocidad; si no, brújula del teléfono
export const rumboActual = () => (ultima && ultima.heading !== null ? ultima.heading : brujula);

function escucharBrujula() {
  const handler = (e) => {
    if (typeof e.webkitCompassHeading === 'number') brujula = e.webkitCompassHeading; // iOS
    else if (e.absolute && e.alpha !== null) brujula = (360 - e.alpha) % 360;
  };
  if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', handler, true);
  else window.addEventListener('deviceorientation', handler, true);
}

// iOS 13+ exige permiso explícito (debe llamarse desde un toque del usuario)
export async function pedirPermisoBrujula() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      await DeviceOrientationEvent.requestPermission();
    }
  } catch { /* el usuario lo rechazó */ }
}

export function modoNavegacionMarcador(activo) {
  marcador?.getElement().classList.toggle('navegando', activo);
}

function dibujarMarcador() {
  if (!map) return;
  if (!marcador) {
    const el = document.createElement('div');
    el.className = 'user-location-marker';
    el.innerHTML = '<div class="user-dot-pulse"></div><div class="user-dot"></div><div class="user-arrow"></div>';
    marcador = new mapboxgl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([ultima.lng, ultima.lat]).addTo(map);
  } else {
    marcador.setLngLat([ultima.lng, ultima.lat]);
  }
  const r = rumboActual();
  if (r !== null && r !== undefined) marcador.setRotation(r);
}
