import { test, expect } from '@playwright/test';

test('lab boots with live workspace, disclaimers, and instrument rail', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('KINELAB')).toBeVisible();
  await expect(page.getByLabel('Live motion analysis view')).toBeVisible();
  await expect(page.getByText('not medically validated').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /RECORD TRIAL/ })).toBeVisible();
});
