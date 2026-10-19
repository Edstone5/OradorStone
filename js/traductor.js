/*
 * Orador de Textos — detección de idioma y traducción al español.
 *
 * Usa primero lo que trae el navegador (Language Detector y Translator APIs de
 * Edge 148+ y Chrome 138+): funciona en el propio equipo, sin límites y sin
 * enviar el texto a nadie. Si el navegador no lo tiene, detecta el idioma con
 * un método propio y traduce en línea con MyMemory (gratis, con límite diario).
 */
(function () {
  'use strict';

  const DESTINO = 'es';

  // Idiomas que se pueden elegir a mano en «Idioma del texto».
  const IDIOMAS = ['es', 'en', 'fr', 'pt', 'it', 'de', 'ca', 'nl', 'ru', 'zh', 'ja', 'ko', 'ar'];

  const nombresDeIdioma = typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['es'], { type: 'language' })
    : null;

  function nombreIdioma(codigo) {
    try {
      return (nombresDeIdioma && nombresDeIdioma.of(codigo)) || codigo;
    } catch (e) {
      return codigo;
    }
  }

  class ErrorDeTraduccion extends Error {
    constructor(codigo, mensaje) {
      super(mensaje);
      this.codigo = codigo;
    }
  }

  const idiomaBase = (codigo) => String(codigo || 'und').split(/[-_]/)[0].toLowerCase();

  // Rechaza si `promesa` no responde a tiempo: hay navegadores que exponen estas
  // APIs pero nunca contestan, y la página no debe quedarse colgada esperando.
  function conPlazo(promesa, ms) {
    let temporizador;
    const plazo = new Promise((_, rechazar) => {
      temporizador = setTimeout(() => rechazar(new ErrorDeTraduccion('plazo', 'El navegador no respondió a tiempo.')), ms);
    });
    return Promise.race([promesa, plazo]).finally(() => clearTimeout(temporizador));
  }

  // ---------------------------------------------------------------------------
  // Detección propia (cuando el navegador no trae detector)

  // Escrituras que identifican el idioma casi por sí solas. El japonés va primero
  // porque mezcla kanji (Han) con kana.
  const ESCRITURAS = [
    ['ja', /[\p{Script=Hiragana}\p{Script=Katakana}]/gu, 0.1],
    ['ko', /\p{Script=Hangul}/gu, 0.4],
    ['zh', /\p{Script=Han}/gu, 0.4],
    ['ru', /\p{Script=Cyrillic}/gu, 0.4],
    ['ar', /\p{Script=Arabic}/gu, 0.4],
    ['el', /\p{Script=Greek}/gu, 0.4],
    ['he', /\p{Script=Hebrew}/gu, 0.4],
    ['hi', /\p{Script=Devanagari}/gu, 0.4],
    ['th', /\p{Script=Thai}/gu, 0.4],
  ];

  // Palabras muy frecuentes de cada idioma con alfabeto latino.
  const FRECUENTES = Object.fromEntries(Object.entries({
    es: 'de la que el en y los se del las un por con no una su para es al lo como más pero sus le ya este sí porque esta entre cuando muy sin sobre también me hasta hay donde desde todo nos durante todos uno les ni otros ese eso ellos esto antes algunos qué unos yo otro otras otra él tanto esa estos mucho nada muchos poco ella estar estas algo',
    en: 'the of and to in is that it for was on are with as his they be at one have this from by had not but what all were we when your can said there an each which she do how their if will up other about out many then them these so some her would make like him into time has two more could my than been who its now people',
    fr: 'le la les de des et est un une du que qui dans pour pas sur au avec il elle ce sont ne se plus par mais ou nous vous leur été être aux cette fait comme tout ont je',
    pt: 'o a os as de do da dos das e é um uma que não em no na para com por se mais como mas foi ao ele ela isso são também já está você muito quando eu',
    it: 'il lo la i gli le di del della che e è un una per non con sono si da in al alla come ma anche più questo questa ha ho essere stato molto perché nel io',
    de: 'der die das und ist nicht ein eine zu den mit sich des auf für im dem von sie es auch an werden aus er hat dass wie bei oder wird noch nach ich',
    ca: 'el la els les de del i que és un una per amb no als al com però més aquest aquesta són també fer seu seva hi ha molt quan jo',
    nl: 'de het een en van is dat niet in op te zijn met voor als maar ook er aan om bij door wordt hij ze zich deze naar heeft ik',
  }).map(([idioma, lista]) => [idioma, new Set(lista.split(' '))]));

  // Letras que delatan un idioma.
  const PISTAS = { es: /[ñ¿¡]/gi, pt: /[ãõ]/gi, de: /[äöß]/gi };

  // `frente`: si se indica, la confianza mide cuánto más probable es el idioma
  // detectado que ese otro (en vez de que el segundo más probable).
  function detectarLocal(texto, frente) {
    const letras = (texto.match(/\p{L}/gu) || []).length;
    if (!letras) return { idioma: 'und', confianza: 0 };

    for (const [idioma, patron, umbral] of ESCRITURAS) {
      if ((texto.match(patron) || []).length / letras > umbral) return { idioma, confianza: 0.8 };
    }

    const palabras = texto.toLowerCase().match(/\p{L}+/gu) || [];
    const puntos = Object.entries(FRECUENTES).map(([idioma, lista]) => {
      let n = palabras.reduce((suma, palabra) => suma + (lista.has(palabra) ? 1 : 0), 0);
      if (PISTAS[idioma]) n += (texto.match(PISTAS[idioma]) || []).length;
      return [idioma, n];
    }).sort((a, b) => b[1] - a[1]);

    const [[idioma, mejor], [, segundo]] = puntos;
    if (mejor < 2) return { idioma: 'und', confianza: 0 };
    const rival = frente ? (puntos.find(([i]) => i === frente) || [frente, 0])[1] : segundo;
    return { idioma, confianza: (mejor - rival) / mejor };
  }

  // ---------------------------------------------------------------------------
  // Detección

  let detectorDelNavegador = null; // promesa del detector, o de null si no hay

  function obtenerDetectorDelNavegador() {
    if (!detectorDelNavegador) {
      detectorDelNavegador = (async () => {
        if (!('LanguageDetector' in self)) return null;
        try {
          if ((await conPlazo(LanguageDetector.availability(), 3000)) === 'unavailable') return null;
          return await conPlazo(LanguageDetector.create(), 20000);
        } catch (e) {
          detectorDelNavegador = null; // se reintentará la próxima vez
          return null;
        }
      })();
    }
    return detectorDelNavegador;
  }

  // Devuelve { idioma, confianza } con confianza de 0 a 1. Ver `frente` en detectarLocal.
  async function detectar(texto, frente) {
    const muestra = texto.slice(0, 4000);
    const detector = await obtenerDetectorDelNavegador();
    if (detector) {
      try {
        const resultados = await conPlazo(detector.detect(muestra), 3000);
        const mejor = resultados[0];
        if (mejor && mejor.detectedLanguage !== 'und') {
          const rival = frente
            ? (resultados.find((r) => idiomaBase(r.detectedLanguage) === frente) || { confidence: 0 }).confidence
            : 0;
          return { idioma: idiomaBase(mejor.detectedLanguage), confianza: mejor.confidence - rival };
        }
      } catch (e) { /* se usa el método propio */ }
    }
    return detectarLocal(muestra, frente);
  }

  // Idioma de cada párrafo: el del texto completo, salvo párrafos largos que
  // claramente estén en otro (por ejemplo, una cita en otro idioma).
  async function idiomasDeParrafos(parrafos) {
    const general = (await detectar(parrafos.join('\n'))).idioma;
    const idiomas = await Promise.all(parrafos.map(async (parrafo) => {
      if (parrafo.length < 80) return general;
      const { idioma, confianza } = await detectar(parrafo, general);
      return idioma !== 'und' && idioma !== general && confianza >= 0.5 ? idioma : general;
    }));
    return { general, idiomas };
  }

  // ---------------------------------------------------------------------------
  // Traducción

  const largoEnLetras = (texto) => texto.length;
  const codificador = new TextEncoder();
  const largoEnBytes = (texto) => codificador.encode(texto).length;

  // Corta un texto por palabras (o por caracteres, si no tiene espacios) en trozos que no pasen del límite.
  function trocear(texto, limite, medir) {
    const conEspacios = /\s/.test(texto.trim());
    const unidades = conEspacios ? texto.trim().split(/\s+/) : Array.from(texto);
    const trozos = [];
    let actual = '';
    for (const unidad of unidades) {
      if (conEspacios && medir(unidad) > limite) {
        if (actual) trozos.push(actual);
        actual = '';
        trozos.push(...trocear(unidad, limite, medir));
        continue;
      }
      const junto = actual ? actual + (conEspacios ? ' ' : '') + unidad : unidad;
      if (actual && medir(junto) > limite) {
        trozos.push(actual);
        actual = unidad;
      } else {
        actual = junto;
      }
    }
    if (actual) trozos.push(actual);
    return trozos;
  }

  // Junta oraciones en partes que no pasen del límite, para traducir con contexto.
  function agrupar(oraciones, limite, medir) {
    const partes = [];
    let actual = '';
    for (const oracion of oraciones.flatMap((o) => (medir(o) > limite ? trocear(o, limite, medir) : [o]))) {
      const junto = actual ? `${actual} ${oracion}` : oracion;
      if (actual && medir(junto) > limite) {
        partes.push(actual);
        actual = oracion;
      } else {
        actual = junto;
      }
    }
    if (actual) partes.push(actual);
    return partes;
  }

  async function traducirPorPartes(texto, limite, medir, traducirParte) {
    const traducidas = [];
    for (const parte of agrupar(Orador.dividirEnOraciones(texto), limite, medir)) {
      traducidas.push((await traducirParte(parte)).trim());
    }
    return traducidas.join(' ');
  }

  // --- MyMemory (en línea) ---

  const URL_MYMEMORY = 'https://api.mymemory.translated.net/get';
  const LIMITE_MYMEMORY = 480;            // el servicio acepta hasta 500 bytes por consulta
  const CODIGOS_MYMEMORY = { zh: 'zh-CN' };

  function decodificarEntidades(texto) {
    if (!/&[#\w]+;/.test(texto)) return texto;
    return new DOMParser().parseFromString(texto, 'text/html').documentElement.textContent;
  }

  async function traducirConMyMemory(texto, desde) {
    const parametros = new URLSearchParams({
      q: texto,
      langpair: `${CODIGOS_MYMEMORY[desde] || desde}|${DESTINO}`,
    });
    let respuesta;
    try {
      respuesta = await fetch(`${URL_MYMEMORY}?${parametros}`);
    } catch (e) {
      throw new ErrorDeTraduccion('red', 'No pude conectar con el servicio de traducción en línea. Revisa tu conexión a internet.');
    }
    const datos = await respuesta.json().catch(() => ({}));
    const traduccion = (datos.responseData && datos.responseData.translatedText) || '';
    const estado = Number(datos.responseStatus || respuesta.status);
    if (estado === 429 || datos.quotaFinished || /MYMEMORY WARNING/i.test(traduccion)) {
      throw new ErrorDeTraduccion('cuota', 'Se acabó por hoy la traducción en línea gratuita (5000 caracteres al día). Con Microsoft Edge o Google Chrome actualizados se traduce en tu equipo, sin límite.');
    }
    if (estado !== 200 || !traduccion) {
      throw new ErrorDeTraduccion('servicio', `El servicio de traducción en línea respondió con un error${datos.responseDetails ? ` («${datos.responseDetails}»)` : ''}.`);
    }
    return decodificarEntidades(traduccion);
  }

  // --- Motores ---

  const motores = new Map(); // idioma de origen → promesa del motor

  // Devuelve { tipo: 'navegador' | 'en-linea', traducir(texto) } para traducir de `desde` al español.
  // `alDescargar(avance)` informa, de 0 a 1, la descarga del modelo del navegador.
  function obtenerMotor(desde, alDescargar) {
    if (!motores.has(desde)) {
      const promesa = crearMotor(desde, alDescargar);
      motores.set(desde, promesa);
      promesa.catch(() => motores.delete(desde));
    }
    return motores.get(desde);
  }

  // Crea el traductor del navegador. La descarga del modelo puede tardar, así que
  // solo se abandona si pasan 30 s sin ningún avance.
  function crearTraductorDelNavegador(desde, alDescargar) {
    return new Promise((resolver, rechazar) => {
      let temporizador;
      const vigilar = () => {
        clearTimeout(temporizador);
        temporizador = setTimeout(() => rechazar(new ErrorDeTraduccion('plazo', 'El traductor del navegador no respondió.')), 30000);
      };
      vigilar();
      Translator.create({
        sourceLanguage: desde,
        targetLanguage: DESTINO,
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            vigilar();
            if (alDescargar) alDescargar(e.total ? e.loaded / e.total : e.loaded);
          });
        },
      }).then(resolver, rechazar).finally(() => clearTimeout(temporizador));
    });
  }

  async function crearMotor(desde, alDescargar) {
    if ('Translator' in self) {
      let disponibilidad = 'unavailable';
      try {
        disponibilidad = await conPlazo(Translator.availability({ sourceLanguage: desde, targetLanguage: DESTINO }), 3000);
      } catch (e) { /* par de idiomas no admitido, o el navegador no responde */ }

      if (disponibilidad !== 'unavailable') {
        try {
          const traductor = await crearTraductorDelNavegador(desde, alDescargar);
          return {
            tipo: 'navegador',
            traducir: (texto) => traducirPorPartes(texto, 1000, largoEnLetras,
              (parte) => conPlazo(traductor.translate(parte), 60000)),
          };
        } catch (e) {
          // Descargar un modelo exige que la persona acabe de pulsar algo en la página.
          if (e.name === 'NotAllowedError') {
            throw new ErrorDeTraduccion('activacion', 'Para descargar el traductor del navegador, pulsa otra vez el botón de reproducir.');
          }
          console.warn('Traductor del navegador no disponible; se usará MyMemory.', e);
        }
      }
    }
    return {
      tipo: 'en-linea',
      traducir: (texto) => traducirPorPartes(texto, LIMITE_MYMEMORY, largoEnBytes, (parte) => traducirConMyMemory(parte, desde)),
    };
  }

  Orador.Traductor = { DESTINO, IDIOMAS, nombreIdioma, detectar, idiomasDeParrafos, obtenerMotor, ErrorDeTraduccion };
})();
