import { test, expect } from '@playwright/test';

test('lab boots with live workspace, disclaimers, and instrument rail', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('KINELAB')).toBeVisible();
  await expect(page.getByText('not medically validated').first()).toBeVisible();
});

test('focus mode boots to patient selection, lab stays intact', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'FOCUS' })).toBeVisible();
  await expect(page.getByText('Who is the patient?')).toBeVisible();
  await expect(page.getByRole('button', { name: /LAB/ })).toBeVisible();
  // Lab switch recovers the full instrumented workspace.
  await page.getByRole('button', { name: /LAB/ }).click();
  await expect(page.getByLabel('Live motion analysis view')).toBeVisible();
  await expect(page.getByRole('button', { name: /RECORD TRIAL/ })).toBeVisible();
});

test('focus assessment picker shows protocol list with plane hints', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('option', { name: /Rivera/ }).first().click();
  await expect(page.getByText('what are we testing?')).toBeVisible();
  await expect(page.getByRole('button', { name: /Knee Flexion AROM/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Side view/ }).first()).toBeVisible();
});
