// Utilidades compartidas
export const CFG = window.APP_CONFIG || {};

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const normalizar = (s) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const rad = (d) => (d * Math.PI) / 180;

export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function rumbo(lat1, lon1, lat2, lon2) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export const difAngulo = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

// Distancia (m) de un punto a un segmento, proyección plana local
function distPuntoSegmentoM(lng, lat, lng1, lat1, lng2, lat2) {
  const mLat = 111320;
  const mLng = 111320 * Math.cos(rad(lat1));
  const x = (lng - lng1) * mLng, y = (lat - lat1) * mLat;
  const dx = (lng2 - lng1) * mLng, dy = (lat2 - lat1) * mLat;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, (x * dx + y * dy) / l2));
  return Math.hypot(x - t * dx, y - t * dy);
}

export function distMinARutaM(lng, lat, coords) {
  if (!coords || coords.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = distPuntoSegmentoM(lng, lat, coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
    if (d < min) min = d;
  }
  return min;
}

// Fechas eBird: "2026-10-29 07:45", "2026-10-29" o "29 Oct 2026"
const MESES = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
export function parseFecha(s) {
  if (!s) return null;
  let m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  m = String(s).match(/^(\d{1,2}) (\w{3}) (\d{4})/);
  if (m && MESES[m[2].toLowerCase()] !== undefined) return new Date(+m[3], MESES[m[2].toLowerCase()], +m[1]);
  return null;
}

const dos = (n) => String(n).padStart(2, '0');
export function fmtFecha(s, conHora = true) {
  const d = s instanceof Date ? s : parseFecha(s);
  if (!d) return s ? String(s) : '';
  const f = `${dos(d.getDate())}-${dos(d.getMonth() + 1)}-${d.getFullYear()}`;
  const tieneHora = conHora && (s instanceof Date || /\d{2}:\d{2}/.test(String(s)));
  return tieneHora ? `${f} ${dos(d.getHours())}:${dos(d.getMinutes())}` : f;
}

export const diasDesde = (s) => {
  const d = parseFecha(s);
  return d ? (Date.now() - d.getTime()) / 86400000 : Infinity;
};

export const fmtDist = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0).replace('.', ',')} km`);
export const fmtNum = (n, dec = 0) => Number(n).toLocaleString('es-CL', { maximumFractionDigits: dec, minimumFractionDigits: dec });

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export async function mapLimit(items, limite, fn) {
  const out = new Array(items.length);
  let i = 0;
  const trabajadores = Array.from({ length: Math.min(limite, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch (e) { out[idx] = null; }
    }
  });
  await Promise.all(trabajadores);
  return out;
}

export const mapsLink = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${(+lat).toFixed(5)},${(+lng).toFixed(5)}`;

export function abrirWhatsApp(texto) {
  window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
}

// --- Preferencias persistentes ---
export const prefs = {
  get(k, def) {
    try { const v = localStorage.getItem('mapsebird.' + k); return v === null ? def : JSON.parse(v); } catch { return def; }
  },
  set(k, v) {
    try { localStorage.setItem('mapsebird.' + k, JSON.stringify(v)); } catch { /* modo privado */ }
  }
};

// --- Avisos (toasts) ---
export function toast(html, { ms = 6000, tipo = 'info', acciones = [] } = {}) {
  const cont = document.getElementById('toasts');
  if (!cont) return;
  const el = document.createElement('div');
  el.className = `toast toast-${tipo}`;
  el.innerHTML = `<div class="toast-texto">${html}</div>`;
  if (acciones.length) {
    const fila = document.createElement('div');
    fila.className = 'toast-acciones';
    acciones.forEach(({ texto, fn }) => {
      const b = document.createElement('button');
      b.textContent = texto;
      b.onclick = () => { fn(); el.remove(); };
      fila.appendChild(b);
    });
    el.appendChild(fila);
  }
  const x = document.createElement('button');
  x.className = 'toast-cerrar';
  x.setAttribute('aria-label', 'Cerrar');
  x.textContent = '×';
  x.onclick = () => el.remove();
  el.appendChild(x);
  cont.appendChild(el);
  while (cont.children.length > 3) cont.firstElementChild.remove();
  if (ms) setTimeout(() => el.remove(), ms);
  return el;
}

// --- Vibración + beep (un solo AudioContext reutilizado) ---
let audioCtx = null;
export function feedback(tipo = 'general') {
  try { navigator.vibrate?.(tipo === 'recalculo' ? [80, 40, 80] : [100]); } catch { /* sin vibración */ }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = tipo === 'recalculo' ? 440 : tipo === 'rara' ? 1200 : 880;
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.3);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
  } catch { /* audio bloqueado */ }
}

// Ícono inline de respaldo cuando no hay foto (reemplaza via.placeholder.com)
export const FOTO_RESPALDO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#e2e8f0"/><path d="M18 40c4-10 12-15 22-14l6-6 2 7-5 3c-1 9-9 15-19 14l-8 6 2-10z" fill="#94a3b8"/><circle cx="41" cy="27" r="1.6" fill="#e2e8f0"/></svg>'
);

export const ICON = {
  whatsapp: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1-.7-.3-1.4-.7-2-1.3-.6-.5-1-1.1-1.4-1.8-.1-.2 0-.4.1-.5l.4-.5.2-.4v-.4l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.7.7-1 1.6-1 2.5.1 1.1.5 2.1 1.2 3 1.2 1.8 2.8 3.2 4.7 4 .5.2 1 .4 1.5.5.6.2 1.2.2 1.8.1.7-.1 1.4-.6 1.8-1.2.2-.4.2-.8.1-1.2l-.4-.2z"/></svg>',
  ir: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2 4.5 20.3l.7.7L12 18l6.8 3 .7-.7z"/></svg>',
  ave: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 15c2-5 6-8 11-7l3-3 1 4-3 2c-.5 4.5-4.5 7.5-9.5 7L3 21l1-5z"/></svg>',
  externo: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  parada: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>'
};
