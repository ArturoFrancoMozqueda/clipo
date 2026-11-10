import type { Template, TemplateSlot } from './types';

// Formats that are popular right now. All texts, layouts and preview art are made for Clipo.

const slot = (label: string, duration: number, filter = 'none'): TemplateSlot => ({ label, duration, filter, fit: 'fill' });

/** The rank badge shown at the corner of each step of a list. */
const num = (n: string, s: number, style = 'precio') => ({ text: n, slot: s, offset: 0, x: 0.16, y: 0.14, size: 0.12, styleId: style });
const step = (text: string, s: number) => ({ text, slot: s, offset: 0.2, x: 0.5, y: 0.8, size: 0.065, styleId: 'caja' });

export const MORE_TEMPLATES: Template[] = [
  {
    version: 1, id: 'tres-tips', name: 'Gancho + 3 consejos',
    description: 'Una frase que engancha y tres consejos rápidos.',
    aspect: '9:16', category: 'redes',
    slots: [slot('Tú o el tema, de frente', 3, 'vivid'), slot('Consejo 1', 3.5), slot('Consejo 2', 3.5), slot('Consejo 3', 3.5), slot('Cierre', 2.5, 'bright')],
    fields: [
      { key: 'gancho', label: 'Tu gancho', default: '3 errores que debes evitar' },
      { key: 'c1', label: 'Consejo 1', default: 'Empieza por lo más simple' },
      { key: 'c2', label: 'Consejo 2', default: 'Cuida la luz y el sonido' },
      { key: 'c3', label: 'Consejo 3', default: 'Publica con constancia' },
      { key: 'cta', label: 'Cierre', default: 'Sígueme para más consejos' },
    ],
    texts: [
      { text: '{gancho}', slot: 0, offset: 0.1, x: 0.5, y: 0.35, size: 0.095, styleId: 'sombra3d' },
      num('1', 1), step('{c1}', 1), num('2', 2), step('{c2}', 2), num('3', 3), step('{c3}', 3),
      { text: '{cta}', slot: 4, offset: 0.2, x: 0.5, y: 0.8, size: 0.065, styleId: 'cta' },
    ],
    look: { colors: ['#7c5cff', '#ffd60a', '#111827', '#ff3b30'], motif: 'bars' },
  },
  {
    version: 1, id: 'top5', name: 'Top 5',
    description: 'Un ranking con cinco puestos, del 5 al 1.',
    aspect: '9:16', category: 'redes',
    slots: [slot('Portada del ranking', 2.5, 'vivid'), slot('Puesto 5', 3), slot('Puesto 4', 3), slot('Puesto 3', 3), slot('Puesto 2', 3), slot('Puesto 1', 3.5, 'vivid')],
    fields: [
      { key: 'tema', label: '¿De qué es tu top?', default: 'Mis lugares favoritos' },
      { key: 'p5', label: 'Puesto 5', default: 'El café de la esquina' },
      { key: 'p4', label: 'Puesto 4', default: 'El parque grande' },
      { key: 'p3', label: 'Puesto 3', default: 'La librería vieja' },
      { key: 'p2', label: 'Puesto 2', default: 'La playa de noche' },
      { key: 'p1', label: 'Puesto 1', default: 'Mi casa' },
    ],
    texts: [
      { text: 'TOP 5', slot: 0, offset: 0.1, x: 0.5, y: 0.35, size: 0.17, styleId: 'oro' },
      { text: '{tema}', slot: 0, offset: 0.4, x: 0.5, y: 0.55, size: 0.065, styleId: 'caja' },
      num('5', 1), step('{p5}', 1), num('4', 2), step('{p4}', 2), num('3', 3), step('{p3}', 3), num('2', 4), step('{p2}', 4),
      num('1', 5, 'oro'), { text: '{p1}', slot: 5, offset: 0.2, x: 0.5, y: 0.8, size: 0.07, styleId: 'rojo' },
    ],
    look: { colors: ['#f5c542', '#111827', '#ff3b30', '#7c5cff'], motif: 'stars' },
  },
  {
    version: 1, id: 'meme', name: 'Meme',
    description: 'Una imagen con texto arriba y abajo, como los memes de siempre.',
    aspect: '1:1', category: 'redes',
    slots: [slot('La imagen o video del meme', 5)],
    fields: [
      { key: 'arriba', label: 'Texto de arriba', default: 'Yo planeando dormir temprano' },
      { key: 'abajo', label: 'Texto de abajo', default: 'Yo a las 3 de la mañana' },
    ],
    texts: [
      { text: '{arriba}', slot: 0, offset: 0, x: 0.5, y: 0.11, size: 0.075, styleId: 'meme' },
      { text: '{abajo}', slot: 0, offset: 0.8, x: 0.5, y: 0.89, size: 0.075, styleId: 'meme' },
    ],
    look: { colors: ['#111827', '#ffffff', '#ffd60a'], motif: 'bars' },
  },
  {
    version: 1, id: 'dia-en-mi-vida', name: 'Un día en mi vida',
    description: 'Tu día con la hora de cada momento.',
    aspect: '9:16', category: 'personal',
    slots: [slot('Al despertar', 2.5, 'soft'), slot('Desayuno o café', 2.5, 'warm'), slot('Trabajo o estudio', 2.5, 'bright'), slot('Comida', 2.5, 'warm'), slot('Tarde', 2.5, 'vivid'), slot('Noche', 3, 'night')],
    fields: [
      { key: 'titulo', label: 'Título', default: 'un día en mi vida' },
      { key: 'h1', label: 'Hora 1', default: '7:00' },
      { key: 'h2', label: 'Hora 2', default: '9:00' },
      { key: 'h3', label: 'Hora 3', default: '13:00' },
      { key: 'h4', label: 'Hora 4', default: '18:00' },
      { key: 'h5', label: 'Hora 5', default: '22:00' },
    ],
    texts: [
      { text: '{titulo}', slot: 0, offset: 0.1, x: 0.5, y: 0.2, size: 0.075, styleId: 'minimal' },
      { text: '{h1}', slot: 0, offset: 0.4, x: 0.5, y: 0.88, size: 0.05, styleId: 'minimal' },
      { text: '{h2}', slot: 1, offset: 0.1, x: 0.5, y: 0.88, size: 0.05, styleId: 'minimal' },
      { text: '{h3}', slot: 3, offset: 0.1, x: 0.5, y: 0.88, size: 0.05, styleId: 'minimal' },
      { text: '{h4}', slot: 4, offset: 0.1, x: 0.5, y: 0.88, size: 0.05, styleId: 'minimal' },
      { text: '{h5}', slot: 5, offset: 0.1, x: 0.5, y: 0.88, size: 0.05, styleId: 'minimal' },
    ],
    look: { colors: ['#fcd5ce', '#f8edeb', '#b5838d', '#6d6875'], motif: 'bubbles' },
  },
  {
    version: 1, id: 'unboxing', name: 'Unboxing y reseña',
    description: 'Abre un producto y cuenta qué te pareció.',
    aspect: '9:16', category: 'redes',
    slots: [slot('El paquete cerrado', 2.5), slot('Abriéndolo', 3), slot('El producto de cerca', 3, 'vivid'), slot('Probándolo', 3.5), slot('Tu veredicto', 3, 'bright')],
    fields: [
      { key: 'producto', label: '¿Qué abres?', default: 'Mi nuevo gadget' },
      { key: 'pro', label: 'Lo mejor', default: 'Muy fácil de usar' },
      { key: 'contra', label: 'Lo que no te gustó', default: 'La batería dura poco' },
      { key: 'nota', label: 'Tu nota', default: '8 / 10' },
    ],
    texts: [
      { text: 'Unboxing', slot: 0, offset: 0.1, x: 0.5, y: 0.2, size: 0.1, styleId: 'titulo' },
      { text: '{producto}', slot: 0, offset: 0.4, x: 0.5, y: 0.8, size: 0.065, styleId: 'etiqueta' },
      { text: 'Lo mejor: {pro}', slot: 3, offset: 0.2, x: 0.5, y: 0.72, size: 0.055, styleId: 'caja' },
      { text: 'Lo malo: {contra}', slot: 3, offset: 1.4, x: 0.5, y: 0.82, size: 0.055, styleId: 'caja' },
      { text: '{nota}', slot: 4, offset: 0.2, x: 0.5, y: 0.45, size: 0.16, styleId: 'oro' },
    ],
    look: { colors: ['#2563eb', '#f59e0b', '#ffffff', '#111827'], motif: 'grid' },
  },
  {
    version: 1, id: 'photo-dump', name: 'Carrusel de fotos',
    description: 'Un montón de fotos rápidas, ideal para recuerdos.',
    aspect: '4:5', category: 'personal',
    slots: [
      slot('Foto 1', 1.6, 'film'), slot('Foto 2', 1.6, 'film'), slot('Foto 3', 1.6, 'film'), slot('Foto 4', 1.6, 'film'),
      slot('Foto 5', 1.6, 'film'), slot('Foto 6', 1.6, 'film'), slot('Foto 7', 1.6, 'film'), slot('Foto 8', 2, 'film'),
    ],
    fields: [
      { key: 'titulo', label: 'Título', default: 'photo dump' },
      { key: 'fecha', label: 'Fecha o lugar', default: 'verano 2026' },
    ],
    texts: [
      { text: '{titulo}', slot: 0, offset: 0, x: 0.5, y: 0.88, size: 0.09, styleId: 'minimal' },
      { text: '{fecha}', slot: 7, offset: 0.2, x: 0.5, y: 0.88, size: 0.06, styleId: 'minimal' },
    ],
    look: { colors: ['#e9c46a', '#f4a261', '#264653', '#fefae0'], motif: 'grid' },
  },
  {
    version: 1, id: 'podcast', name: 'Clip de podcast',
    description: 'Un fragmento de tu conversación con título y subtítulos.',
    aspect: '9:16', category: 'redes',
    slots: [slot('Tu video o imagen del episodio', 15, 'soft')],
    fields: [
      { key: 'episodio', label: 'Nombre del episodio', default: 'Episodio 12' },
      { key: 'tema', label: 'De qué trata el clip', default: 'Cómo empecé de cero' },
      { key: 'cta', label: 'Dónde escucharlo', default: 'Episodio completo en mi canal' },
    ],
    texts: [
      { text: '{episodio}', slot: 0, offset: 0, x: 0.5, y: 0.08, size: 0.045, styleId: 'ubicacion' },
      { text: '{tema}', slot: 0, offset: 0.3, x: 0.5, y: 0.2, size: 0.075, styleId: 'sombra3d' },
      { text: '{cta}', slot: 0, offset: 11, x: 0.5, y: 0.9, size: 0.05, styleId: 'cta' },
    ],
    look: { colors: ['#1d1b3a', '#7c5cff', '#22d3ee', '#ff2d95'], motif: 'bars' },
  },
  {
    version: 1, id: 'testimonio', name: 'Testimonio de cliente',
    description: 'Lo que dice un cliente contento, con su nombre.',
    aspect: '1:1', category: 'negocio',
    slots: [slot('Foto o video del cliente', 4, 'soft'), slot('Tu producto o trabajo', 3.5, 'vivid'), slot('Tu logo o local', 3, 'bright')],
    fields: [
      { key: 'frase', label: 'Lo que dijo', default: '“Superó mis expectativas.\nLo recomiendo mucho.”', multiline: true },
      { key: 'cliente', label: 'Nombre del cliente', default: '— Ana, clienta' },
      { key: 'negocio', label: 'Tu negocio', default: 'Estudio Luna' },
    ],
    texts: [
      { text: '{frase}', slot: 0, offset: 0.4, x: 0.5, y: 0.7, size: 0.06, styleId: 'caja' },
      { text: '{cliente}', slot: 1, offset: 0.1, x: 0.5, y: 0.86, size: 0.05, styleId: 'etiqueta' },
      { text: '{negocio}', slot: 2, offset: 0.3, x: 0.5, y: 0.5, size: 0.09, styleId: 'titulo' },
    ],
    look: { colors: ['#14b8a6', '#fde68a', '#0f172a', '#ffffff'], motif: 'bubbles' },
  },
  {
    version: 1, id: 'tutorial', name: 'Tutorial paso a paso',
    description: 'Enseña algo en cuatro pasos con números grandes.',
    aspect: '9:16', category: 'redes',
    slots: [slot('El resultado final', 2.5, 'vivid'), slot('Paso 1', 3.5), slot('Paso 2', 3.5), slot('Paso 3', 3.5), slot('Paso 4', 3.5), slot('Resultado otra vez', 2.5, 'bright')],
    fields: [
      { key: 'titulo', label: '¿Qué enseñas?', default: 'Cómo hacer tu primer video' },
      { key: 'p1', label: 'Paso 1', default: 'Elige tus clips' },
      { key: 'p2', label: 'Paso 2', default: 'Recorta lo que sobra' },
      { key: 'p3', label: 'Paso 3', default: 'Agrega texto y música' },
      { key: 'p4', label: 'Paso 4', default: 'Guárdalo y compártelo' },
    ],
    texts: [
      { text: '{titulo}', slot: 0, offset: 0.1, x: 0.5, y: 0.3, size: 0.085, styleId: 'verde' },
      { text: 'Paso 1', slot: 1, offset: 0, x: 0.22, y: 0.1, size: 0.06, styleId: 'etiqueta' }, step('{p1}', 1),
      { text: 'Paso 2', slot: 2, offset: 0, x: 0.22, y: 0.1, size: 0.06, styleId: 'etiqueta' }, step('{p2}', 2),
      { text: 'Paso 3', slot: 3, offset: 0, x: 0.22, y: 0.1, size: 0.06, styleId: 'etiqueta' }, step('{p3}', 3),
      { text: 'Paso 4', slot: 4, offset: 0, x: 0.22, y: 0.1, size: 0.06, styleId: 'etiqueta' }, step('{p4}', 4),
      { text: '¡Listo!', slot: 5, offset: 0.2, x: 0.5, y: 0.5, size: 0.12, styleId: 'amarillo' },
    ],
    look: { colors: ['#2bff6b', '#111827', '#ffffff', '#7c5cff'], motif: 'grid' },
  },
  {
    version: 1, id: 'oferta-flash', name: 'Oferta relámpago',
    description: 'Precio, descuento y hasta cuándo dura.',
    aspect: '9:16', category: 'negocio',
    slots: [slot('El producto', 3, 'vivid'), slot('Otro ángulo', 2.5, 'vivid'), slot('Producto en uso', 2.5, 'bright'), slot('Foto final', 3, 'vivid')],
    fields: [
      { key: 'producto', label: 'Producto', default: 'Tenis deportivos' },
      { key: 'antes', label: 'Precio antes', default: '$1,200' },
      { key: 'ahora', label: 'Precio ahora', default: '$799' },
      { key: 'hasta', label: '¿Hasta cuándo?', default: 'Solo hasta el domingo' },
      { key: 'contacto', label: '¿Cómo comprar?', default: 'Escríbenos por mensaje' },
    ],
    texts: [
      { text: '¡OFERTA!', slot: 0, offset: 0.1, x: 0.5, y: 0.16, size: 0.12, styleId: 'alerta' },
      { text: '{producto}', slot: 0, offset: 0.4, x: 0.5, y: 0.8, size: 0.07, styleId: 'etiqueta' },
      { text: 'Antes {antes}', slot: 1, offset: 0, x: 0.5, y: 0.78, size: 0.06, styleId: 'caja' },
      { text: '{ahora}', slot: 2, offset: 0, x: 0.5, y: 0.2, size: 0.13, styleId: 'precio' },
      { text: '{hasta}', slot: 2, offset: 0.3, x: 0.5, y: 0.82, size: 0.06, styleId: 'rojo' },
      { text: '{contacto}', slot: 3, offset: 0.2, x: 0.5, y: 0.8, size: 0.065, styleId: 'cta' },
    ],
    look: { colors: ['#ff3b30', '#ffd60a', '#111827', '#ffffff'], motif: 'stripes' },
  },
  {
    version: 1, id: 'viaje-corto', name: 'Viaje en 15 segundos',
    description: 'Tu viaje en vertical, con lugar y recuerdos.',
    aspect: '9:16', category: 'viajes',
    slots: [slot('Llegada', 2.5, 'golden'), slot('Un lugar bonito', 2.5, 'golden'), slot('Comida', 2.5, 'warm'), slot('Tú o tus amigos', 2.5, 'vivid'), slot('Atardecer', 3, 'golden')],
    fields: [
      { key: 'lugar', label: '¿Dónde fuiste?', default: 'Oaxaca' },
      { key: 'fecha', label: '¿Cuándo?', default: 'Octubre 2026' },
      { key: 'cierre', label: 'Frase final', default: 'Volvería mil veces' },
    ],
    texts: [
      { text: '{lugar}', slot: 0, offset: 0.5, x: 0.5, y: 0.5, size: 0.14, styleId: 'titulo' },
      { text: '{fecha}', slot: 1, offset: 0.2, x: 0.5, y: 0.88, size: 0.05, styleId: 'minimal' },
      { text: '{cierre}', slot: 4, offset: 0.3, x: 0.5, y: 0.5, size: 0.085, styleId: 'elegante' },
    ],
    look: { colors: ['#f59e0b', '#ef4444', '#0ea5e9', '#fef3c7'], motif: 'waves' },
  },
  {
    version: 1, id: 'felicitacion', name: 'Felicitación',
    description: 'Aniversario, graduación o logro: celebra con fotos y un mensaje.',
    aspect: '9:16', category: 'personal',
    slots: [slot('Foto principal', 3, 'bright'), slot('Un recuerdo', 2.5, 'warm'), slot('Otro recuerdo', 2.5, 'warm'), slot('Foto final', 3.5, 'bright')],
    fields: [
      { key: 'motivo', label: '¿Qué celebras?', default: '¡Felicidades!' },
      { key: 'nombre', label: 'Para quién', default: 'Sofía' },
      { key: 'mensaje', label: 'Tu mensaje', default: 'Estamos muy orgullosos de ti', multiline: true },
    ],
    texts: [
      { text: '{motivo}', slot: 0, offset: 0.2, x: 0.5, y: 0.2, size: 0.11, styleId: 'oro' },
      { text: '{nombre}', slot: 0, offset: 0.6, x: 0.5, y: 0.82, size: 0.085, styleId: 'neon' },
      { text: '{mensaje}', slot: 3, offset: 0.3, x: 0.5, y: 0.5, size: 0.075, styleId: 'elegante' },
    ],
    look: { colors: ['#f5c542', '#ff6fae', '#8a6cff', '#3fd1c5'], motif: 'confetti' },
  },
  {
    version: 1, id: 'lanzamiento', name: 'Anuncio de lanzamiento',
    description: 'Presenta algo nuevo: fecha, lugar y cómo enterarse.',
    aspect: '9:16', category: 'negocio',
    slots: [slot('Imagen de impacto', 3, 'drama'), slot('Un adelanto', 3, 'vivid'), slot('Otro adelanto', 3, 'vivid'), slot('Imagen final', 3, 'drama')],
    fields: [
      { key: 'nombre', label: '¿Qué lanzas?', default: 'Nueva colección' },
      { key: 'fecha', label: 'Fecha', default: '15 de noviembre' },
      { key: 'donde', label: 'Dónde', default: 'En nuestra tienda y en línea' },
    ],
    texts: [
      { text: 'PRÓXIMAMENTE', slot: 0, offset: 0.1, x: 0.5, y: 0.14, size: 0.06, styleId: 'noticia' },
      { text: '{nombre}', slot: 0, offset: 0.4, x: 0.5, y: 0.5, size: 0.11, styleId: 'titulo' },
      { text: '{fecha}', slot: 2, offset: 0.2, x: 0.5, y: 0.8, size: 0.075, styleId: 'precio' },
      { text: '{donde}', slot: 3, offset: 0.3, x: 0.5, y: 0.8, size: 0.06, styleId: 'cta' },
    ],
    look: { colors: ['#0f172a', '#7c5cff', '#22d3ee', '#f8fafc'], motif: 'stars' },
  },
  {
    version: 1, id: 'pov', name: 'POV',
    description: 'Una escena corta con tu situación y un giro final.',
    aspect: '9:16', category: 'redes',
    slots: [slot('La situación', 3.5), slot('La reacción', 3), slot('El giro final', 3.5)],
    fields: [
      { key: 'pov', label: 'POV: …', default: 'POV: dijiste «cinco minutitos»' },
      { key: 'giro', label: 'El giro', default: 'Eran las 4 de la tarde' },
    ],
    texts: [
      { text: '{pov}', slot: 0, offset: 0.1, x: 0.5, y: 0.16, size: 0.06, styleId: 'clasico' },
      { text: '¡¿QUÉ?!', slot: 1, offset: 0.3, x: 0.5, y: 0.45, size: 0.14, styleId: 'alerta' },
      { text: '{giro}', slot: 2, offset: 0.3, x: 0.5, y: 0.8, size: 0.065, styleId: 'caja' },
    ],
    look: { colors: ['#ff3b30', '#111827', '#ffffff'], motif: 'split' },
  },
];
