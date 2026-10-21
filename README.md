# Orador de Textos

Asistente que lee textos en voz alta en español. Si el texto está en otro idioma, primero lo traduce al español y luego lee la traducción. Funciona en el navegador, sin instalar nada.

## Cómo usarlo

1. Abre `index.html` con doble clic. Se recomienda **Microsoft Edge** actualizado: trae voces naturales en español (requieren internet) y traduce dentro de tu equipo, sin límite.
2. Pega o escribe el texto, o abre un documento (ver abajo). Elige la voz y la velocidad.
3. Pulsa ▶. Si el texto no está en español, se traduce y la lectura empieza en cuanto está listo el primer párrafo. La oración que se está leyendo se resalta.
4. Haz clic en cualquier oración para leer desde ahí.

**Atajos:** `Ctrl+Enter` leer o pausar · `Esc` detener · `←` `→` oración anterior o siguiente · `Espacio` pausar (en modo lectura).

La página recuerda la voz, la velocidad y el último texto en este navegador.

**¿No aparecen voces en español?** En Windows: Configuración → Hora e idioma → Voz → Agregar voces → Español. Luego vuelve a abrir la página.

## En el celular (Android)

La página funciona como **app instalable** (PWA) cuando está publicada en internet con https (por ejemplo, en GitHub Pages):

1. Abre la dirección en **Chrome** del celular.
2. Menú ⋮ → **Instalar app** (o «Agregar a la pantalla principal»). Aparece el ícono de Orador y se abre a pantalla completa, como cualquier app.

En el celular:
- **Tomar foto** abre la cámara para fotografiar una página y escucharla (se reconoce el texto con OCR).
- **Compartir:** con la app instalada, en cualquier app puedes seleccionar un texto, tocar *Compartir* y elegir **Orador**: el texto llega listo para leer.
- **Con la pantalla bloqueada:** elige en «Voz» una de las **voces descargables**. Con ellas la lectura sigue aunque bloquees el teléfono o cambies de app, y en la pantalla de bloqueo aparecen los controles (pausa, oración anterior y siguiente). Ver «Voces descargables».
- **Pantalla encendida:** con las voces del sistema, mientras lee, la pantalla no se apaga sola, porque Chrome corta esas voces al bloquear la pantalla.
- **Voces:** usa las voces de Android. Si no aparece ninguna en español: Ajustes → Sistema → Idiomas → Salida de texto a voz → motor de Google → instalar datos de voz en español.
- **Traducción:** si Chrome del celular no trae traductor propio, se usa MyMemory (en línea, 5000 caracteres al día).
- **Sin conexión:** después del primer uso, la app abre sin internet. Los lectores de PDF y de fotos se guardan la primera vez que se usan.

Archivos de la app instalable: `manifest.webmanifest`, `sw.js` (service worker) e `iconos/`. Al abrir la página con doble clic en la computadora no se usan y todo funciona igual.

## Voces descargables

Además de las voces del sistema, en «Voz» hay **voces descargables**: voces neuronales ([Piper](https://github.com/rhasspy/piper), con [vits-web](https://github.com/diffusionstudio/vits-web)) que generan el audio dentro del navegador. Como suenan como cualquier audio, **siguen sonando con la pantalla bloqueada**.

| Voz | Acento | Tamaño |
|---|---|---|
| Claude | México (alta calidad) | 63 MB |
| Ald | México | 63 MB |
| Davefx | España | 63 MB |
| Sharvard | España | 77 MB |

- Cada voz se descarga **una sola vez** al elegirla (mejor con wifi) y queda guardada; después funciona sin internet.
- El audio se genera unas oraciones por adelantado mientras suena la actual. Al empezar, o al saltar a otra parte, la primera oración tarda unos segundos («Preparando la voz…»).
- En un celular modesto, generar puede ir más lento que la lectura y dejar pequeños silencios entre oraciones.
- Solo están con la página publicada (https). Al abrirla con doble clic no aparecen.
- Cuántas oraciones se generan por adelantado se cambia en `ADELANTO`, dentro de `js/lector.js`.

## Abrir documentos

Pulsa **Abrir archivo** o arrastra el archivo a la página. El texto aparece en el cuadro, listo para leer (y para corregir, si hace falta), y una línea resume lo que se hizo.

| Formato | Qué se limpia |
|---|---|
| **PDF** | Quita los encabezados y pies de página que se repiten en las páginas y los números de página. Une las líneas en párrafos, repara las palabras cortadas con guion y junta los párrafos que siguen en la página siguiente. |
| **Word (.docx)** | Lee solo el texto principal: los encabezados, pies de página, notas al pie y el texto borrado con control de cambios quedan fuera. |
| **Texto (.txt)** | Quita las líneas que solo tienen un número de página. Reconoce archivos antiguos de Windows con tildes. |
| **PDF escaneado y fotos (JPG, PNG)** | Reconoce el texto de la imagen (OCR) y luego lo limpia igual que un PDF. Ver «Escaneos y fotos de páginas». |

Al leer cualquier texto, también el pegado, se saltan las líneas que solo son un número de página («12», «- 12 -», «Página 3 de 10») y las citas entre corchetes como «[3]».

## Tablas

Las tablas de un documento de Word (.docx) se leen **fila por fila, de izquierda a derecha**, con una **pausa de 0,425 segundos entre columnas**. En el cuadro de lectura, las columnas de una fila se ven separadas por una barra vertical. La pausa se cambia en `PAUSA_COLUMNA`, dentro de `js/lector.js`.

- Cada celda se lee por separado, así que no se mezclan con la fila de arriba o de abajo.
- Un texto pegado desde Word o Excel también funciona: sus celdas llegan separadas por tabuladores.
- En un PDF no se puede saber dónde empieza cada columna, así que las tablas se leen como texto corrido. Para documentos con tablas conviene abrir el .docx.
- En Word se omite el texto en letra de ancho fijo (Consolas, Courier y parecidas), que suele ser código y no se entiende en voz alta. Para leerlo igual, cambia `OMITIR_CODIGO` a `false` en `js/archivos.js`.

Notas:
- Para abrir PDF hace falta internet la primera vez: se descarga el lector de PDF ([pdf.js](https://mozilla.github.io/pdf.js/), de Mozilla). Word y .txt funcionan sin conexión.
- Los `.doc` antiguos no se pueden leer: guárdalos como `.docx` o PDF.

## Escaneos y fotos de páginas

Los PDF escaneados (páginas que son imágenes, sin texto seleccionable) y las fotos de páginas pasan por el **reconocimiento de texto (OCR)** de [Tesseract.js](https://tesseract.projectnaptha.com/).

- **Fotos:** se pueden abrir o arrastrar **varias a la vez**; se leen en el orden de sus nombres («página 2» va antes que «página 10»).
- **PDF mezclados:** solo pasan por el OCR las páginas que no tienen texto; el resto se lee directamente.
- **Limpieza:** al reconocer varias páginas se quitan los encabezados y pies que se repiten y los números de página, igual que en un PDF normal. Con una sola foto solo se quitan los números de página, porque no hay repeticiones que comparar.
- **Idioma:** con «Detectar automáticamente» se reconoce en español e inglés, y si la primera página está en otro idioma (francés, portugués, italiano, alemán…) se cambia a ese idioma. Para ruso, chino, japonés, coreano o árabe, **elige el idioma antes de abrir el archivo**.
- **Avance y cancelación:** se muestra la página que se está reconociendo. **Cancelar** detiene el proceso y conserva el texto de las páginas ya reconocidas.
- **Calidad:** el resumen avisa si la imagen no es muy nítida. El texto queda en el cuadro para corregirlo antes de escucharlo. Funciona mejor con fotos derechas, bien iluminadas y enfocadas.
- La primera vez hace falta internet: se descargan el reconocedor y el modelo del idioma (unos pocos MB, que el navegador guarda para la próxima vez).

## Textos en otros idiomas

- **Idioma del texto:** por defecto se detecta solo, párrafo por párrafo, así que un texto que mezcla idiomas también funciona. Si la detección falla, elige el idioma a mano; con «Español (no traducir)» se lee tal cual.
- **Original al lado:** en la lectura se ve la traducción y, al lado, el original. El párrafo que se está leyendo se marca en ambos. «Ocultar original» lo esconde.
- **Cómo se traduce:**
  - **En tu equipo** (Edge 148 o posterior, Chrome 138 o posterior): el navegador usa su propio traductor. Es gratis, no tiene límite y el texto no sale de tu computadora. La primera vez que se usa un idioma, el navegador descarga ese traductor y se muestra el avance.
  - **En línea con [MyMemory](https://mymemory.translated.net/)**, si el navegador no trae traductor: es gratis hasta 5000 caracteres al día, y el texto se envía a ese servicio. La página siempre indica cuál de los dos se está usando.

## Cómo está hecho

| Archivo | Qué hace |
|---|---|
| `index.html` | Estructura de la página |
| `css/estilos.css` | Diseño (tema claro y oscuro automáticos) |
| `js/lector.js` | Motor de lectura: limpia el texto, lo divide en oraciones y lo lee con la Web Speech API del navegador. Acepta texto que va llegando por partes |
| `js/traductor.js` | Detecta el idioma y traduce al español (traductor del navegador o MyMemory) |
| `js/archivos.js` | Abre PDF (con pdf.js), Word (lee el .zip y su XML directamente), .txt y fotos, y quita encabezados, pies y números de página |
| `js/ocr.js` | Reconocimiento de texto en imágenes con Tesseract.js, incluido el cambio automático de idioma |
| `js/voces-descargables.js` | Voces neuronales que generan audio en el navegador (siguen con la pantalla bloqueada) |
| `manifest.webmanifest`, `sw.js`, `iconos/` | App instalable en el celular: nombre e íconos, recibir textos compartidos y abrir sin conexión |
| `js/app.js` | Interfaz: conecta botones, voces, idioma, traducción y resaltado |

El texto se lee **una oración a la vez**: así se puede resaltar, saltar adelante o atrás, y se evita que algunas voces se corten con textos largos. Al pegar texto copiado de un PDF se unen las líneas cortadas y las palabras partidas con guion.

Si el navegador no trae detector de idioma, se usa uno propio que reconoce español, inglés, francés, portugués, italiano, alemán, catalán y neerlandés por sus palabras más frecuentes, y ruso, chino, japonés, coreano, árabe, griego, hebreo, hindi y tailandés por su alfabeto.

`.claude/launch.json` solo sirve para probar la página con un servidor local (`python -m http.server`); para usarla basta el doble clic.

## Hoja de ruta

- [x] **Fase 1 — Leer texto en español.** Pegar texto, elegir voz y velocidad, reproducir, pausar, saltar oraciones, resaltar lo que se lee.
- [x] **Fase 2 — Textos en otros idiomas.** Detectar el idioma y, si no es español, **traducirlo al español y leer la traducción** (decisión tomada: "que suene en español" significa traducir, no leer el original con acento español). Original y traducción lado a lado.
- [x] **Fase 3 — Documentos.** Abrir PDF, Word y .txt (botón o arrastrar); quitar encabezados, pies de página, números de página y citas entre corchetes.
- [x] **Fase 4 — Escaneos e imágenes.** Reconocimiento de texto (OCR) para PDF escaneados y fotos de páginas, con varias fotos a la vez, avance y cancelación.
- [ ] **Fase 5 (opcional) — Voces premium y MP3.** Voces de pago (Azure, Google, OpenAI, ElevenLabs) o un motor local (Piper), y descarga de la lectura en audio. Requiere un pequeño servidor, porque las voces del navegador no se pueden grabar en un archivo.
