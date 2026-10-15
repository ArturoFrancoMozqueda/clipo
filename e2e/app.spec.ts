import { test, expect, type Page } from '@playwright/test';

/** Console errors, uncaught exceptions and CSP violations seen by the page. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // Safari ignores (and reports) the Android-only `interactive-widget` viewport key; harmless.
    if (m.type() === 'error' && !m.text().includes('interactive-widget')) errors.push(`console: ${m.text()}`);
  });
  page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`));
  });
  return errors;
}

async function noHorizontalOverflow(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, 'la página no debe desplazarse en horizontal').toBeLessThanOrEqual(cw);
}

/** Fills the template's picker with generated photos (no fixtures to keep in the repo). */
async function addPhotos(page: Page, count: number) {
  await page.evaluate(async (n) => {
    const input = [...document.querySelectorAll<HTMLInputElement>('input[type=file]')].find((i) => i.multiple);
    if (!input) throw new Error('no hay selector múltiple');
    const dt = new DataTransfer();
    for (let i = 0; i < n; i++) {
      const c = document.createElement('canvas');
      c.width = 720;
      c.height = 1280;
      const x = c.getContext('2d')!;
      x.fillStyle = `hsl(${i * 70},70%,50%)`;
      x.fillRect(0, 0, c.width, c.height);
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
      dt.items.add(new File([blob], `foto${i}.png`, { type: 'image/png' }));
    }
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, count);
}

test('el inicio carga sin errores ni violaciones de CSP', async ({ page, browserName }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Crea videos geniales/ })).toBeVisible();
  await noHorizontalOverflow(page);
  // Multithreaded WASM needs cross-origin isolation (COOP + COEP credentialless; not in WebKit yet).
  if (browserName === 'chromium') expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test('Escape cierra el modal de importar de CapCut', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Importar proyecto de CapCut' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('crear un video desde plantilla, reproducirlo y ver Exportar en pantalla', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Usar una plantilla' }).click();
  await page.getByText('Cumpleaños', { exact: true }).first().click();
  await addPhotos(page, 5);
  // The first-run tour can open at any moment once the editor loads: dismiss it whenever it shows.
  await page.addLocatorHandler(page.getByRole('button', { name: 'Saltar' }), async (skip) => {
    await skip.click();
  });
  await page.getByRole('button', { name: 'Crear mi video' }).click();

  // The main action must be reachable at every size (it used to overflow on 375 px phones).
  const exportBtn = page.locator('.export-btn');
  await expect(exportBtn).toBeVisible();
  const box = (await exportBtn.boundingBox())!;
  const vw = page.viewportSize()!.width;
  expect(box.x + box.width).toBeLessThanOrEqual(vw);
  await noHorizontalOverflow(page);

  const time = page.getByText(/^\d\d:\d\d\.\d \/ \d\d:\d\d\.\d$/).first();
  await expect(time).toHaveText(/^00:00\.0/);
  await page.getByRole('button', { name: 'Reproducir' }).click();
  await expect(time).not.toHaveText(/^00:00\.0/, { timeout: 5000 });
  await page.getByRole('button', { name: 'Pausar' }).click();
  await expect(page.getByRole('button', { name: 'Reproducir' })).toBeVisible();

  // The preview canvas has drawn the first photo (not left blank).
  const drawn = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('.preview canvas, canvas');
    if (!c) return false;
    const d = c.getContext('2d')!.getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
    return d[3] > 0 && d[0] + d[1] + d[2] > 0;
  });
  expect(drawn).toBe(true);
  expect(errors).toEqual([]);
});
