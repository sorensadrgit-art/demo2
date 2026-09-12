import { test, expect } from '@playwright/test';

/**
 * SAFETY-GATE E2E: synthetic input must NOT bypass the real guards.
 * Wrong-plane and missing-joint fixtures must fail safely; the valid
 * geometric cue must still progress. Compensation fixture must flag.
 */

test('wrong orientation keeps the positioning cue active', async ({ page }) => {
  await page.goto('/?e2ePose=synthetic&e2eScenario=wrong-plane');
  await page.getByRole('option', { name: /Rivera/ }).first().click();
  await page.getByRole('button', { name: /Knee Flexion AROM/ }).click();
  await expect(page.getByText('TRIAL 1/3')).toBeVisible();
  await expect(page.getByText('Turn sideways to the camera.')).toBeVisible({ timeout: 15000 });
  // The gate never clears on a frontal subject for a sagittal protocol.
  await page.waitForTimeout(5000);
  await expect(page.getByText('Turn sideways to the camera.')).toBeVisible();
  await expect(page.getByText('Hold still')).not.toBeVisible();
});

test('missing knee landmarks fail readiness safely', async ({ page }) => {
  await page.goto('/?e2ePose=synthetic&e2eScenario=missing-knee');
  await page.getByRole('option', { name: /Rivera/ }).first().click();
  await page.getByRole('button', { name: /Knee Flexion AROM/ }).click();
  await expect(page.getByText('TRIAL 1/3')).toBeVisible();
  // Occluded knee chain: suspended confidence, never proceeds to Hold still.
  await expect(page.getByText('SUSPENDED')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(5000);
  await expect(page.getByText('Hold still')).not.toBeVisible();
  await expect(page.getByText('Trial 1 complete')).not.toBeVisible();
});

test('valid movement fixture progresses past positioning', async ({ page }) => {
  await page.goto('/?e2ePose=synthetic');
  await page.getByRole('option', { name: /Rivera/ }).first().click();
  await page.getByRole('button', { name: /Knee Flexion AROM/ }).click();
  await expect(page.getByText('TARGET LOCKED')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Hold still')).toBeVisible({ timeout: 30000 });
});

test('trunk-lean fixture raises a compensation finding', async ({ page }) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await page.goto('/?e2ePose=synthetic&e2eScenario=trunk-lean');
  await page.getByRole('option', { name: /Rivera/ }).first().click();
  await page.getByRole('button', { name: /Knee Flexion AROM/ }).click();
  await expect(page.getByText('ASSESSMENT COMPLETE')).toBeVisible({ timeout: 280000 });
  await expect(page.getByText('BEST ROM')).toBeVisible();
  await expect(page.getByText('FINDINGS')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/EXCESSIVE TRUNK STRATEGY/)).toBeVisible();
  expect(errors).toEqual([]);
});
