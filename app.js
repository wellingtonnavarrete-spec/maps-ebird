// 1. Credenciales
mapboxgl.accessToken = 'pk.eyJ1Ijoid2VsbHluYXZhcnJldGUiLCJhIjoiY210emJ5YmF1MGkwNTJ3cHM3bjN5MXNsMyJ9.aMygGNT7FYaNhMw1wMmeAw';
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
});
