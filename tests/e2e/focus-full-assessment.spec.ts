import { test, expect } from '@playwright/test';

/**
 * FULL FOCUS ASSESSMENT E2E (Knee Flexion AROM, LEFT, sagittal).
 * Deterministic test-only pose input via ?e2ePose=synthetic — the synthetic
 * detections travel the SAME pipeline as MediaPipe (tracker → smoother →
 * angles → plane/confidence → focusMachine gates). UI interactions only.
 */

const shot = (n: string) => `e2e-focus-${n}.png`;

test('focus full assessment completes three trials and selects the best (T2)', async ({ page }) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  const failed: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 160)}`); });
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url().slice(0, 100)}`); });

  await page.goto('/?e2ePose=synthetic');
  await expect(page.getByText('KINELAB')).toBeVisible();
  await expect(page.getByText('Who is the patient?')).toBeVisible();
  await page.screenshot({ path: `test-results/${shot('01-patient')}` });

  await page.getByRole('option', { name: /Rivera/ }).first().click();
  await expect(page.getByText('what are we testing?')).toBeVisible();
  await page.getByRole('button', { name: /Knee Flexion AROM/ }).click();
  await expect(page.getByText('TRIAL 1/3')).toBeVisible();
  await expect(page.getByText('E2E TEST INPUT')).toBeVisible();
  await page.screenshot({ path: `test-results/${shot('02-protocol')}` });

  // Positioning: the real gates must clear on synthetic input alone.
  // Zero-chrome capture: lock state lives on the patient overlay, not as
  // text — acquisition is proven by the identity probe reaching locked.
  // Poll: the probe publishes every engine frame and the engine may still
  // be starting when the treatment screen first mounts.
  await expect.poll(async () => page.evaluate(() => (
    (window as unknown as { __kinelabIdentity?: { state: string } }).__kinelabIdentity?.state ?? null
  )), { timeout: 20000 }).toBe('locked');
  const lockProbe = await page.evaluate(() => (
    (window as unknown as { __kinelabIdentity?: { state: string; activeId: number | null } }).__kinelabIdentity ?? null
  ));
  expect(lockProbe!.activeId).not.toBeNull();
  await page.screenshot({ path: `test-results/${shot('03-positioning')}` });

  // Readiness: every gate ✓ (lock, calibration, plane, landmark quality).
  await expect(page.getByText('Hold still')).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: `test-results/${shot('04-ready')}` });

  // Trials: automatic onset → record → complete; therapist only watches
  // (this spec clicks nothing after protocol select — completion alone proves
  // automatic onset). Anchors are the persistent trial headers: TRIAL 2/3 is
  // shown once trial 1 is banked, TRIAL 3/3 once trial 2 is banked. The
  // transient `Trial N complete` status is asserted opportunistically.
  await expect(page.getByText('TRIAL 2/3')).toBeVisible({ timeout: 120000 });
  await page.screenshot({ path: `test-results/${shot('05-trial-1')}` });
  await expect(page.getByText('TRIAL 3/3')).toBeVisible({ timeout: 120000 });
  await page.screenshot({ path: `test-results/${shot('06-trial-2')}` });

  // Assessment complete → review with three computed measurements.
  await expect(page.getByText('ASSESSMENT COMPLETE')).toBeVisible({ timeout: 120000 });
  await page.screenshot({ path: `test-results/${shot('08-assessment-complete')}` });
  await expect(page.getByText('BEST ROM')).toBeVisible();
  const best = await page.getByText('BEST ROM').locator('..').locator('p').nth(1).textContent();
  // Peak excursions are T1=112 T2=119 T3=116 → best trial = trial 2 (119°).
  expect(best).toMatch(/119/);
  await expect(page.getByText(/Trial 2 selected/)).toBeVisible();
  await expect(page.getByText('3 / 3 VALID')).toBeVisible();
  await page.screenshot({ path: `test-results/${shot('09-review')}` });

  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
});
