// Panel lateral, registro de textos para compartir y carga diferida de fotos
import { abrirWhatsApp, FOTO_RESPALDO } from './util.js';

let token = 0;
export const nuevoToken = () => ++token;
export const tokenVigente = (t) => t === token;

export function abrirPanel(titulo, html) {
  const panel = document.getElementById('side-panel');
  document.getElementById('panel-titulo').textContent = titulo;
  setPanel(html);
  panel.classList.add('panel-open');
  panel.setAttribute('aria-hidden', 'false');
}

export function setPanel(html) {
  const body = document.getElementById('panel-content');
  body.innerHTML = html;
  cargarFotos(body);
}

export function cerrarPanel() {
  nuevoToken();
  const panel = document.getElementById('side-panel');
  panel.classList.remove('panel-open');
  panel.setAttribute('aria-hidden', 'true');
}

// --- Compartir por WhatsApp: guardamos el texto y el botón solo lleva un id ---
const compartibles = new Map();
let n = 0;
export function registrarCompartible(texto) {
  const id = 'c' + ++n;
  compartibles.set(id, texto);
  if (compartibles.size > 600) compartibles.delete(compartibles.keys().next().value);
  return id;
}
export function compartir(id) {
  const t = compartibles.get(id);
  if (t) abrirWhatsApp(t);
}

// --- Fotos desde Wikipedia (es → en), solo cuando la fila es visible ---
const fotos = new Map();
async function fotoDe(sci) {
  if (fotos.has(sci)) return fotos.get(sci);
  const p = (async () => {
    const titulo = encodeURIComponent(sci.replace(/ /g, '_'));
    for (const lang of ['es', 'en']) {
      try {
        const r = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${titulo}`);
        if (!r.ok) continue;
        const d = await r.json();
        if (d.thumbnail && d.thumbnail.source) return d.thumbnail.source;
      } catch { /* sin conexión */ }
    }
    return null;
  })();
  fotos.set(sci, p);
  return p;
}

const observador = 'IntersectionObserver' in window
  ? new IntersectionObserver((entradas) => {
      entradas.forEach((e) => {
        if (!e.isIntersecting) return;
        observador.unobserve(e.target);
        pintarFoto(e.target);
      });
    }, { rootMargin: '200px' })
  : null;

async function pintarFoto(img) {
  const url = await fotoDe(img.dataset.sci);
  if (url) img.src = url;
}

export function cargarFotos(raiz) {
  raiz.querySelectorAll('img[data-sci]').forEach((img) => {
    if (!img.getAttribute('src')) img.src = FOTO_RESPALDO;
    if (observador) observador.observe(img); else pintarFoto(img);
  });
}
