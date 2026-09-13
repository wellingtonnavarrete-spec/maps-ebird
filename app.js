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

// 4. Carga de datos, Clustering e Interacciones
map.on('load', async () => {
    const hotspotsGeoJSON = await getEBirdHotspots('CL-AR');

    map.addSource('ebird-hotspots', {
        type: 'geojson',
        data: hotspotsGeoJSON, 
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50
    });
  
    map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'ebird-hotspots',
        filter: ['has', 'point_count'],
        paint: {
            'circle-color': ['step', ['get', 'point_count'], '#51bbd6', 10, '#f1f075', 50, '#f28cb1'],
            'circle-radius': ['step', ['get', 'point_count'], 20, 10, 30, 50, 40]
        }
    });

    map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'ebird-hotspots',
        filter: ['has', 'point_count'],
        layout: {
            'text-field': '{point_count_abbreviated}',
            'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
            'text-size': 12
        }
    });

    map.addLayer({
        id: 'unclustered-point',
        type: 'circle',
        source: 'ebird-hotspots',
        filter: ['!', ['has', 'point_count']],
        paint: {
            'circle-color': '#11b4da',
            'circle-radius': 6,
            'circle-stroke-width': 1,
            'circle-stroke-color': '#fff'
        }
    });

    map.on('click', 'clusters', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        const clusterId = features[0].properties.cluster_id;
        map.getSource('ebird-hotspots').getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (err) return;
            map.easeTo({ center: features[0].geometry.coordinates, zoom: zoom });
        });
    });

    map.on('click', 'unclustered-point', (e) => {
        const coordinates = e.features[0].geometry.coordinates.slice();
        const locName = e.features[0].properties.locName;
        const locId = e.features[0].properties.locId;
        const lng = coordinates[0];
        const lat = coordinates[1];
        const fotoUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},14,0/300x160?access_token=${mapboxgl.accessToken}`;

        const htmlContent = `
            <div class="popup-card-clean">
                <img src="${fotoUrl}" class="popup-img-clean" alt="${locName}">
                <div class="popup-body-clean">
                    <h3>${locName}</h3>
                    <div style="display: flex; gap: 8px; flex-direction: column;">
                        <button class="popup-btn-clean" onclick="cargarObservaciones('${locId}')">🌿 Ver aves recientes</button>
                        <button class="popup-btn-ir" onclick="iniciarRutaHacia(${lng}, ${lat}, '${locName.replace(/'/g, "\\'")}')">🚗 Ir hacia aquí</button>
                    </div>
                </div>
            </div>
        `;

        new mapboxgl.Popup().setLngLat(coordinates).setHTML(htmlContent).addTo(map);
    });

    map.on('mouseenter', 'unclustered-point', () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', 'unclustered-point', () => map.getCanvas().style.cursor = '');
    map.on('mouseenter', 'clusters', () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', 'clusters', () => map.getCanvas().style.cursor = '');

    activarGPSInicial();
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

    if (btn.classList.contains('activo')) {
        btn.classList.remove('activo');
        btn.innerText = "🔥 Ver activos (Últimos 7 días)";
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
        btn.innerText = "🔥 Ocultar activos";
    } catch (error) {
        btn.innerText = "Error de conexión";
    }
}

// 7. Navegación HUD y Alertas
let navWatchId = null;
let navCurrentHeading = 0;
let navMarker = null;

if (window.DeviceOrientationEvent) {
    window.addEventListener('deviceorientationabsolute', (event) => {
        if (event.alpha !== null) navCurrentHeading = 360 - event.alpha;
    }, true);
}

function iniciarRutaHacia(lng, lat, nombreDestino) {
    document.querySelectorAll('.mapboxgl-ctrl-directions').forEach(p => p.style.setProperty('display', 'none', 'important'));
    while (document.getElementsByClassName('mapboxgl-popup')[0]) document.getElementsByClassName('mapboxgl-popup')[0].remove();
    
    if (document.getElementById('btn-radar')) document.getElementById('btn-radar').style.display = 'none';
    if (document.getElementById('nav-hud')) document.getElementById('nav-hud').style.display = 'flex';
    if (document.getElementById('nav-instruction')) document.getElementById('nav-instruction').innerText = `Hacia ${nombreDestino}`;

    navigator.geolocation.getCurrentPosition((pos) => {
        directions.setOrigin([pos.coords.longitude, pos.coords.latitude]);
        directions.setDestination([lng, lat]);
    }, () => directions.setDestination([lng, lat]), { enableHighAccuracy: false, timeout: 15000, maximumAge: 10000 });

    if (navWatchId !== null) navigator.geolocation.clearWatch(navWatchId);
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
        }
    });
    navWatchId = navigator.geolocation.watchPosition((position) => {
        const userLng = position.coords.longitude;
        const userLat = position.coords.latitude;
        const bearingToUse = position.coords.heading || navCurrentHeading;

        if (document.getElementById('speedometer-value')) {
            document.getElementById('speedometer-value').textContent = position.coords.speed ? Math.round(position.coords.speed * 3.6) : 0;
        }

        verificarHotspotsCercanosEnRuta(userLng, userLat);

        if (typeof map !== 'undefined') {
            map.easeTo({ center: [userLng, userLat], zoom: 18.5, pitch: 65, bearing: bearingToUse, duration: 600, essential: true });
            if (!navMarker) {
                const el = document.createElement('div'); el.className = 'nav-marker';
                navMarker = new mapboxgl.Marker({ element: el }).setLngLat([userLng, userLat]).addTo(map);
            } else { navMarker.setLngLat([userLng, userLat]); }
        }
    }, (error) => { if (error.code !== 3) console.log("Error GPS:", error); }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 10000 });
}

function salirNavegacion() {
    if (document.getElementById('nav-hud')) document.getElementById('nav-hud').style.display = 'none';
    if (document.getElementById('btn-radar')) document.getElementById('btn-radar').style.display = 'block';
    if (typeof directions !== 'undefined') directions.removeRoutes();
    if (navWatchId !== null) { navigator.geolocation.clearWatch(navWatchId); navWatchId = null; }
    if (navMarker) { navMarker.remove(); navMarker = null; }
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
    const distTexto = distanciaKm < 1 ? `${Math.round(distanciaKm * 1000)} m` : `${distanciaKm.toFixed(1)} km`;
    card.innerHTML = `
        <div class="desvio-info"><span class="desvio-tag">🔥 Hotspot cercano</span><strong>${hotspot.locName}</strong><small>A ${distTexto}</small></div>
        <button onclick="iniciarRutaHacia(${hotspot.lng}, ${hotspot.lat}, '${hotspot.locName.replace(/'/g, "\\'")}')">Desviarme 📍</button>
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
    if (!map) return;
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                map.flyTo({
                    center: [pos.coords.longitude, pos.coords.latitude],
                    zoom: 16,
                    pitch: 45,
                    essential: true
                });
            },
            (err) => console.warn("Error GPS al centrar:", err),
            { enableHighAccuracy: false, timeout: 15000, maximumAge: 10000 }
        );
    }
}

// 2. Alternar entre estilos de mapa (ej: 'satellite-streets-v12', 'outdoors-v12', 'dark-v11')
function cambiarEstiloMapa(estiloId) {
    if (map) {
        map.setStyle(`mapbox://styles/mapbox/${estiloId}`);
    }
}

// 3. Filtrar los puntos del mapa en tiempo real según la búsqueda de un input text
function buscarHotspotPorNombre(textoBusqueda) {
    if (!hotspotsDataGlobal || hotspotsDataGlobal.length === 0) return;

    const textoLimpio = textoBusqueda.toLowerCase().trim();
    
    const filtrados = hotspotsDataGlobal.filter(h => 
        h.locName.toLowerCase().includes(textoLimpio)
    );

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

// Exportación al objeto global
window.centrarUbicacion = centrarUbicacion;
window.cambiarEstiloMapa = cambiarEstiloMapa;
window.buscarHotspotPorNombre = buscarHotspotPorNombre;
