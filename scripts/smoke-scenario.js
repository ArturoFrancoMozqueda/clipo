// End-to-end check run inside the desktop app by `npm run app:smoke` with CLIPO_SMOKE_SCRIPT set:
// new project → import two generated clips → transition, text preset, sticker, music → export.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = (sel, text) => [...document.querySelectorAll(sel)].find((b) => b.textContent.includes(text));
  localStorage.setItem('clipo.onboarded', '1');
  btn('button', 'Nuevo video').click();
  await sleep(300);
  btn('.format-card', 'Vertical').click();
  await sleep(800);

  async function makeVideo(seconds, hue, label) {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 360;
    const x = c.getContext('2d');
    const ac = new AudioContext();
    const osc = ac.createOscillator();
    const dest = ac.createMediaStreamDestination();
    osc.frequency.value = 220 + hue;
    osc.connect(dest);
    osc.start();
    const stream = c.captureStream(30);
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const start = performance.now();
    const timer = setInterval(() => {
      x.fillStyle = `hsl(${hue},70%,45%)`;
      x.fillRect(0, 0, 640, 360);
      x.fillStyle = '#fff';
      x.font = 'bold 60px sans-serif';
      x.fillText(`${label} ${((performance.now() - start) / 1000).toFixed(1)}`, 40, 200);
    }, 33);
    rec.start();
    await sleep(seconds * 1000);
    rec.stop();
    await new Promise((r) => (rec.onstop = r));
    clearInterval(timer);
    osc.stop();
    ac.close();
    return new File(chunks, `${label}.webm`, { type: 'video/webm' });
  }

  const dt = new DataTransfer();
  dt.items.add(await makeVideo(3, 0, 'A'));
  dt.items.add(await makeVideo(3, 220, 'B'));
  document.querySelector('.editor').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  await sleep(3500);
  const clips = document.querySelectorAll('.tl-item.clip').length;

  document.querySelector('.tl-junction')?.click();
  await sleep(300);
  btn('.sheet button', 'Fundido')?.click();
  await sleep(200);
  document.querySelector('.btn-done')?.click();
  document.querySelector('.tool.back')?.click();
  await sleep(200);

  btn('.tool', 'Texto').click();
  await sleep(400);
  document.querySelector('.preset')?.click();
  await sleep(300);
  document.querySelector('.btn-done')?.click();
  document.querySelector('.tool.back')?.click();
  await sleep(200);

  btn('.tool', 'Stickers').click();
  await sleep(400);
  document.querySelector('.emoji')?.click();
  await sleep(300);
  document.querySelector('.btn-done')?.click();
  document.querySelector('.tool.back')?.click();
  await sleep(200);

  btn('.tool', 'Música').click();
  await sleep(300);
  btn('.mood', 'Alegre')?.querySelector('.small-btn')?.click();
  for (let i = 0; i < 40 && !btn('.tl-item.audio', 'Música'); i++) await sleep(250);
  document.querySelector('.btn-done')?.click();
  await sleep(200);

  document.querySelector('.export-btn').click();
  await sleep(400);
  const t0 = performance.now();
  btn('.sheet button', 'Guardar video').click();
  let done = null;
  for (let i = 0; i < 240 && !done; i++) {
    await sleep(250);
    done = document.querySelector('.export-done') || document.querySelector('.warn');
  }
  const v = document.querySelector('.export-video');
  if (v) await new Promise((r) => (v.readyState >= 1 ? r() : (v.onloadedmetadata = r)));
  return {
    ok: !!v && clips === 2,
    clips,
    exportSeconds: ((performance.now() - t0) / 1000).toFixed(1),
    videoSeconds: v ? v.duration.toFixed(2) : null,
    size: v ? `${v.videoWidth}x${v.videoHeight}` : null,
    file: document.querySelector('.export-done a')?.download ?? null,
    warn: document.querySelector('.warn')?.textContent ?? null,
  };
})();
