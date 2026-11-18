import { uid, useStore, itemsOf } from '../store';
import type { Project } from '../types';
import { actionSchema, type AgentAction } from './schema';
import type { JobContext } from './jobs';
import { createAgentJobs } from './jobs';
import { agentStorage, projectDigest } from './storage';
import { getArtifact, mediaInfo, storeArtifact } from './artifacts';
import { getBlob, getProject, putBlob, saveProject, listProjectMeta, deleteProject } from '../db';
import { saveNow, useSaveState } from '../saveState';
import { applyEdits, catalog } from './edits';
import { totalDuration } from '../model';

export const agentJobs = createAgentJobs(agentStorage, uid, (busy) => useStore.getState().setCaptioning(busy));
export async function verifySaved() {
  await saveNow();
  if (useSaveState.getState().status === 'error') throw new Error('Los cambios están aplicados, pero no guardados. Usa clipo_save_project.');
  const p = useStore.getState().project;
  if (!p) return null;
  const saved = await getProject(p.id);
  const sha256 = await projectDigest(p);
  if (!saved || await projectDigest(saved) !== sha256) throw new Error('El proyecto guardado no coincide con el editor. Lee el estado antes de reintentar.');
  return { projectId: p.id, sha256, verified: true };
}

async function addAudio(samples: Float32Array, sampleRate: number, name: string, start: number, volume: number, role: 'music' | 'sfx' | 'voice', check: () => void) {
  const { encodeWav } = await import('../voice');
  const assetId = uid(); const itemId = uid(); const blob = encodeWav(samples, sampleRate);
  if (!samples.length || !samples.some((s) => Math.abs(s) > 0.00001)) throw new Error('El audio generado está vacío o en silencio.');
  await putBlob(assetId, blob);
  if ((await getBlob(assetId))?.size !== blob.size) throw new Error('No se guardó el audio generado.');
  check();
  const duration = samples.length / sampleRate;
  const url = URL.createObjectURL(blob);
  useStore.getState().addUrls({ [assetId]: url });
  useStore.getState().commit((p) => {
    p.assets[assetId] = { id: assetId, name, kind: 'audio', duration, width: 0, height: 0 };
    p.audios.push({ id: itemId, assetId, start, in: 0, out: duration, volume, fadeIn: 0, fadeOut: role === 'music' ? Math.min(0.5, duration) : 0, role });
  });
  return { assetId, itemId, duration };
}

export async function actionCatalog() {
  const [{ MOODS, SFX }, { VOICES }, { BUILTIN_TEMPLATES }, templates, brand, { listProfiles }] = await Promise.all([
    import('../sound'), import('../voice'), import('../templates/builtin'), import('../templates/build'), import('../brand'), import('../myVoice'),
  ]);
  return { ...catalog(), actions: actionSchema.options.map((option) => option.shape.action.value), moods: MOODS.map(({ id, name }) => ({ id, name })), sounds: SFX.map(({ id, name }) => ({ id, name })),
    voices: [...VOICES.map(({ id, name, engine }) => ({ id, name, engine })), ...(await listProfiles()).map((p) => ({ id: 'my-' + p.id, name: p.name, engine: 'clone' }))],
    templates: [...BUILTIN_TEMPLATES, ...templates.loadUserTemplates()], brand: brand.getBrand(),
    capabilities: { localOnly: true, jobPersistence: true, artifactVerification: 'SHA-256 + decode exported video',
      microphone: 'semantic MCP record controls; requires OS permission and a real microphone',
      oauth: 'semantic MCP account controls; requires user login', publishing: 'requires configured provider and connected account',
      proxy: { enabled: useStore.getState().proxyPreview, readyAssets: Object.keys(useStore.getState().proxyUrls), job: useStore.getState().proxyJob } } };
}

/** Direct operations reuse Clipo's own media, rendering and analysis implementations. */
export async function runAction(a: AgentAction, alive: () => void): Promise<unknown> {
  const state = useStore.getState(); const project = state.project;
  if (!project) throw new Error('Abre un proyecto primero.');
  const check = () => { alive(); if (useStore.getState().project !== project) throw new Error('El proyecto cambió durante el trabajo. Lee el estado antes de reintentar.'); };
  const commit = (fn: (p: Project) => void) => { check(); useStore.getState().commit(fn); };
  const finish = async (result: unknown = {}) => ({ result, receipt: await verifySaved() });
  const job = async (run: (ctx: JobContext) => Promise<unknown>) => ({ job: await agentJobs.start(project.id, a.action, async (ctx) => {
    const checked = { ...ctx, check: () => { ctx.check(); if (useStore.getState().project !== project) throw new Error('El proyecto cambió durante el trabajo.'); } };
    return run(checked);
  }) });
  switch (a.action) {
    case 'catalog': return actionCatalog();
    case 'auto_color': {
      const { layout } = await import('../model'); const { engine } = await import('../engine'); const { autoColor } = await import('../color');
      const item = a.kind === 'clip' ? project.clips.find((c) => c.id === a.itemId) : project.overlays?.find((c) => c.id === a.itemId);
      if (!item) throw new Error('Elemento inexistente.');
      const start = a.kind === 'clip' ? layout(project).find((c) => c.clip.id === item.id)!.start : ('start' in item ? item.start : 0);
      check(); engine.seek(start + Math.min(0.05, (item.out - item.in) / 2)); await engine.waitForPreview(); check();
      const pixels = engine.samplePixels(item); if (!pixels) throw new Error('No se pudo leer el fotograma original.');
      const color = { ...autoColor(pixels), vignette: item.color?.vignette };
      commit((p) => { const target = a.kind === 'clip' ? p.clips.find((c) => c.id === a.itemId)! : p.overlays!.find((c) => c.id === a.itemId)!; target.color = color; });
      return finish({ color });
    }
    case 'split_selection':
    case 'duplicate_selection':
    case 'delete_selection': {
      const item = itemsOf(project, a.kind).find((x) => x.id === a.itemId);
      if (!item) throw new Error('Elemento inexistente.');
      const ops = await import('../ops'); const { engine } = await import('../engine'); check(); engine.pause();
      if (a.action === 'split_selection') {
        const { layout } = await import('../model'); check();
        const range = a.kind === 'clip' ? layout(project).find((c) => c.clip.id === a.itemId) : null;
        const timed = item as { start?: number; duration?: number; in?: number; out?: number };
        const start = range?.start ?? timed.start!; const end = range?.end ?? start + (timed.duration ?? timed.out! - timed.in!);
        if (a.at <= start + 0.1 || a.at >= end - 0.1) throw new Error('El corte debe quedar dentro del elemento seleccionado.');
        engine.seek(a.at);
      }
      state.select({ kind: a.kind, id: a.itemId });
      if (a.action === 'split_selection' && a.kind === 'clip' && 'freeze' in item && item.freeze !== undefined) {
        const edited = applyEdits(project, [{ op: 'split_clip', id: a.itemId, at: a.at }]);
        state.commit((p) => Object.assign(p, edited.project));
      } else if (a.action === 'split_selection') ops.splitAtPlayhead();
      else if (a.action === 'duplicate_selection') ops.duplicateSelected();
      else ops.deleteSelected();
      if (useStore.getState().project === project) throw new Error('No se aplicó la operación. Para dividir, coloca el corte dentro del elemento.');
      return finish();
    }
    case 'move_clip': {
      if (!project.clips.some((c) => c.id === a.clipId) || a.toIndex >= project.clips.length) throw new Error('Clip o posición inexistente.');
      const ops = await import('../ops'); check(); ops.moveClipTo(a.clipId, a.toIndex); return finish();
    }
    case 'duplicate_project': {
      await verifySaved(); check();
      const copy = { ...structuredClone(project), id: uid(), name: a.name, createdAt: Date.now(), updatedAt: Date.now() };
      await saveProject(copy);
      const saved = await getProject(copy.id);
      if (!saved || await projectDigest(saved) !== await projectDigest(copy)) throw new Error('No se pudo verificar la copia.');
      return { projectId: copy.id, name: copy.name, verified: true };
    }
    case 'delete_project': {
      if (a.targetId === project.id) throw new Error('Abre otro proyecto antes de borrar este.');
      const target = (await listProjectMeta()).find((x) => x.id === a.targetId);
      if (!target) throw new Error('Proyecto inexistente.');
      // Keep an editable recovery copy; media remain referenced during garbage collection.
      const original = await getProject(target.id); check();
      if (!original) throw new Error('Proyecto inexistente.');
      const backup = { ...original, id: uid(), name: original.name + ' · recuperación MCP' };
      await saveProject(backup); check(); await deleteProject(target);
      return { deleted: target.id, recoveryProjectId: backup.id, verified: !await getProject(target.id) };
    }
    case 'remove_asset': {
      if (!project.assets[a.assetId]) throw new Error('Archivo inexistente.');
      const referenced = [...project.clips, ...project.audios, ...project.texts, ...(project.stickers ?? []), ...(project.overlays ?? [])].some((x) => 'assetId' in x && x.assetId === a.assetId) || project.clips.some((c) => c.bgRemoval?.assetId === a.assetId);
      if (referenced) throw new Error('El archivo está en uso. Borra sus elementos antes de quitarlo de la biblioteca.');
      commit((p) => { delete p.assets[a.assetId]; }); return finish();
    }
    case 'import_lut': {
      const { lutFromCube } = await import('../lut'); check();
      const lut = lutFromCube(uid(), a.name, a.cube);
      commit((p) => { (p.luts ??= {})[lut.id] = lut; }); return finish({ lutId: lut.id, size: lut.size });
    }
    case 'delete_lut': {
      if (!project.luts?.[a.lutId]) throw new Error('LUT inexistente.');
      commit((p) => { delete p.luts![a.lutId]; for (const c of p.clips) if (c.lut?.id === a.lutId) delete c.lut; }); return finish();
    }
    case 'freeze': {
      const { layout } = await import('../model'); const hit = layout(project).find((x) => a.at >= x.start && a.at < x.end);
      if (!hit || project.assets[hit.clip.assetId]?.kind !== 'video' || hit.clip.freeze !== undefined) throw new Error('Coloca el congelado dentro de un video.');
      const { engine } = await import('../engine'); const { freezeAtPlayhead } = await import('../visualOps'); check();
      engine.seek(a.at); state.select({ kind: 'clip', id: hit.clip.id }); freezeAtPlayhead(); return finish();
    }
    case 'reframe': {
      const m = await import('../reframeAnalyze'); check();
      if (a.clear) { m.clearReframe(); return finish(); }
      if (!m.reframable(project).length) throw new Error('No hay clips que puedan reencuadrarse.');
      return job(async (ctx) => {
        const result = await m.autoReframe(ctx.progress, ctx.signal, ctx.check);
        return { ...result, receipt: await verifySaved() };
      });
    }
    case 'prepare_background': return job(async (ctx) => { await (await import('../segmentation')).loadSegmenter(); ctx.check(); return { ready: true }; });
    case 'music': return job(async (ctx) => {
      const m = await import('../sound'); const mood = m.MOODS.find((x) => x.id === a.moodId);
      if (!mood) throw new Error('Estilo musical desconocido.');
      const samples = await m.renderSong(mood, a.duration, a.version); ctx.check();
      m.levelSong(samples);
      const result = await addAudio(samples, 44100, mood.name, a.start, a.volume, 'music', ctx.check);
      return { ...result, receipt: await verifySaved() };
    });
    case 'sfx': return job(async (ctx) => {
      const m = await import('../sound'); const sound = m.sfxById(a.soundId);
      if (!sound) throw new Error('Sonido desconocido.');
      const result = await addAudio(await m.renderSfx(sound), 44100, sound.name, a.start, a.volume, 'sfx', ctx.check);
      return { ...result, receipt: await verifySaved() };
    });
    case 'narration': return job(async (ctx) => {
      const m = await import('../voice');
      let voice = m.VOICES.find((x) => x.id === a.voiceId);
      if (!voice && a.voiceId.startsWith('my-')) {
        const profile = (await (await import('../myVoice')).listProfiles()).find((x) => 'my-' + x.id === a.voiceId);
        if (profile) voice = m.profileVoice(profile);
      }
      if (!voice) throw new Error('Voz desconocida.');
      const result = await m.synthesize(a.text, voice, a.speed, ctx.progress); ctx.check();
      const added = await addAudio(result.samples, result.sampleRate, 'Narración MCP', a.start, 1, 'voice', ctx.check);
      return { ...added, receipt: await verifySaved() };
    });
    case 'analyze_audio': return job(async (ctx) => {
      const m = await import('../exporter'); const loudness = await m.measureLoudness(project, ctx.signal); ctx.check();
      const levels = await m.measureAudio(project, ctx.signal); ctx.check(); return { loudness, levels };
    });
    case 'silences': return job(async (ctx) => {
      const { analyzeAsset } = await import('../audioFx'); const dsp = await import('../audioDsp');
      const levels: Record<string, Float32Array> = {};
      for (const c of project.clips) {
        ctx.check(); if (levels[c.assetId] || project.assets[c.assetId]?.kind !== 'video') continue;
        const url = state.urls[c.assetId]; if (!url) throw new Error('Falta el archivo del video.');
        const analysis = await analyzeAsset(c.assetId, url); if (!analysis) throw new Error('No se pudo analizar el sonido.');
        levels[c.assetId] = analysis.levels;
      }
      ctx.check(); const cuts = dsp.planSilenceCuts(project, levels, a);
      if (!a.apply || !cuts.length) return { cuts, applied: false };
      let removed = 0;
      useStore.getState().commit((p) => { removed = dsp.applySilenceCuts(p, cuts, uid); });
      return { cuts, removed, applied: true, receipt: await verifySaved() };
    });
    case 'import_subtitles': {
      const { parseSubtitles } = await import('../subtitles'); const m = await import('../captions'); check();
      if (!m.CAPTION_STYLES.some((s) => s.id === a.look.style) && !(a.look.style === 'marca' && (await import('../brand')).getBrand())) throw new Error('Estilo de subtítulos desconocido.');
      const items = m.cuesToItems(parseSubtitles(a.content), a.look, totalDuration(project));
      if (!items.length) throw new Error('No hay subtítulos válidos dentro del proyecto.');
      commit((p) => { p.texts = [...p.texts.filter((t) => !t.caption), ...items]; }); return finish({ count: items.length });
    }
    case 'restyle_captions': {
      const m = await import('../captions'); check();
      if (!m.CAPTION_STYLES.some((s) => s.id === a.look.style) && !(a.look.style === 'marca' && (await import('../brand')).getBrand())) throw new Error('Estilo de subtítulos desconocido.');
      m.restyleCaptions(a.look); return finish();
    }
    case 'export_subtitles': {
      const m = await import('../captions'); check(); const file = m.subtitleFile(a.format);
      if (!file) throw new Error('No hay subtítulos para exportar.');
      return { artifact: await storeArtifact(project.id, file.name, file) };
    }
    case 'export_project': return { artifact: await storeArtifact(project.id, project.name + '.clipo.json', new Blob([JSON.stringify(project)], { type: 'application/json' })), includesMedia: false };
    case 'export_video': return job(async (ctx) => {
      const m = await import('../exporter'); const artifacts = [];
      for (const aspect of [...new Set(a.aspects ?? [project.aspect])]) {
        ctx.check(); const result = await m.exportVideo(Number(a.short), (p) => ctx.progress({ aspect, ...p }), ctx.signal, { aspect });
        ctx.check(); const info = await mediaInfo(result.blob);
        if (Math.abs(info.duration - totalDuration(project)) > 0.2) throw new Error('La duración exportada no coincide con el proyecto.');
        artifacts.push(await storeArtifact(project.id, `${project.name}-${aspect.replace(':', 'x')}.${result.ext}`, result.blob, info));
      }
      return { artifacts, verified: true };
    });
    case 'capture_cover': {
      if (a.at >= totalDuration(project)) throw new Error('Portada fuera del proyecto.');
      const { engine } = await import('../engine'); const { loadProjectFonts } = await import('../fonts');
      await loadProjectFonts(project); check(); state.select(null); engine.seek(a.at);
      await engine.waitForPreview(); check();
      const canvas = document.querySelector<HTMLCanvasElement>('.preview-canvas');
      if (!canvas) throw new Error('No hay una vista previa visible.');
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error('No se pudo capturar la portada.');
      const thumb = canvas.toDataURL('image/jpeg', 0.8);
      commit((p) => { p.publish = { ...p.publish, coverTime: a.at, coverThumb: thumb }; });
      return { artifact: await storeArtifact(project.id, 'portada.png', blob), receipt: await verifySaved() };
    }
    case 'check_social': return job(async (ctx) => {
      const m = await import('../platforms'); const { itemBoxes } = await import('../components/SocialPanel');
      const { measureAudio } = await import('../exporter'); const audio = await measureAudio(project, ctx.signal);
      const checks = [];
      for (const platform of a.platforms) {
        ctx.check(); const aspect = project.publish?.targets?.find((t) => t.platform === platform)?.aspect ?? project.aspect;
        const boxes = await itemBoxes(project, aspect); ctx.check();
        checks.push({ platform, aspect, issues: m.checkVersion({ platform, aspect, duration: totalDuration(project), short: a.short, audio, boxes, ...project.publish?.posts?.[platform] }) });
      }
      return { checks, audioMeasured: true, safeZonesMeasured: true };
    });
    case 'save_template': {
      const m = await import('../templates/build'); check(); const template = m.templateFromProject(project, a.name);
      m.saveUserTemplate(template);
      if (!m.loadUserTemplates().some((t) => t.id === template.id)) throw new Error('No se guardó la plantilla.');
      return { template };
    }
    case 'delete_template': { const m = await import('../templates/build'); check(); m.deleteUserTemplate(a.templateId); return { verified: !m.loadUserTemplates().some((t) => t.id === a.templateId) }; }
    case 'apply_template': {
      const m = await import('../templates/build'); const { BUILTIN_TEMPLATES } = await import('../templates/builtin'); check();
      const template = [...BUILTIN_TEMPLATES, ...m.loadUserTemplates()].find((x) => x.id === a.templateId);
      if (!template) throw new Error('Plantilla inexistente.');
      const assets = a.assetIds.map((id) => { const asset = project.assets[id]; if (!asset || asset.kind === 'audio') throw new Error('La plantilla necesita videos o fotos existentes.'); return asset; });
      const built = m.projectFromTemplate(template, assets, a.values);
      commit((p) => { p.aspect = built.aspect; p.clips = built.clips; p.texts = built.texts; }); return finish();
    }
    case 'brand': {
      const m = await import('../brand'); check();
      if (a.kit) {
        const test = { ...project, texts: project.texts.map((t) => m.brandLook(structuredClone(t), a.kit!)) };
        applyEdits(test, []); // validate IDs against bundled font/style catalogs even on empty projects
        if (!catalog().textStyles.some((x) => x.id === a.kit!.styleId) || (a.kit.font && !catalog().fonts.some((x) => x.id === a.kit!.font))) throw new Error('Marca con estilo o fuente desconocida.');
      }
      m.saveBrand(a.kit);
      const raw = localStorage.getItem('clipo.brandKit');
      if (JSON.stringify(raw ? JSON.parse(raw) : null) !== JSON.stringify(a.kit)) throw new Error('No se pudo guardar la marca.');
      if (a.apply && a.kit) commit((p) => { p.texts.forEach((t) => m.brandLook(t, a.kit!)); });
      return finish({ brand: m.getBrand() });
    }
    case 'publishing_status': {
      const m = await import('../publish/store'); await m.startPublishing();
      const { accounts, jobs } = m.usePublish.getState(); return { accounts, jobs };
    }
    case 'cancel_publication': { const m = await import('../publish/store'); check(); await m.cancelJob(a.jobId); return { jobs: m.usePublish.getState().jobs }; }
    case 'retry_publication': { const m = await import('../publish/store'); check(); await m.retryJob(a.jobId); return { jobs: m.usePublish.getState().jobs }; }
    case 'publish': {
      const m = await import('../publish/store'); await m.startPublishing(); check();
      const artifact = await getArtifact(a.artifactId);
      if (!artifact.media || artifact.projectId !== project.id || !artifact.type.startsWith('video/')) throw new Error('Publica un video exportado de este proyecto.');
      const targets = a.targets.map((t) => {
        const account = m.usePublish.getState().accounts.find((x) => x.id === t.accountId && x.networks.includes(t.platform));
        if (!account || !m.publisherFor(t.platform)) throw new Error('Conecta una cuenta compatible antes de publicar.');
        if (!a.posts[t.platform]) throw new Error('Falta el texto de una publicación.');
        return { network: t.platform, account: { id: account.id, name: account.name } };
      });
      check(); await m.queuePublish({ file: artifact.blob, video: { ...artifact.media, name: artifact.name, type: artifact.type, bytes: artifact.bytes }, targets, posts: a.posts, options: { privacy: a.privacy, madeForKids: a.madeForKids }, scheduledAt: a.scheduledAt });
      return { jobs: m.usePublish.getState().jobs, note: 'En cola no significa publicado: verifica published/error en publishing_status.' };
    }
  }
  const exhaustive: never = a;
  throw new Error(`Acción sin implementar: ${exhaustive}`);
}
