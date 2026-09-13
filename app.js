// 1. Credenciales
mapboxgl.accessToken = 'pk.eyJ1Ijoid2VsbHluYXZhcnJldGUiLCJhIjoiY210emQwbjBoMG9hbDJ5b2t0MHcxc3BkbyJ9.j_-CVMex9D8_qx_y1wPnJg';
const ebirdApiKey = '89f4bf7f-47ac-4e68-949f-de69c890bce7';
const regionCode = 'CL-AR'; // La Araucanía

// 2. Inicialización del mapa
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/outdoors-v12',
    center: [-72.59, -38.73], // Centro en Temuco
    zoom: 8
});

// --- NUEVO: Control de Navegación (Rutas) ---
const directions = new MapboxDirections({
    accessToken: mapboxgl.accessToken,
    unit: 'metric', // Usar kilómetros
    profile: 'mapbox/driving', // Ruta para auto
    language: 'es-CL', // Instrucciones en español
    placeholderOrigin: 'Origen (ej: Temuco)',
    placeholderDestination: 'Destino (ej: Saavedra)'
});

// Agregamos el panel de búsqueda en la esquina superior izquierda
map.addControl(directions, 'top-left');

// Control de zoom estándar del mapa
map.addControl(new mapboxgl.NavigationControl());

// 3. Función para descargar y transformar datos de eBird a GeoJSON
async function getEBirdHotspots() {
    try {
        const response = await fetch(`https://api.ebird.org/v2/ref/hotspot/${regionCode}?fmt=json`, {
            headers: { 'X-eBirdApiToken': ebirdApiKey }
        });
        const data = await response.json();
        
        // Transformar la respuesta al formato GeoJSON para Mapbox
        return {
            type: 'FeatureCollection',
            features: data.map(hotspot => ({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [hotspot.lng, hotspot.lat]
                },
                properties: {
                    locId: hotspot.locId,
                    locName: hotspot.locName
                }
            }))
        };
    } catch (error) {
        console.error("Error cargando eBird:", error);
        return { type: 'FeatureCollection', features: [] };
    }
}

// 4. Carga de datos y clustering en el mapa
map.on('load', async () => {
    // Obtenemos los datos reales antes de cargar la fuente
    const hotspotsGeoJSON = await getEBirdHotspots();

    map.addSource('ebird-hotspots', {
        type: 'geojson',
        data: hotspotsGeoJSON, 
        cluster: false,
        clusterMaxZoom: 14,
        clusterRadius: 50
    });

    // Capa de clústeres
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

    // Capa de números en clústeres
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

    // Capa de hotspots individuales
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

    // 5. Interacciones (Zoom al hacer clic)
    map.on('click', 'clusters', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        const clusterId = features[0].properties.cluster_id;
        map.getSource('ebird-hotspots').getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (err) return;
            map.easeTo({ center: features[0].geometry.coordinates, zoom: zoom });
        });
    });

    map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = ''; });
    // --- NUEVO CÓDIGO: Interacción con los puntos individuales ---

// 1. Mostrar popup limpio al hacer clic en un hotspot
    map.on('click', 'unclustered-point', (e) => {
        const coordinates = e.features[0].geometry.coordinates.slice();
        const locName = e.features[0].properties.locName;
        const locId = e.features[0].properties.locId;

        // Generar la foto aérea/paisaje de respaldo del sector
        const lng = coordinates[0];
        const lat = coordinates[1];
        const fotoUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},14,0/300x160?access_token=${mapboxgl.accessToken}`;

const htmlContent = `
        <div class="popup-card-clean">
            <img src="${fotoUrl}" class="popup-img-clean" alt="${locName}">
            <div class="popup-body-clean">
                <h3>${locName}</h3>
                <div style="display: flex; gap: 8px; flex-direction: column;">
                    <button class="popup-btn-clean" onclick="cargarObservaciones('${locId}')">
                        🌿 Ver aves recientes
                    </button>
                    <button class="popup-btn-ir" 
                        onclick="iniciarRutaHacia(${coordinates[0]}, ${coordinates[1]}, '${locName}')">
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
    // 2. Cambiar el cursor a la "manito" al pasar sobre un punto
    map.on('mouseenter', 'unclustered-point', () => { 
        map.getCanvas().style.cursor = 'pointer'; 
    });
    map.on('mouseleave', 'unclustered-point', () => { 
        map.getCanvas().style.cursor = ''; 
    });
});
// --- FUNCIONES DEL PANEL LATERAL ---

// Conectar a la API para traer las aves del hotspot
async function cargarObservaciones(locId) {
    const panel = document.getElementById('side-panel');
    const content = document.getElementById('panel-content');
    
    // Desplegar panel y mostrar estado de carga
    panel.classList.add('panel-open');
    content.innerHTML = '<p>Cargando aves recientes...</p>';

    try {
        // Llamada a la API de eBird (Observaciones recientes en un hotspot)
        const response = await fetch(`https://api.ebird.org/v2/data/obs/${locId}/recent`, {
            headers: { 'X-eBirdApiToken': ebirdApiKey }
        });
        const aves = await response.json();

        if (aves.length === 0) {
            content.innerHTML = '<p>No hay observaciones en los últimos días.</p>';
            return;
        }

        // Armar la lista de aves en HTML
        let htmlLista = '';
        aves.forEach(ave => {
            htmlLista += `
                <div class="bird-item">
                    <div class="bird-name">${ave.comName} <i>(${ave.sciName})</i></div>
                    <div class="bird-date">Visto el: ${ave.obsDt}</div>
                </div>
            `;
        });
        
        // Inyectar la lista en el panel
        content.innerHTML = htmlLista;

    } catch (error) {
        console.error(error);
        content.innerHTML = '<p>Error al cargar los datos.</p>';
    }
}

// Función para cerrar el panel con el botón "X"
function cerrarPanel() {
    document.getElementById('side-panel').classList.remove('panel-open');
}
// --- FUNCIONES DEL PANEL LATERAL ---

// 1. Función para buscar la foto del ave en Wikipedia
async function cargarImagenAve(sciName, speciesCode) {
    try {
        // Formateamos el nombre para buscarlo en Wikipedia (ej: "Buteo_ventralis")
        const query = sciName.replace(' ', '_');
        const res = await fetch(`https://es.wikipedia.org/api/rest_v1/page/summary/${query}`);
        const data = await res.json();
        
        // Si Wikipedia tiene una foto (thumbnail), actualizamos la imagen en el panel
        if (data.thumbnail && data.thumbnail.source) {
            const imgEl = document.getElementById(`img-${speciesCode}`);
            if (imgEl) imgEl.src = data.thumbnail.source;
        }
    } catch (e) {
        // Falla silenciosamente si el ave no tiene foto en Wikipedia
        console.log("Sin foto en Wikipedia para:", sciName);
    }
}

// 2. Conectar a la API para traer las aves del hotspot
async function cargarObservaciones(locId) {
    const panel = document.getElementById('side-panel');
    const content = document.getElementById('panel-content');
    
    panel.classList.add('panel-open');
    content.innerHTML = '<p style="text-align: center; color: #777;">Cargando lista de aves...</p>';

    try {
        // MAGIA 1: Agregamos ?sppLocale=es-CL a la URL de eBird
        const response = await fetch(`https://api.ebird.org/v2/data/obs/${locId}/recent?sppLocale=es-CL`, {
            headers: { 'X-eBirdApiToken': ebirdApiKey }
        });
        const aves = await response.json();

        if (aves.length === 0) {
            content.innerHTML = '<p>No hay observaciones en los últimos días.</p>';
            return;
        }

        let htmlLista = '';
        aves.forEach(ave => {
            // MAGIA 2: Maquetamos un espacio para la foto y disparamos la búsqueda
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
            
            // Le pedimos a Wikipedia la foto en segundo plano
            cargarImagenAve(ave.sciName, ave.speciesCode);
        });
        
        content.innerHTML = htmlLista;

    } catch (error) {
        console.error(error);
        content.innerHTML = '<p>Error de conexión con eBird.</p>';
    }
}

// 3. Función para cerrar el panel
function cerrarPanel() {
    document.getElementById('side-panel').classList.remove('panel-open');
}
// --- NUEVA FUNCIÓN: Resaltar Hotspots Activos (Vista Panorámica) ---
async function buscarHotspotsActivos() {
    const btn = document.getElementById('btn-radar');

    // Si ya está activo, apagamos la capa superior y restauramos el botón
    if (btn.classList.contains('activo')) {
        btn.classList.remove('activo');
        btn.innerText = "🔥 Ver activos (Últimos 7 días)";
        if (map.getLayer('puntos-rojos')) map.removeLayer('puntos-rojos');
        if (map.getSource('activos-source')) map.removeSource('activos-source');
        return;
    }

    btn.innerText = "Buscando...";

    try {
        const response = await fetch(`https://api.ebird.org/v2/data/obs/CL-AR/recent?back=7`, {
            headers: { 'X-eBirdApiToken': ebirdApiKey }
        });
        const observaciones = await response.json();

        // Extraer ubicaciones únicas con sus coordenadas exactas
        const lugaresActivos = [];
        const idsVistos = new Set();
        
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

        // Limpiar capas previas por si se hace doble clic rápido
        if (map.getLayer('puntos-rojos')) map.removeLayer('puntos-rojos');
        if (map.getSource('activos-source')) map.removeSource('activos-source');

        // Inyectar una nueva fuente de datos exclusiva para los puntos activos
        map.addSource('activos-source', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: lugaresActivos }
        });

        // Dibujar los puntos rojos por encima de todo el mapa
        map.addLayer({
            id: 'puntos-rojos',
            type: 'circle',
            source: 'activos-source',
            paint: {
                'circle-color': '#ff5252',
                'circle-radius': 8,
                'circle-stroke-width': 2,
                'circle-stroke-color': '#ffffff'
            }
        });

        btn.classList.add('activo');
        btn.innerText = "🔥 Ocultar activos";

    } catch (error) {
        console.error("Error cargando radar:", error);
        btn.innerText = "Error de conexión";
    }
}
// ==========================================
// MÓDULO DE NAVEGACIÓN HUD (CON ÍCONO 3D)
// ==========================================

// Variables encapsuladas
let navWatchId = null;
let navCurrentHeading = 0;
let navMarker = null; // <-- Nueva variable para tu flecha azul

if (window.DeviceOrientationEvent) {
    window.addEventListener('deviceorientationabsolute', (event) => {
        if (event.alpha !== null) navCurrentHeading = 360 - event.alpha;
    }, true);
}

function iniciarRutaHacia(lng, lat, nombreDestino) {
    const mapboxPanels = document.querySelectorAll('.mapboxgl-ctrl-directions, .mapbox-directions-component, .mapbox-directions-route-summary');
    mapboxPanels.forEach(p => p.style.setProperty('display', 'none', 'important'));

    const popups = document.getElementsByClassName('mapboxgl-popup');
    while (popups[0]) popups[0].remove();
    
    const btnRadar = document.getElementById('btn-radar');
    if (btnRadar) btnRadar.style.display = 'none';

    const hud = document.getElementById('nav-hud');
    if (hud) hud.style.display = 'flex';
    
    const titleInstr = document.getElementById('nav-instruction');
    if (titleInstr) titleInstr.innerText = `Hacia ${nombreDestino}`;

    if (typeof map !== 'undefined') {
        map.easeTo({ zoom: 18.5, pitch: 65, bearing: navCurrentHeading, duration: 1000, essential: true });
    }

    if (typeof directions !== 'undefined') {
        directions.on('route', (e) => {
            if (e.route && e.route.length > 0) {
                const ruta = e.route[0];
                const minutos = Math.round(ruta.duration / 60);
                const km = (ruta.distance / 1000).toFixed(1);

                const ahora = new Date();
                ahora.setMinutes(ahora.getMinutes() + minutos);
                
                const timeEl = document.getElementById('nav-time');
                const detailsEl = document.getElementById('nav-details');
                if (timeEl) timeEl.innerText = `${minutos} min`;
                if (detailsEl) detailsEl.innerText = `${km} km • Llegada ${ahora.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            }
        });

        navigator.geolocation.getCurrentPosition((pos) => {
            directions.setOrigin([pos.coords.longitude, pos.coords.latitude]);
            directions.setDestination([lng, lat]);
        }, () => directions.setDestination([lng, lat]), { enableHighAccuracy: true });
    }

    if (navWatchId !== null) navigator.geolocation.clearWatch(navWatchId);
    
    navWatchId = navigator.geolocation.watchPosition((position) => {
        const userLng = position.coords.longitude;
        const userLat = position.coords.latitude;
        const gpsHeading = position.coords.heading;
        const bearingToUse = (gpsHeading !== null && !isNaN(gpsHeading)) ? gpsHeading : navCurrentHeading;

        if (typeof map !== 'undefined') {
            // 1. Mover la cámara
            map.easeTo({ center: [userLng, userLat], zoom: 18.5, pitch: 65, bearing: bearingToUse, duration: 600, easing: (t) => t, essential: true });

            // 2. CREAR O MOVER EL ÍCONO DE NAVEGACIÓN
            if (!navMarker) {
                const el = document.createElement('div');
                el.className = 'nav-marker';
                navMarker = new mapboxgl.Marker({ element: el })
                    .setLngLat([userLng, userLat])
                    .addTo(map);
            } else {
                navMarker.setLngLat([userLng, userLat]);
            }
        }
    }, (error) => console.log("Error GPS:", error), { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 });
}

function salirNavegacion() {
    const hud = document.getElementById('nav-hud');
    if (hud) hud.style.display = 'none';
    
    const btnRadar = document.getElementById('btn-radar');
    if (btnRadar) btnRadar.style.display = 'block';

    if (typeof directions !== 'undefined') directions.removeRoutes();
    
    if (navWatchId !== null) {
        navigator.geolocation.clearWatch(navWatchId);
        navWatchId = null;
    }

    // ELIMINAR EL ÍCONO AL SALIR
    if (navMarker) {
        navMarker.remove();
        navMarker = null;
    }
    
    if (typeof map !== 'undefined') map.easeTo({ pitch: 0, bearing: 0, zoom: 13, duration: 800 });
}

window.iniciarRutaHacia = iniciarRutaHacia;
window.salirNavegacion = salirNavegacion;
