// Copia este archivo como config.local.js (está en .gitignore, NO se sube).
// Solo se carga cuando abres la app en localhost / 127.0.0.1.
// Sirve para probar sin desplegar el proxy.
Object.assign(window.APP_CONFIG, {
  EBIRD_API_KEY: 'TU_KEY_DE_EBIRD_NUEVA'
  // EBIRD_PROXY_URL: 'http://localhost:8787/ebird',
  // CNE_PROXY_URL: 'http://localhost:8787/cne'
});
