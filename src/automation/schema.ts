// Shared contract: the MCP host and the editor validate exactly the same commands.
import { z } from 'zod';

const id = z.string().min(1).max(160);
const seconds = z.number().finite().min(0).max(86400);
const unit = z.number().finite().min(0).max(1);
const positive = z.number().finite().min(0.01).max(86400);
const volume = z.number().finite().min(0).max(2);
const aspect = z.enum(['9:16', '16:9', '1:1', '4:5']);
const pose = { x: unit, y: unit, size: z.number().min(0.01).max(2), rotation: z.number().finite().min(-100).max(100), opacity: unit };
const keyframes = z.array(z.strictObject({ t: seconds, ...pose, ease: z.enum(['linear', 'ease']) })).max(500);
const color = z.strictObject(Object.fromEntries(
  ['brightness', 'contrast', 'saturation', 'temperature', 'tint', 'highlights', 'shadows', 'vignette']
    .map((key) => [key, z.number().min(-1).max(1).optional()]),
));
const transition = z.strictObject({ type: id, duration: z.number().min(0.2).max(1.5), dir: z.enum(['left', 'right', 'up', 'down']).optional() });
const effect = z.strictObject({ id, intensity: unit });
const voiceFx = z.enum(['none', 'robot', 'deep', 'high', 'phone', 'radio', 'echo', 'room']);
const platform = z.enum(['tiktok', 'instagram_reels', 'youtube_shorts', 'youtube', 'facebook', 'x', 'linkedin']);
const post = z.strictObject({ title: z.string().max(500).optional(), description: z.string().max(10000), hashtags: z.string().max(3000) });
const publish = z.strictObject({ targets: z.array(z.strictObject({ platform, aspect })).max(7).optional(),
  coverTime: seconds.optional(), posts: z.partialRecord(platform, post).optional() });
const clip = z.strictObject({
  assetId: id, in: seconds.default(0), out: positive, speed: z.number().min(0.1).max(10).default(1),
  volume: volume.default(1), filter: id.default('none'), fit: z.enum(['fit', 'fill']).default('fit'),
  transition: transition.optional(), effect: effect.optional(), color: color.optional(),
  flipH: z.boolean().optional(), flipV: z.boolean().optional(),
  crop: z.strictObject({ x: unit, y: unit, w: unit, h: unit }).optional(),
  bgRemoval: z.strictObject({ mode: z.enum(['color', 'blur', 'media']), color: z.string().regex(/^#[\da-fA-F]{6}$/), assetId: id.optional(), smooth: unit }).optional(),
  voiceFx: voiceFx.optional(), lut: z.strictObject({ id, amount: unit }).optional(), freeze: seconds.optional(),
  reframe: z.strictObject({ points: z.array(z.strictObject({ t: seconds, x: unit, y: unit })).min(1).max(10000) }).optional(),
});
const text = z.strictObject({
  text: z.string().min(1).max(10000), start: seconds, duration: positive,
  x: unit.default(0.5), y: unit.default(0.75), size: z.number().min(0.01).max(2).default(0.075),
  styleId: id.default('clasico'), font: id.optional(), caption: z.boolean().optional(),
  fill: z.string().regex(/^#[\da-fA-F]{6}$/).optional(), rotation: pose.rotation.optional(), opacity: unit.optional(),
  anim: z.strictObject({
    in: z.enum(['none', 'fade', 'pop', 'slideUp', 'typewriter', 'slam', 'blurIn', 'drop', 'slideLeft', 'words']),
    out: z.enum(['none', 'fade', 'pop', 'blurOut', 'up']),
    loop: z.enum(['none', 'bounce', 'pulse', 'wiggle', 'float', 'shake']),
  }).optional(),
  words: z.array(z.strictObject({ text: z.string().max(200), start: seconds, end: seconds })).max(1000).optional(),
  karaoke: z.strictObject({ mode: z.enum(['color', 'box', 'scale']), color: z.string().regex(/^#[\da-fA-F]{6}$/) }).optional(),
  keyframes: keyframes.optional(),
});
const audio = z.strictObject({
  assetId: id, start: seconds, in: seconds.default(0), out: positive, volume: volume.default(1),
  fadeIn: seconds.default(0), fadeOut: seconds.default(0), role: z.enum(['voice', 'music', 'sfx']).optional(),
  voiceFx: z.enum(['none', 'robot', 'deep', 'high', 'phone', 'radio', 'echo', 'room']).optional(),
});
const overlay = z.strictObject({
  assetId: id, start: seconds, in: seconds.default(0), out: positive, volume: volume.default(0),
  x: unit.default(0.7), y: unit.default(0.28), size: pose.size.default(0.42), rotation: pose.rotation.default(0), opacity: unit.default(1),
  blend: z.enum(['normal', 'screen', 'multiply', 'overlay', 'lighten', 'darken', 'soft-light', 'difference']).default('normal'),
  filter: id.optional(), color: color.optional(), keyframes: keyframes.optional(),
});
const sticker = z.strictObject({
  start: seconds, duration: positive, x: unit.default(0.5), y: unit.default(0.5), size: pose.size.default(0.25),
  rotation: pose.rotation.default(0), opacity: unit.optional(), emoji: z.string().min(1).max(40).optional(),
  assetId: id.optional(), keyframes: keyframes.optional(),
});
// Zod 4 applies defaults inside optional fields. Strip them for patches, otherwise a
// volume-only update could silently reset the trim, speed, filter and framing.
const clipChanges = clip.extend({
  in: clip.shape.in.removeDefault(), speed: clip.shape.speed.removeDefault(), volume: clip.shape.volume.removeDefault(),
  filter: clip.shape.filter.removeDefault(), fit: clip.shape.fit.removeDefault(),
}).partial();
const textChanges = text.extend({
  x: text.shape.x.removeDefault(), y: text.shape.y.removeDefault(), size: text.shape.size.removeDefault(), styleId: text.shape.styleId.removeDefault(),
}).partial();
const audioChanges = audio.extend({
  in: audio.shape.in.removeDefault(), volume: audio.shape.volume.removeDefault(), fadeIn: audio.shape.fadeIn.removeDefault(), fadeOut: audio.shape.fadeOut.removeDefault(),
}).partial();
const overlayChanges = overlay.extend({
  in: overlay.shape.in.removeDefault(), volume: overlay.shape.volume.removeDefault(), x: overlay.shape.x.removeDefault(),
  y: overlay.shape.y.removeDefault(), size: overlay.shape.size.removeDefault(), rotation: overlay.shape.rotation.removeDefault(),
  opacity: overlay.shape.opacity.removeDefault(), blend: overlay.shape.blend.removeDefault(),
}).partial();
const stickerChanges = sticker.extend({
  x: sticker.shape.x.removeDefault(), y: sticker.shape.y.removeDefault(), size: sticker.shape.size.removeDefault(), rotation: sticker.shape.rotation.removeDefault(),
}).partial();
export const editOperation = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('settings'), name: z.string().trim().min(1).max(200).optional(), aspect: aspect.optional(),
    audioMix: z.strictObject({ duck: z.number().min(0).max(40), normalize: z.boolean() }).optional(), publish: publish.optional() }),
  z.strictObject({ op: z.literal('clear'), kind: z.enum(['clip', 'text', 'audio', 'overlay', 'sticker']), id,
    fields: z.array(z.enum(['transition', 'effect', 'color', 'bgRemoval', 'voiceFx', 'lut', 'freeze', 'reframe', 'crop', 'flipH', 'flipV', 'font', 'fill', 'anim', 'words', 'karaoke', 'keyframes', 'opacity'])).min(1) }),
  z.strictObject({ op: z.literal('duplicate'), kind: z.enum(['clip', 'text', 'audio', 'overlay', 'sticker']), id, start: seconds.optional() }),
  z.strictObject({ op: z.literal('split_item'), kind: z.enum(['text', 'audio', 'overlay', 'sticker']), id, at: seconds }),
  z.strictObject({ op: z.literal('add_clip'), clip, index: z.number().int().min(0).optional() }),
  z.strictObject({ op: z.literal('update_clip'), id, changes: clipChanges }),
  z.strictObject({ op: z.literal('split_clip'), id, at: seconds.describe('Absolute timeline seconds; not source time.') }),
  z.strictObject({ op: z.literal('reorder_clips'), clipIds: z.array(id).max(2000) }),
  z.strictObject({ op: z.literal('add_text'), text }),
  z.strictObject({ op: z.literal('update_text'), id, changes: textChanges }),
  z.strictObject({ op: z.literal('add_audio'), audio }),
  z.strictObject({ op: z.literal('update_audio'), id, changes: audioChanges }),
  z.strictObject({ op: z.literal('add_overlay'), overlay }),
  z.strictObject({ op: z.literal('update_overlay'), id, changes: overlayChanges }),
  z.strictObject({ op: z.literal('add_sticker'), sticker }),
  z.strictObject({ op: z.literal('update_sticker'), id, changes: stickerChanges }),
  z.strictObject({ op: z.literal('delete'), kind: z.enum(['clip', 'text', 'audio', 'overlay', 'sticker']), id }),
]);
const revision = z.number().int().min(0);
const response = z.enum(['full', 'summary']).optional();
const guard = { projectId: id, expectedRevision: revision, response };
const mutationGuard = { ...guard, requestKey: id.optional() };
const paging = { offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).optional() };
const visualRange = { from: seconds, to: positive, samples: z.number().int().min(1).max(24).default(12), sceneThreshold: z.number().min(0.05).max(1).default(0.3) };
const look = z.strictObject({ style: id, karaoke: z.enum(['none', 'color', 'box', 'scale']), color: z.string().regex(/^#[\da-fA-F]{6}$/), chunk: z.enum(['frase', 'corto', 'palabra']).optional() });
export const actionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('catalog') }),
  z.strictObject({ action: z.literal('auto_color'), kind: z.enum(['clip', 'overlay']), itemId: id }),
  z.strictObject({ action: z.literal('split_selection'), kind: z.enum(['clip', 'text', 'audio', 'overlay', 'sticker']), itemId: id, at: seconds }),
  z.strictObject({ action: z.literal('duplicate_selection'), kind: z.enum(['clip', 'text', 'audio', 'overlay', 'sticker']), itemId: id }),
  z.strictObject({ action: z.literal('delete_selection'), kind: z.enum(['clip', 'text', 'audio', 'overlay', 'sticker']), itemId: id }),
  z.strictObject({ action: z.literal('move_clip'), clipId: id, toIndex: z.number().int().min(0).max(2000) }),
  z.strictObject({ action: z.literal('duplicate_project'), name: z.string().trim().min(1).max(200) }),
  z.strictObject({ action: z.literal('delete_project'), targetId: id }),
  z.strictObject({ action: z.literal('remove_asset'), assetId: id }),
  z.strictObject({ action: z.literal('import_lut'), name: z.string().max(200), cube: z.string().min(1).max(500000) }),
  z.strictObject({ action: z.literal('delete_lut'), lutId: id }),
  z.strictObject({ action: z.literal('freeze'), at: seconds }),
  z.strictObject({ action: z.literal('reframe'), clear: z.boolean().default(false) }),
  z.strictObject({ action: z.literal('prepare_background') }),
  z.strictObject({ action: z.literal('music'), moodId: id, duration: z.number().min(1).max(600), version: z.number().int().min(1).max(100).default(1), start: seconds, volume: volume.default(0.3) }),
  z.strictObject({ action: z.literal('sfx'), soundId: id, start: seconds, volume: volume.default(0.7) }),
  z.strictObject({ action: z.literal('narration'), voiceId: id, text: z.string().trim().min(1).max(10000), speed: z.number().min(0.5).max(2).default(1), start: seconds }),
  z.strictObject({ action: z.literal('analyze_audio') }),
  z.strictObject({ action: z.literal('silences'), apply: z.boolean().default(false), depth: z.number().min(10).max(60).default(30), minDuration: z.number().min(0.1).max(10).default(0.8), margin: z.number().min(0).max(1).default(0.15) }),
  z.strictObject({ action: z.literal('import_subtitles'), format: z.enum(['srt', 'vtt']), content: z.string().min(1).max(500000), look }),
  z.strictObject({ action: z.literal('restyle_captions'), look }),
  z.strictObject({ action: z.literal('export_subtitles'), format: z.enum(['srt', 'vtt']) }),
  z.strictObject({ action: z.literal('export_video'), short: z.enum(['360', '720', '1080']).default('720'), aspects: z.array(aspect).min(1).max(4).optional() }),
  z.strictObject({ action: z.literal('export_project') }),
  z.strictObject({ action: z.literal('capture_cover'), at: seconds }),
  z.strictObject({ action: z.literal('check_social'), platforms: z.array(platform).min(1).max(7), short: z.number().int().min(360).max(1080).default(720) }),
  z.strictObject({ action: z.literal('save_template'), name: z.string().trim().min(1).max(200) }),
  z.strictObject({ action: z.literal('delete_template'), templateId: id }),
  z.strictObject({ action: z.literal('apply_template'), templateId: id, assetIds: z.array(id).min(1).max(200), values: z.record(z.string(), z.string().max(1000)).default({}) }),
  z.strictObject({ action: z.literal('brand'), kit: z.strictObject({ font: id.optional(), styleId: id, fill: z.string().regex(/^#[\da-fA-F]{6}$/).optional(), accent: z.string().regex(/^#[\da-fA-F]{6}$/), forNew: z.boolean() }).nullable(), apply: z.boolean().default(false) }),
  z.strictObject({ action: z.literal('publishing_status') }),
  z.strictObject({ action: z.literal('cancel_publication'), jobId: id }),
  z.strictObject({ action: z.literal('retry_publication'), jobId: id }),
  z.strictObject({ action: z.literal('publish'), artifactId: id, targets: z.array(z.strictObject({ platform, accountId: id })).min(1).max(7), posts: z.partialRecord(platform, post), privacy: z.enum(['public', 'unlisted', 'private']), madeForKids: z.boolean(), scheduledAt: z.number().int().positive().optional() }),
]);
export type AgentAction = z.infer<typeof actionSchema>;
export const toolSchemas = {
  clipo_get_request: z.strictObject({ requestKey: id }),
  clipo_query_project: z.strictObject({ ...guard, section: z.enum(['summary', 'assets', 'clips', 'texts', 'audios', 'overlays', 'stickers']).default('summary'),
    from: seconds.optional(), to: positive.optional(), search: z.string().max(200).default(''), ...paging, limit: z.number().int().min(1).max(100).default(50) }),
  clipo_inspect_media: z.strictObject({ ...guard, assetId: id, ...visualRange }),
  clipo_review_export: z.strictObject({ artifactId: id, ...visualRange, includeAudio: z.boolean().default(true), expectedDuration: positive.optional() }),
  clipo_connect: z.strictObject({}),
  clipo_close_editor: z.strictObject({ projectId: id.nullable(), expectedRevision: revision }),
  clipo_action: z.strictObject({ ...mutationGuard, request: actionSchema }),
  clipo_plan_edit: z.strictObject({ ...guard, operations: z.array(editOperation).min(1).max(200) }),
  clipo_list_jobs: z.strictObject({ ...paging, response, projectId: id.optional(), status: z.enum(['queued', 'running', 'saving', 'completed', 'error', 'cancelled', 'interrupted']).optional() }),
  clipo_get_job: z.strictObject({ jobId: id, response }),
  clipo_cancel_job: z.strictObject({ jobId: id }),
  clipo_read_artifact: z.strictObject({ artifactId: id, offset: z.number().int().min(0).default(0), length: z.number().int().min(1).max(1048576).default(1048576) }),
  clipo_export_file: z.strictObject({ artifactId: id, path: z.string().min(1).max(4096) }),
  clipo_audit: z.strictObject({ limit: z.number().int().min(1).max(100).default(30) }),
  clipo_status: z.strictObject({ response }),
  clipo_list_projects: z.strictObject({ ...paging, search: z.string().max(200).default('') }),
  clipo_get_project: z.strictObject({ response }),
  clipo_preview: z.strictObject({}),
  clipo_refresh_editor: z.strictObject(guard),
  clipo_get_audio: z.strictObject({ ...guard, assetId: id, from: seconds, to: positive }),
  clipo_review_audio: z.strictObject({ ...mutationGuard, assetId: id, from: seconds, to: positive,
    language: z.enum(['spanish', 'english', 'portuguese', 'french', 'italian', 'german']).default('spanish'),
    quality: z.enum(['rapido', 'preciso', 'revision']).default('revision'),
  }),
  clipo_get_ui: z.strictObject({ filter: z.string().max(200).default(''), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(300).default(200) }),
  clipo_ui_action: z.strictObject({ expectedRevision: revision, viewId: id, controlId: id,
    action: z.enum(['click', 'set_value', 'key', 'scroll']), value: z.string().max(10000).optional(),
    key: z.enum(['Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Delete', 'Backspace', ' ']).optional(),
    delta: z.number().min(-10000).max(10000).optional(),
  }),
  clipo_set_input_files: z.strictObject({ expectedRevision: revision, viewId: id, controlId: id, paths: z.array(z.string().min(1).max(4096)).min(1).max(8) }),
  clipo_editor: z.strictObject({ ...guard,
    panel: z.enum(['media', 'audio', 'format', 'speed', 'volume', 'filters', 'text', 'captions', 'transition', 'effects', 'background', 'stickers', 'record', 'tts', 'export', 'publish', 'overlay', 'color', 'keyframes', 'sfx', 'crop', 'smartAudio', 'social', 'help']).nullable().optional(),
    selection: z.strictObject({ kind: z.enum(['clip', 'text', 'audio', 'sticker', 'overlay']), id }).nullable().optional(),
    advanced: z.boolean().optional(), playing: z.boolean().optional(), snap: z.boolean().optional(), proxyPreview: z.boolean().optional(), zoom: z.number().min(8).max(500).optional(),
  }),
  clipo_generate_captions: z.strictObject({ ...mutationGuard,
    language: z.enum(['spanish', 'english', 'portuguese', 'french', 'italian', 'german']).default('spanish'),
    quality: z.enum(['rapido', 'preciso', 'revision']).default('preciso'),
    look: z.strictObject({
      style: z.enum(['clasico', 'amarillo', 'caja', 'impacto', 'verde', 'sombra3d', 'burbuja', 'editorial', 'glitch', 'viral', 'cajaViva', 'rebote', 'popRosa', 'minimal', 'celeste', 'rosa', 'noticiero', 'pastel', 'fuego', 'marca']),
      karaoke: z.enum(['none', 'color', 'box', 'scale']), color: z.string().regex(/^#[\da-fA-F]{6}$/),
      chunk: z.enum(['frase', 'corto', 'palabra']),
    }).default({ style: 'viral', karaoke: 'color', color: '#ffe500', chunk: 'corto' }),
  }),
  clipo_get_caption_job: z.strictObject({ jobId: id, response }),
  clipo_cancel_caption_job: z.strictObject({ jobId: id }),
  clipo_create_project: z.strictObject({ name: z.string().trim().min(1).max(200), aspect: aspect.default('9:16'), expectedRevision: revision, response, requestKey: id.optional() }),
  clipo_open_project: z.strictObject({ ...mutationGuard }),
  clipo_import_media: z.strictObject({ ...mutationGuard, paths: z.array(z.string().min(1).max(4096)).min(1).max(8), normalize: z.boolean().optional(),
    ranges: z.array(z.strictObject({ from: seconds, to: positive })).min(1).max(8).optional() }).superRefine((a, ctx) => {
      if (a.ranges && (!a.normalize || a.ranges.length !== a.paths.length || a.ranges.some(r => r.to <= r.from))) ctx.addIssue({ code: 'custom', message: 'ranges requiere normalize=true y un intervalo válido por ruta.' });
    }),
  clipo_import_capcut: z.strictObject({ ...mutationGuard, paths: z.array(z.string().min(1).max(4096)).min(1).max(8) }),
  clipo_edit: z.strictObject({ ...mutationGuard, operations: z.array(editOperation).min(1).max(200) }),
  clipo_undo: z.strictObject(mutationGuard),
  clipo_redo: z.strictObject(mutationGuard),
  clipo_save_project: z.strictObject(mutationGuard),
  clipo_seek: z.strictObject({ ...guard, time: seconds }),
};
export type ToolName = keyof typeof toolSchemas;
export type EditOperation = z.infer<typeof editOperation>;
