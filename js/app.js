/*
 * Orador de Textos — interfaz.
 * Conecta los controles de la página con el Lector (js/lector.js) y el
 * Traductor (js/traductor.js).
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const ui = {
    voz: $('voz'),
    idioma: $('idioma'),
    velocidad: $('velocidad'),
    velocidadValor: $('velocidad-valor'),
    probarVoz: $('probar-voz'),
    aviso: $('aviso'),
    avisoTexto: $('aviso-texto'),
    avisoCerrar: $('aviso-cerrar'),
    hoja: $('hoja'),
    hojaTitulo: $('hoja-titulo'),
    verOriginal: $('ver-original'),
    editar: $('editar'),
    abrir: $('abrir'),
    foto: $('foto'),
    camara: $('camara'),
    archivo: $('archivo'),
    borrar: $('borrar'),
    infoArchivo: $('info-archivo'),
    infoArchivoTexto: $('info-archivo-texto'),
    cancelarApertura: $('cancelar-apertura'),
    infoIdioma: $('info-idioma'),
    texto: $('texto'),
    lectura: $('lectura'),
    contador: $('contador'),
    reproductor: $('reproductor'),
    barra: $('progreso-barra'),
    estado: $('estado'),
    anterior: $('anterior'),
    reproducir: $('reproducir'),
    siguiente: $('siguiente'),
    detener: $('detener'),
  };

  const PALABRAS_POR_MINUTO = 155; // ritmo aproximado de una voz en español a velocidad 1
  const ES_CELULAR = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

  // Preferencias del navegador (voz, velocidad, último texto). Si el navegador
  // no deja guardar, la página funciona igual.
  const almacen = {
    leer(clave, porDefecto) {
      try {
        const valor = localStorage.getItem('orador.' + clave);
        return valor === null ? porDefecto : JSON.parse(valor);
      } catch (e) {
        return porDefecto;
      }
    },
    guardar(clave, valor) {
      try {
        localStorage.setItem('orador.' + clave, JSON.stringify(valor));
      } catch (e) { /* sin almacenamiento */ }
    },
  };

  const mayuscula = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1);

  // --- Avisos ---------------------------------------------------------------

  let avisoActual = null;

  function mostrarAviso(id, mensaje, recordarCierre) {
    if (recordarCierre && almacen.leer('aviso-cerrado.' + id, false)) return;
    avisoActual = { id, recordarCierre: !!recordarCierre };
    ui.avisoTexto.textContent = mensaje;
    ui.aviso.hidden = false;
  }

  function ocultarAviso(id) {
    if (!avisoActual || (id && avisoActual.id !== id)) return;
    ui.aviso.hidden = true;
    avisoActual = null;
  }

  ui.avisoCerrar.addEventListener('click', () => {
    if (avisoActual && avisoActual.recordarCierre) almacen.guardar('aviso-cerrado.' + avisoActual.id, true);
    ocultarAviso();
  });

  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
    mostrarAviso('sin-soporte', 'Este navegador no puede leer en voz alta. Abre este archivo con Microsoft Edge o Google Chrome.');
    document.querySelectorAll('button, select, input').forEach((el) => {
      if (el !== ui.avisoCerrar) el.disabled = true;
    });
    return;
  }

  const { Traductor } = Orador;
  const lector = new Orador.Lector();
  let voces = [];
  let documento = null;   // texto preparado para leer: párrafos, idiomas y su vista
  let trabajo = 0;        // cambia con cada documento nuevo y deja sin efecto la traducción anterior
  let preparando = false;
  let frases = [];
  let fraseVisible = -1;
  let infoIdioma = '';
  let infoArchivo = '';

  // --- Voces ----------------------------------------------------------------

  // Voces descargables (siguen sonando con la pantalla bloqueada). Solo con la
  // página publicada: al abrirla con doble clic no se ofrecen.
  const { VocesDescargables } = Orador;
  const descargables = VocesDescargables.disponible ? VocesDescargables.VOCES : [];
  let vocesGuardadas = new Set();

  function etiquetaDescargable(voz) {
    const region = voz.lang === 'es-MX' ? 'México' : 'España';
    const estado = vocesGuardadas.has(voz.id) ? 'descargada' : `se descarga (${voz.mb} MB)`;
    return `${voz.nombre} — ${region} · ${estado}`;
  }

  function actualizarEtiquetasDescargables() {
    for (const opcion of ui.voz.options) {
      const voz = descargables.find((v) => v.name === opcion.value);
      if (voz) opcion.textContent = etiquetaDescargable(voz);
    }
  }

  async function descargarVoz(voz) {
    const titulo = `la voz ${voz.nombre} (${voz.mb} MB)`;
    mostrarAviso('descarga', `Descargando ${titulo}…`);
    try {
      await VocesDescargables.descargar(voz.id, (avance) => {
        if (avisoActual && avisoActual.id === 'descarga') mostrarAviso('descarga', `Descargando ${titulo}: ${Math.round(avance * 100)} %`);
      });
      vocesGuardadas.add(voz.id);
      actualizarEtiquetasDescargables();
      mostrarAviso('descarga', `La voz ${voz.nombre} está lista. Con ella, la lectura sigue aunque bloquees la pantalla.`);
    } catch (e) {
      mostrarAviso('descarga', 'No se pudo descargar la voz. Revisa tu conexión a internet e inténtalo de nuevo.');
    }
  }

  // Si la voz elegida es descargable y aún no está en el equipo, se descarga mostrando el avance.
  function prepararVoz() {
    const voz = lector.voz;
    if (voz && voz.descargable && !vocesGuardadas.has(voz.id)) descargarVoz(voz);
  }

  // En el celular se recuerda que las voces del sistema se cortan al bloquear la pantalla.
  function avisarSobreBloqueo() {
    if (ES_CELULAR && descargables.length && lector.voz && !lector.voz.descargable) {
      mostrarAviso('bloqueo', 'Para seguir escuchando con la pantalla bloqueada, elige en «Voz» una de las voces descargables. Se descarga una sola vez (unos 60 MB; mejor con wifi).', true);
    } else {
      ocultarAviso('bloqueo');
    }
  }

  function cargarVoces(avisarSiNoHay) {
    const delSistema = Orador.vocesEnEspanol();
    voces = [...delSistema, ...descargables];
    const elegida = (lector.voz && lector.voz.name) || almacen.leer('voz', null);
    ui.voz.textContent = '';

    // Mientras llegan las voces del sistema no se elige ninguna (si no, se
    // elegiría una descargable solo por haber llegado antes).
    if (!delSistema.length && (!avisarSiNoHay || !descargables.length)) {
      ui.voz.add(new Option(avisarSiNoHay ? 'No hay voces en español' : 'Cargando voces…', ''));
      ui.voz.disabled = ui.probarVoz.disabled = true;
      lector.voz = null;
      if (avisarSiNoHay) {
        mostrarAviso('sin-voces', ES_CELULAR
          ? 'No encontré voces en español. En Android ve a Ajustes → Sistema → Idiomas → Salida de texto a voz, elige el motor de Google, instala los datos de voz en español y vuelve a abrir esta página.'
          : 'No encontré voces en español en este navegador. En Windows ve a Configuración → Hora e idioma → Voz → Agregar voces, instala una voz en español y vuelve a abrir esta página.');
      }
      return;
    }

    ocultarAviso('sin-voces');
    ui.voz.disabled = ui.probarVoz.disabled = false;
    const naturales = delSistema.filter(Orador.esNatural);
    const otras = delSistema.filter((v) => !Orador.esNatural(v));
    const grupos = [naturales, otras, descargables].filter((g) => g.length).length;
    agregarGrupo(grupos > 1 ? 'Voces naturales (recomendadas)' : null, naturales);
    agregarGrupo(grupos > 1 ? (naturales.length ? 'Otras voces' : 'Voces del sistema') : null, otras);
    agregarGrupo(grupos > 1 ? 'Voces descargables (siguen con la pantalla bloqueada)' : null, descargables, etiquetaDescargable);

    lector.voz = voces.find((v) => v.name === elegida) || delSistema[0] || descargables[0];
    ui.voz.value = lector.voz.name;

    // En el celular las voces del sistema ya son buenas: el consejo de Edge es solo para la computadora.
    if (naturales.length || ES_CELULAR) ocultarAviso('usar-edge');
    else mostrarAviso('usar-edge', 'Consejo: abre este archivo con Microsoft Edge para tener voces naturales en español, que suenan mucho mejor.', true);
    avisarSobreBloqueo();
  }

  function agregarGrupo(titulo, lista, etiqueta = Orador.etiquetaVoz) {
    if (!lista.length) return;
    let destino = ui.voz;
    if (titulo) {
      destino = document.createElement('optgroup');
      destino.label = titulo;
      ui.voz.appendChild(destino);
    }
    lista.forEach((voz) => destino.appendChild(new Option(etiqueta(voz), voz.name)));
  }

  ui.voz.addEventListener('change', () => {
    const voz = voces.find((v) => v.name === ui.voz.value);
    if (!voz) return;
    lector.voz = voz;
    almacen.guardar('voz', voz.name);
    prepararVoz();
    avisarSobreBloqueo();
    lector.reiniciarOracion();
  });

  ui.probarVoz.addEventListener('click', () => {
    const voz = lector.voz;
    const nombre = !voz ? '' : voz.descargable ? voz.nombre : Orador.nombreCorto(voz);
    const saludo = nombre && nombre !== 'Google' && nombre !== 'Voz del sistema' ? `Hola, soy ${nombre}.` : 'Hola.';
    prepararVoz();
    lector.decir(`${saludo} Así sueno cuando leo tus textos.`);
  });

  // --- Idioma del texto -----------------------------------------------------

  ui.idioma.add(new Option('Detectar automáticamente', 'auto'));
  Traductor.IDIOMAS.forEach((codigo) => {
    const nombre = mayuscula(Traductor.nombreIdioma(codigo));
    ui.idioma.add(new Option(codigo === 'es' ? `${nombre} (no traducir)` : nombre, codigo));
  });

  // Si se cambia mientras se ve la lectura, se prepara de nuevo con el idioma elegido.
  ui.idioma.addEventListener('change', () => {
    if (ui.lectura.hidden) return;
    lector.detener();
    prepararLectura();
  });

  // --- Velocidad ------------------------------------------------------------

  function mostrarVelocidad() {
    ui.velocidadValor.textContent = Number(ui.velocidad.value).toFixed(1).replace('.', ',') + '×';
  }

  ui.velocidad.value = almacen.leer('velocidad', 1);
  lector.velocidad = Number(ui.velocidad.value);
  mostrarVelocidad();

  ui.velocidad.addEventListener('input', () => {
    lector.velocidad = Number(ui.velocidad.value);
    mostrarVelocidad();
    actualizarContador();
  });
  ui.velocidad.addEventListener('change', () => {
    almacen.guardar('velocidad', lector.velocidad);
    lector.reiniciarOracion();
  });

  // --- Texto ----------------------------------------------------------------

  function actualizarContador() {
    const palabras = (ui.texto.value.match(/\S+/g) || []).length;
    if (!palabras) {
      ui.contador.textContent = '';
      return;
    }
    const minutos = palabras / (PALABRAS_POR_MINUTO * lector.velocidad);
    const duracion = minutos < 1 ? 'menos de 1 min'
      : minutos < 60 ? `unos ${Math.round(minutos)} min`
      : `unas ${(minutos / 60).toFixed(1).replace('.', ',')} h`;
    ui.contador.textContent = `${palabras.toLocaleString('es')} ${palabras === 1 ? 'palabra' : 'palabras'} · ${duracion} de lectura`;
  }

  ui.texto.value = almacen.leer('texto', '');
  let guardadoPendiente;
  ui.texto.addEventListener('input', () => {
    actualizarContador();
    clearTimeout(guardadoPendiente);
    guardadoPendiente = setTimeout(() => almacen.guardar('texto', ui.texto.value), 400);
  });

  ui.borrar.addEventListener('click', () => {
    if (!ui.texto.value || !confirm('¿Borrar todo el texto?')) return;
    ui.texto.value = '';
    almacen.guardar('texto', '');
    actualizarContador();
    mostrarInfoArchivo('');
    ui.texto.focus();
  });

  ui.editar.addEventListener('click', () => {
    lector.detener();
    modoLectura(false);
    ui.texto.focus();
  });

  function modoLectura(activo) {
    ui.texto.hidden = activo;
    ui.lectura.hidden = !activo;
    ui.editar.hidden = !activo;
    ui.abrir.hidden = activo;
    ui.foto.hidden = activo;
    ui.borrar.hidden = activo;
    ui.verOriginal.hidden = !(activo && documento && documento.traducido);
    ui.infoIdioma.hidden = !(activo && infoIdioma);
    ui.infoArchivo.hidden = activo || !infoArchivo;
    ui.hojaTitulo.textContent = activo ? 'Lectura' : 'Tu texto';
  }

  function mostrarInfo(texto) {
    infoIdioma = texto || '';
    ui.infoIdioma.textContent = infoIdioma;
    ui.infoIdioma.hidden = ui.lectura.hidden || !infoIdioma;
  }

  function mostrarInfoArchivo(texto) {
    infoArchivo = texto || '';
    ui.infoArchivoTexto.textContent = infoArchivo;
    ui.infoArchivo.hidden = !ui.lectura.hidden || !infoArchivo;
  }

  // --- Abrir archivos (PDF, Word, texto, fotos) ------------------------------

  let apertura = null; // AbortController de la apertura en curso

  async function abrirArchivos(archivos) {
    archivos = Array.from(archivos || []);
    if (!archivos.length || apertura) return;
    apertura = new AbortController();
    lector.detener();
    modoLectura(false);
    ocultarAviso('archivo');
    const nombre = archivos.length > 1 ? `${archivos.length} fotos` : `«${archivos[0].name}»`;
    mostrarInfoArchivo(`Abriendo ${nombre}…`);
    ui.cancelarApertura.hidden = false;
    try {
      const { texto, detalles } = await Orador.Archivos.abrir(archivos, {
        idioma: ui.idioma.value,
        senal: apertura.signal,
        alAvanzar: (mensaje) => {
          if (!apertura.signal.aborted) mostrarInfoArchivo(`Abriendo ${nombre}: ${mensaje}`);
        },
      });
      if (!texto.trim()) throw new Orador.Archivos.ErrorDeArchivo('No encontré texto en el archivo.');
      ui.texto.value = texto;
      ui.texto.scrollTop = 0;
      almacen.guardar('texto', texto);
      actualizarContador();
      // Con varias fotos, los detalles ya empiezan por "N fotos".
      mostrarInfoArchivo([archivos.length > 1 ? '' : nombre, detalles].filter(Boolean).join(' · '));
    } catch (error) {
      if (!(error instanceof Orador.Archivos.ErrorDeArchivo)) console.error(error);
      mostrarInfoArchivo('');
      mostrarAviso('archivo', error instanceof Orador.Archivos.ErrorDeArchivo
        ? error.message
        : `No pude abrir ${nombre}; puede estar dañado.`);
    } finally {
      apertura = null;
      ui.cancelarApertura.hidden = true;
    }
  }

  // Al cancelar se conserva lo que ya se leyó (por ejemplo, las primeras páginas).
  ui.cancelarApertura.addEventListener('click', () => {
    if (!apertura) return;
    apertura.abort();
    mostrarInfoArchivo('Cancelando…');
  });

  ui.abrir.addEventListener('click', () => ui.archivo.click());
  ui.foto.addEventListener('click', () => ui.camara.click());
  ui.camara.addEventListener('change', () => {
    abrirArchivos(ui.camara.files);
    ui.camara.value = '';
  });
  ui.archivo.addEventListener('change', () => {
    abrirArchivos(ui.archivo.files);
    ui.archivo.value = ''; // permite volver a abrir el mismo archivo
  });

  // Se puede soltar un archivo en cualquier parte de la página.
  let arrastres = 0; // dragenter y dragleave llegan por cada elemento que se cruza
  const llevaArchivos = (e) => Array.from(e.dataTransfer ? e.dataTransfer.types : []).includes('Files');

  document.addEventListener('dragenter', (e) => {
    if (!llevaArchivos(e)) return;
    e.preventDefault();
    arrastres++;
    ui.hoja.classList.add('arrastrando');
  });
  document.addEventListener('dragover', (e) => {
    if (!llevaArchivos(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('dragleave', (e) => {
    if (!llevaArchivos(e)) return;
    arrastres = Math.max(0, arrastres - 1);
    if (!arrastres) ui.hoja.classList.remove('arrastrando');
  });
  document.addEventListener('drop', (e) => {
    if (!llevaArchivos(e)) return;
    e.preventDefault();
    arrastres = 0;
    ui.hoja.classList.remove('arrastrando');
    abrirArchivos(e.dataTransfer.files);
  });

  // --- Original junto a la traducción ---------------------------------------

  let verOriginal = almacen.leer('ver-original', true);

  function aplicarVerOriginal() {
    ui.lectura.classList.toggle('sin-original', !verOriginal);
    ui.verOriginal.textContent = verOriginal ? 'Ocultar original' : 'Ver original';
  }

  ui.verOriginal.addEventListener('click', () => {
    verOriginal = !verOriginal;
    almacen.guardar('ver-original', verOriginal);
    aplicarVerOriginal();
  });
  aplicarVerOriginal();

  // --- Documento: detectar idioma, traducir y mostrar -------------------------

  // Dibuja un bloque por párrafo. En textos traducidos, cada bloque tiene la
  // traducción (lo que se lee) y, al lado, el original.
  function dibujarBloques() {
    ui.lectura.textContent = '';
    frases = [];
    fraseVisible = -1;
    ui.lectura.classList.toggle('bilingue', documento.traducido);

    if (documento.traducido) {
      const cabecera = ui.lectura.appendChild(document.createElement('div'));
      cabecera.className = 'bloque bloque-cabecera';
      cabecera.innerHTML = '<span>Traducción al español</span><span>Original</span>';
    }

    documento.bloques = documento.parrafos.map((parrafo, i) => {
      const bloque = ui.lectura.appendChild(document.createElement('div'));
      bloque.className = 'bloque';
      const texto = bloque.appendChild(document.createElement('p'));
      texto.className = 'bloque-texto';
      let original = null;
      if (documento.traducido) {
        texto.classList.add('pendiente');
        original = bloque.appendChild(document.createElement('p'));
        original.className = 'bloque-original';
        original.lang = documento.idiomas[i];
        if (documento.idiomas[i] !== Traductor.DESTINO) original.textContent = parrafo;
      }
      return { bloque, texto, original };
    });
  }

  // Muestra el texto (ya en español) de un párrafo y devuelve sus fragmentos para el lector.
  function publicar(numero, texto) {
    const fragmentos = Orador.fragmentar(texto, numero);
    const celda = documento.bloques[numero].texto;
    const base = frases.length;
    celda.classList.remove('pendiente');
    celda.textContent = '';
    fragmentos.forEach((fragmento, k) => {
      if (k) celda.appendChild(document.createTextNode(fragmentos[k - 1].pausa ? '  │  ' : ' '));
      const frase = celda.appendChild(document.createElement('span'));
      frase.className = 'frase';
      frase.textContent = fragmento.texto;
      frase.dataset.indice = base + k;
      frases.push(frase);
    });
    return fragmentos;
  }

  function unirNombres(nombres) {
    return nombres.length > 1 ? `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}` : nombres[0];
  }

  function describirTraduccion(motores, detalle) {
    const origen = mayuscula(unirNombres(Object.keys(motores).map(Traductor.nombreIdioma)));
    if (detalle) return `${origen} → español · ${detalle}`;
    const enLinea = Object.values(motores).some((m) => m.tipo === 'en-linea');
    return `${origen} → español · ` + (enLinea
      ? 'traducido en línea con MyMemory (gratis hasta 5000 caracteres al día)'
      : 'traducido en tu equipo con el traductor del navegador');
  }

  // Prepara el texto para leer. Devuelve false si no se pudo.
  async function cargarDocumento(texto, clave) {
    const id = ++trabajo;
    lector.nuevo();
    ui.estado.textContent = 'Preparando…';
    ocultarAviso('idioma');
    ocultarAviso('traduccion');

    const parrafos = Orador.parrafos(texto);
    const elegido = ui.idioma.value;
    let idiomas = parrafos.map(() => elegido);
    if (elegido === 'auto') {
      mostrarInfo('Detectando el idioma…');
      const deteccion = await Traductor.idiomasDeParrafos(parrafos);
      if (id !== trabajo) return false;
      idiomas = deteccion.idiomas.map((idioma) => (idioma === 'und' ? Traductor.DESTINO : idioma));
      if (deteccion.general === 'und') {
        mostrarAviso('idioma', 'No reconocí el idioma del texto, así que lo leeré tal cual. Si no está en español, elige su idioma en «Idioma del texto».');
      }
    }

    const aTraducir = [...new Set(idiomas.filter((idioma) => idioma !== Traductor.DESTINO))];
    documento = { clave, parrafos, idiomas, traducido: aTraducir.length > 0, bloques: [], fallido: false };
    dibujarBloques();
    modoLectura(true);

    if (!documento.traducido) {
      mostrarInfo('');
      lector.agregar(parrafos.flatMap((parrafo, i) => publicar(i, parrafo)));
      lector.completar();
      return true;
    }

    // Se piden todos los motores a la vez: descargar un modelo del navegador
    // exige que la persona acabe de pulsar algo, y ese permiso dura poco.
    const nombres = unirNombres(aTraducir.map(Traductor.nombreIdioma));
    mostrarInfo(`Preparando el traductor de ${nombres} a español…`);
    let motores;
    try {
      const lista = await Promise.all(aTraducir.map((idioma) => Traductor.obtenerMotor(idioma, (avance) => {
        if (id === trabajo) mostrarInfo(`Descargando el traductor de ${Traductor.nombreIdioma(idioma)} a español: ${Math.round(avance * 100)} %`);
      })));
      motores = Object.fromEntries(aTraducir.map((idioma, i) => [idioma, lista[i]]));
    } catch (error) {
      if (id !== trabajo) return false;
      documento = null;
      lector.detener();
      mostrarInfo('');
      modoLectura(false);
      mostrarAviso('traduccion', error.message);
      return false;
    }
    if (id !== trabajo) return false;

    traducirEnSegundoPlano(id, documento, motores);
    return true;
  }

  // Traduce párrafo a párrafo; la lectura puede empezar en cuanto llega el primero.
  async function traducirEnSegundoPlano(id, doc, motores) {
    const total = doc.parrafos.length;
    for (let i = 0; i < total; i++) {
      let texto = doc.parrafos[i];
      const motor = motores[doc.idiomas[i]];
      if (motor) {
        mostrarInfo(describirTraduccion(motores, `traduciendo ${i + 1} de ${total}…`));
        try {
          texto = await motor.traducir(texto);
        } catch (error) {
          if (id !== trabajo) return;
          doc.fallido = true;
          doc.bloques.slice(i).forEach(({ texto: celda }) => {
            celda.classList.remove('pendiente');
            celda.classList.add('sin-traducir');
            celda.textContent = 'Sin traducir';
          });
          lector.completar();
          mostrarInfo(describirTraduccion(motores, 'la traducción se interrumpió'));
          mostrarAviso('traduccion', error.message || 'No se pudo traducir el texto.');
          return;
        }
      }
      if (id !== trabajo) return;
      lector.agregar(publicar(i, texto));
    }
    lector.completar();
    mostrarInfo(describirTraduccion(motores));
  }

  ui.lectura.addEventListener('click', (e) => {
    const frase = e.target.closest('.frase');
    if (!frase || String(window.getSelection())) return; // no interrumpir si se está seleccionando texto
    lector.reproducir(Number(frase.dataset.indice));
  });

  // --- Reproducción ---------------------------------------------------------

  async function prepararLectura() {
    const texto = ui.texto.value;
    if (!texto.trim()) {
      mostrarAviso('vacio', 'Primero pega o escribe un texto para leer.');
      modoLectura(false);
      ui.texto.focus();
      return false;
    }
    ocultarAviso('vacio');
    const clave = ui.idioma.value + '\n' + texto;
    if (documento && documento.clave === clave && !documento.fallido) {
      modoLectura(true);
      return true;
    }
    preparando = true;
    try {
      return await cargarDocumento(texto, clave);
    } finally {
      preparando = false;
    }
  }

  async function alternarLectura() {
    if (preparando) return;
    if (lector.estado === 'leyendo') {
      lector.pausar();
    } else if (await prepararLectura()) {
      prepararVoz();
      lector.reproducir();
    }
  }

  ui.reproducir.addEventListener('click', alternarLectura);
  ui.detener.addEventListener('click', () => lector.detener());
  ui.anterior.addEventListener('click', () => lector.saltar(-1));
  ui.siguiente.addEventListener('click', () => lector.saltar(1));

  function asegurarVisible(elemento) {
    const caja = elemento.getBoundingClientRect();
    const limiteInferior = window.innerHeight - ui.reproductor.offsetHeight - 24;
    if (caja.top < 24 || caja.bottom > limiteInferior) {
      elemento.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  // Mientras se lee, la pantalla del celular no se apaga: con la pantalla
  // apagada, el navegador puede cortar la lectura al terminar la oración.
  let quierePantalla = false;
  let bloqueoPantalla = null; // WakeLockSentinel, o 'pidiendo'

  async function pantallaEncendida(si) {
    quierePantalla = si;
    if (!('wakeLock' in navigator)) return;
    try {
      if (si && !bloqueoPantalla) {
        bloqueoPantalla = 'pidiendo';
        const bloqueo = await navigator.wakeLock.request('screen');
        bloqueoPantalla = bloqueo;
        bloqueo.addEventListener('release', () => {
          if (bloqueoPantalla === bloqueo) bloqueoPantalla = null;
        });
        if (!quierePantalla) pantallaEncendida(false);
      } else if (!si && bloqueoPantalla && bloqueoPantalla !== 'pidiendo') {
        const bloqueo = bloqueoPantalla;
        bloqueoPantalla = null;
        await bloqueo.release();
      }
    } catch (e) {
      bloqueoPantalla = null; // sin permiso o sin batería suficiente: se sigue sin él
    }
  }

  // Al volver a la página, el navegador ya soltó el bloqueo: se pide de nuevo.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && quierePantalla) pantallaEncendida(true);
  });

  // Controles en la pantalla de bloqueo y en la notificación (con voces
  // descargables, que suenan como audio normal).
  const sesion = 'mediaSession' in navigator ? navigator.mediaSession : null;
  if (sesion) {
    const acciones = {
      play: () => { if (lector.estado !== 'leyendo') alternarLectura(); },
      pause: () => lector.pausar(),
      stop: () => lector.detener(),
      previoustrack: () => lector.saltar(-1),
      nexttrack: () => lector.saltar(1),
    };
    for (const [accion, hacer] of Object.entries(acciones)) {
      try {
        sesion.setActionHandler(accion, hacer);
      } catch (e) { /* acción no admitida en este navegador */ }
    }
  }

  let fraseEnSesion = -1;
  function actualizarSesionMultimedia(estado, indice, total) {
    if (!sesion) return;
    sesion.playbackState = estado === 'leyendo' ? 'playing' : estado === 'pausado' ? 'paused' : 'none';
    const fragmento = estado !== 'detenido' && lector.fragmentos[indice];
    if (!fragmento || indice === fraseEnSesion) return;
    fraseEnSesion = indice;
    const titulo = fragmento.texto.length > 90 ? fragmento.texto.slice(0, 89) + '…' : fragmento.texto;
    sesion.metadata = new MediaMetadata({
      title: titulo,
      artist: 'Orador de Textos',
      album: `Oración ${indice + 1} de ${total}`,
      artwork: [
        { src: 'iconos/icono-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'iconos/icono-512.png', sizes: '512x512', type: 'image/png' },
      ],
    });
  }

  lector.alCambiar = ({ estado, indice, total, completo, esperando, preparandoVoz, terminado }) => {
    const activo = estado !== 'detenido';
    const hayFrase = activo && indice < total;
    // Con voces descargables no hace falta: siguen sonando con la pantalla apagada.
    const necesitaPantalla = estado === 'leyendo' && !(lector.voz && lector.voz.descargable);
    if (necesitaPantalla !== quierePantalla) pantallaEncendida(necesitaPantalla);
    actualizarSesionMultimedia(estado, indice, total);

    frases.forEach((frase, i) => {
      frase.classList.toggle('actual', hayFrase && i === indice);
      frase.classList.toggle('leida', activo && i < indice);
    });
    if (hayFrase && frases[indice] && indice !== fraseVisible) asegurarVisible(frases[indice]);
    fraseVisible = hayFrase ? indice : -1;

    // En textos traducidos se marca también el párrafo original que se está leyendo.
    const parrafoActual = hayFrase ? lector.fragmentos[indice].parrafo : -1;
    if (documento) documento.bloques.forEach(({ bloque }, i) => bloque.classList.toggle('actual', i === parrafoActual));

    const leyendo = estado === 'leyendo';
    ui.reproductor.dataset.estado = estado;
    ui.reproducir.setAttribute('aria-label', leyendo ? 'Pausar' : 'Reproducir');
    ui.reproducir.title = (leyendo ? 'Pausar' : 'Reproducir') + ' (Ctrl+Enter)';
    ui.anterior.disabled = ui.siguiente.disabled = !(activo && total);
    ui.detener.disabled = !activo;

    const posicion = total ? ` · ${Math.min(indice + 1, total)} de ${total}${completo ? '' : '…'}` : '';
    ui.barra.style.width = (terminado ? 100 : activo && total ? (Math.min(indice + 1, total) / total) * 100 : 0).toFixed(2) + '%';
    ui.estado.textContent =
      leyendo && esperando ? 'Esperando la traducción…'
      : leyendo && preparandoVoz ? 'Preparando la voz…'
      : leyendo ? `Leyendo${posicion}`
      : activo ? `En pausa${posicion}`
      : terminado ? 'Lectura terminada'
      : 'Listo para leer';
  };

  const MENSAJES_DE_ERROR = {
    network: 'La voz elegida necesita internet. Revisa tu conexión o elige una de «Otras voces».',
    'voice-unavailable': 'La voz elegida no está disponible. Elige otra en la lista.',
    'not-allowed': 'El navegador bloqueó el audio. Pulsa el botón de reproducir otra vez.',
    audio: 'No se pudo generar la voz. Revisa tu conexión (la primera vez se descarga) o elige otra voz.',
  };
  lector.alError = (codigo) => {
    mostrarAviso('error', MENSAJES_DE_ERROR[codigo] || `No se pudo leer el texto (${codigo}). Prueba con otra voz.`);
  };

  // --- Atajos de teclado ----------------------------------------------------

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      alternarLectura();
      return;
    }
    if (e.key === 'Escape' && lector.estado !== 'detenido') {
      e.preventDefault();
      lector.detener();
      return;
    }
    if (ui.lectura.hidden || e.target.closest('textarea, input, select')) return;
    if (e.key === ' ' && !e.target.closest('button')) {
      e.preventDefault();
      alternarLectura();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      lector.saltar(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      lector.saltar(1);
    }
  });

  // --- Inicio ---------------------------------------------------------------

  // Chrome sigue hablando tras recargar o cerrar la página si no se le pide parar.
  window.addEventListener('pagehide', () => speechSynthesis.cancel());

  lector.detener(); // calla cualquier lectura que haya quedado sonando y deja la interfaz lista

  // Texto compartido desde otra app del celular (menú «Compartir» → Orador).
  const compartido = new URLSearchParams(location.search);
  if (['titulo', 'texto', 'enlace'].some((clave) => compartido.has(clave))) {
    const texto = (compartido.get('texto') || '').trim();
    const enlace = (compartido.get('enlace') || '').trim();
    const titulo = (compartido.get('titulo') || '').trim();
    if (texto && !/^https?:\/\/\S+$/.test(texto)) {
      ui.texto.value = titulo && !texto.startsWith(titulo) ? `${titulo}\n${texto}` : texto;
      almacen.guardar('texto', ui.texto.value);
    } else if (texto || enlace) {
      mostrarAviso('compartido', 'Compartiste un enlace, no un texto. Abre la página, selecciona el texto que quieres escuchar y compártelo con Orador (o pégalo aquí).');
    }
    history.replaceState(null, '', location.pathname); // que al recargar no se vuelva a pegar
  }
  actualizarContador();

  // Instalar como app y abrir sin conexión (solo cuando la página está publicada,
  // no al abrirla con doble clic).
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Qué voces descargables ya están en el equipo (para mostrarlo en la lista).
  if (descargables.length) {
    VocesDescargables.guardadas().then((ids) => {
      vocesGuardadas = new Set(ids);
      actualizarEtiquetasDescargables();
    });
  }

  // Las voces llegan de forma asíncrona; si tras unos segundos no hay ninguna, se avisa.
  cargarVoces(false);
  speechSynthesis.addEventListener('voiceschanged', () => cargarVoces(true));
  setTimeout(() => {
    if (!voces.length) cargarVoces(true);
  }, 2000);
})();
