// Optional desktop compatibility import. Original files are never modified.
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
async function probe(file, signal) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', file], { signal, windowsHide: true, maxBuffer: 1024 * 1024 });
  const info = JSON.parse(stdout);
  const video = info.streams.find(s => s.codec_type === 'video');
  if (video && (!video.color_transfer || !video.color_primaries)) {
    const sample = await run('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-select_streams', 'v:0', '-read_intervals', '%+#1', '-show_frames', '-show_entries', 'frame=color_transfer,color_primaries,color_space', '-of', 'json', file], { signal, windowsHide: true, maxBuffer: 1024 * 1024 });
    const frame = JSON.parse(sample.stdout).frames?.[0];
    if (frame) for (const field of ['color_transfer', 'color_primaries', 'color_space']) video[field] ??= frame[field];
  }
  return info;
}
async function compatibleMedia(source, root, signal, range) {
  if (!path.isAbsolute(source) || !/\.(mov|mp4|m4v|mkv|webm|3gp)$/i.test(source)) throw new Error('La importación compatible requiere una ruta absoluta a un video.');
  let info;
  try { info = await probe(source, signal); } catch (e) { if (e.code === 'ENOENT') throw new Error('La importación compatible necesita FFmpeg y ffprobe instalados en PATH.'); throw e; }
  const video = info.streams.find(s => s.codec_type === 'video');
  if (!video) throw new Error('El archivo no contiene video.');
  const hdr = ['arib-std-b67', 'smpte2084'].includes(video.color_transfer);
  const sourceDuration = Number(info.format.duration);
  if (range && (!Number.isFinite(range.from) || !Number.isFinite(range.to) || range.from < 0 || range.to <= range.from || range.to > sourceDuration + .02)) throw new Error('El intervalo está fuera del video original.');
  const before = await fs.stat(source);
  const ratio = Math.min(1, 1920 / video.width, 1080 / video.height);
  const width = Math.max(2, Math.floor(video.width * ratio / 2) * 2);
  const height = Math.max(2, Math.floor(video.height * ratio / 2) * 2);
  if (!hdr && video.color_primaries && !['bt709', 'smpte170m', 'bt470bg', 'unknown'].includes(video.color_primaries)) throw new Error('Espacio de color sin conversión compatible definida; se conserva el original.');
  const dir = await fs.mkdtemp(path.join(root, 'clipo-compatible-'));
  const suffix = range ? `_${Math.round(range.from * 1000)}-${Math.round(range.to * 1000)}` : '';
  const output = path.join(dir, path.basename(source, path.extname(source)) + '_compatible' + suffix + '.mp4');
  try {
    const scale = "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2";
    const filters = hdr
      ? `fps=30,zscale=w=${width}:h=${height}:filter=lanczos:transfer=linear:npl=100,format=gbrpf32le,zscale=primaries=bt709,tonemap=tonemap=hable:desat=0:peak=10,zscale=transfer=bt709:matrix=bt709:range=limited,format=yuv420p`
      : 'fps=30,' + scale + ',format=yuv420p';
    await run('ffmpeg', ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', ...(range ? ['-ss', String(range.from)] : []), '-i', source,
      ...(range ? ['-t', String(range.to - range.from)] : []), '-map', '0:v:0', '-map', '0:a:0?', '-vf', filters + ',setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-threads', '4', '-pix_fmt', 'yuv420p',
      '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart+write_colr', '-n', output], { signal, windowsHide: true, maxBuffer: 1024 * 1024 });
    const after = await fs.stat(source);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('El original cambió durante la conversión; no se importó la copia.');
    const converted = await probe(output, signal);
    const stream = converted.streams.find(s => s.codec_type === 'video');
    if (!stream || stream.codec_name !== 'h264' || Math.abs(Number(converted.format.duration) - (range ? range.to - range.from : sourceDuration)) > 0.2) throw new Error('La copia compatible no superó la verificación de códec/duración.');
    return { path: output, directory: dir, receipt: { sourceName: path.basename(source), sourceCodec: video.codec_name, sourceTransfer: video.color_transfer ?? null,
      outputName: path.basename(output), outputCodec: stream.codec_name, outputTransfer: stream.color_transfer, width: stream.width, height: stream.height,
      duration: Number(converted.format.duration), sourceFrom: range?.from ?? 0, sourceTo: range?.to ?? sourceDuration,
      toneMap: hdr ? 'hable; peak=10; BT.709 primaries before mapping' : null, hdrToSdr: hdr, originalsUnchanged: true, verified: true } };
  } catch (e) { await fs.rm(dir, { recursive: true, force: true }); throw e; }
}
module.exports = { compatibleMedia };
