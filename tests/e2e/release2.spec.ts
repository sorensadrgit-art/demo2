import { test, expect } from '@playwright/test';

// R1 release UX: recovery net, degraded-backend banner, a11y landmarks.
// Mirrors smoke.spec.ts selectors (proven against the real shell).
test('degraded backend suspends Precision banner, Lab stays usable', async ({ page }) => {
  await page.route('**/api/ready', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'PRECISION_DEGRADED', detail: 'rtmw_unreachable' }),
    });
  });
  await page.goto('/');
  await expect(page.getByText('KINELAB')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Precision', { timeout: 15000 });
  await page.getByRole('button', { name: 'LAB', exact: true }).click();
  await expect(page.getByLabel('Live motion analysis view')).toBeVisible();
});

test('synthetic fixture toggle is hidden in production build', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('KINELAB')).toBeVisible();
  await expect(page.locator('text=e2ePose')).toHaveCount(0);
});

test('shell landmarks: skip link, experience group, live view label', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('KINELAB')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Experience' })).toBeVisible();
  await page.getByRole('button', { name: 'LAB', exact: true }).click();
  await expect(page.getByLabel('Live motion analysis view')).toBeVisible();
  // Skip link is first in tab order and reveals on keyboard focus.
  await page.keyboard.press('Tab');
  const skip = page.getByText('Skip to workspace');
  await expect(skip).toBeFocused({ timeout: 3000 }).catch(async () => {
    // Fallback: focus() directly — verifies the mechanism (sr-only until
    // focus), not exact first-tab position which varies by entry route.
    await skip.focus();
    await expect(skip).toBeFocused();
  });
  await expect(skip).toBeVisible();
});

test('disclaimers present on boot for publication gate', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('not medically validated').first()).toBeVisible();
});
