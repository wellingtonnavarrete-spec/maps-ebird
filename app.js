// 1. Credenciales
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

// Función para convertir el nombre detectado al código ISO de eBird
function obtenerCodigoRegionEBird(nombreDetectado) {
    if (!nombreDetectado) return 'CL-AR';

    const normalizar = (txt) => txt.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const nombreLimpio = normalizar(nombreDetectado);

    for (const [code, info] of Object.entries(REGIONES_CHILE)) {
        if (nombreLimpio.includes(normalizar(info.nombre))) {
            return code;
        }
    }

    return 'CL-AR';
}

// Variables globales
let regionActual = null;
let regionManual = false;
const regionesCargadas = new Set();
let hotspotsDataGlobal = [];
let ultimaVerificacionRegion = 0;

// 2. Inicialización del mapa
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

// Refrescar hotspots en el mapa
async function refrescarMapaHotspots(codeRegion) {
  const geojson = await getEBirdHotspots(codeRegion);
  if (geojson && map.getSource('ebird-hotspots')) {
    map.getSource('ebird-hotspots').setData(geojson);
  }
}

// 3. Obtener hotspots de eBird
async function getEBirdHotspots(codeRegion) {
  if (!codeRegion || typeof codeRegion !== 'string' || codeRegion.includes('.') || regionesCargadas.has(codeRegion)) return null;
  
  try {
       const response = await fetch(`https://corsproxy.io/?https://api.ebird.org/v2/ref/hotspot/${codeRegion}?fmt=json&key=${ebirdApiKey}`);

        if (!response.ok) {
            console.warn(`Respuesta no válida de eBird (${response.status}) para la región: ${codeRegion}`);
            return { type: 'FeatureCollection', features: [] };
        }

        const data = await response.json();

        if (Array.isArray(data)) {
            regionesCargadas.add(codeRegion);
            hotspotsDataGlobal = [...hotspotsDataGlobal, ...data];
        }

        return {
            type: 'FeatureCollection',
            features: hotspotsDataGlobal.map(hotspot => ({
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

// 4. Carga de capas e interacción en el mapa
map.on('load', async () => {
    const hotspotsGeoJSON = await getEBirdHotspots('CL-AR');

    map.addSource('ebird-hotspots', {
        type: 'geojson',
        data: hotspotsGeoJSON, 
        cluster: false,
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

    map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = ''; });

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

    map.on('mouseenter', 'unclustered-point', () => { 
        map.getCanvas().style.cursor = 'pointer'; 
    });
    map.on('mouseleave', 'unclustered-point', () => { 
        map.getCanvas().style.cursor = ''; 
    });
});

// Panel lateral: Imagen Wikipedia
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
        console.log("Sin foto en Wikipedia para:", sciName);
    }
}

// Panel lateral: Observaciones
async function cargarObservaciones(locId) {
    const panel = document.getElementById('side-panel');
    const content = document.getElementById('panel-content');
    
    panel.classList.add('panel-open');
    content.innerHTML = '<p style="text-align: center; color: #777;">Cargando lista de aves...</p>';

    try {
        const response = await fetch(`https://corsproxy.io/?https://api.ebird.org/v2/data/obs/${locId}/recent?sppLocale=es-CL&key=${ebirdApiKey}`);
        const aves = await response.json();

        if (!Array.isArray(aves) || aves.length === 0) {
            content.innerHTML = '<p>No hay observaciones en los últimos días.</p>';
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
        
        content.innerHTML = htmlLista;

    } catch (error) {
        console.error(error);
        content.innerHTML = '<p>Error de conexión con eBird.</p>';
    }
}

function cerrarPanel() {
    const panel = document.getElementById('side-panel');
    if (panel) panel.classList.remove('panel-open');
}

// Radar de hotspots activos
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

// Navegación HUD
let navWatchId = null;
let navCurrentHeading = 0;
let navMarker = null;

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

    directions.on('route', (e) => {
        if (e.route && e.route.length > 0) {
            const ruta = e.route[0];
            const minutos = Math.round(ruta.duration / 60);
            const km = (ruta.distance / 1000).toFixed(1);

            if (ruta.geometry && ruta.geometry.coordinates && ruta.geometry.coordinates.length > 1) {
                const coords = ruta.geometry.coordinates;
                const p1 = coords[0];
                const p2 = coords[Math.min(3, coords.length - 1)];

                const dLon = (p2[0] - p1[0]) * Math.PI / 180;
                const lat1 = p1[1] * Math.PI / 180;
                const lat2 = p2[1] * Math.PI / 180;
                const y = Math.sin(dLon) * Math.cos(lat2);
                const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
                const bearingInicial = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

                map.easeTo({
                    center: p1,
                    zoom: 17,
                    pitch: 65,
                    bearing: bearingInicial,
                    duration: 1200
                });
            }

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

    if (navWatchId !== null) navigator.geolocation.clearWatch(navWatchId);

    navWatchId = navigator.geolocation.watchPosition((position) => {
        const userLng = position.coords.longitude;
        const userLat = position.coords.latitude;
        const gpsHeading = position.coords.heading;
        const bearingToUse = (gpsHeading !== null && !isNaN(gpsHeading)) ? gpsHeading : navCurrentHeading;

        const speedKmh = (position.coords.speed && position.coords.speed > 0) 
          ? Math.round(position.coords.speed * 3.6) 
          : 0;
        const speedEl = document.getElementById('speedometer-value');
        if (speedEl) speedEl.textContent = speedKmh;

        const ahora = Date.now();
        if (ahora - ultimaVerificacionRegion > 30000) {
            detectarRegionPorGPS(userLng, userLat);
            ultimaVerificacionRegion = ahora;
        }

        verificarHotspotsCercanosEnRuta(userLng, userLat);

        if (typeof map !== 'undefined') {
            map.easeTo({ center: [userLng, userLat], zoom: 18.5, pitch: 65, bearing: bearingToUse, duration: 600, easing: (t) => t, essential: true });

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

    if (navMarker) {
        navMarker.remove();
        navMarker = null;
    }
    
    if (typeof map !== 'undefined') map.easeTo({ pitch: 0, bearing: 0, zoom: 13, duration: 800 });
}

window.iniciarRutaHacia = iniciarRutaHacia;
window.salirNavegacion = salirNavegacion;

// Detecta la región usando Mapbox Reverse Geocoding
async function detectarRegionPorGPS(lng, lat) {
  if (regionManual) return;

  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=region&access_token=${mapboxgl.accessToken}`
    );
    const data = await res.json();
    
    if (data.features && data.features.length > 0) {
      const isoCode = data.features[0].properties.short_code;

      if (isoCode && REGIONES_CHILE[isoCode] && regionActual !== isoCode) {
        regionActual = isoCode;
        
        const selectEl = document.getElementById('region-select');
        if (selectEl) selectEl.value = isoCode;

        await refrescarMapaHotspots(isoCode);
        console.log(`Auto-detectada nueva región: ${REGIONES_CHILE[isoCode].nombre}`);
      }
    }
  } catch (error) {
    console.error("Error al detectar región por GPS:", error);
  }
}

let ultimoHotspotAlertado = null;

function verificarHotspotsCercanosEnRuta(userLng, userLat) {
  if (!hotspotsDataGlobal || hotspotsDataGlobal.length === 0) return;

  const RADIO_ALERTA_KM = 1.5;

  let hotspotCercano = null;
  let menorDistancia = RADIO_ALERTA_KM;

  hotspotsDataGlobal.forEach(spot => {
    const dist = calcularDistanciaKm(userLat, userLng, spot.lat, spot.lng);
    if (dist < menorDistancia) {
      menorDistancia = dist;
      hotspotCercano = spot;
    }
  });

  if (hotspotCercano && hotspotCercano.locId !== ultimoHotspotAlertado) {
    ultimoHotspotAlertado = hotspotCercano.locId;
    mostrarTarjetaDesvio(hotspotCercano, menorDistancia);
  }
}

// Fórmula de Haversine
function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function mostrarTarjetaDesvio(hotspot, distanciaKm) {
  let card = document.getElementById('desvio-card');
  if (!card) {
    card = document.createElement('div');
    card.id = 'desvio-card';
    card.className = 'desvio-card-hud';
    document.body.appendChild(card);
  }

  const distTexto = distanciaKm < 1 
    ? `${Math.round(distanciaKm * 1000)} m` 
    : `${distanciaKm.toFixed(1)} km`;

  card.innerHTML = `
    <div class="desvio-info">
      <span class="desvio-tag">🔥 Hotspot cercano</span>
      <strong>${hotspot.locName}</strong>
      <small>A ${distTexto} de tu ruta</small>
    </div>
    <button onclick="iniciarRutaHacia(${hotspot.lng}, ${hotspot.lat})">Desviarme 📍</button>
  `;

  card.classList.add('visible');
  setTimeout(() => card.classList.remove('visible'), 12000);
}

// Precarga automática de GPS
function activarGPSInicial() {
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;

                map.flyTo({
                    center: [lng, lat],
                    zoom: 15.5,
                    pitch: 65,
                    essential: true
                });

                detectarRegionPorGPS(lng, lat);
            },
            (error) => {
                console.warn("GPS no disponible al inicio:", error.message);
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }
}

activarGPSInicial();
