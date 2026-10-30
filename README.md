# Mapa de Aves (maps-ebird)

Mapa interactivo de aves de Chile sobre Mapbox, con datos de eBird. Pensado para usarse en el teléfono mientras vas en ruta.

## Funciones

- **Hotspots de eBird** con agrupación (clusters) para que el mapa sea fluido con miles de puntos. El color indica actividad: verde = registros en los últimos 7 días, celeste = 30 días, gris = sin registros recientes.
- **Capas de mapa**: calles, satélite y relieve.
- **Detalle de un hotspot**: especies de los últimos 7 días ordenadas por **frecuencia** (en cuántas de las últimas listas aparece cada una, igual que la frecuencia de eBird), nombre común chileno (`es_CL`), fecha, cantidad y **quién la observó**.
- **Compartir por WhatsApp**: una especie o la lista completa del hotspot, con ubicación (link de Google Maps), día, observador y nombre común chileno.
- **Activos 7 días**: hotspots con listas en la última semana en tu región.
- **Aves raras** (eBird *notable*): capa en el mapa y lista con estado (confirmada / sin revisar), observador y link a la lista.
- **Avisos de aves raras cerca de ti** (radio configurable, por defecto 25 km), revisados cada 10 minutos mientras la app está abierta. Con permiso, también como notificación del sistema.
- **Navegación** con instrucciones paso a paso en español, recálculo automático si te desvías, paradas intermedias, ETA, velocímetro y estimación de combustible. La pantalla se mantiene encendida mientras navegas.
- **Alertas de hotspots cercanos en ruta**: al pasar a menos de 1,5 km de un hotspot que está adelante, aparece una tarjeta con las aves registradas ahí en los últimos 7 días y un botón para desviarte (se agrega como parada sin perder tu destino).
- **Bencineras con precios oficiales de la CNE** (opcional, requiere el proxy).
- Buscador de hotspots con autocompletado (sin importar tildes).

## Estructura

```
index.html                 interfaz
style.css                  estilos
config.js                  configuración pública (sin claves secretas)
config.local.example.js    plantilla para pruebas locales (copiar a config.local.js)
app.js                     punto de entrada
src/
  util.js                  utilidades, avisos, fechas, WhatsApp
  ebird.js                 cliente de la API 2.0 de eBird (con caché)
  mapa.js                  mapa, estilos y registro de capas
  geo.js                   GPS único y brújula
  hotspots.js              hotspots, búsqueda, detalle, activos
  nav.js                   navegación y alertas en ruta
  raras.js                 aves raras y avisos
  bencineras.js            bencineras CNE
  panel.js                 panel lateral, compartir y fotos (Wikipedia)
worker/
  ebird-proxy.js           proxy en Cloudflare Workers (guarda las claves)
  wrangler.toml
```

## Puesta en marcha

### 1. Seguridad (hacer primero)

La key de eBird anterior quedó publicada en el historial del repositorio. **Genera una nueva** en <https://ebird.org/api/keygen> y no la vuelvas a poner en el código.

En <https://account.mapbox.com/access-tokens/> restringe el token público de Mapbox a tu dominio (por ejemplo `https://wellingtonnavarrete-spec.github.io/*`).

### 2. Proxy (Cloudflare Workers, plan gratuito)

```bash
cd worker
npx wrangler login
npx wrangler secret put EBIRD_API_KEY        # pega la key nueva
npx wrangler secret put CNE_EMAIL            # opcional (bencineras)
npx wrangler secret put CNE_PASSWORD         # opcional (bencineras)
npx wrangler deploy
```

Ajusta `ALLOWED_ORIGINS` en `worker/wrangler.toml` con la URL donde publicas la app. Al terminar, Wrangler te muestra una URL como `https://maps-ebird-proxy.TU-USUARIO.workers.dev`.

Para las bencineras, crea una cuenta gratuita en <https://api.cne.cl>.

### 3. Configurar la app

En `config.js`:

```js
EBIRD_PROXY_URL: 'https://maps-ebird-proxy.TU-USUARIO.workers.dev/ebird',
CNE_PROXY_URL:   'https://maps-ebird-proxy.TU-USUARIO.workers.dev/cne',
```

### 4. Publicar

Sirve la carpeta con cualquier hosting estático con **HTTPS** (GitHub Pages sirve). El GPS, la brújula y las notificaciones del navegador solo funcionan sobre HTTPS o `localhost`.

### Probar en tu computador sin proxy

```bash
cp config.local.example.js config.local.js   # pon tu key ahí (no se sube, está en .gitignore)
python3 -m http.server 8000
# abre http://localhost:8000
```

## Límites conocidos

- Los avisos de aves raras funcionan mientras la app está abierta. Para recibirlos con la app cerrada hace falta un servidor de notificaciones push o la versión app (fase siguiente).
- La frecuencia se calcula con las últimas 10 listas de los últimos 7 días del hotspot, para no gastar cuota de la API.
- Los nombres comunes vienen de la taxonomía de eBird en español de Chile (`es_CL`).

## Uso comercial

Los datos de aves vienen de la API de eBird, que tiene términos de uso propios del Cornell Lab of Ornithology. Antes de cobrar por la app, revisa los términos vigentes y, si corresponde, pide autorización: <https://www.birds.cornell.edu/home/ebird-api-terms-of-use/>. Lo mismo aplica a Mapbox (plan y límites de uso) y a la API de la CNE.

## Créditos

Datos de aves: [eBird](https://ebird.org), Cornell Lab of Ornithology. Mapas: Mapbox. Precios de combustible: Comisión Nacional de Energía (CNE). Fotos: Wikipedia.
