import { useEffect } from 'react';

/**
 * iOS doesn't shrink the layout when the on-screen keyboard opens, so bottom sheets end up under it.
 * Publishes the keyboard height as the CSS variable `--kb` (0px when closed or when the browser
 * already resizes the page, e.g. Android with interactive-widget=resizes-content).
 */
export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    if (!vv) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (vv.scale > 1.01) return; // pinch zoom, not the keyboard
        const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
        root.style.setProperty('--kb', `${kb}px`);
      });
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--kb');
    };
  }, []);
}
