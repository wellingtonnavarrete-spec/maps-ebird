// 1. Credenciales y Configuración
mapboxgl.accessToken = 'pk.eyJ1Ijoid2VsbHluYXZhcnJldGUiLCJhIjoiY210emQwbjBoMG9hbDJ5b2t0MHcxc3BkbyJ9.j_-CVMex9D8_qx_y1wPnJg';
const ebirdApiKey = '89f4bf7f-47ac-4e68-949f-de69c890bce7';

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

let regionActual = null;
let regionManual = false;
const regionesCargadas = new Set();
let hotspotsDataGlobal = [];
let ultimaVerificacionRegion = 0;

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

// Control Seguro de Navegación (Rutas)
let directions = null;
if (typeof MapboxDirections !== 'undefined') {
    directions = new MapboxDirections({
        accessToken: mapboxgl.accessToken,
        unit: 'metric',
        profile: 'mapbox/driving',
        language: 'es-CL',
        placeholderOrigin: 'Origen (ej: Temuco)',
        placeholderDestination: 'Destino (ej: Saavedra)'
    });
    map.addControl(directions, 'top-left');
}
map.addControl(new mapboxgl.NavigationControl());

// Helper para obtener GeoJSON seguro
function obtenerGeoJSONActual() {
    return {
        type: 'FeatureCollection',
        features: hotspotsDataGlobal.map(hotspot => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [hotspot.lng, hotspot.lat] },
            properties: { locId: hotspot.locId, locName: hotspot.locName }
        }))
    };
}

// 3. Obtención de Hotspots eBird (Nivel de error resguardado)
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
                hotspotsDataGlobal = [...hotspotsDataGlobal, ...data];
            }
        }
    } catch (error) {
        console.error("Error al obtener eBird hotspots:", error);
    }

    return obtenerGeoJSONActual();
}

async function refrescarMapaHotspots(codeRegion) {
    const geojson = await getEBirdHotspots(codeRegion);
    if (map.getSource('ebird-hotspots')) {
        map.getSource('ebird-hotspots').setData(geojson);
    }
}

// 4. Carga e Interacción del Mapa
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
            'circle-color': '#11b4da',
            'circle-radius': 7,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff'
        }
    });

    // Eventos Clic sobre Puntos
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
                    <div style="display: flex; gap: 8px; flex-direction: column; margin-top: 8px;">
                        <button class="popup-btn-clean" onclick="cargarObservaciones('${locId}')">
                            🌿 Ver aves recientes
                        </button>
                        <button class="popup-btn-ir" onclick="iniciarRutaHacia(${lng}, ${lat}, '${locName.replace(/'/g, "\\'")}')">
                            🚗 Ir hacia aquí
                        </button>
                    </div>
                </div>
            </div>
        `;

        new mapboxgl.Popup()
            .setLngLat(coordinates)
            .setHTML(htmlContent)
            .addTo(map);
    });

    map.on('mouseenter', 'unclustered-point', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'unclustered-point', () => { map.getCanvas().style.cursor = ''; });

    // Activar GPS solo tras confirmarse la carga del mapa
    activarGPSInicial();
});

// 5. Panel Lateral de Aves
async function cargarImagenAve(sciName, speciesCode) {
    try {
        const query = sciName.replace(' ', '_');
        const res = await fetch(`https://es.wikipedia.org/api/rest_v1/page/summary/${query}`);
        const data = await res.json();
        
        if (data.thumbnail && data.thumbnail.source) {
            const imgEl = document.getElementById(`img-${speciesCode}`);
            if (imgEl) imgEl.src = data.thumbnail.source;
        }
    } catch (e) {
        console.log("Sin foto para:", sciName);
    }
}

async function cargarObservaciones(locId) {
    const panel = document.getElementById('side-panel');
    const content = document.getElementById('panel-content');
    
    if (panel) panel.classList.add('panel-open');
    if (content) content.innerHTML = '<p style="text-align: center; color: #777;">Cargando lista de aves...</p>';

    try {
        const response = await fetch(`https://corsproxy.io/?https://api.ebird.org/v2/data/obs/${locId}/recent?sppLocale=es-CL&key=${ebirdApiKey}`);
        const aves = await response.json();

        if (!Array.isArray(aves) || aves.length === 0) {
            if (content) content.innerHTML = '<p>No hay observaciones en los últimos días.</p>';
            return;
        }

        let htmlLista = '';
        aves.forEach(ave => {
            htmlLista += `
                <div class="bird-item" style="display: flex; gap: 15px; align-items: center; padding: 12px 0; border-bottom: 1px solid #eee;">
                    <img id="img-${ave.speciesCode}" src="https://via.placeholder.com/60?text=Ave" style="width: 60px; height: 60px; border-radius: 50%; object-fit: cover; background: #f4f4f4; flex-shrink: 0;">
                    <div>
                        <div class="bird-name" style="font-size: 15px; font-weight: bold; color: #333;">${ave.comName}</div>
                        <div style="font-size: 12px; color: #666; font-style: italic; margin-bottom: 4px;">${ave.sciName}</div>
                        <div class="bird-date" style="font-size: 11px; color: #999;">Último registro: ${ave.obsDt}</div>
                    </div>
                </div>
            `;
            cargarImagenAve(ave.sciName, ave.speciesCode);
        });
        
        if (content) content.innerHTML = htmlLista;

    } catch (error) {
        console.error(error);
        if (content) content.innerHTML = '<p>Error de conexión con eBird.</p>';
    }
}

function cerrarPanel() {
    const panel = document.getElementById('side-panel');
    if (panel) panel.classList.remove('panel-open');
}

// 6. Navegación HUD en Ruta
let navWatchId = null;
let navCurrentHeading = 0;
let navMarker = null;

if (window.DeviceOrientationEvent) {
    window.addEventListener('deviceorientationabsolute', (event) => {
        if (event.alpha !== null) navCurrentHeading = 360 - event.alpha;
    }, true);
}

function iniciarRutaHacia(lng, lat, nombreDestino) {
    const popups = document.getElementsByClassName('mapboxgl-popup');
    while (popups[0]) popups[0].remove();
    
    const hud = document.getElementById('nav-hud');
    if (hud) hud.style.display = 'flex';
    
    const titleInstr = document.getElementById('nav-instruction');
    if (titleInstr) titleInstr.innerText = `Hacia ${nombreDestino}`;

    if (directions) {
        directions.setDestination([lng, lat]);
        navigator.geolocation.getCurrentPosition((pos) => {
            directions.setOrigin([pos.coords.longitude, pos.coords.latitude]);
        });
    }

    if (navWatchId !== null) navigator.geolocation.clearWatch(navWatchId);

    navWatchId = navigator.geolocation.watchPosition((position) => {
        const userLng = position.coords.longitude;
        const userLat = position.coords.latitude;
        const gpsHeading = position.coords.heading;
        const bearingToUse = (gpsHeading !== null && !isNaN(gpsHeading)) ? gpsHeading : navCurrentHeading;

        const speedKmh = (position.coords.speed && position.coords.speed > 0) ? Math.round(position.coords.speed * 3.6) : 0;
        const speedEl = document.getElementById('speedometer-value');
        if (speedEl) speedEl.textContent = speedKmh;

        map.easeTo({ center: [userLng, userLat], zoom: 18, pitch: 65, bearing: bearingToUse, duration: 600, essential: true });

        if (!navMarker) {
            const el = document.createElement('div');
            el.className = 'nav-marker';
            navMarker = new mapboxgl.Marker({ element: el }).setLngLat([userLng, userLat]).addTo(map);
        } else {
            navMarker.setLngLat([userLng, userLat]);
        }
    }, (err) => console.log(err), { enableHighAccuracy: true });
}

function salirNavegacion() {
    const hud = document.getElementById('nav-hud');
    if (hud) hud.style.display = 'none';

    if (directions) directions.removeRoutes();
    if (navWatchId !== null) { navigator.geolocation.clearWatch(navWatchId); navWatchId = null; }
    if (navMarker) { navMarker.remove(); navMarker = null; }
    
    map.easeTo({ pitch: 0, bearing: 0, zoom: 13, duration: 800 });
}

// 7. Geolocalización y Reverse Geocoding
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
    } catch (error) {
        console.error("Error reconociendo ubicación por GPS:", error);
    }
}

function activarGPSInicial() {
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;

                map.flyTo({ center: [lng, lat], zoom: 14, pitch: 45, essential: true });
                detectarRegionPorGPS(lng, lat);
            },
            (error) => console.warn("GPS no listo:", error.message),
            { enableHighAccuracy: true, timeout: 8000 }
        );
    }
}

window.iniciarRutaHacia = iniciarRutaHacia;
window.salirNavegacion = salirNavegacion;
window.cargarObservaciones = cargarObservaciones;
window.cerrarPanel = cerrarPanel;
