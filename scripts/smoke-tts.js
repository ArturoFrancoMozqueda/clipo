// Desktop check for text to speech and sound effects (run with CLIPO_SMOKE_SCRIPT=scripts/smoke-tts.js).
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = (sel, text) => [...document.querySelectorAll(sel)].find((b) => b.textContent.includes(text));
  localStorage.setItem('clipo.onboarded', '1');
  btn('button', 'Nuevo video').click();
  await sleep(300);
  btn('.format-card', 'Vertical').click();
  await sleep(800);
  // A sound effect from the bundled recordings.
  btn('.tool', 'Sonidos').click();
  await sleep(400);
  const total = document.querySelectorAll('.sound-row').length;
  btn('.sound-row', 'Puñetazo').querySelector('.small-btn').click();
  for (let i = 0; i < 40 && !btn('.tl-item.audio', 'Puñetazo'); i++) await sleep(250);
  document.querySelector('.btn-done').click();
  await sleep(200);
  // A narration with a natural voice.
  btn('.tool', 'Texto a voz').click();
  await sleep(400);
  btn('.sheet button', 'Claudia').click();
  const ta = document.querySelector('.sheet textarea');
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'Hola, esta es una prueba de la voz natural.');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(200);
  btn('.sheet button', 'Crear narración').click();
  for (let i = 0; i < 360 && !btn('.tl-item.audio', 'Narración'); i++) await sleep(250);
  const items = [...document.querySelectorAll('.tl-item.audio')].map((a) => a.textContent.trim());
  return { ok: items.some((x) => x.includes('Narración')) && items.some((x) => x.includes('Puñetazo')), sfxListed: total, items, err: document.querySelector('.sheet .warn')?.textContent ?? null };
})();
