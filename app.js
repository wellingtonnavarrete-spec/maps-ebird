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
        cluster: true,
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

    // 1. Mostrar popup al hacer clic en un hotspot
    map.on('click', 'unclustered-point', (e) => {
        const coordinates = e.features[0].geometry.coordinates.slice();
        const locName = e.features[0].properties.locName;
        const locId = e.features[0].properties.locId;

        // Crear la ventana emergente (Popup)
        new mapboxgl.Popup()
            .setLngLat(coordinates)
            .setHTML(`
                <div style="padding: 5px;">
                    <h3 style="margin: 0 0 8px 0; font-size: 15px; color: #333;">${locName}</h3>
                    <p style="margin: 0 0 10px 0; font-size: 12px; color: #777;">ID: ${locId}</p>
                    <button onclick="cargarObservaciones('${locId}')" style="background: #11b4da; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; width: 100%;">
                        Ver aves recientes
                    </button>
                </div>
            `)
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
