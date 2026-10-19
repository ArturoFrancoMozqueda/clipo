import { useRef, useState, type ReactNode } from 'react';
import { ACCEPT_MEDIA, importFiles } from '../media';
import { addAssetsToTimeline } from '../ops';
import { useStore } from '../store';

export async function importAndAdd(files: FileList | File[]) {
  const { ok, failed } = await importFiles(files);
  addAssetsToTimeline(ok);
  const n = useStore.getState().notify;
  if (failed.length) n(`No se pudo abrir: ${failed.join(', ')}. Prueba con MP4, MOV, JPG, PNG o MP3.`);
  else if (ok.length) n(ok.length === 1 ? 'Agregado a tu video' : `${ok.length} archivos agregados`);
}

/** A button that opens the device file picker and adds the chosen files to the timeline. */
export function ImportButton({
  accept = ACCEPT_MEDIA,
  className = 'btn-primary',
  children,
}: {
  accept?: string;
  className?: string;
  children: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button className={className} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <span className="spinner" /> : null}
        {busy ? 'Cargando…' : children}
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple
        hidden
        onChange={async (e) => {
          const files = e.target.files;
          if (!files?.length) return;
          setBusy(true);
          try {
            await importAndAdd(files);
          } finally {
            setBusy(false);
            e.target.value = '';
          }
        }}
      />
    </>
  );
}
