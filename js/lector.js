/*
 * Orador de Textos — motor de lectura.
 *
 * Prepara el texto (limpieza y división en oraciones) y lo lee en voz alta con
 * la Web Speech API del navegador, una oración a la vez. Leer por oraciones
 * permite resaltar lo que se está leyendo, saltar adelante o atrás y evita que
 * algunas voces se corten con textos largos.
 */
(function () {
  'use strict';

  // Largo máximo de cada fragmento. Las voces de Google en Chrome se callan si
  // un enunciado dura más de ~15 segundos.
  const LARGO_MAXIMO = 200;

  // Pausa, en milisegundos, entre las columnas de una fila de tabla. Las celdas
  // de una fila llegan separadas por un tabulador (así salen las tablas de Word
  // y las que se pegan desde Word o Excel) y se leen de izquierda a derecha.
  const PAUSA_COLUMNA = 425;

  // Con las voces descargables, cuántas oraciones se generan por adelantado
  // mientras suena la actual (así no hay silencios entre una y otra).
  const ADELANTO = 3;

  // ---------------------------------------------------------------------------
  // Preparación del texto

  // Líneas que solo tienen un número de página: "12", "- 12 -", "Página 3 de 10", "Page 4".
  const NUMERO_DE_PAGINA = /^[-–—|·•\s]*(?:(?:p[áa]g(?:ina)?|page|p)\.?\s*\d{1,4}(?:\s*(?:de|of|\/)\s*\d{1,4})?|\d{1,3}(?:\s*(?:de|of|\/)\s*\d{1,4})?)[-–—|·•\s]*$/i;
  const esNumeroDePagina = (linea) => NUMERO_DE_PAGINA.test(linea);

  function limpiar(texto) {
    return texto
      .replace(/\r\n?/g, '\n')
      .split('\n').filter((linea) => !esNumeroDePagina(linea)).join('\n')
      // Citas numéricas entre corchetes, que la voz leería en voz alta: "texto [3]" → "texto"
      .replace(/\s*\[\d{1,3}(?:\s*[-–,]\s*\d{1,3})*\]/g, '')
      // Columnas de una tabla: el tabulador se conserva y se limpia a su alrededor
      .replace(/[ \u00a0\u200b]*\t[ \t\u00a0\u200b]*/g, '\t')
      .replace(/[ \u00a0\u200b]+/g, ' ')
      .replace(/ *\n */g, '\n')
      // Palabra cortada al final de una línea (típico al copiar de un PDF): "pala-\nbra" → "palabra"
      .replace(/(\p{L})-\n(?=\p{Ll})/gu, '$1')
      // Salto de línea en mitad de una frase: la línea siguiente empieza en minúscula.
      // Las filas de una tabla (con tabuladores) nunca se unen a la línea de al lado.
      .replace(/^([^\n]+)\n(?=(\p{Ll}[^\n]*))/gmu, (junto, linea, siguiente) =>
        (linea.includes('\t') || siguiente.includes('\t') ? junto : linea + ' '))
      .trim();
  }

  // Párrafos del texto ya limpio, sin líneas vacías.
  function parrafos(texto) {
    return limpiar(texto).split('\n').map((p) => p.trim()).filter(Boolean);
  }

  const segmentador = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter('es', { granularity: 'sentence' })
    : null;

  function dividirEnOraciones(parrafo) {
    const partes = segmentador
      ? Array.from(segmentador.segment(parrafo), (s) => s.segment)
      : parrafo.match(/[^.!?…]*(?:[.!?…]+["'»”’)\]]*|$)/g) || [parrafo];
    return partes.map((s) => s.trim()).filter(Boolean);
  }

  // Abreviaturas que terminan en punto pero no cierran la oración ("Sr. Pérez", "pág. 4", "J. Pérez").
  const ABREVIATURA_AL_FINAL = /(?:^|[\s(])(?:sra?|srta|sres|dra?|lic|ing|prof|arq|p[áa]gs?|n[úu]m|art|cap|aprox|tel|av|vol|ej|uds?|vds?|ee|\p{L})\.$/iu;

  function unirAbreviaturas(oraciones) {
    const resultado = [];
    for (const oracion of oraciones) {
      const ultima = resultado.length - 1;
      if (ultima >= 0 && ABREVIATURA_AL_FINAL.test(resultado[ultima])) {
        resultado[ultima] += ' ' + oracion;
      } else {
        resultado.push(oracion);
      }
    }
    return resultado;
  }

  // Parte una oración demasiado larga en la última pausa natural antes del límite.
  function partirLargas(oracion) {
    const partes = [];
    let resto = oracion;
    while (resto.length > LARGO_MAXIMO) {
      const tramo = resto.slice(0, LARGO_MAXIMO);
      let corte = Math.max(
        tramo.lastIndexOf(', '), tramo.lastIndexOf('; '),
        tramo.lastIndexOf(': '), tramo.lastIndexOf(' — ')
      ) + 1;
      if (corte < LARGO_MAXIMO * 0.4) corte = tramo.lastIndexOf(' ') + 1;
      if (corte <= 0) corte = LARGO_MAXIMO;
      partes.push(resto.slice(0, corte).trim());
      resto = resto.slice(corte).trim();
    }
    partes.push(resto);
    return partes.filter(Boolean);
  }

  // Fragmentos a leer de un párrafo en español: { texto, parrafo, leible, pausa }.
  // Si el párrafo es una fila de tabla, cada celda se lee por separado y la
  // última oración de cada celda, menos la de la última columna, lleva una pausa.
  function fragmentar(parrafo, numero) {
    const celdas = parrafo.split('\t').map((c) => c.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const fragmentos = [];
    celdas.forEach((celda, k) => {
      const deCelda = [];
      unirAbreviaturas(dividirEnOraciones(celda)).forEach((oracion) => {
        partirLargas(oracion).forEach((parte) => {
          deCelda.push({ texto: parte, parrafo: numero, leible: /[\p{L}\p{N}]/u.test(parte), pausa: 0 });
        });
      });
      if (k < celdas.length - 1 && deCelda.length) deCelda[deCelda.length - 1].pausa = PAUSA_COLUMNA;
      fragmentos.push(...deCelda);
    });
    return fragmentos;
  }

  // ---------------------------------------------------------------------------
  // Voces

  const esVozEnEspanol = (voz) => /^es(?:[-_]|$)/i.test(voz.lang);
  const esNatural = (voz) => /natural|online|neural/i.test(voz.name);
  const normalizarIdioma = (lang) => lang.replace('_', '-').toLowerCase();

  const nombresDeRegion = typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['es'], { type: 'region' })
    : null;

  function nombreCorto(voz) {
    if (/^google/i.test(voz.name)) return 'Google';
    // En Android las voces se llaman como el idioma ("Spanish Spain", "español
    // Estados Unidos" o "es-es-x-eea-local"); el país ya va en la etiqueta.
    if (/^(spanish|espa[ñn]ol|es[-_])/i.test(voz.name)) return 'Voz del sistema';
    return voz.name
      .replace(/^microsoft\s+/i, '')
      .replace(/\s*-\s*(spanish|español).*$/i, '')
      .replace(/\s*online/i, '')
      .replace(/\s*\((natural|neural)\)/i, '')
      .trim() || voz.name;
  }

  function region(voz) {
    const codigo = voz.lang.split(/[-_]/)[1];
    if (!codigo) return 'Español';
    try {
      return (nombresDeRegion && nombresDeRegion.of(codigo.toUpperCase())) || codigo;
    } catch (e) {
      return codigo;
    }
  }

  function etiquetaVoz(voz) {
    return `${nombreCorto(voz)} — ${region(voz)}`;
  }

  // Voces en español: primero las naturales, luego las de Google, luego el resto;
  // dentro de cada grupo, primero las del país del navegador.
  function vocesEnEspanol() {
    const idiomaPreferido = normalizarIdioma(navigator.language || 'es');
    const grupo = (v) => (esNatural(v) ? 0 : /^google/i.test(v.name) ? 1 : 2);
    const esLocal = (v) => Number(normalizarIdioma(v.lang) === idiomaPreferido);
    return speechSynthesis.getVoices()
      .filter(esVozEnEspanol)
      .sort((a, b) =>
        grupo(a) - grupo(b) ||
        esLocal(b) - esLocal(a) ||
        etiquetaVoz(a).localeCompare(etiquetaVoz(b), 'es'));
  }

  // ---------------------------------------------------------------------------
  // Lector
  //
  // Los fragmentos pueden llegar por partes (por ejemplo, mientras se traduce):
  // nuevo() empieza un texto, agregar() suma fragmentos y completar() avisa que
  // no llegarán más. Si la lectura alcanza el final antes de tiempo, espera.

  class Lector {
    constructor() {
      this.fragmentos = [];
      this.completo = true;
      this.esperando = false;   // leyendo, pero a la espera de más fragmentos
      this.indice = 0;
      this.estado = 'detenido'; // 'leyendo' | 'pausado' | 'detenido'
      this.voz = null;
      this.velocidad = 1;
      this.alCambiar = () => {};
      this.alError = () => {};
      this._turno = 0;          // cada lectura nueva invalida los avisos de la anterior
      this._enunciado = null;   // referencia viva: Chrome descarta enunciados sin referencia y nunca avisa que terminaron
      this._latido = null;
      // Voces descargables: el audio se genera unas oraciones por adelantado y
      // suena en un único <audio>, que sigue con la pantalla bloqueada.
      this.preparandoVoz = false;
      this._audio = null;
      this._audios = new Map(); // "voz|índice" → promesa de la URL del audio
    }

    get total() {
      return this.fragmentos.length;
    }

    nuevo() {
      this.detener();
      this.fragmentos = [];
      this.completo = false;
      this._olvidarAudios(() => true);
    }

    agregar(fragmentos) {
      this.fragmentos.push(...fragmentos);
      if (this.esperando && this.estado === 'leyendo') this._leerActual();
      else this._avisar();
    }

    completar() {
      this.completo = true;
      if (this.esperando && this.estado === 'leyendo') this._leerActual();
      else this._avisar();
    }

    reproducir(desde) {
      if (!this.total && this.completo) return;
      if (typeof desde === 'number' && this.total) this.indice = Math.min(Math.max(desde, 0), this.total - 1);
      this.estado = 'leyendo';
      this._leerActual();
    }

    // La pausa corta la voz y recuerda la oración; al continuar, se repite desde
    // su inicio. Es más fiable que speechSynthesis.pause(), que falla en Chrome.
    pausar() {
      if (this.estado !== 'leyendo') return;
      this._callar();
      this.estado = 'pausado';
      this._avisar();
    }

    detener() {
      this._callar();
      this.estado = 'detenido';
      this.indice = 0;
      this._avisar();
    }

    saltar(cuantas) {
      if (this.estado === 'detenido' || !this.total) return;
      this.indice = Math.min(Math.max(this.indice + cuantas, 0), this.total - 1);
      if (this.estado === 'leyendo') this._leerActual();
      else this._avisar();
    }

    // Aplica al momento un cambio de voz o de velocidad repitiendo la oración actual.
    reiniciarOracion() {
      if (this.estado === 'leyendo' && !this.esperando) this._leerActual();
    }

    // Dice un texto suelto (por ejemplo, para probar la voz) sin perder la posición.
    decir(texto) {
      if (this.estado === 'leyendo') this.estado = 'pausado';
      const turno = this._callar();
      this._avisar();
      this._hablar(texto, turno, null, () => {});
    }

    _leerActual() {
      const turno = this._callar();
      while (this.indice < this.total && !this.fragmentos[this.indice].leible) this.indice++;
      if (this.indice >= this.total) {
        if (this.completo) {
          this._terminar();
        } else {
          this.esperando = true;
          this._avisar();
        }
        return;
      }
      this._avisar();
      this._hablar(this.fragmentos[this.indice].texto, turno, this.indice, () => {
        const pausa = this.fragmentos[this.indice].pausa || 0;
        this.indice++;
        if (!pausa) {
          this._leerActual();
        } else {
          // Pausa entre columnas de una tabla. Si se pausa, se detiene o se salta, el turno cambia y no sigue.
          setTimeout(() => {
            if (turno === this._turno) this._leerActual();
          }, pausa);
        }
      });
    }

    // `indice`: posición del fragmento (null para un texto suelto, como «Probar voz»).
    _hablar(texto, turno, indice, alTerminar) {
      if (this.voz && this.voz.descargable) {
        this._hablarConAudio(texto, turno, indice, alTerminar);
        return;
      }
      const enunciado = new SpeechSynthesisUtterance(texto);
      if (this.voz) {
        enunciado.voice = this.voz;
        enunciado.lang = this.voz.lang;
      } else {
        enunciado.lang = 'es-ES';
      }
      enunciado.rate = this.velocidad;
      enunciado.onend = () => {
        if (turno === this._turno) alTerminar();
      };
      enunciado.onerror = (e) => {
        if (turno !== this._turno || e.error === 'interrupted' || e.error === 'canceled') return;
        this._callar();
        if (this.estado === 'leyendo') this.estado = 'pausado';
        this._avisar();
        this.alError(e.error);
      };
      this._enunciado = enunciado;
      // Justo después de cancel(), algunos navegadores ignoran speak(): se espera un instante.
      setTimeout(() => {
        if (turno !== this._turno) return;
        if (speechSynthesis.paused) speechSynthesis.resume();
        speechSynthesis.speak(enunciado);
        this._mantenerViva(turno);
      }, 30);
    }

    // --- Voces descargables ---

    async _hablarConAudio(texto, turno, indice, alTerminar) {
      if (indice !== null) this._adelantar(indice);
      // Si el audio no está listo enseguida, se avisa que se está preparando la voz.
      const avisoDeEspera = setTimeout(() => {
        if (turno !== this._turno) return;
        this.preparandoVoz = true;
        this._avisar();
      }, 150);
      let url;
      try {
        url = await (indice === null
          ? Orador.VocesDescargables.generar(texto, this.voz.id).then((wav) => URL.createObjectURL(wav))
          : this._audioDe(indice));
      } catch (e) {
        if (turno === this._turno) this._fallar('audio', e);
        return;
      } finally {
        clearTimeout(avisoDeEspera);
      }
      if (turno !== this._turno) return;
      if (this.preparandoVoz) {
        this.preparandoVoz = false;
        this._avisar();
      }

      if (!this._audio) this._audio = new Audio();
      const audio = this._audio;
      audio.onended = () => {
        if (turno === this._turno) alTerminar();
      };
      audio.onerror = () => {
        if (turno === this._turno) this._fallar('audio');
      };
      audio.src = url;
      audio.playbackRate = this.velocidad;
      try {
        await audio.play();
      } catch (e) {
        if (turno === this._turno) this._fallar(e.name === 'NotAllowedError' ? 'not-allowed' : 'audio', e);
      }
    }

    // Audio de un fragmento: se genera una vez y se guarda mientras haga falta.
    _audioDe(indice) {
      const voz = this.voz.id;
      const clave = `${voz}|${indice}`;
      if (!this._audios.has(clave)) {
        const fragmento = this.fragmentos[indice];
        const haceFalta = () => this.voz && this.voz.id === voz && this.fragmentos[indice] === fragmento &&
          indice >= this.indice && indice <= this.indice + ADELANTO;
        const promesa = Orador.VocesDescargables.generar(fragmento.texto, voz, haceFalta)
          .then((wav) => URL.createObjectURL(wav));
        promesa.catch(() => this._audios.delete(clave));
        this._audios.set(clave, promesa);
      }
      return this._audios.get(clave);
    }

    // Pide por adelantado el audio de las oraciones siguientes y suelta el de las ya leídas.
    _adelantar(indice) {
      this._olvidarAudios((voz, i) => voz !== this.voz.id || i < indice - 1);
      for (let i = indice + 1; i <= indice + ADELANTO && i < this.total; i++) {
        if (this.fragmentos[i].leible) this._audioDe(i).catch(() => {});
      }
    }

    _olvidarAudios(condicion) {
      for (const [clave, promesa] of this._audios) {
        const [voz, i] = clave.split('|');
        if (condicion(voz, Number(i))) {
          this._audios.delete(clave);
          promesa.then((url) => URL.revokeObjectURL(url), () => {});
        }
      }
    }

    _fallar(codigo, error) {
      if (error) console.warn(error);
      this._callar();
      if (this.estado === 'leyendo') this.estado = 'pausado';
      this._avisar();
      this.alError(codigo);
    }

    // Las voces de Google en Chrome se callan tras ~15 s de habla continua;
    // pausar y reanudar cada pocos segundos lo evita.
    _mantenerViva(turno) {
      clearInterval(this._latido);
      if (!this.voz || !/^google/i.test(this.voz.name)) return;
      this._latido = setInterval(() => {
        if (turno !== this._turno || !speechSynthesis.speaking) {
          clearInterval(this._latido);
          return;
        }
        speechSynthesis.pause();
        speechSynthesis.resume();
      }, 10000);
    }

    _callar() {
      this._turno++;
      this.esperando = false;
      this.preparandoVoz = false;
      clearInterval(this._latido);
      this._enunciado = null;
      if (this._audio) this._audio.pause();
      if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
      return this._turno;
    }

    _terminar() {
      this._callar();
      this.estado = 'detenido';
      this.indice = 0;
      this._avisar({ terminado: true });
    }

    _avisar(extra) {
      this.alCambiar(Object.assign({
        estado: this.estado,
        indice: this.indice,
        total: this.total,
        completo: this.completo,
        esperando: this.esperando,
        preparandoVoz: this.preparandoVoz,
      }, extra));
    }
  }

  window.Orador = {
    Lector, parrafos, fragmentar, dividirEnOraciones, esNumeroDePagina,
    vocesEnEspanol, esNatural, etiquetaVoz, nombreCorto,
  };
})();
