// 1. Configuración de credenciales
mapboxgl.accessToken = 'TU_TOKEN_DE_MAPBOX_AQUI';

// 2. Inicialización del mapa
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/outdoors-v12', // Estilo ideal para ver relieve/naturaleza
    center: [-72.59, -38.73], // Coordenadas de ejemplo (Temuco)
    zoom: 8
});

// Controles de navegación (zoom y rotación)
map.addControl(new mapboxgl.NavigationControl());

// 3. Carga de datos y clustering
map.on('load', () => {
    // NOTA: Aquí asumo que tienes tu GeoJSON de hotspots guardado en una variable 
    // o que lo cargas desde un archivo local llamado hotspots.geojson.
    // Para V1, es mejor tener un archivo estático.
    
    map.addSource('ebird-hotspots', {
        type: 'geojson',
        data: 'hotspots.geojson', // Puede ser una URL o ruta local
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50
    });

    // Capa de los círculos agrupados
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

    // Capa de los números dentro de los grupos
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

    // Capa de los puntos individuales
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

    // 4. Interacciones
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
