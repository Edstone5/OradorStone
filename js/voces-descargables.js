/*
 * Orador de Textos — voces descargables.
 *
 * Las voces del sistema (Web Speech API) se callan cuando el celular bloquea la
 * pantalla. Estas voces, en cambio, generan el audio dentro del navegador
 * (voces neuronales Piper, con vits-web y ONNX Runtime) y se reproducen como
 * cualquier audio, así que siguen sonando con la pantalla bloqueada.
 *
 * Cada voz se descarga una vez (unos 60–80 MB) y el navegador la guarda.
 * Solo funcionan con la página publicada (https), no al abrirla con doble clic.
 */
(function () {
  'use strict';

  const VITS = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/+esm';

  const VOCES = [
    { id: 'es_MX-claude-high', nombre: 'Claude', lang: 'es-MX', mb: 63 },
    { id: 'es_MX-ald-medium', nombre: 'Ald', lang: 'es-MX', mb: 63 },
    { id: 'es_ES-davefx-medium', nombre: 'Davefx', lang: 'es-ES', mb: 63 },
    { id: 'es_ES-sharvard-medium', nombre: 'Sharvard', lang: 'es-ES', mb: 77 },
  ].map((v) => ({ ...v, descargable: true, name: 'piper:' + v.id }));

  // Se guardan en el almacenamiento privado del sitio (OPFS), que no existe al
  // abrir la página como archivo.
  const disponible = location.protocol !== 'file:' && !!(navigator.storage && navigator.storage.getDirectory);

  let modulo = null;
  function cargar() {
    if (!modulo) {
      modulo = import(VITS).catch((e) => {
        modulo = null;
        throw new Error('Para usar las voces descargables hace falta conexión a internet la primera vez.');
      });
    }
    return modulo;
  }

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  // Ids de las voces ya descargadas. Se miran directamente en la carpeta donde
  // vits-web las guarda, para no descargar la librería solo para saberlo.
  async function guardadas() {
    if (!disponible) return [];
    try {
      const carpeta = await (await navigator.storage.getDirectory()).getDirectoryHandle('piper');
      const ids = [];
      for await (const [nombre, archivo] of carpeta.entries()) {
        if (archivo.kind === 'file' && nombre.endsWith('.onnx')) ids.push(nombre.slice(0, -'.onnx'.length));
      }
      return ids;
    } catch (e) {
      return []; // todavía no se descargó ninguna
    }
  }

  const descargas = new Map(); // id → promesa de la descarga en curso

  // Descarga una voz. `alAvanzar(avance)` recibe de 0 a 1.
  function descargar(id, alAvanzar = () => {}) {
    if (!descargas.has(id)) {
      const promesa = (async () => {
        const tts = await cargar();
        if ((await tts.stored()).includes(id)) return;
        await tts.download(id, (p) => {
          if (/\.onnx$/.test(p.url) && p.total) alAvanzar(p.loaded / p.total);
        });
        await esperar(500); // recién descargada, la voz a veces aún no se puede abrir
      })();
      descargas.set(id, promesa);
      promesa.finally(() => descargas.delete(id)).catch(() => {});
    }
    return descargas.get(id);
  }

  // Genera el audio de un texto (Blob WAV). Se generan de a uno: el modelo no
  // admite trabajos simultáneos. Si al llegar su turno `sigueHaciendoFalta()`
  // devuelve false (por ejemplo, porque se saltó a otra parte del texto), el
  // trabajo se descarta sin generar nada.
  let cola = Promise.resolve();
  function generar(texto, id, sigueHaciendoFalta = () => true) {
    const trabajo = cola.then(async () => {
      if (!sigueHaciendoFalta()) throw new Error('descartado');
      await descargar(id);
      const tts = await cargar();
      try {
        return await tts.predict({ text: texto, voiceId: id });
      } catch (e) {
        await esperar(500); // un segundo intento resuelve los fallos al abrir una voz recién descargada
        try {
          return await tts.predict({ text: texto, voiceId: id });
        } catch (error) {
          // Si el modelo quedó dañado (por ejemplo, una descarga cortada), se borra
          // para que la próxima vez se descargue de nuevo.
          if (/protobuf|graph/i.test(error.message)) await tts.remove(id).catch(() => {});
          throw error;
        }
      }
    });
    cola = trabajo.catch(() => {});
    return trabajo;
  }

  Orador.VocesDescargables = { VOCES, disponible, guardadas, descargar, generar };
})();
