// Desktop check for "Mi voz" (run with CLIPO_SMOKE_SCRIPT=scripts/smoke-clone.js; needs a few minutes).
// A Piper voice (Martín) stands in for the user's recording, so no microphone is needed: it is saved
// as a voice profile, then a narration is made with the cloned voice through the normal panel.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = (sel, text) => {
    const b = [...document.querySelectorAll(sel)].find((x) => x.textContent.includes(text));
    if (!b) throw new Error(`no encontré ${sel} "${text}" (hay: ${[...document.querySelectorAll(sel)].map((x) => x.textContent.trim().slice(0, 20)).join(" | ")})`);
    return b;
  };
  const t0 = performance.now();
  const T = () => Math.round((performance.now() - t0) / 1000);
  const pitch = (s, sr) => {
    const f0s = [];
    const N = Math.round(sr * 0.046);
    for (let o = 0; o + N < s.length; o += N * 2) {
      const fr = s.subarray(o, o + N);
      let e = 0;
      for (const x of fr) e += x * x;
      if (e / N < 0.001) continue;
      let best = 0;
      let bl = 0;
      for (let lag = Math.floor(sr / 400); lag < Math.floor(sr / 70); lag++) {
        let c = 0;
        for (let i = 0; i + lag < N; i++) c += fr[i] * fr[i + lag];
        if (c > best) {
          best = c;
          bl = lag;
        }
      }
      if (bl) f0s.push(sr / bl);
    }
    f0s.sort((a, b) => a - b);
    return Math.round(f0s[Math.floor(f0s.length / 2)] || 0);
  };
  const decode24k = async (url) => {
    const buf = await new OfflineAudioContext(1, 1, 24000).decodeAudioData(await (await fetch(url)).arrayBuffer());
    return buf.getChannelData(0).slice();
  };
  const wav = (s, sr) => {
    const b = new ArrayBuffer(44 + s.length * 2);
    const v = new DataView(b);
    const w = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + s.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, s.length * 2, true);
    for (let i = 0; i < s.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s[i])) * 0x7fff, true);
    return new Blob([b], { type: 'audio/wav' });
  };
  const narrate = async (voiceName, text, maxSeconds) => {
    document.querySelector('.tool.back')?.click(); // the last narration stays selected
    await sleep(200);
    btn('.tool', 'Texto a voz').click();
    await sleep(500);
    btn('.sheet .voice-pick', voiceName).click();
    const ta = document.querySelector('.sheet textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(200);
    const before = document.querySelectorAll('.tl-item.audio').length;
    btn('.sheet button', 'Crear narración').click();
    for (let i = 0; i < maxSeconds * 4 && document.querySelectorAll('.tl-item.audio').length === before; i++) {
      const warn = document.querySelector('.sheet .warn');
      if (warn) return { error: warn.textContent };
      await sleep(250);
    }
    return { added: document.querySelectorAll('.tl-item.audio').length > before };
  };

  localStorage.setItem('clipo.onboarded', '1');
  btn('button', 'Nuevo video').click();
  await sleep(300);
  btn('.format-card', 'Vertical').click();
  await sleep(800);

  // 1) The stand-in recording.
  const ref = await narrate('Martín', 'Hola, me llamo Martín y esta es mi voz. Me encanta grabar videos para mis amigos y mi familia todos los días.', 120);
  if (!ref.added) return { ok: false, step: 'reference', ...ref };
  await sleep(500);
  const refUrl = document.querySelector('.media-host audio').src;
  const refSamples = await decode24k(refUrl);
  const refF0 = pitch(refSamples, 24000);

  // 2) Save it as a "Mi voz" profile, the same way the setup screen does.
  await new Promise((resolve, reject) => {
    const open = indexedDB.open('clipo');
    open.onsuccess = () => {
      const tx = open.result.transaction('blobs', 'readwrite');
      tx.objectStore('blobs').put(wav(refSamples, 24000), 'myvoice:smoke');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  });
  localStorage.setItem('clipo.myVoices', JSON.stringify([{ id: 'smoke', name: 'Prueba', createdAt: Date.now(), consent: true, seconds: refSamples.length / 24000 }]));
  window.dispatchEvent(new Event('clipo:myvoices'));
  document.querySelector('.btn-done')?.click();
  await sleep(300);

  // 3) Narrate with the cloned voice.
  const startClone = T();
  const cloned = await narrate('Prueba', 'Hola a todos, bienvenidos a mi canal de recetas.', 900);
  if (!cloned.added) return { ok: false, step: 'clone', refF0, ...cloned, seconds: T() };
  await sleep(500);
  const urls = [...document.querySelectorAll('.media-host audio')].map((a) => a.src);
  const out = await decode24k(urls[urls.length - 1]);
  return { ok: true, refF0, clonedF0: pitch(out, 24000), clonedSeconds: (out.length / 24000).toFixed(2), cloneTook: T() - startClone };
})();
