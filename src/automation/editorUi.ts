// Semantic editor controls over MCP: no arbitrary selectors or injected JavaScript.
import { uid, useStore } from '../store';

export function createEditorUi() {
  let viewId = '';
  let handles = new Map<string, { element: HTMLElement; label: string }>();
  const label = (el: HTMLElement) => (el.getAttribute('aria-label') ||
    ('labels' in el ? Array.from((el as HTMLInputElement).labels ?? []).map((l) => l.textContent).join(' ') : '') ||
    el.getAttribute('title') || el.textContent || el.getAttribute('placeholder') || el.getAttribute('name') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 220);
  const visible = (el: HTMLElement) => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const topDialog = () => Array.from(document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"][aria-modal="true"]')).filter(visible).at(-1);
  const describe = (el: HTMLElement, id: string) => {
    const input = el instanceof HTMLInputElement ? el : null;
    return { id, label: label(el), tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), type: input?.type,
      section: el.closest('dialog, [role="dialog"]') ? 'dialog' : el.closest('.sheet-body') ? `panel:${useStore.getState().panel}` : el.closest('.toolbar') ? 'toolbar' : 'editor',
      disabled: el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true',
      value: input?.type === 'password' || input?.type === 'file' ? undefined : 'value' in el ? String(el.value).slice(0, 4000) : undefined,
      checked: input && ['checkbox', 'radio'].includes(input.type) ? input.checked : undefined,
      active: el.classList.contains('active') || el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true',
      min: input?.min || undefined, max: input?.max || undefined, step: input?.step || undefined,
      accept: input?.type === 'file' ? input.accept : undefined,
      options: el instanceof HTMLSelectElement ? Array.from(el.options).map((o) => ({ value: o.value, label: o.label, disabled: o.disabled })) : undefined };
  };
  const read = (filter = '', offset = 0, limit = 200) => {
    viewId = uid(); handles = new Map();
    // Voice enrollment is portaled to document.body, outside React's #root.
    // A modal makes the underlying editor inert: expose only the active dialog.
    const root = topDialog() ?? document.body;
    const all = Array.from(root?.querySelectorAll<HTMLElement>('button, input, select, textarea, [role="button"], [role="slider"], [role="tab"], [tabindex]') ?? []);
    const controls = all.filter((el) => visible(el) || (el instanceof HTMLInputElement && el.type === 'file' && !!el.parentElement && visible(el.parentElement)))
      .map((el) => { const id = uid(); handles.set(id, { element: el, label: label(el) }); return describe(el, id); })
      .filter((c) => !filter || c.label.toLocaleLowerCase().includes(filter.toLocaleLowerCase()) || c.type === filter);
    return { viewId, panel: useStore.getState().panel, total: controls.length, offset,
      controls: controls.slice(offset, offset + limit), text: (root?.innerText ?? '').slice(0, 18000) };
  };
  const resolve = (requestedView: string, id: string) => {
    const h = handles.get(id);
    if (requestedView !== viewId || !h || !h.element.isConnected || label(h.element) !== h.label) throw new Error('Control desactualizado. Usa clipo_get_ui y el ID recién devuelto.');
    if (topDialog() && !topDialog()!.contains(h.element)) throw new Error('Hay un diálogo activo. Usa clipo_get_ui para observar sus controles.');
    if (h.element.matches(':disabled') || h.element.getAttribute('aria-disabled') === 'true') throw new Error('Ese control está deshabilitado.');
    return h.element;
  };
  const fileInput = (view: string, id: string) => {
    const el = resolve(view, id);
    if (!(el instanceof HTMLInputElement) || el.type !== 'file') throw new Error('El control no es una entrada de archivos.');
    return el;
  };
  return {
    read, fileInput,
    async action(view: string, id: string, action: 'click' | 'set_value' | 'key' | 'scroll', value?: string, key?: string, delta = 400) {
      const el = resolve(view, id);
      viewId = ''; // Consume the observation before dispatching any change.
      if (action === 'click') {
        if (el instanceof HTMLInputElement && el.type === 'file') throw new Error('Usa clipo_set_input_files con rutas locales.');
        el.click();
      } else if (action === 'set_value') {
        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) || (el instanceof HTMLInputElement && ['file', 'checkbox', 'radio', 'button', 'submit', 'hidden'].includes(el.type))) throw new Error('Este control no admite set_value.');
        if (value === undefined) throw new Error('Falta value.');
        el.focus(); useStore.getState().checkpoint();
        const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true })); el.blur();
      } else if (action === 'key') {
        if (!key) throw new Error('Falta key.');
        el.focus(); el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
      } else (el.closest('.sheet-body, .modal-body, .timeline-scroll') ?? el).scrollBy({ top: delta, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 40));
      return read();
    },
    async attach(view: string, id: string, files: File[]) {
      const input = fileInput(view, id);
      if (!input.multiple && files.length > 1) throw new Error('Este control acepta un solo archivo.');
      const transfer = new DataTransfer(); files.forEach((f) => transfer.items.add(f));
      viewId = ''; input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 40));
      return read();
    },
  };
}
