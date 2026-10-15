# Licencias de las fuentes de Clipo

Todas las fuentes vienen de [Fontsource](https://fontsource.org) (copias de Google Fonts), se
empaquetan con la app y se descargan bajo demanda (solo cuando un texto o el selector las usa).
Clipo incluye únicamente el peso indicado y los subconjuntos **latin** (y **latin-ext** cuando la
familia lo tiene), que cubren español, portugués, francés, italiano y alemán.

- **OFL-1.1** — [SIL Open Font License 1.1](https://openfontlicense.org): uso libre, también
  comercial, incrustada en apps y en videos exportados. No se puede vender la fuente sola; las
  versiones modificadas no pueden usar el nombre reservado de la fuente.
- **Apache-2.0** — [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0): uso libre,
  también comercial; conservar el aviso de licencia (está en el paquete de cada fuente, archivo
  `LICENSE`).

El texto de licencia de cada familia está en `node_modules/@fontsource/<familia>/LICENSE` y se
mantiene con la versión del paquete indicada abajo.

## Verificación

Para cada familia se revisó con fontTools que el archivo `latin` del peso usado contiene
`ñ Ñ á é í ó ú Á É Í Ó Ú ü Ü ¿ ¡`. Todas las de la lista pasan. Se descartó **Butcherman**
(catálogo: Terror / fantasía) porque no tiene el signo «¿».

Del catálogo `font_categories_open_source_examples` no se incluyeron, por ser casi iguales a otras
de la lista: Source Sans 3, Work Sans, Nunito Sans, Public Sans, Josefin Sans, Quicksand,
Questrial, Archivo Narrow, Crimson Text, Tangerine, Cedarville Cursive, Inconsolata, DM Mono,
Source Code Pro, Noto Sans Display y Noto Sans Mono. Todas existen en Fontsource con OFL-1.1 si
se quieren agregar (paquete + `src/fontFiles.ts` + `FONTS` en `src/fonts.ts`).

## Familias incluidas

| Familia | Categoría en Clipo | Peso | Licencia | Paquete | Subconjuntos |
| --- | --- | --- | --- | --- | --- |
| Montserrat | Modernas | 800 | OFL-1.1 | `@fontsource/montserrat` 5.3.0 | latin + latin-ext |
| Poppins | Modernas | 700 | OFL-1.1 | `@fontsource/poppins` 5.3.0 | latin + latin-ext |
| Inter | Modernas | 800 | OFL-1.1 | `@fontsource/inter` 5.3.0 | latin + latin-ext |
| Roboto | Modernas | 700 | OFL-1.1 | `@fontsource/roboto` 5.3.0 | latin + latin-ext |
| Open Sans | Modernas | 800 | OFL-1.1 | `@fontsource/open-sans` 5.3.0 | latin + latin-ext |
| Lato | Modernas | 900 | OFL-1.1 | `@fontsource/lato` 5.3.0 | latin + latin-ext |
| DM Sans | Modernas | 800 | OFL-1.1 | `@fontsource/dm-sans` 5.3.0 | latin + latin-ext |
| Manrope | Modernas | 800 | OFL-1.1 | `@fontsource/manrope` 5.3.0 | latin + latin-ext |
| Rubik | Modernas | 800 | OFL-1.1 | `@fontsource/rubik` 5.3.0 | latin + latin-ext |
| Urbanist | Modernas | 800 | OFL-1.1 | `@fontsource/urbanist` 5.3.0 | latin + latin-ext |
| Outfit | Modernas | 800 | OFL-1.1 | `@fontsource/outfit` 5.3.0 | latin + latin-ext |
| Jost | Modernas | 700 | OFL-1.1 | `@fontsource/jost` 5.3.0 | latin + latin-ext |
| Sora | Modernas | 800 | OFL-1.1 | `@fontsource/sora` 5.3.0 | latin + latin-ext |
| Lexend | Modernas | 700 | OFL-1.1 | `@fontsource/lexend` 5.3.0 | latin + latin-ext |
| Atkinson Hyperlegible | Modernas | 700 | OFL-1.1 | `@fontsource/atkinson-hyperlegible` 5.3.0 | latin + latin-ext |
| Noto Sans | Modernas | 800 | OFL-1.1 | `@fontsource/noto-sans` 5.3.0 | latin + latin-ext |
| Bebas Neue | Condensadas | 400 | OFL-1.1 | `@fontsource/bebas-neue` 5.3.0 | latin + latin-ext |
| Anton | Condensadas | 400 | OFL-1.1 | `@fontsource/anton` 5.3.0 | latin + latin-ext |
| Oswald | Condensadas | 700 | OFL-1.1 | `@fontsource/oswald` 5.3.0 | latin + latin-ext |
| Barlow Condensed | Condensadas | 800 | OFL-1.1 | `@fontsource/barlow-condensed` 5.3.0 | latin + latin-ext |
| Roboto Condensed | Condensadas | 800 | OFL-1.1 | `@fontsource/roboto-condensed` 5.3.0 | latin + latin-ext |
| Teko | Condensadas | 600 | OFL-1.1 | `@fontsource/teko` 5.3.0 | latin + latin-ext |
| Fjalla One | Condensadas | 400 | OFL-1.1 | `@fontsource/fjalla-one` 5.3.0 | latin + latin-ext |
| Saira Condensed | Condensadas | 800 | OFL-1.1 | `@fontsource/saira-condensed` 5.3.0 | latin + latin-ext |
| Playfair Display | Serif | 700 | OFL-1.1 | `@fontsource/playfair-display` 5.3.0 | latin + latin-ext |
| Merriweather | Serif | 900 | OFL-1.1 | `@fontsource/merriweather` 5.3.0 | latin + latin-ext |
| Lora | Serif | 700 | OFL-1.1 | `@fontsource/lora` 5.3.0 | latin + latin-ext |
| Libre Baskerville | Serif | 700 | OFL-1.1 | `@fontsource/libre-baskerville` 5.3.0 | latin + latin-ext |
| Cormorant Garamond | Serif | 700 | OFL-1.1 | `@fontsource/cormorant-garamond` 5.3.0 | latin + latin-ext |
| DM Serif Display | Serif | 400 | OFL-1.1 | `@fontsource/dm-serif-display` 5.3.0 | latin + latin-ext |
| EB Garamond | Serif | 700 | OFL-1.1 | `@fontsource/eb-garamond` 5.3.0 | latin + latin-ext |
| Bodoni Moda | Serif | 700 | OFL-1.1 | `@fontsource/bodoni-moda` 5.3.0 | latin + latin-ext |
| Prata | Serif | 400 | OFL-1.1 | `@fontsource/prata` 5.3.0 | latin |
| Noto Serif | Serif | 700 | OFL-1.1 | `@fontsource/noto-serif` 5.3.0 | latin + latin-ext |
| Dancing Script | Caligrafía | 700 | OFL-1.1 | `@fontsource/dancing-script` 5.3.0 | latin + latin-ext |
| Great Vibes | Caligrafía | 400 | OFL-1.1 | `@fontsource/great-vibes` 5.3.0 | latin + latin-ext |
| Allura | Caligrafía | 400 | OFL-1.1 | `@fontsource/allura` 5.3.0 | latin + latin-ext |
| Sacramento | Caligrafía | 400 | OFL-1.1 | `@fontsource/sacramento` 5.3.0 | latin + latin-ext |
| Parisienne | Caligrafía | 400 | OFL-1.1 | `@fontsource/parisienne` 5.3.0 | latin + latin-ext |
| Alex Brush | Caligrafía | 400 | OFL-1.1 | `@fontsource/alex-brush` 5.3.0 | latin + latin-ext |
| Italianno | Caligrafía | 400 | OFL-1.1 | `@fontsource/italianno` 5.3.0 | latin + latin-ext |
| Pinyon Script | Caligrafía | 400 | OFL-1.1 | `@fontsource/pinyon-script` 5.3.0 | latin + latin-ext |
| Caveat | Manuscritas | 700 | OFL-1.1 | `@fontsource/caveat` 5.3.0 | latin + latin-ext |
| Kalam | Manuscritas | 700 | OFL-1.1 | `@fontsource/kalam` 5.3.0 | latin + latin-ext |
| Patrick Hand | Manuscritas | 400 | OFL-1.1 | `@fontsource/patrick-hand` 5.3.0 | latin + latin-ext |
| Shadows Into Light | Manuscritas | 400 | OFL-1.1 | `@fontsource/shadows-into-light` 5.3.0 | latin + latin-ext |
| Indie Flower | Manuscritas | 400 | OFL-1.1 | `@fontsource/indie-flower` 5.3.0 | latin + latin-ext |
| Permanent Marker | Manuscritas | 400 | Apache-2.0 | `@fontsource/permanent-marker` 5.3.0 | latin |
| Satisfy | Manuscritas | 400 | Apache-2.0 | `@fontsource/satisfy` 5.3.0 | latin |
| Kaushan Script | Manuscritas | 400 | OFL-1.1 | `@fontsource/kaushan-script` 5.3.0 | latin + latin-ext |
| Righteous | Retro | 400 | OFL-1.1 | `@fontsource/righteous` 5.3.0 | latin + latin-ext |
| Lobster | Retro | 400 | OFL-1.1 | `@fontsource/lobster` 5.3.0 | latin + latin-ext |
| Pacifico | Retro | 400 | OFL-1.1 | `@fontsource/pacifico` 5.3.0 | latin + latin-ext |
| Abril Fatface | Retro | 400 | OFL-1.1 | `@fontsource/abril-fatface` 5.3.0 | latin + latin-ext |
| Alfa Slab One | Retro | 400 | OFL-1.1 | `@fontsource/alfa-slab-one` 5.3.0 | latin + latin-ext |
| Limelight | Retro | 400 | OFL-1.1 | `@fontsource/limelight` 5.3.0 | latin + latin-ext |
| Bungee | Retro | 400 | OFL-1.1 | `@fontsource/bungee` 5.3.0 | latin + latin-ext |
| Bowlby One SC | Retro | 400 | OFL-1.1 | `@fontsource/bowlby-one-sc` 5.3.0 | latin + latin-ext |
| Orbitron | Tecnología | 800 | OFL-1.1 | `@fontsource/orbitron` 5.3.0 | latin |
| Rajdhani | Tecnología | 700 | OFL-1.1 | `@fontsource/rajdhani` 5.3.0 | latin + latin-ext |
| Oxanium | Tecnología | 700 | OFL-1.1 | `@fontsource/oxanium` 5.3.0 | latin + latin-ext |
| Audiowide | Tecnología | 400 | OFL-1.1 | `@fontsource/audiowide` 5.3.0 | latin + latin-ext |
| Exo 2 | Tecnología | 800 | OFL-1.1 | `@fontsource/exo-2` 5.3.0 | latin + latin-ext |
| Chakra Petch | Tecnología | 700 | OFL-1.1 | `@fontsource/chakra-petch` 5.3.0 | latin + latin-ext |
| Space Grotesk | Tecnología | 700 | OFL-1.1 | `@fontsource/space-grotesk` 5.3.0 | latin + latin-ext |
| Space Mono | Máquina de escribir | 700 | OFL-1.1 | `@fontsource/space-mono` 5.3.0 | latin + latin-ext |
| JetBrains Mono | Máquina de escribir | 800 | OFL-1.1 | `@fontsource/jetbrains-mono` 5.3.0 | latin + latin-ext |
| IBM Plex Mono | Máquina de escribir | 700 | OFL-1.1 | `@fontsource/ibm-plex-mono` 5.3.0 | latin + latin-ext |
| Roboto Mono | Máquina de escribir | 700 | OFL-1.1 | `@fontsource/roboto-mono` 5.3.0 | latin + latin-ext |
| Special Elite | Máquina de escribir | 400 | Apache-2.0 | `@fontsource/special-elite` 5.3.0 | latin + latin-ext |
| Fredoka | Redondeadas | 700 | OFL-1.1 | `@fontsource/fredoka` 5.3.0 | latin + latin-ext |
| Baloo 2 | Redondeadas | 800 | OFL-1.1 | `@fontsource/baloo-2` 5.3.0 | latin + latin-ext |
| Comfortaa | Redondeadas | 700 | OFL-1.1 | `@fontsource/comfortaa` 5.3.0 | latin + latin-ext |
| Nunito | Redondeadas | 900 | OFL-1.1 | `@fontsource/nunito` 5.3.0 | latin + latin-ext |
| Varela Round | Redondeadas | 400 | OFL-1.1 | `@fontsource/varela-round` 5.3.0 | latin + latin-ext |
| Bubblegum Sans | Redondeadas | 400 | OFL-1.1 | `@fontsource/bubblegum-sans` 5.3.0 | latin + latin-ext |
| Sniglet | Redondeadas | 800 | OFL-1.1 | `@fontsource/sniglet` 5.3.0 | latin + latin-ext |
| Bangers | Cómic | 400 | OFL-1.1 | `@fontsource/bangers` 5.3.0 | latin + latin-ext |
| Luckiest Guy | Cómic | 400 | Apache-2.0 | `@fontsource/luckiest-guy` 5.3.0 | latin + latin-ext |
| Titan One | Cómic | 400 | OFL-1.1 | `@fontsource/titan-one` 5.3.0 | latin + latin-ext |
| Lilita One | Cómic | 400 | OFL-1.1 | `@fontsource/lilita-one` 5.3.0 | latin + latin-ext |
| Chewy | Cómic | 400 | Apache-2.0 | `@fontsource/chewy` 5.3.0 | latin |
| Comic Neue | Cómic | 700 | OFL-1.1 | `@fontsource/comic-neue` 5.3.0 | latin |
| Boogaloo | Cómic | 400 | OFL-1.1 | `@fontsource/boogaloo` 5.3.0 | latin |
| Monoton | Decorativas y terror | 400 | OFL-1.1 | `@fontsource/monoton` 5.3.0 | latin + latin-ext |
| Press Start 2P | Decorativas y terror | 400 | OFL-1.1 | `@fontsource/press-start-2p` 5.3.0 | latin + latin-ext |
| Black Ops One | Decorativas y terror | 400 | OFL-1.1 | `@fontsource/black-ops-one` 5.3.0 | latin + latin-ext |
| Faster One | Decorativas y terror | 400 | OFL-1.1 | `@fontsource/faster-one` 5.3.0 | latin + latin-ext |
| Cinzel Decorative | Decorativas y terror | 700 | OFL-1.1 | `@fontsource/cinzel-decorative` 5.3.0 | latin + latin-ext |
| Creepster | Decorativas y terror | 400 | OFL-1.1 | `@fontsource/creepster` 5.3.0 | latin |
| Nosifer | Decorativas y terror | 400 | OFL-1.1 | `@fontsource/nosifer` 5.3.0 | latin + latin-ext |
| Eater | Decorativas y terror | 400 | OFL-1.1 | `@fontsource/eater` 5.3.0 | latin + latin-ext |
| Metal Mania | Decorativas y terror | 400 | OFL-1.1 | `@fontsource/metal-mania` 5.3.0 | latin + latin-ext |
| Cinzel | Elegantes | 700 | OFL-1.1 | `@fontsource/cinzel` 5.3.0 | latin + latin-ext |
| Marcellus | Elegantes | 400 | OFL-1.1 | `@fontsource/marcellus` 5.3.0 | latin + latin-ext |
| Italiana | Elegantes | 400 | OFL-1.1 | `@fontsource/italiana` 5.3.0 | latin |
| Forum | Elegantes | 400 | OFL-1.1 | `@fontsource/forum` 5.3.0 | latin + latin-ext |
| Tenor Sans | Elegantes | 400 | OFL-1.1 | `@fontsource/tenor-sans` 5.3.0 | latin + latin-ext |
| Belleza | Elegantes | 400 | OFL-1.1 | `@fontsource/belleza` 5.3.0 | latin + latin-ext |
