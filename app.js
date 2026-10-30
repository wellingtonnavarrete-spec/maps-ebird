// Punto de entrada: crea el mapa, conecta módulos y maneja la interfaz.
// Todos los botones usan data-accion (sin onclick en línea → sin inyección de HTML).
import { CFG, esc, prefs, toast } from './src/util.js';
import { crearMapa, cambiarEstilo, map } from './src/mapa.js';
import * as geo from './src/geo.js';
import * as hs from './src/hotspots.js';
import * as nav from './src/nav.js';
import * as raras from './src/raras.js';
import * as benc from './src/bencineras.js';
import { cerrarPanel, compartir, abrirPanel } from './src/panel.js';
import { modoEbird, ebirdConfigurado } from './src/ebird.js';

if (!CFG.MAPBOX_TOKEN) {
  document.body.innerHTML = '<p style="padding:20px;font-family:sans-serif">Falta MAPBOX_TOKEN en config.js</p>';
  throw new Error('Sin token de Mapbox');
}

crearMapa();

map.on('load', () => {
  hs.iniciarHotspots();
  raras.iniciarRaras();
  benc.iniciarBencineras();
  nav.iniciarNav();

  const regionGuardada = prefs.get('region', '');
  if (regionGuardada) hs.setRegionManual(regionGuardada);
  else hs.cambiarRegion(CFG.REGION_INICIAL || 'CL-AR');
  if (!ebirdConfigurado()) hs.avisarError({ codigo: 'SIN_CONFIG' });

  if (prefs.get('bencineras', false)) benc.alternarBencineras(true).catch(() => prefs.set('bencineras', false));

  geo.iniciarGPS();
});

// ---------- GPS ----------
let ultimaDeteccion = 0;
geo.alMoverse(async (p, primera) => {
  if (primera) {
    if (!nav.nav.activo) map.flyTo({ center: [p.lng, p.lat], zoom: 14, essential: true });
    await hs.cargarAlrededor(p.lat, p.lng);
    hs.detectarRegion(p.lat, p.lng);
    ultimaDeteccion = Date.now();
  } else if (Date.now() - ultimaDeteccion > 120000) {
    ultimaDeteccion = Date.now();
    hs.cargarAlrededor(p.lat, p.lng);
    hs.detectarRegion(p.lat, p.lng);
  }
  nav.onPosicion(p);
});

hs.onRegion((region) => {
  document.getElementById('region-actual').textContent = hs.REGIONES[region] || region;
  hs.refrescarActivosSiVisibles();
  raras.refrescarRarasSiVisibles();
});

// ---------- Acciones (delegación de clics) ----------
const num = (v) => parseFloat(v);
const destinoDe = (d) => ({ lng: num(d.lng), lat: num(d.lat), nombre: d.nombre || 'Destino' });

async function conCarga(boton, fn) {
  if (boton.disabled) return;
  boton.disabled = true;
  boton.classList.add('cargando');
  try { return await fn(); } finally { boton.disabled = false; boton.classList.remove('cargando'); }
}

const acciones = {
  'ver-hotspot': (d) => hs.abrirHotspot(d.loc),
  ir: (d) => { cerrarPanelSiMovil(); nav.navegarA(destinoDe(d)); },
  parada: (d) => { cerrarPanelSiMovil(); hs.cerrarPopups(); document.getElementById('desvio-card').classList.remove('visible'); nav.agregarParada(destinoDe(d)); },
  compartir: (d) => compartir(d.id),
  'ver-rara': (d) => { cerrarPanelSiMovil(); map.flyTo({ center: [num(d.lng), num(d.lat)], zoom: 14, essential: true }); },
  'cerrar-desvio': () => document.getElementById('desvio-card').classList.remove('visible'),
  estilo: (d) => cambiarEstilo(d.estilo),
  centrar: () => nav.centrar(),
  salir: () => nav.salir(),
  'quitar-parada': () => nav.quitarParada(),
  'cerrar-panel': () => cerrarPanel(),
  menu: () => abrirMenu(),
  notificaciones: () => raras.activarNotificaciones(),
  activos: (d, b) => conCarga(b, async () => {
    try {
      const r = await hs.alternarActivos();
      b.classList.toggle('activo', r.visible);
      if (r.visible) toast(`${r.total} hotspots con actividad en los últimos 7 días (${esc(hs.REGIONES[r.region] || r.region)}).`, { ms: 4000 });
    } catch (e) { hs.avisarError(e); }
  }),
  raras: (d, b) => conCarga(b, async () => {
    try {
      const r = await raras.alternarRaras();
      b.classList.toggle('activo', r.visible);
      if (!r.visible) cerrarPanel();
    } catch (e) { hs.avisarError(e); }
  })
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-accion]');
  if (!el) return;
  const fn = acciones[el.dataset.accion];
  if (!fn) return;
  e.preventDefault();
  fn(el.dataset, el);
});

const cerrarPanelSiMovil = () => { if (window.innerWidth < 700) cerrarPanel(); };

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarPanel(); });

// ---------- Buscador con autocompletado ----------
const input = document.getElementById('buscar');
const lista = document.getElementById('resultados');
let resultados = [];
let sel = -1;

function pintarResultados() {
  if (!resultados.length) {
    lista.hidden = input.value.trim().length < 2;
    lista.innerHTML = '<div class="resultado vacio">Sin coincidencias en los hotspots cargados</div>';
    return;
  }
  lista.innerHTML = resultados.map((h, i) => `
    <div class="resultado${i === sel ? ' sel' : ''}" role="option" data-i="${i}">
      <strong>${esc(h.nombre)}</strong><small>${esc(hs.REGIONES[h.region] || '')}${h.especies ? ` · ${h.especies} especies` : ''}</small>
    </div>`).join('');
  lista.hidden = false;
}

function elegir(i) {
  const h = resultados[i];
  if (!h) return;
  input.value = h.nombre;
  lista.hidden = true;
  input.blur();
  map.flyTo({ center: [h.lng, h.lat], zoom: 15, essential: true });
  map.once('moveend', () => hs.popupHotspot(h.locId));
}

input.addEventListener('input', () => { resultados = hs.buscar(input.value); sel = -1; pintarResultados(); });
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { sel = Math.min(resultados.length - 1, sel + 1); pintarResultados(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); pintarResultados(); e.preventDefault(); }
  else if (e.key === 'Enter') elegir(sel >= 0 ? sel : 0);
  else if (e.key === 'Escape') { lista.hidden = true; input.blur(); }
});
lista.addEventListener('mousedown', (e) => {
  const fila = e.target.closest('[data-i]');
  if (fila) { e.preventDefault(); elegir(+fila.dataset.i); }
});
input.addEventListener('blur', () => setTimeout(() => { lista.hidden = true; }, 150));

// ---------- Menú / ajustes ----------
function abrirMenu() {
  const regionGuardada = prefs.get('region', '');
  const opciones = Object.entries(hs.REGIONES)
    .map(([k, v]) => `<option value="${k}"${k === regionGuardada ? ' selected' : ''}>${esc(v)}</option>`).join('');
  const notif = 'Notification' in window ? Notification.permission : 'no-soportado';
  abrirPanel('Ajustes', `
    <label class="campo">Región
      <select id="aj-region"><option value="">Automática (según GPS)</option>${opciones}</select>
    </label>
    <label class="interruptor"><input type="checkbox" id="aj-alertas"${prefs.get('alertasRuta', true) ? ' checked' : ''}> Alertas de hotspots cercanos en ruta</label>
    <label class="interruptor"><input type="checkbox" id="aj-raras"${prefs.get('avisosRaras', true) ? ' checked' : ''}> Avisos de aves raras cerca de mí</label>
    <label class="interruptor"><input type="checkbox" id="aj-bencineras"${benc.bencinerasVisibles ? ' checked' : ''}> Bencineras y precios (CNE)</label>
    ${notif === 'granted' ? '<p class="nota">Notificaciones del sistema activadas.</p>'
      : notif === 'no-soportado' ? '' : '<button class="btn btn-sec" data-accion="notificaciones">Activar notificaciones del sistema</button>'}
    <label class="campo">Rendimiento del vehículo (km/L)
      <input type="number" id="aj-kml" min="3" max="40" step="0.5" value="${prefs.get('kmPorLitro', CFG.KM_POR_LITRO || 12)}">
    </label>
    <h4>Leyenda</h4>
    <ul class="leyenda">
      <li><i style="background:#22c55e"></i>Hotspot con registros en los últimos 7 días</li>
      <li><i style="background:#00b4d8"></i>Registros en los últimos 30 días</li>
      <li><i style="background:#94a3b8"></i>Sin registros recientes</li>
      <li><i class="anillo"></i>Activo (listas en los últimos 7 días)</li>
      <li><i style="background:#f59e0b"></i>Ave rara reportada</li>
    </ul>
    <p class="nota">Conexión eBird: <strong>${esc(modoEbird())}</strong> · ${hs.db.size} hotspots cargados.</p>
    <p class="nota">Datos de aves: eBird (Cornell Lab of Ornithology). Precios de combustible: Comisión Nacional de Energía.</p>`);

  document.getElementById('aj-region').onchange = (e) => {
    prefs.set('region', e.target.value);
    hs.setRegionManual(e.target.value);
    if (!e.target.value && geo.ultima) hs.detectarRegion(geo.ultima.lat, geo.ultima.lng);
  };
  document.getElementById('aj-alertas').onchange = (e) => prefs.set('alertasRuta', e.target.checked);
  document.getElementById('aj-raras').onchange = (e) => prefs.set('avisosRaras', e.target.checked);
  document.getElementById('aj-bencineras').onchange = async (e) => {
    try { await benc.alternarBencineras(e.target.checked); prefs.set('bencineras', e.target.checked); }
    catch { e.target.checked = false; prefs.set('bencineras', false); }
  };
  document.getElementById('aj-kml').onchange = (e) => {
    const v = parseFloat(e.target.value);
    if (v >= 3 && v <= 40) prefs.set('kmPorLitro', v);
  };
}
