// 1. Credenciales y Configuración
mapboxgl.accessToken = 'pk.eyJ1Ijoid2VsbHluYXZhcnJldGUiLCJhIjoiY210emQwbjBoMG9hbDJ5b2t0MHcxc3BkbyJ9.j_-CVMex9D8_qx_y1wPnJg';
const ebirdApiKey = '89f4bf7f-47ac-4e68-949f-de69c890bce7';

// Diccionario completo de regiones de Chile
const REGIONES_CHILE = {
  'CL-AP': { nombre: 'Arica y Parinacota' },
  'CL-TA': { nombre: 'Tarapacá' },
  'CL-AN': { nombre: 'Antofagasta' },
  'CL-AT': { nombre: 'Atacama' },
  'CL-CO': { nombre: 'Coquimbo' },
  'CL-VS': { nombre: 'Valparaíso' },
  'CL-RM': { nombre: 'Metropolitana' },
  'CL-LI': { nombre: 'O\'Higgins' },
  'CL-ML': { nombre: 'Maule' },
  'CL-NB': { nombre: 'Ñuble' },
  'CL-BI': { nombre: 'Bío-Bío' },
  'CL-AR': { nombre: 'La Araucanía' },
  'CL-LR': { nombre: 'Los Ríos' },
  'CL-LL': { nombre: 'Los Lagos' },
  'CL-AI': { nombre: 'Aysén' },
  'CL-MA': { nombre: 'Magallanes' }
};

// Variables globales
let regionActual = null;
let regionManual = false;
const regionesCargadas = new Set();
let hotspotsDataGlobal = [];
let ultimaVerificacionRegion = 0;
let ultimoHotspotAlertado = null;

// --- NUEVAS VARIABLES AGREGADAS ---
let autoSeguimiento = true;
let estiloMapaActual = 'satellite';
let rutaDestinoActual = null;
let longPressTimer = null;
let bencinerasMarkers = [];

// --- FUNCIÓN DE FEEDBACK (VIBRACIÓN/AUDIO) ---
function emitirFeedback(tipo = 'general') {
    if (navigator.vibrate) navigator.vibrate(tipo === 'recalculo' ? [80, 40, 80] : [100]);
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = tipo === 'recalculo' ? 440 : 880;
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.12);
    } catch(e) {}
}

// 2. Inicialización del Mapa
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/satellite-streets-v12',
    center: [-72.59, -38.73],
    zoom: 15.5,
    pitch: 65,
    antialias: true
});

map.on('style.load', () => {
    const layers = map.getStyle().layers;
    for (const layer of layers) {
        if (layer.type === 'symbol' && layer.layout && layer.layout['text-field']) {
            map.setLayoutProperty(layer.id, 'text-size', 16);
        }
    }
});

// Control de Navegación (Rutas)
const directions = new MapboxDirections({
    accessToken: mapboxgl.accessToken,
    unit: 'metric',
    profile: 'mapbox/driving',
    language: 'es-CL',
    placeholderOrigin: 'Origen (ej: Temuco)',
    placeholderDestination: 'Destino (ej: Saavedra)'
});

map.addControl(directions, 'top-left');
map.addControl(new mapboxgl.NavigationControl());

// Helper para garantizar GeoJSON válido
function obtenerGeoJSONActual() {
    return {
        type: 'FeatureCollection',
        features: hotspotsDataGlobal.map(h => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [h.lng, h.lat] },
            properties: { locId: h.locId, locName: h.locName }
        }))
    };
}

// 3. Descarga de datos eBird
async function getEBirdHotspots(codeRegion) {
    if (!codeRegion || typeof codeRegion !== 'string' || codeRegion.includes('.') || regionesCargadas.has(codeRegion)) {
        return obtenerGeoJSONActual();
    }
  
    try {
        const response = await fetch(`https://corsproxy.io/?https://api.ebird.org/v2/ref/hotspot/${codeRegion}?fmt=json&key=${ebirdApiKey}`);

        if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data)) {
                regionesCargadas.add(codeRegion);
                const existentes = new Set(hotspotsDataGlobal.map(h => h.locId));
                const nuevos = data.filter(h => !existentes.has(h.locId));
                hotspotsDataGlobal = [...hotspotsDataGlobal, ...nuevos];
            }
        }
    } catch (error) {
        console.error("Error cargando eBird:", error);
    }

    return obtenerGeoJSONActual();
}

async function refrescarMapaHotspots(codeRegion) {
    const geojson = await getEBirdHotspots(codeRegion);
    if (map.getSource('ebird-hotspots')) {
        map.getSource('ebird-hotspots').setData(geojson);
    }
}

// 4. Carga de datos e Interacciones (Puntos Individuales sin Clustering)
map.on('load', async () => {
    const hotspotsGeoJSON = await getEBirdHotspots('CL-AR');

    map.addSource('ebird-hotspots', {
        type: 'geojson',
        data: hotspotsGeoJSON, 
        cluster: false
    });

    map.addLayer({
        id: 'unclustered-point',
        type: 'circle',
        source: 'ebird-hotspots',
        paint: {
            'circle-color': '#00b4d8',
            'circle-radius': 6,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff'
        }
    });

   map.on('click', 'unclustered-point', (e) => {
    const coordinates = e.features[0].geometry.coordinates.slice();
    const locName = e.features[0].properties.locName;
    const locId = e.features[0].properties.locId;
    const lng = coordinates[0];
    const lat = coordinates[1];
    const fotoUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},14,0/300x160?access_token=${mapboxgl.accessToken}`;

    // Iconos SVG vectoriales inline
    const iconBird = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: -3px; margin-right: 6px;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-5l6 2.5-6 2.5z"/></svg>`;
    const iconNav = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: -3px; margin-right: 6px;"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>`;

    const htmlContent = `
        <div class="popup-card-clean">
            <img src="${fotoUrl}" class="popup-img-clean" alt="${locName}">
            <div class="popup-body-clean">
                <h3>${locName}</h3>
                <div style="display: flex; gap: 8px; flex-direction: column;">
                    <button class="popup-btn-clean" onclick="cargarObservaciones('${locId}')">${iconBird}Ver aves recientes</button>
                    <button class="popup-btn-ir" onclick="iniciarRutaHacia(${lng}, ${lat}, '${locName.replace(/'/g, "\\'")}')">${iconNav}Ir hacia aquí</button>
                </div>
            </div>
        </div>
    `;

    new mapboxgl.Popup().setLngLat(coordinates).setHTML(htmlContent).addTo(map);
});

    map.on('mouseenter', 'unclustered-point', () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', 'unclustered-point', () => map.getCanvas().style.cursor = '');

   activarRastreoPosicion();
});

// 5. Panel Lateral e Imágenes Wikipedia
async function cargarImagenAve(sciName, speciesCode) {
    try {
        const query = sciName.replace(' ', '_');
        const res = await fetch(`https://es.wikipedia.org/api/rest_v1/page/summary/${query}`);
        const data = await res.json();
        if (data.thumbnail && data.thumbnail.source) {
            const imgEl = document.getElementById(`img-${speciesCode}`);
            if (imgEl) imgEl.src = data.thumbnail.source;
        }
    } catch (e) { console.log("Sin foto en Wikipedia"); }
}

async function cargarObservaciones(locId) {
    const panel = document.getElementById('side-panel');
    const content = document.getElementById('panel-content');
    if (panel) panel.classList.add('panel-open');
    if (content) content.innerHTML = '<p style="text-align: center;">Cargando...</p>';

    try {
        const response = await fetch(`https://corsproxy.io/?https://api.ebird.org/v2/data/obs/${locId}/recent?sppLocale=es-CL&key=${ebirdApiKey}`);
        const aves = await response.json();

        if (!Array.isArray(aves) || aves.length === 0) {
            if (content) content.innerHTML = '<p>No hay observaciones recientes.</p>';
            return;
        }

        let htmlLista = '';
        aves.forEach(ave => {
            htmlLista += `
                <div class="bird-item" style="display: flex; gap: 15px; align-items: center; padding: 12px 0; border-bottom: 1px solid #eee;">
                    <img id="img-${ave.speciesCode}" src="https://via.placeholder.com/60?text=Ave" style="width: 60px; height: 60px; border-radius: 50%; object-fit: cover;">
                    <div>
                        <div style="font-size: 15px; font-weight: bold;">${ave.comName}</div>
                        <div style="font-size: 12px; color: #666; font-style: italic;">${ave.sciName}</div>
                        <div style="font-size: 11px; color: #999;">Último registro: ${ave.obsDt}</div>
                    </div>
                </div>
            `;
            cargarImagenAve(ave.sciName, ave.speciesCode);
        });
        if (content) content.innerHTML = htmlLista;
    } catch (error) {
        if (content) content.innerHTML = '<p>Error de conexión.</p>';
    }
}

function cerrarPanel() {
    const panel = document.getElementById('side-panel');
    if (panel) panel.classList.remove('panel-open');
}

// 6. Radar de Hotspots Activos
async function buscarHotspotsActivos() {
    const btn = document.getElementById('btn-radar');
    if (!btn) return;

    const iconFlame = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: -2px; margin-right: 6px;"><path d="M13.5 1.5c0 0-2.5 3.5-2.5 6 0 1.38.56 2.63 1.47 3.53C11.53 10.37 10.5 9.17 10.5 7.5c0 0-3.5 3.5-3.5 7.5 0 3.87 3.13 7 7 7s7-3.13 7-7c0-5.5-4.5-9.5-7.5-13.5z"/></svg>`;

    if (btn.classList.contains('activo')) {
        btn.classList.remove('activo');
        btn.innerHTML = `${iconFlame}Ver activos (Últimos 7 días)`;
        if (map.getLayer('puntos-rojos')) map.removeLayer('puntos-rojos');
        if (map.getSource('activos-source')) map.removeSource('activos-source');
        return;
    }

    btn.innerText = "Buscando...";
    try {
        const response = await fetch(`https://corsproxy.io/?https://api.ebird.org/v2/data/obs/CL-AR/recent?back=7&key=${ebirdApiKey}`);
        const observaciones = await response.json();
        const lugaresActivos = [];
        const idsVistos = new Set();
        
        if (Array.isArray(observaciones)) {
            observaciones.forEach(obs => {
                if (obs.locId && !idsVistos.has(obs.locId)) {
                    idsVistos.add(obs.locId);
                    lugaresActivos.push({
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [obs.lng, obs.lat] },
                        properties: { locId: obs.locId, locName: obs.locName }
                    });
                }
            });
        }

        if (map.getLayer('puntos-rojos')) map.removeLayer('puntos-rojos');
        if (map.getSource('activos-source')) map.removeSource('activos-source');

        map.addSource('activos-source', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: lugaresActivos }
        });

        map.addLayer({
            id: 'puntos-rojos',
            type: 'circle',
            source: 'activos-source',
            paint: { 'circle-color': '#ff5252', 'circle-radius': 8, 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' }
        });

        btn.classList.add('activo');
        btn.innerHTML = `${iconFlame}Ocultar activos`;
    } catch (error) {
        btn.innerText = "Error de conexión";
    }
}

// 7. Navegación HUD y Alertas
let navWatchId = null;
let navCurrentHeading = 0;
let navMarker = null;

// --- Recálculo automático de ruta ---
let rutaActualCoords = null;      // Geometría (array de [lng, lat]) de la ruta activa
let destinoActivo = null;         // { lng, lat, nombre } del destino en curso
let recalculandoRuta = false;     // Evita solicitudes de recálculo superpuestas
let ultimaRecalculacionTs = 0;    // Timestamp del último recálculo disparado
let directionsListenerAdded = false; // Evita registrar el listener 'route' más de una vez
const UMBRAL_DESVIO_METROS = 40;     // Distancia perpendicular a la ruta que se considera "desvío"
const COOLDOWN_RECALCULO_MS = 8000;  // Tiempo mínimo entre recálculos consecutivos

if (window.DeviceOrientationEvent) {
    window.addEventListener('deviceorientationabsolute', (event) => {
        if (event.alpha !== null) navCurrentHeading = 360 - event.alpha;
    }, true);
}

// Distancia en metros entre dos coordenadas (Haversine)
function distanciaHaversineMetros(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Distancia perpendicular (en metros) de un punto a un segmento de ruta, usando
// una proyección plana local (suficientemente precisa para tramos cortos de calle)
function distanciaPuntoASegmento(lng, lat, lng1, lat1, lng2, lat2) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos(toRad(lat1));

    const x = (lng - lng1) * mPerDegLng;
    const y = (lat - lat1) * mPerDegLat;
    const dx = (lng2 - lng1) * mPerDegLng;
    const dy = (lat2 - lat1) * mPerDegLat;

    const lengthSq = dx * dx + dy * dy;
    let t = lengthSq === 0 ? 0 : (x * dx + y * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));

    const distX = x - t * dx;
    const distY = y - t * dy;
    return Math.sqrt(distX * distX + distY * distY);
}

// Distancia mínima del usuario a la polilínea completa de la ruta activa
function distanciaMinimaARuta(lng, lat, rutaCoords) {
    if (!rutaCoords || rutaCoords.length < 2) return Infinity;
    let minDist = Infinity;
    for (let i = 0; i < rutaCoords.length - 1; i++) {
        const [lng1, lat1] = rutaCoords[i];
        const [lng2, lat2] = rutaCoords[i + 1];
        const d = distanciaPuntoASegmento(lng, lat, lng1, lat1, lng2, lat2);
        if (d < minDist) minDist = d;
    }
    return minDist;
}

// Dispara un nuevo cálculo de ruta desde la posición actual del usuario hacia el destino activo
// Feedback breve (vibración + beep) al detectar un desvío y disparar el recálculo
function feedbackDesvioRuta() {
    // Vibración (solo funciona en navegadores/celulares compatibles, ej. Chrome Android)
    if ('vibrate' in navigator) {
        try { navigator.vibrate([120, 60, 120]); } catch (e) { /* ignorar si el navegador lo bloquea */ }
    }

    // Beep corto generado con Web Audio API (no requiere archivos de audio externos)
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
        osc.onended = () => ctx.close();
    } catch (e) { /* Web Audio no disponible o bloqueado por el navegador */ }
}

function recalcularRuta(userLng, userLat) {
    if (!destinoActivo || recalculandoRuta) return;
    recalculandoRuta = true;
    ultimaRecalculacionTs = Date.now();

    feedbackDesvioRuta();

    const instructionEl = document.getElementById('nav-instruction');
    const subEl = document.getElementById('nav-sub-instruction');
    if (instructionEl) instructionEl.innerText = 'Recalculando ruta...';
    if (subEl) subEl.innerText = 'Te desviaste, buscando un nuevo camino';

    directions.setOrigin([userLng, userLat]);
    directions.setDestination([destinoActivo.lng, destinoActivo.lat]);
}

function iniciarRutaHacia(lng, lat, nombreDestino) {
    document.querySelectorAll('.mapboxgl-ctrl-directions').forEach(p => p.style.setProperty('display', 'none', 'important'));
    while (document.getElementsByClassName('mapboxgl-popup')[0]) document.getElementsByClassName('mapboxgl-popup')[0].remove();
    
   if (document.getElementById('btn-radar')) document.getElementById('btn-radar').style.display = 'none';
if (document.getElementById('nav-hud')) document.getElementById('nav-hud').style.display = 'flex';
if (document.getElementById('btn-centrar')) document.getElementById('btn-centrar').style.display = 'flex';
if (document.getElementById('nav-instruction')) document.getElementById('nav-instruction').innerText = `Hacia ${nombreDestino}`;
if (document.getElementById('nav-sub-instruction')) document.getElementById('nav-sub-instruction').innerText = 'Sigue el trazado de la ruta';

    // Guarda el destino activo y reinicia el estado de recálculo para este nuevo viaje
    destinoActivo = { lng, lat, nombre: nombreDestino };
    rutaActualCoords = null;
    recalculandoRuta = false;
    ultimaRecalculacionTs = 0;

    navigator.geolocation.getCurrentPosition((pos) => {
        directions.setOrigin([pos.coords.longitude, pos.coords.latitude]);
        directions.setDestination([lng, lat]);
    }, () => directions.setDestination([lng, lat]), { enableHighAccuracy: false, timeout: 15000, maximumAge: 10000 });

    if (navWatchId !== null) navigator.geolocation.clearWatch(navWatchId);

    // El listener 'route' se registra una sola vez: así también captura las rutas
    // generadas por recalcularRuta() sin duplicar el manejador cada vez que se navega
    if (!directionsListenerAdded) {
        directionsListenerAdded = true;
        directions.on('route', (e) => {
            if (e.route && e.route.length > 0) {
                const ruta = e.route[0];
                const minutos = Math.round(ruta.duration / 60);
                const km = (ruta.distance / 1000).toFixed(1);

                const ahora = new Date();
                ahora.setMinutes(ahora.getMinutes() + minutos);
                const horaLlegada = ahora.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                const timeEl = document.getElementById('nav-time');
                const detailsEl = document.getElementById('nav-details');

                if (timeEl) timeEl.innerText = `${minutos} min`;
                if (detailsEl) detailsEl.innerText = `${km} km • Llegada ${horaLlegada}`;

                // Guarda la geometría para poder medir el desvío del usuario respecto a la ruta
                if (ruta.geometry && Array.isArray(ruta.geometry.coordinates)) {
                    rutaActualCoords = ruta.geometry.coordinates;
                }

                // Si esta ruta llegó producto de un recálculo, restaura el HUD a su estado normal
                if (recalculandoRuta) {
                    recalculandoRuta = false;
                    const instructionEl = document.getElementById('nav-instruction');
                    const subEl = document.getElementById('nav-sub-instruction');
                    if (instructionEl && destinoActivo) instructionEl.innerText = `Hacia ${destinoActivo.nombre}`;
                    if (subEl) subEl.innerText = 'Sigue el trazado de la ruta';
                }
            }
        });
    }

    navWatchId = navigator.geolocation.watchPosition((position) => {
        const userLng = position.coords.longitude;
        const userLat = position.coords.latitude;
        const bearingToUse = position.coords.heading || navCurrentHeading;

        if (document.getElementById('speedometer-value')) {
            document.getElementById('speedometer-value').textContent = position.coords.speed ? Math.round(position.coords.speed * 3.6) : 0;
        }

        verificarHotspotsCercanosEnRuta(userLng, userLat);

        // --- Detección de desvío y recálculo automático ---
        if (destinoActivo && rutaActualCoords) {
            const desviacionMetros = distanciaMinimaARuta(userLng, userLat, rutaActualCoords);
            const ahoraTs = Date.now();
            if (
                desviacionMetros > UMBRAL_DESVIO_METROS &&
                !recalculandoRuta &&
                (ahoraTs - ultimaRecalculacionTs) > COOLDOWN_RECALCULO_MS
            ) {
                recalcularRuta(userLng, userLat);
            }
        }

        if (typeof map !== 'undefined') {
        if (autoSeguimiento) {
            map.easeTo({ 
                center: [userLng, userLat], 
                zoom: 16.5, 
                pitch: 40, 
                bearing: bearingToUse, 
                duration: 800,
                easing: (t) => t
            });
        }

        if (!navMarker) {
            const el = document.createElement('div');
            el.className = 'nav-marker';
            navMarker = new mapboxgl.Marker({ element: el }).setLngLat([userLng, userLat]).addTo(map);
        } else {
            navMarker.setLngLat([userLng, userLat]);
        }
    }
    }, (error) => { if (error.code !== 3) console.log("Error GPS:", error); }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 10000 });
}

function salirNavegacion() {
    if (document.getElementById('nav-hud')) document.getElementById('nav-hud').style.display = 'none';
    if (document.getElementById('btn-centrar')) document.getElementById('btn-centrar').style.display = 'none';
    if (document.getElementById('btn-radar')) document.getElementById('btn-radar').style.display = 'block';
    if (typeof directions !== 'undefined') directions.removeRoutes();
    if (navWatchId !== null) { navigator.geolocation.clearWatch(navWatchId); navWatchId = null; }
    if (navMarker) { navMarker.remove(); navMarker = null; }

    // Limpia el estado de recálculo de ruta
    destinoActivo = null;
    rutaActualCoords = null;
    recalculandoRuta = false;
    ultimaRecalculacionTs = 0;

    if (typeof map !== 'undefined') map.easeTo({ pitch: 0, bearing: 0, zoom: 13, duration: 800 });
}

function verificarHotspotsCercanosEnRuta(userLng, userLat) {
    if (!hotspotsDataGlobal.length) return;
    let hotspotCercano = null;
    let menorDistancia = 1.5;

    hotspotsDataGlobal.forEach(spot => {
        const R = 6371;
        const dLat = (spot.lat - userLat) * Math.PI / 180;
        const dLon = (spot.lng - userLng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(userLat * Math.PI / 180) * Math.cos(spot.lat * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const dist = R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));

        if (dist < menorDistancia) { menorDistancia = dist; hotspotCercano = spot; }
    });

    if (hotspotCercano && hotspotCercano.locId !== ultimoHotspotAlertado) {
        ultimoHotspotAlertado = hotspotCercano.locId;
        mostrarTarjetaDesvio(hotspotCercano, menorDistancia);
    }
}

function mostrarTarjetaDesvio(hotspot, distanciaKm) {
    let card = document.getElementById('desvio-card');
    if (!card) {
        card = document.createElement('div');
        card.id = 'desvio-card';
        card.className = 'desvio-card-hud';
        document.body.appendChild(card);
    }

    const iconPin = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: -2px; margin-left: 4px;"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;
    const distTexto = distanciaKm < 1 ? `${Math.round(distanciaKm * 1000)} m` : `${distanciaKm.toFixed(1)} km`;

    card.innerHTML = `
        <div class="desvio-info">
            <span class="desvio-tag">Hotspot cercano</span>
            <strong>${hotspot.locName}</strong>
            <small>A ${distTexto}</small>
        </div>
        <button onclick="iniciarRutaHacia(${hotspot.lng}, ${hotspot.lat}, '${hotspot.locName.replace(/'/g, "\\'")}')">
            Desviarme ${iconPin}
        </button>
    `;
    card.classList.add('visible');
    setTimeout(() => card.classList.remove('visible'), 12000);
}

// 8. GPS Inicial
async function detectarRegionPorGPS(lng, lat) {
    if (regionManual) return;
    try {
        const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=region&access_token=${mapboxgl.accessToken}`);
        const data = await res.json();
        if (data.features && data.features.length > 0) {
            const isoCode = data.features[0].properties.short_code;
            if (isoCode && REGIONES_CHILE[isoCode] && regionActual !== isoCode) {
                regionActual = isoCode;
                await refrescarMapaHotspots(isoCode);
            }
        }
    } catch (error) { console.error("Error GPS:", error); }
}

function activarGPSInicial() {
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                map.flyTo({ center: [position.coords.longitude, position.coords.latitude], zoom: 15.5, pitch: 65, essential: true });
                detectarRegionPorGPS(position.coords.longitude, position.coords.latitude);
            },
            (error) => console.warn("GPS inicial no disponible:", error.message),
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }
}

// Exports globales
window.iniciarRutaHacia = iniciarRutaHacia;
window.salirNavegacion = salirNavegacion;
window.cargarObservaciones = cargarObservaciones;
window.cerrarPanel = cerrarPanel;
window.buscarHotspotsActivos = buscarHotspotsActivos;
// ==========================================
// 9. NUEVAS FUNCIONALIDADES ADICIONALES
// ==========================================

// 1. Centrar el mapa al instante en la ubicación actual del usuario
function centrarUbicacion() {
    console.log("🎯 Solicitando centrado de ubicación...");
    
    if (!map) {
        console.warn("El mapa aún no está listo.");
        return;
    }

    // Fallback rápido: Si ya existe un marcador de usuario en pantalla, volar directamente a él
    if (typeof userMarker !== 'undefined' && userMarker) {
        const lngLat = userMarker.getLngLat();
        map.flyTo({ center: [lngLat.lng, lngLat.lat], zoom: 16, pitch: 45, essential: true });
        return;
    }

    // Consulta GPS directa con manejo explícito de errores
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const coords = [pos.coords.longitude, pos.coords.latitude];
                console.log("Ubicación obtenida:", coords);
                map.flyTo({
                    center: coords,
                    zoom: 16,
                    pitch: 45,
                    essential: true
                });
            },
            (err) => {
                console.error("Error al obtener ubicación:", err);
                alert("GPS Bloqueado o Sin Permisos: Asegúrate de estar usando una conexión segura (HTTPS) y tener la ubicación activada.");
            },
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
        );
    } else {
        alert("Tu navegador no soporta Geolocalización.");
    }
}

// 2. Alternar entre estilos de mapa ('streets' vs 'satellite')
let estiloMapaActual = 'satellite';

function cambiarEstiloMapa(tipo) {
    if (tipo === estiloMapaActual || !map) return;
    estiloMapaActual = tipo;

    // 1. Cambiar estado visual de los botones
    const btnStreets = document.getElementById('btn-style-streets');
    const btnSatellite = document.getElementById('btn-style-satellite');
    if (btnStreets) btnStreets.classList.toggle('active', tipo === 'streets');
    if (btnSatellite) btnSatellite.classList.toggle('active', tipo === 'satellite');

    // 2. Seleccionar mapa base de Mapbox
    const estiloUrl = tipo === 'streets' 
        ? 'mapbox://styles/mapbox/outdoors-v12' 
        : 'mapbox://styles/mapbox/satellite-streets-v12';

    map.setStyle(estiloUrl);

    // 3. Re-dibujar los hotspots una vez cargado el nuevo estilo base
    map.once('style.load', () => {
        const geojson = obtenerGeoJSONActual();

        if (!map.getSource('ebird-hotspots')) {
            map.addSource('ebird-hotspots', {
                type: 'geojson',
                data: geojson,
                cluster: false
            });
        }

        if (!map.getLayer('unclustered-point')) {
            map.addLayer({
                id: 'unclustered-point',
                type: 'circle',
                source: 'ebird-hotspots',
                paint: {
                    'circle-color': '#00b4d8',
                    'circle-radius': 6,
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#ffffff'
                }
            });
        }
    });
}

// ==========================================
// 9. FUNCIONALIDADES DE CONTROL Y RASTREO GPS
// ==========================================

userMarker = null;
watchPositionId = null;

// Centrar el mapa al instante en la ubicación del marcador activo
function centrarUbicacion() {
    if (!map) return;

    if (userMarker) {
        const lngLat = userMarker.getLngLat();
        map.flyTo({ center: [lngLat.lng, lngLat.lat], zoom: 16, pitch: 45, essential: true });
    } else if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            (pos) => map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 16, pitch: 45, essential: true }),
            () => alert("GPS sin permisos o desactivado.")
        );
    }
}

// Alternar entre estilos de mapa ('streets' vs 'satellite')
estiloMapaActual = 'satellite';

function cambiarEstiloMapa(tipo) {
    if (tipo === estiloMapaActual || !map) return;
    estiloMapaActual = tipo;

    const btnStreets = document.getElementById('btn-style-streets');
    const btnSatellite = document.getElementById('btn-style-satellite');
    if (btnStreets) btnStreets.classList.toggle('active', tipo === 'streets');
    if (btnSatellite) btnSatellite.classList.toggle('active', tipo === 'satellite');

    const estiloUrl = tipo === 'streets' 
        ? 'mapbox://styles/mapbox/outdoors-v12' 
        : 'mapbox://styles/mapbox/satellite-streets-v12';

    map.setStyle(estiloUrl);

    map.once('style.load', () => {
        const geojson = obtenerGeoJSONActual();

        if (!map.getSource('ebird-hotspots')) {
            map.addSource('ebird-hotspots', { type: 'geojson', data: geojson, cluster: false });
        }

        if (!map.getLayer('unclustered-point')) {
            map.addLayer({
                id: 'unclustered-point',
                type: 'circle',
                source: 'ebird-hotspots',
                paint: {
                    'circle-color': '#00b4d8',
                    'circle-radius': 6,
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#ffffff'
                }
            });
        }
    });
}

// Filtrar hotspots por nombre
function buscarHotspotPorNombre(textoBusqueda) {
    if (!hotspotsDataGlobal || hotspotsDataGlobal.length === 0) return;

    const textoLimpio = textoBusqueda.toLowerCase().trim();
    const filtrados = hotspotsDataGlobal.filter(h => h.locName.toLowerCase().includes(textoLimpio));

    const geojsonFiltrado = {
        type: 'FeatureCollection',
        features: filtrados.map(h => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [h.lng, h.lat] },
            properties: { locId: h.locId, locName: h.locName }
        }))
    };

    if (map.getSource('ebird-hotspots')) {
        map.getSource('ebird-hotspots').setData(geojsonFiltrado);
    }
}

// Rastreo de posición en tiempo real (Punto azul animado)
function activarRastreoPosicion() {
    if (!navigator.geolocation) return;

    const el = document.createElement('div');
    el.className = 'user-location-marker';
    el.innerHTML = `
        <div class="user-dot-pulse"></div>
        <div class="user-dot"></div>
    `;

    watchPositionId = navigator.geolocation.watchPosition(
        (pos) => {
            const coords = [pos.coords.longitude, pos.coords.latitude];

            if (!userMarker) {
                userMarker = new mapboxgl.Marker({ element: el })
                    .setLngLat(coords)
                    .addTo(map);
                
                map.flyTo({ center: coords, zoom: 15.5, pitch: 65, essential: true });
                detectarRegionPorGPS(coords[0], coords[1]);
            } else {
                userMarker.setLngLat(coords);
            }
        },
        (err) => console.error("Error GPS:", err),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
}

// Exportación consolidada al objeto window
window.centrarUbicacion = centrarUbicacion;
window.cambiarEstiloMapa = cambiarEstiloMapa;
window.manejarBusquedaPredictiva = manejarBusquedaPredictiva;
window.toggleBencinerasCercanas = toggleBencinerasCercanas;

// ==========================================
// NUEVAS FUNCIONES: BÚSQUEDA PREDICTIVA Y BENCINERAS
// ==========================================

function manejarBusquedaPredictiva(texto) {
    const dropdown = document.getElementById('autocomplete-results');
    const query = texto.toLowerCase().trim();

    if (!query || typeof hotspotsDataGlobal === 'undefined') {
        dropdown.style.display = 'none';
        return;
    }

    const coincidencias = hotspotsDataGlobal.filter(h => h.locName.toLowerCase().includes(query)).slice(0, 5);

    if (coincidencias.length === 0) {
        dropdown.style.display = 'none';
        return;
    }

    dropdown.innerHTML = coincidencias.map(h => `
        <div class="autocomplete-item" onclick="seleccionarHotspotBusqueda(${h.lng}, ${h.lat}, '${h.locName.replace(/'/g, "\\'")}')">
            ${h.locName}
        </div>
    `).join('');

    dropdown.style.display = 'block';
}

function seleccionarHotspotBusqueda(lng, lat, nombre) {
    document.getElementById('autocomplete-results').style.display = 'none';
    document.getElementById('input-busqueda').value = nombre;
    map.flyTo({ center: [lng, lat], zoom: 15 });
}

async function toggleBencinerasCercanas() {
    if (bencinerasMarkers.length > 0) {
        bencinerasMarkers.forEach(m => m.remove());
        bencinerasMarkers = [];
        return;
    }

    try {
        const url = 'https://corsproxy.io/?https://www.bencinaenlinea.cl/CNE_Servicios/Servicios/Estaciones';
        const response = await fetch(url);
        if (!response.ok) throw new Error("Error de red");

        const estaciones = await response.json();
        const bounds = map.getBounds();

        estaciones.forEach(estacion => {
            const lat = parseFloat(estacion.latitud);
            const lng = parseFloat(estacion.longitud);

            if (lng >= bounds.getWest() && lng <= bounds.getEast() &&
                lat >= bounds.getSouth() && lat <= bounds.getNorth()) {

                const nombreEstacion = estacion.distribuidor || 'Estación de Servicio';
                const direccionEstacion = estacion.direccion || 'Chile';

                const popupHtml = `
                    <div style="width: 270px; padding: 6px; font-family: -apple-system, sans-serif; color: #0f172a;">
                        <!-- Encabezado Copec -->
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                            <div style="width: 42px; height: 42px; background: #f1f5f9; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="#334155">
                                    <path d="M19 10v2c0 1.66-1.34 3-3 3h-.5a2.5 2.5 0 0 0-2.5-2.5V11a2.5 2.5 0 0 0-2.5-2.5H9c-1.38 0-2.5.9-2.5 2V18h-1a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2h1c.83 0 1.5.67 1.5 1.5v3h1c1.1 0 2-.9 2-2V11c0-.28.22-.5.5-.5h1c.28 0 .5.22.5.5v2c0 1.1-.9 2-2 2h-1c1.38 0 2.5 1.12 2.5 2.5h.5c.83 0 1.5-.67 1.5-1.5V10l3.18-1.59A1.5 1.5 0 0 0 22 7.07 1.5 1.5 0 0 0 20.5 5.57L17.5 7 19 10m-3-7a2 2 0 1 1-2-2 2 2 0 0 1 2 2M10 3a2 2 0 1 1-2-2 2 2 0 0 1 2 2Z"/>
                                </svg>
                            </div>
                            <div style="flex-grow: 1; overflow: hidden;">
                                <div style="font-size: 18px; font-weight: 800; color: #1e293b; line-height: 1.2;">${nombreEstacion}</div>
                                <div style="font-size: 11px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px;">${direccionEstacion}</div>
                            </div>
                        </div>

                        <div style="height: 1px; background: #e2e8f0; margin-bottom: 10px;"></div>

                        <!-- Lista de Precios -->
                        <div style="display: flex; flex-direction: column; gap: 8px; font-size: 13px; margin-bottom: 12px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="display: flex; align-items: center; gap: 8px;"><span style="width: 10px; height: 10px; border-radius: 50%; background: #16a34a;"></span>Gasolina 93</span>
                                <strong>$${estacion.precios?.['93'] || 'N/A'} <span style="font-size: 10px; color: #94a3b8; font-weight: normal;">$/L</span></strong>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="display: flex; align-items: center; gap: 8px;"><span style="width: 10px; height: 10px; border-radius: 50%; background: #f97316;"></span>Gasolina 95</span>
                                <strong>$${estacion.precios?.['95'] || 'N/A'} <span style="font-size: 10px; color: #94a3b8; font-weight: normal;">$/L</span></strong>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="display: flex; align-items: center; gap: 8px;"><span style="width: 10px; height: 10px; border-radius: 50%; background: #dc2626;"></span>Gasolina 97</span>
                                <strong>$${estacion.precios?.['97'] || 'N/A'} <span style="font-size: 10px; color: #94a3b8; font-weight: normal;">$/L</span></strong>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="display: flex; align-items: center; gap: 8px;"><span style="width: 10px; height: 10px; border-radius: 50%; background: #475569;"></span>Petróleo Diésel</span>
                                <strong>$${estacion.precios?.['diesel'] || 'N/A'} <span style="font-size: 10px; color: #94a3b8; font-weight: normal;">$/L</span></strong>
                            </div>
                        </div>

                        <div style="height: 1px; background: #e2e8f0; margin-bottom: 12px;"></div>

                        <!-- Botón Tomar Desvío -->
                        <button onclick="tomarDesvioEstacion(${lng}, ${lat}, '${nombreEstacion.replace(/'/g, "\\'")}')" 
                                style="width: 100%; background: #0f172a; color: white; border: none; padding: 10px; border-radius: 10px; font-weight: 700; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v20M12 2l7 10M12 2L5 12"/></svg>
                            Tomar Desvío (${nombreEstacion})
                        </button>
                    </div>
                `;

                const el = document.createElement('div');
                el.className = 'gas-station-marker';
                el.innerHTML = `
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="#0284c7" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 22V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v18"/>
                        <path d="M14 13h4a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/>
                    </svg>
                `;

                const marker = new mapboxgl.Marker(el)
                    .setLngLat([lng, lat])
                    .setPopup(new mapboxgl.Popup({ offset: 15, maxWidth: '300px' }).setHTML(popupHtml))
                    .addTo(map);

                bencinerasMarkers.push(marker);
            }
        });
        emitirFeedback('general');
    } catch (e) {
        console.error("Error al obtener Bencina en Línea:", e);
    }
}
let desvioActivo = null;

function tomarDesvioEstacion(lng, lat, nombre) {
    if (!destinoActivo) {
        iniciarRutaHacia(lng, lat, nombre);
        return;
    }

    desvioActivo = { lng, lat, nombre };

    const aplicarRutaConDesvio = (origenLngLat) => {
        if (typeof directions !== 'undefined') {
            const desvio = [lng, lat];
            const destino = [destinoActivo.lng, destinoActivo.lat];

            directions.setOrigin(origenLngLat);
            directions.setDestination(destino);
            directions.addWaypoint(0, desvio);

            const subEl = document.getElementById('nav-sub-instruction');
            if (subEl) subEl.innerText = `Desvío programado: Parada en ${nombre}`;

            // Punto 2: Hacer visible el botón de cancelar desvío en el HUD
            const btnCancelar = document.getElementById('btn-cancelar-desvio');
            if (btnCancelar) btnCancelar.style.display = 'block';

            emitirFeedback('general');
        }
    };

    if (userMarker) {
        const pos = userMarker.getLngLat();
        aplicarRutaConDesvio([pos.lng, pos.lat]);
        return;
    }

    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            pos => {
                aplicarRutaConDesvio([pos.coords.longitude, pos.coords.latitude]);
            },
            err => {
                console.error("Error al obtener GPS:", err);
                alert("No se pudo obtener la ubicación GPS activa.");
            },
            { enableHighAccuracy: true, timeout: 5000 }
        );
    }
}

    desvioActivo = { lng, lat, nombre };

    const aplicarRutaConDesvio = (origenLngLat) => {
        if (typeof directions !== 'undefined') {
            const desvio = [lng, lat];
            const destino = [destinoActivo.lng, destinoActivo.lat];

            // Establecer origen y destino, luego inyectar la parada intermedia
            directions.setOrigin(origenLngLat);
            directions.setDestination(destino);
            directions.addWaypoint(0, desvio);

            const subEl = document.getElementById('nav-sub-instruction');
            if (subEl) subEl.innerText = `Desvío programado: Parada en ${nombre}`;
            
            emitirFeedback('general');
        }
    };

    // 1. Usar inmediatamente la posición activa del marcador en el mapa
    if (userMarker) {
        const pos = userMarker.getLngLat();
        aplicarRutaConDesvio([pos.lng, pos.lat]);
        return;
    }

    // 2. Fallback si el marcador aún no se ha dibujado
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            pos => {
                aplicarRutaConDesvio([pos.coords.longitude, pos.coords.latitude]);
            },
            err => {
                console.error("Error al obtener ubicación GPS:", err);
                alert("No se pudo obtener tu ubicación actual. Asegúrate de tener el GPS activo.");
            },
            { enableHighAccuracy: true, timeout: 5000 }
        );
    }
}

window.tomarDesvioEstacion = tomarDesvioEstacion;
function cancelarDesvio() {
    if (!desvioActivo || !destinoActivo) return;

    desvioActivo = null;

    if (typeof directions !== 'undefined' && userMarker) {
        const pos = userMarker.getLngLat();
        directions.setOrigin([pos.lng, pos.lat]);
        directions.setDestination([destinoActivo.lng, destinoActivo.lat]);
    }

    const subEl = document.getElementById('nav-sub-instruction');
    if (subEl) subEl.innerText = `Ruta directa a ${destinoActivo.nombre}`;

    const btnCancelar = document.getElementById('btn-cancelar-desvio');
    if (btnCancelar) btnCancelar.style.display = 'none';

    emitirFeedback('general');
}

window.cancelarDesvio = cancelarDesvio;
