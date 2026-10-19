/*
 * Orador de Textos — reconocimiento de texto en imágenes (OCR).
 *
 * Usa Tesseract.js, que se descarga la primera vez junto con el modelo del
 * idioma (unos pocos MB); después el navegador lo guarda y funciona más rápido.
 */
(function () {
  'use strict';

  const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

  // Idioma del texto → modelo de Tesseract.
  const MODELOS = {
    es: 'spa', en: 'eng', fr: 'fra', pt: 'por', it: 'ita', de: 'deu', ca: 'cat',
    nl: 'nld', ru: 'rus', zh: 'chi_sim', ja: 'jpn', ko: 'kor', ar: 'ara',
  };

  let carga = null;

  function cargarTesseract() {
    if (!carga) {
      carga = new Promise((resolver, rechazar) => {
        const script = document.createElement('script');
        script.src = TESSERACT;
        script.onload = () => resolver(window.Tesseract);
        script.onerror = () => {
          carga = null;
          script.remove();
          rechazar(new Error('No se pudo descargar Tesseract.js'));
        };
        document.head.appendChild(script);
      });
    }
    return carga;
  }

  // Crea un reconocedor para textos en `idioma` ('es', 'en'…, o 'auto').
  // Con 'auto' empieza con español + inglés y, si la primera página resulta
  // estar en otro idioma, cambia al modelo de ese idioma.
  // `alAvanzar(mensaje)` informa qué está haciendo; si `senal` se cancela, se detiene.
  async function crear(idioma, { alAvanzar = () => {}, senal } = {}) {
    const { ErrorDeArchivo } = Orador.Archivos;
    let Tesseract;
    try {
      Tesseract = await cargarTesseract();
    } catch (e) {
      throw new ErrorDeArchivo('Para reconocer texto en imágenes hace falta conexión a internet (se descarga el reconocedor de texto).');
    }

    let tarea = ''; // qué se está reconociendo, para los mensajes de avance
    const informar = (m) => {
      if (m.status === 'recognizing text') alAvanzar(`reconociendo el texto de ${tarea}: ${Math.round(m.progress * 100)} %`);
      else alAvanzar('preparando el reconocimiento de texto (la primera vez se descarga)…');
    };

    let worker;
    try {
      worker = await Tesseract.createWorker(idioma in MODELOS ? MODELOS[idioma] : ['spa', 'eng'], 1, { logger: informar });
    } catch (e) {
      throw new ErrorDeArchivo('No pude preparar el reconocimiento de texto. Revisa tu conexión a internet e inténtalo de nuevo.');
    }
    let terminado = false;
    const terminar = () => {
      if (terminado) return;
      terminado = true;
      Promise.resolve(worker.terminate()).catch(() => {});
    };
    // Al cancelar se detiene el trabajo y se rechaza lo pendiente (Tesseract no
    // siempre avisa cuando se lo detiene a mitad).
    let cancelado = null;
    if (senal) {
      cancelado = new Promise((_, rechazar) => {
        const alCancelar = () => {
          terminar();
          rechazar(new ErrorDeArchivo('Se canceló el reconocimiento de texto.'));
        };
        if (senal.aborted) alCancelar(); // se canceló mientras se preparaba
        else senal.addEventListener('abort', alCancelar, { once: true });
      });
      cancelado.catch(() => {});
    }
    const esperar = (promesa) => {
      promesa.catch(() => {});
      return cancelado ? Promise.race([promesa, cancelado]) : promesa;
    };

    let idiomaPorConfirmar = !(idioma in MODELOS);

    async function reconocerUnaVez(imagen) {
      const { data } = await esperar(worker.recognize(imagen));
      const lineas = (data.lines || [])
        .map((l) => ({
          texto: l.text.replace(/\s+/g, ' ').trim(),
          confianza: l.confidence,
          x0: l.bbox.x0,
          x1: l.bbox.x1,
          y0: l.bbox.y0,
          y1: l.bbox.y1,
          base: l.baseline && l.baseline.has_baseline ? (l.baseline.y0 + l.baseline.y1) / 2 : l.bbox.y1,
        }))
        // Fuera el ruido: manchas o bordes que el OCR confunde con letras.
        .filter((l) => /[\p{L}\p{N}]{2,}/u.test(l.texto) && l.confianza >= 30);
      return { lineas, confianza: data.confidence };
    }

    return {
      // Reconoce una imagen (lienzo). `descripcion`: "la página 3 de 10", para los mensajes.
      async reconocer(imagen, descripcion) {
        tarea = descripcion;
        let resultado = await reconocerUnaVez(imagen);
        if (idiomaPorConfirmar) {
          idiomaPorConfirmar = false;
          const { idioma: detectado } = await Orador.Traductor.detectar(resultado.lineas.map((l) => l.texto).join('\n'));
          if (detectado !== 'es' && detectado !== 'en' && detectado in MODELOS) {
            await esperar(worker.reinitialize(MODELOS[detectado]));
            resultado = await reconocerUnaVez(imagen);
          }
        }
        return resultado;
      },
      terminar,
    };
  }

  Orador.OCR = { crear };
})();
