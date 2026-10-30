// =============================================================
// Configuración pública de la app (este archivo SÍ va al repo).
// NO pongas aquí la key de eBird ni credenciales de la CNE:
// esas viven como "secrets" en el proxy (ver worker/ y README).
// =============================================================
window.APP_CONFIG = {
  // Token PÚBLICO de Mapbox (pk.*). Restríngelo por URL en
  // https://account.mapbox.com/access-tokens/ a tu dominio de GitHub Pages.
  MAPBOX_TOKEN: 'pk.eyJ1Ijoid2VsbHluYXZhcnJldGUiLCJhIjoiY210emQwbjBoMG9hbDJ5b2t0MHcxc3BkbyJ9.j_-CVMex9D8_qx_y1wPnJg',

  // URL del proxy (Cloudflare Worker) que guarda la key de eBird.
  // Ej: 'https://maps-ebird-proxy.TU-USUARIO.workers.dev/ebird'
  EBIRD_PROXY_URL: '',

  // URL del proxy para precios de combustible (mismo Worker).
  // Ej: 'https://maps-ebird-proxy.TU-USUARIO.workers.dev/cne'
  CNE_PROXY_URL: '',

  // Solo para pruebas en tu computador: defínela en config.local.js (no se sube).
  EBIRD_API_KEY: '',

  REGION_INICIAL: 'CL-AR',
  CENTRO_INICIAL: [-72.59, -38.73],
  LOCALE: 'es_CL',               // nombres comunes de Chile en eBird
  RADIO_ALERTA_HOTSPOT_KM: 1.5,  // hotspots cercanos mientras vas en ruta
  RADIO_AVES_RARAS_KM: 25,       // avisos de aves raras alrededor tuyo
  MINUTOS_REVISION_RARAS: 10,
  KM_POR_LITRO: 12,              // rendimiento por defecto (editable en el menú)
  PRECIO_LITRO_REFERENCIA: 0     // 0 = usar promedio de bencineras cargadas
};
