// The optimized preview (proxies.ts): a quiet progress pill while a heavy video gets its light copy,
// and the switch in "Ayuda" to play the originals instead.
import { Gauge } from 'lucide-react';
import { useStore } from '../store';

export function ProxyBadge() {
  const job = useStore((s) => s.proxyJob);
  const on = useStore((s) => s.proxyPreview);
  if (!job || !on) return null;
  const pct = Math.min(99, Math.floor(job.progress * 100));
  return (
    <span className="proxy-badge" role="status" title={`${job.name}: se está preparando una copia ligera para que se vea fluido al editar. Al guardar el video se usa el original.`}>
      <Gauge size={14} aria-hidden /> Optimizando para editar… {pct}%
    </span>
  );
}

export function ProxyToggle() {
  const on = useStore((s) => s.proxyPreview);
  return (
    <label className="adv-toggle">
      <input type="checkbox" checked={on} onChange={(e) => useStore.getState().setProxyPreview(e.target.checked)} />
      <span className="adv-switch" aria-hidden />
      <span>
        <b>Vista previa optimizada</b>
        <small>Los videos pesados (4K, 60 fps o más, del iPhone) se ven con una copia ligera para que no se trabe. Al guardar el video siempre se usa el original.</small>
      </span>
    </label>
  );
}
