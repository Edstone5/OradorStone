/*
 * Orador de Textos — abrir documentos.
 *
 * Saca el texto de archivos PDF, Word (.docx), de texto (.txt) y de fotos de
 * páginas, y quita lo que no conviene leer en voz alta: encabezados y pies de
 * página que se repiten en cada página, y números de página.
 *
 * Los PDF se leen con pdf.js (Mozilla), que se descarga la primera vez que se
 * abre uno. Las páginas escaneadas y las fotos pasan por el reconocimiento de
 * texto (js/ocr.js). Word y texto se leen sin nada externo.
 */
(function () {
  'use strict';

  const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/';

  class ErrorDeArchivo extends Error {}

  const extension = (nombre) => ((nombre.match(/\.([^.]+)$/) || [])[1] || '').toLowerCase();
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

  // "se quitó 1 número de página" / "se quitaron 3 encabezados y 2 números de página"
  function seQuito(cuentas) {
    const partes = cuentas.filter(([n]) => n > 0);
    if (!partes.length) return '';
    const verbo = partes.length === 1 && partes[0][0] === 1 ? 'se quitó' : 'se quitaron';
    return `${verbo} ${partes.map(([n, uno, varios]) => plural(n, uno, varios)).join(' y ')}`;
  }

  const IMAGENES = ['jpg', 'jpeg', 'png', 'webp', 'bmp'];
  const esImagen = (archivo) => IMAGENES.includes(extension(archivo.name)) || /^image\/(jpeg|png|webp|bmp)$/.test(archivo.type);

  // Abre uno o varios archivos (varios solo si son fotos de páginas, que se
  // leen en el orden de sus nombres). Devuelve { texto, detalles }, donde
  // `detalles` resume lo que se hizo. Opciones:
  //   idioma      idioma del texto ('auto', 'es', 'en'…), para el reconocimiento de texto
  //   alAvanzar   recibe mensajes de avance ("página 3 de 10")
  //   senal       AbortSignal para cancelar; se devuelve lo leído hasta entonces
  async function abrir(archivos, opciones = {}) {
    const lista = Array.from(archivos);
    if (lista.length > 1) {
      if (!lista.every(esImagen)) {
        throw new ErrorDeArchivo('Abre los documentos de uno en uno. Solo se pueden abrir varios a la vez si son fotos de páginas.');
      }
      return abrirImagenes(lista.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true })), opciones);
    }
    const [archivo] = lista;
    const tipo = extension(archivo.name);
    if (tipo === 'pdf' || archivo.type === 'application/pdf') return abrirPdf(archivo, opciones);
    if (esImagen(archivo)) return abrirImagenes([archivo], opciones);
    if (tipo === 'docx') return abrirDocx(archivo);
    if (tipo === 'txt' || tipo === 'md' || archivo.type.startsWith('text/')) return abrirTexto(archivo);
    if (tipo === 'doc') {
      throw new ErrorDeArchivo('Los archivos .doc (Word antiguo) no se pueden leer. Ábrelo en Word y guárdalo como .docx o como PDF.');
    }
    throw new ErrorDeArchivo(`No puedo abrir archivos «.${tipo || '?'}». Puedo leer PDF, Word (.docx), texto (.txt) y fotos (JPG o PNG).`);
  }

  // Une dos trozos de texto, reparando palabras cortadas con guion al final de línea.
  function unir(antes, despues) {
    if (!antes) return despues;
    if (/\p{L}-$/u.test(antes) && /^\p{Ll}/u.test(despues)) return antes.slice(0, -1) + despues;
    return `${antes} ${despues}`;
  }

  // ---------------------------------------------------------------------------
  // Texto

  async function abrirTexto(archivo) {
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    let texto;
    if (bytes[0] === 0xff && bytes[1] === 0xfe) texto = new TextDecoder('utf-16le').decode(bytes);
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) texto = new TextDecoder('utf-16be').decode(bytes);
    else {
      try {
        texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch (e) {
        texto = new TextDecoder('windows-1252').decode(bytes); // archivos antiguos de Windows
      }
    }
    const lineas = texto.replace(/^﻿/, '').split(/\r\n?|\n/);
    const quedan = lineas.filter((linea) => !Orador.esNumeroDePagina(linea));
    return {
      texto: quedan.join('\n'),
      detalles: seQuito([[lineas.length - quedan.length, 'número de página', 'números de página']]),
    };
  }

  // ---------------------------------------------------------------------------
  // Word (.docx): es un .zip con el texto en XML. Los encabezados, pies de
  // página y notas al pie están en otras partes del archivo, así que no se leen.

  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

  async function abrirDocx(archivo) {
    let xml;
    try {
      const zip = await archivo.arrayBuffer();
      xml = await leerDeZip(zip, await rutaDelDocumento(zip));
    } catch (e) {
      throw new ErrorDeArchivo('No pude leer el archivo de Word; puede estar dañado.');
    }
    const doc = new DOMParser().parseFromString(xml || '', 'application/xml');
    if (!xml || doc.getElementsByTagName('parsererror').length) {
      throw new ErrorDeArchivo('No pude leer el archivo de Word; puede estar dañado.');
    }

    // Las tablas se leen fila por fila, de izquierda a derecha: las celdas de una
    // fila quedan separadas por un tabulador y el lector hace una pausa entre ellas.
    const parrafos = [];
    for (const el of doc.getElementsByTagNameNS(W, '*')) {
      if (el.localName === 'p') {
        if (ancestro(el, (a) => a.localName === 'tc')) continue; // lo lee la fila de su tabla
        const texto = textoDeParrafo(el);
        if (texto) parrafos.push(texto);
      } else if (el.localName === 'tr') {
        if (ancestro(el, (a) => a.localName === 'tc')) continue; // tabla anidada: la lee la celda que la contiene
        const celdas = [];
        for (const celda of el.childNodes) {
          if (celda.nodeType !== 1 || celda.localName !== 'tc') continue;
          const texto = Array.from(celda.getElementsByTagNameNS(W, 'p'), textoDeParrafo)
            .filter(Boolean).join(' ').replace(/\s*\n\s*/g, ' ').trim();
          if (texto) celdas.push(texto);
        }
        if (celdas.length) parrafos.push(celdas.join('\t'));
      }
    }
    return {
      texto: parrafos.join('\n'),
      detalles: 'sin encabezados, pies de página ni notas al pie' + (OMITIR_CODIGO ? ' ni código en letra de ancho fijo' : ''),
    };
  }

  // Letras de ancho fijo que se usan para código: leerlas en voz alta no sirve de nada.
  // Para leerlas igual, basta cambiar OMITIR_CODIGO a false.
  const FUENTE_DE_CODIGO = /^(consolas|courier|lucida console|cascadia|menlo|monaco|fira code|source code|jetbrains mono)/i;
  const OMITIR_CODIGO = true;

  function esCodigo(corrida) {
    if (!OMITIR_CODIGO) return false;
    const fuentes = corrida.getElementsByTagNameNS(W, 'rFonts')[0];
    const nombre = fuentes && (fuentes.getAttributeNS(W, 'ascii') || fuentes.getAttributeNS(W, 'hAnsi'));
    return !!nombre && FUENTE_DE_CODIGO.test(nombre);
  }

  // Texto de un párrafo de Word, sin el de párrafos anidados ni el de copias alternativas de cuadros de texto.
  function textoDeParrafo(p) {
    if (ancestro(p, (el) => el.localName === 'Fallback')) return '';
    let texto = '';
    for (const el of p.getElementsByTagNameNS(W, '*')) {
      if (ancestro(el, (a) => a.localName === 'p' && a.namespaceURI === W) !== p) continue; // de un párrafo anidado
      const enTexto = el.parentNode.localName === 'r';
      if (enTexto && esCodigo(el.parentNode)) continue;
      if (el.localName === 't') texto += el.textContent;
      else if (el.localName === 'tab' && enTexto) texto += ' ';
      else if ((el.localName === 'br' || el.localName === 'cr') && enTexto) texto += '\n';
      else if (el.localName === 'noBreakHyphen') texto += '-';
    }
    return texto.trim();
  }

  function ancestro(el, condicion) {
    for (let a = el.parentNode; a && a.nodeType === 1; a = a.parentNode) {
      if (condicion(a)) return a;
    }
    return null;
  }

  // El texto principal suele estar en word/document.xml, pero el índice del paquete lo confirma.
  async function rutaDelDocumento(zip) {
    const relaciones = await leerDeZip(zip, '_rels/.rels');
    const destino = relaciones && /Type="[^"]*\/officeDocument"[^>]*Target="\/?([^"]+)"|Target="\/?([^"]+)"[^>]*Type="[^"]*\/officeDocument"/.exec(relaciones);
    return destino ? destino[1] || destino[2] : 'word/document.xml';
  }

  // Lee un archivo dentro de un .zip y devuelve su texto, o null si no está.
  async function leerDeZip(buffer, ruta) {
    const vista = new DataView(buffer);
    let fin = -1; // registro de fin del directorio central, buscado desde el final
    for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
      if (vista.getUint32(i, true) === 0x06054b50) {
        fin = i;
        break;
      }
    }
    if (fin < 0) throw new Error('No es un archivo zip');

    const decodificador = new TextDecoder();
    const entradas = vista.getUint16(fin + 10, true);
    let pos = vista.getUint32(fin + 16, true);
    for (let n = 0; n < entradas; n++) {
      if (vista.getUint32(pos, true) !== 0x02014b50) throw new Error('Zip dañado');
      const metodo = vista.getUint16(pos + 10, true);
      const tamano = vista.getUint32(pos + 20, true);
      const largoNombre = vista.getUint16(pos + 28, true);
      const largoExtra = vista.getUint16(pos + 30, true);
      const largoComentario = vista.getUint16(pos + 32, true);
      const local = vista.getUint32(pos + 42, true);
      const nombre = decodificador.decode(new Uint8Array(buffer, pos + 46, largoNombre));
      if (nombre === ruta) {
        const inicio = local + 30 + vista.getUint16(local + 26, true) + vista.getUint16(local + 28, true);
        const datos = new Uint8Array(buffer, inicio, tamano);
        if (metodo === 0) return decodificador.decode(datos);
        if (metodo !== 8) throw new Error('Compresión no admitida');
        const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Response(flujo).text();
      }
      pos += 46 + largoNombre + largoExtra + largoComentario;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // PDF

  let pdfjs = null;

  function cargarPdfJs() {
    if (!pdfjs) {
      pdfjs = import(PDFJS + 'build/pdf.min.mjs').then((modulo) => {
        modulo.GlobalWorkerOptions.workerSrc = PDFJS + 'build/pdf.worker.min.mjs';
        return modulo;
      }, () => {
        pdfjs = null;
        throw new ErrorDeArchivo('Para abrir archivos PDF hace falta conexión a internet (se descarga el lector de PDF).');
      });
    }
    return pdfjs;
  }

  async function abrirPdf(archivo, { idioma = 'auto', alAvanzar = () => {}, senal } = {}) {
    const lib = await cargarPdfJs();
    let doc;
    try {
      doc = await lib.getDocument({
        data: new Uint8Array(await archivo.arrayBuffer()),
        isEvalSupported: false,
        cMapUrl: PDFJS + 'cmaps/',
        cMapPacked: true,
        standardFontDataUrl: PDFJS + 'standard_fonts/',
      }).promise;
    } catch (e) {
      if (e.name === 'PasswordException') throw new ErrorDeArchivo('El PDF está protegido con contraseña.');
      throw new ErrorDeArchivo('No pude abrir el PDF; puede estar dañado.');
    }

    // Las páginas sin texto pero con imágenes (escaneadas) pasan por el OCR,
    // que solo se prepara si hace falta.
    const total = doc.numPages;
    const paginas = [];
    const confianzas = [];
    let ocr = null;

    async function leerPagina(n) {
      const pagina = await doc.getPage(n);
      const [, abajo, , arriba] = pagina.view;
      let hoja = { lineas: lineasDePagina(await pagina.getTextContent()), abajo, arriba };
      if (letrasDe(hoja.lineas) < 20 && await tieneDibujo(pagina, lib)) {
        ocr = ocr || await Orador.OCR.crear(idioma, { alAvanzar, senal });
        const { lienzo, escala } = await dibujarPagina(pagina);
        const resultado = await ocr.reconocer(lienzo, `la página ${n} de ${total}`);
        hoja = paginaDeOcr(resultado.lineas, lienzo.height, escala);
        confianzas.push(resultado.confianza);
      }
      pagina.cleanup();
      return hoja;
    }

    try {
      for (let n = 1; n <= total && !(senal && senal.aborted); n++) {
        alAvanzar(`página ${n} de ${total}…`);
        paginas.push(await hastaCancelar(leerPagina(n), senal));
      }
    } catch (e) {
      if (!(senal && senal.aborted)) throw e; // al cancelar se devuelve lo leído hasta entonces
    } finally {
      if (ocr) ocr.terminar();
      doc.destroy();
    }

    return armarResultado(paginas, {
      total,
      unidad: ['página', 'páginas'],
      conOcr: confianzas,
    });
  }

  const letrasDe = (lineas) => lineas.reduce((suma, l) => suma + l.texto.length, 0);

  // Rechaza en cuanto se cancela, aunque `promesa` siga pendiente (lo que quede
  // a medias se descarta y se libera al cerrar el documento o el OCR).
  function hastaCancelar(promesa, senal) {
    if (!senal) return promesa;
    return new Promise((resolver, rechazar) => {
      const alCancelar = () => rechazar(new ErrorDeArchivo('Se canceló la apertura del archivo.'));
      if (senal.aborted) {
        alCancelar();
        return;
      }
      senal.addEventListener('abort', alCancelar, { once: true });
      promesa.then(resolver, rechazar).finally(() => senal.removeEventListener('abort', alCancelar));
    });
  }

  // ¿La página dibuja algo (imágenes o muchos trazos) que podría ser texto escaneado?
  async function tieneDibujo(pagina, lib) {
    const { OPS } = lib;
    const deImagen = new Set([
      OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat,
      OPS.paintImageMaskXObject, OPS.paintImageMaskXObjectGroup, OPS.paintImageMaskXObjectRepeat,
      OPS.paintInlineImageXObjectGroup,
    ]);
    const { fnArray } = await pagina.getOperatorList();
    let trazos = 0;
    for (const operacion of fnArray) {
      if (deImagen.has(operacion)) return true;
      if (operacion === OPS.constructPath && ++trazos > 100) return true; // texto convertido en trazos
    }
    return false;
  }

  // Dibuja una página en un lienzo de unos 2000 px de ancho, buena resolución para el OCR.
  async function dibujarPagina(pagina) {
    const escala = Math.min(3, 2000 / pagina.getViewport({ scale: 1 }).width);
    const viewport = pagina.getViewport({ scale: escala });
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.ceil(viewport.width);
    lienzo.height = Math.ceil(viewport.height);
    const contexto = lienzo.getContext('2d');
    contexto.fillStyle = '#fff';
    contexto.fillRect(0, 0, lienzo.width, lienzo.height);
    // Con intent 'print', pdf.js no espera a los fotogramas de la pantalla, que
    // el navegador pausa si la pestaña no está a la vista: así el OCR sigue
    // avanzando aunque la persona cambie de pestaña.
    await pagina.render({ canvasContext: contexto, viewport, intent: 'print' }).promise;
    return { lienzo, escala };
  }

  // ---------------------------------------------------------------------------
  // Fotos de páginas

  async function abrirImagenes(archivos, { idioma = 'auto', alAvanzar = () => {}, senal } = {}) {
    const ocr = await Orador.OCR.crear(idioma, { alAvanzar, senal });
    const paginas = [];
    const confianzas = [];
    try {
      for (let i = 0; i < archivos.length && !(senal && senal.aborted); i++) {
        const lienzo = await imagenEnLienzo(archivos[i]);
        const descripcion = archivos.length > 1 ? `la foto ${i + 1} de ${archivos.length}` : 'la imagen';
        const resultado = await ocr.reconocer(lienzo, descripcion);
        paginas.push(paginaDeOcr(resultado.lineas, lienzo.height, 1));
        confianzas.push(resultado.confianza);
      }
    } catch (e) {
      if (!(senal && senal.aborted)) throw e;
    } finally {
      ocr.terminar();
    }
    return armarResultado(paginas, {
      total: archivos.length,
      unidad: archivos.length > 1 ? ['foto', 'fotos'] : ['imagen', 'imágenes'],
      conOcr: confianzas,
    });
  }

  // Pasa la imagen a un lienzo (así se respeta la orientación de las fotos del
  // celular) con un tamaño cómodo para el OCR: ni diminuta ni enorme.
  async function imagenEnLienzo(archivo) {
    let mapa;
    try {
      mapa = await createImageBitmap(archivo);
    } catch (e) {
      throw new ErrorDeArchivo(`No pude abrir la imagen «${archivo.name}». Prueba con una foto en JPG o PNG.`);
    }
    const lado = Math.max(mapa.width, mapa.height);
    const escala = lado < 2000 ? Math.min(2, 2000 / lado) : Math.min(1, 3500 / lado);
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(mapa.width * escala);
    lienzo.height = Math.round(mapa.height * escala);
    const contexto = lienzo.getContext('2d');
    contexto.fillStyle = '#fff';
    contexto.fillRect(0, 0, lienzo.width, lienzo.height);
    contexto.drawImage(mapa, 0, 0, lienzo.width, lienzo.height);
    mapa.close();
    return lienzo;
  }

  // Convierte las líneas del OCR (en píxeles, con la y hacia abajo) en una
  // página como las del PDF (y hacia arriba), para limpiarla igual.
  function paginaDeOcr(lineasOcr, altoEnPixeles, escala) {
    const habitual = mediana(lineasOcr.map((l) => l.y1 - l.y0)) || 1;
    const lineas = lineasOcr.map((l) => {
      const alto = l.y1 - l.y0;
      return {
        texto: l.texto,
        x: l.x0 / escala,
        finX: l.x1 / escala,
        y: (altoEnPixeles - l.base) / escala,
        // Las letras con rabito (g, p, y) cambian el alto de cada línea: se usa
        // el alto habitual, salvo en líneas claramente más grandes (títulos).
        tamano: ((alto > habitual * 1.5 ? alto : habitual) / escala) * 0.75,
      };
    });
    return { lineas, abajo: 0, arriba: altoEnPixeles / escala };
  }

  // Limpia las páginas, las une en párrafos y resume lo que se hizo.
  function armarResultado(paginas, { total, unidad: [una, varias], conOcr }) {
    if (!paginas.length) throw new ErrorDeArchivo('Se canceló la apertura del archivo.');

    const { encabezados, numeros } = quitarEncabezadosYPies(paginas);
    const texto = unirPaginas(paginas).join('\n');
    if (!texto.trim()) {
      throw new ErrorDeArchivo(conOcr.length
        ? 'No encontré texto en el archivo. Si la imagen está borrosa o torcida, prueba con una foto más nítida y derecha.'
        : 'No encontré texto en el archivo.');
    }

    const detalles = [paginas.length < total
      ? `${paginas.length} de ${plural(total, una, varias)} (se canceló el resto)`
      : plural(total, una, varias)];
    if (conOcr.length) {
      const promedio = conOcr.reduce((a, b) => a + b, 0) / conOcr.length;
      detalles.push(conOcr.length === paginas.length || una !== 'página'
        ? 'texto reconocido con OCR'
        : `texto reconocido con OCR en ${plural(conOcr.length, 'página', 'páginas')}`);
      if (promedio < 70) detalles.push('la imagen no es muy nítida: revisa el texto, puede tener errores');
    }
    detalles.push(seQuito([
      [encabezados, 'encabezado o pie de página', 'encabezados o pies de página'],
      [numeros, 'número de página', 'números de página'],
    ]));
    return { texto, detalles: detalles.filter(Boolean).join(' · ') };
  }

  // Agrupa los trozos de texto de una página en líneas: { texto, x, y, finX, tamano }.
  function lineasDePagina(contenido) {
    const lineas = [];
    let actual = null;
    const cerrar = () => {
      if (actual) {
        actual.texto = actual.texto.replace(/\s+/g, ' ').trim();
        if (actual.texto) lineas.push(actual);
      }
      actual = null;
    };
    for (const item of contenido.items) {
      if (typeof item.str !== 'string') continue; // marcas de contenido, sin texto
      if (item.str) {
        const [a, b, c, d, x, y] = item.transform;
        const tamano = Math.hypot(c, d) || Math.hypot(a, b) || 10;
        if (actual && Math.abs(y - actual.y) < tamano * 0.6) {
          if (x - actual.finX > tamano * 0.2 && !/\s$/.test(actual.texto) && !/^\s/.test(item.str)) actual.texto += ' ';
          actual.texto += item.str;
          actual.finX = Math.max(actual.finX, x + item.width);
        } else {
          cerrar();
          actual = { texto: item.str, x, y, finX: x + item.width, tamano };
        }
      }
      if (item.hasEOL) cerrar();
    }
    cerrar();
    return lineas;
  }

  const claveDeLinea = (texto) => texto.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, '');
  const esNumeroDePaginaPdf = (texto) => Orador.esNumeroDePagina(texto) || /^[ivxlcdm]{1,7}$/i.test(texto);

  // Quita, cerca del borde superior o inferior de cada página, los números de
  // página y las líneas que se repiten en muchas páginas (encabezados y pies).
  // En la comparación los números no cuentan: "Capítulo 2 · 14" y
  // "Capítulo 2 · 15" se consideran la misma línea.
  function quitarEncabezadosYPies(paginas) {
    const candidatas = paginas.map(({ lineas, abajo, arriba }) => {
      const altura = arriba - abajo || 1;
      const porAltura = [...lineas].sort((l1, l2) => l2.y - l1.y);
      return [...new Set([...porAltura.slice(0, 2), ...porAltura.slice(-2)])].filter((l) => {
        const posicion = (l.y - abajo) / altura;
        return posicion > 0.85 || posicion < 0.15;
      });
    });

    const repeticiones = new Map();
    candidatas.forEach((lista) => {
      new Set(lista.map((l) => claveDeLinea(l.texto))).forEach((clave) => {
        repeticiones.set(clave, (repeticiones.get(clave) || 0) + 1);
      });
    });
    // Con una sola página no hay repeticiones que buscar. Hasta 3 páginas, la
    // línea tiene que estar en todas; desde 4, en al menos el 40 % (así entran
    // los libros que alternan encabezados en páginas pares e impares).
    const n = paginas.length;
    const minimo = n < 2 ? Infinity : n <= 3 ? n : Math.max(3, Math.ceil(n * 0.4));

    let encabezados = 0;
    let numeros = 0;
    paginas.forEach((pagina, i) => {
      const quitar = new Set(candidatas[i].filter((l) => {
        if (esNumeroDePaginaPdf(l.texto)) {
          numeros++;
          return true;
        }
        if (repeticiones.get(claveDeLinea(l.texto)) >= minimo) {
          encabezados++;
          return true;
        }
        return false;
      }));
      pagina.lineas = pagina.lineas.filter((l) => !quitar.has(l));
    });
    return { encabezados, numeros };
  }

  const FIN_DE_ORACION = /[.!?…:;»”")\]]$/;

  function mediana(valores) {
    if (!valores.length) return 0;
    const orden = [...valores].sort((a, b) => a - b);
    return orden[Math.floor(orden.length / 2)];
  }

  // Une las líneas de una página en párrafos. `margenDelDocumento` es el margen
  // derecho habitual, para páginas con pocas líneas (todas cortas).
  function parrafosDePagina(lineas, margenDelDocumento) {
    if (!lineas.length) return [];
    const margenDerecho = Math.max(margenDelDocumento, ...lineas.map((l) => l.finX));
    const saltos = [];
    for (let i = 1; i < lineas.length; i++) {
      const salto = lineas[i - 1].y - lineas[i].y;
      if (salto > 0) saltos.push(salto);
    }
    const interlineado = mediana(saltos) || lineas[0].tamano * 1.2;

    const parrafos = [];
    let actual = lineas[0].texto;
    for (let i = 1; i < lineas.length; i++) {
      const previa = lineas[i - 1];
      const linea = lineas[i];
      const salto = previa.y - linea.y;
      const nuevoParrafo =
        salto <= 0 ||                                                  // sube: otra columna o un bloque aparte
        salto > interlineado * 1.4 ||                                  // espacio extra entre párrafos
        Math.abs(linea.tamano - previa.tamano) > previa.tamano * 0.2 || // cambia el tamaño de letra (títulos)
        (FIN_DE_ORACION.test(previa.texto) && previa.finX < margenDerecho - previa.tamano * 4); // termina antes del margen
      if (nuevoParrafo) {
        parrafos.push(actual);
        actual = linea.texto;
      } else {
        actual = unir(actual, linea.texto);
      }
    }
    parrafos.push(actual);
    return parrafos;
  }

  // Une los párrafos de todas las páginas; un párrafo que sigue en la página
  // siguiente (sin punto final y continuando en minúscula) se junta.
  function unirPaginas(paginas) {
    const margenDelDocumento = mediana(paginas
      .filter((p) => p.lineas.length)
      .map((p) => Math.max(...p.lineas.map((l) => l.finX))));
    const parrafos = [];
    for (const pagina of paginas) {
      const propios = parrafosDePagina(pagina.lineas, margenDelDocumento);
      const ultimo = parrafos.length - 1;
      if (propios.length && ultimo >= 0 && !FIN_DE_ORACION.test(parrafos[ultimo]) && /^\p{Ll}/u.test(propios[0])) {
        parrafos[ultimo] = unir(parrafos[ultimo], propios.shift());
      }
      parrafos.push(...propios);
    }
    return parrafos;
  }

  Orador.Archivos = { abrir, ErrorDeArchivo };
})();
