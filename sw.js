/*
 * Orador de Textos — service worker.
 *
 * Permite instalar la página como app y abrirla sin conexión:
 * - Los archivos de la app se piden primero a internet (así siempre llega la
 *   última versión) y, si no hay conexión, se sirven desde la copia guardada.
 * - Las librerías de las CDN (pdf.js, Tesseract, vits-web, ONNX Runtime) tienen la versión
 *   en la dirección y no cambian: se guardan la primera vez y luego se usan
 *   desde la copia, también sin conexión.
 * - Lo demás (por ejemplo, la traducción en línea) pasa sin tocarse.
 */
const APP = 'orador-app-v2';
const CDN = 'orador-cdn-v1';
const ARCHIVOS_DE_LA_APP = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/estilos.css',
  'js/lector.js',
  'js/voces-descargables.js',
  'js/traductor.js',
  'js/archivos.js',
  'js/ocr.js',
  'js/app.js',
  'iconos/icono-192.png',
  'iconos/icono-512.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(APP).then((cache) => cache.addAll(ARCHIVOS_DE_LA_APP)));
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil((async () => {
    for (const nombre of await caches.keys()) {
      if (nombre !== APP && nombre !== CDN) await caches.delete(nombre);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (evento) => {
  const { request } = evento;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    evento.respondWith(primeroInternet(request));
  } else if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'cdnjs.cloudflare.com') {
    evento.respondWith(primeroCopia(request));
  }
  // Los modelos de las voces descargables (huggingface.co) no pasan por aquí:
  // vits-web ya los guarda en el almacenamiento del sitio.
});

async function primeroInternet(request) {
  const cache = await caches.open(APP);
  // La página se guarda sin parámetros (el texto compartido no debe quedar guardado).
  const clave = request.mode === 'navigate' ? new URL(request.url).pathname : request;
  try {
    const respuesta = await fetch(request);
    if (respuesta.ok) cache.put(clave, respuesta.clone());
    return respuesta;
  } catch (e) {
    // Sin conexión. Una dirección con parámetros (p. ej., texto compartido) usa la página guardada.
    return (await cache.match(request, { ignoreSearch: true })) || Response.error();
  }
}

async function primeroCopia(request) {
  const cache = await caches.open(CDN);
  const guardada = await cache.match(request);
  if (guardada) return guardada;
  const respuesta = await fetch(request);
  if (respuesta.ok || respuesta.type === 'opaque') cache.put(request, respuesta.clone());
  return respuesta;
}
