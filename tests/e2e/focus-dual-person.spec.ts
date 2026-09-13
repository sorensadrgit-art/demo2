import { test, expect } from '@playwright/test';

/**
 * DUAL-PERSON AUTOLOCK ACCEPTANCE (KineLab Autolock V2 + zero-chrome overlay).
 *
 * Scenario `therapist-crossing` feeds TWO detections through the SAME pipeline
 * (PatientIdentityManager → smoother → angles → gates):
 *  - window 1: the patient performs knee-flexion cycles while a LARGER
 *    therapist walks THROUGH the frame mid-trial (partial occlusion);
 *  - window 2 (stress): the therapist crosses again, the patient FULLY hides
 *    (therapist alone in frame, high score — must NOT match), then the
 *    patient returns and is reacquired.
 *
 * The test performs ZERO clicks after protocol select. Acceptance requires:
 *  1. Automatic acquisition with no taps.
 *  2. Zero identity switches across both windows (window probe).
 *  3. Zero candidate boxes drawn during Focus capture (canvas counter).
 *  4. Zero wrong-person overlay frames (canvas counter).
 *  5. Reacquisition of the ORIGINAL patient after the full-hide window.
 *  6. A completed trial on the ORIGINAL patient (TRIAL header advances).
 */

interface Probe {
  identity: { activeId: number | null; state: string; idSwitches: number; samples: number } | null;
  boxes: number | null;
  wrong: number | null;
}

async function readProbe(page: Parameters<Parameters<typeof test>[1]>[0]): Promise<Probe> {
  return page.evaluate(() => ({
    identity: (window as unknown as { __kinelabIdentity?: Probe['identity'] }).__kinelabIdentity ?? null,
    boxes: (window as unknown as { __kinelabBoxesDrawn?: number }).__kinelabBoxesDrawn ?? null,
    wrong: (window as unknown as { __kinelabWrongOverlayFrames?: number }).__kinelabWrongOverlayFrames ?? null,
  }));
}

test('dual-person crossing: autolock holds the patient, zero chrome, trial completes', async ({ page }) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  const failed: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 160)}`); });
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url().slice(0, 100)}`); });

  let clicks = 0;
  // Reacquisition evidence: poll the probe through BOTH crossing windows and
  // record every (state, activeId) transition with a timestamp.
  const transitions: Array<{ t: number; state: string; activeId: number | null }> = [];
  let lastKey = '';
  const t0 = Date.now();
  const poller = setInterval(() => {
    void page.evaluate(() => ({
      identity: (window as unknown as { __kinelabIdentity?: { activeId: number | null; state: string } }).__kinelabIdentity ?? null,
    })).then((p) => {
      if (!p.identity) return;
      const key = `${p.identity.state}:${p.identity.activeId}`;
      if (key !== lastKey) {
        lastKey = key;
        transitions.push({ t: Date.now() - t0, state: p.identity.state, activeId: p.identity.activeId });
      }
    }).catch(() => {});
  }, 500);

  await page.goto('/?e2ePose=synthetic&e2eScenario=therapist-crossing');
  await expect(page.getByText('KINELAB')).toBeVisible();
  await expect(page.getByText('Who is the patient?')).toBeVisible();

  await page.getByRole('option', { name: /Rivera/ }).first().click();
  clicks += 1;
  await expect(page.getByText('what are we testing?')).toBeVisible();
  await page.getByRole('button', { name: /Knee Flexion AROM/ }).click();
  clicks += 1;
  await expect(page.getByText('TRIAL 1/3')).toBeVisible();
  await expect(page.getByText('E2E TEST INPUT')).toBeVisible();

  // Automatic acquisition: readiness without any further interaction.
  await expect(page.getByText('Hold still')).toBeVisible({ timeout: 30000 });
  const firstProbe = await readProbe(page);
  const originalId = firstProbe.identity?.activeId;
  expect(originalId).not.toBeNull();

  // The trial must progress on the original patient DESPITE both windows:
  // the header advances past TRIAL 1/3 (trial-complete → ready-next flow) or
  // the assessment completes. Either proves measurement continuity.
  const progressed = await Promise.race([
    page.getByText('TRIAL 2/3').waitFor({ timeout: 240000 }).then(() => 'trial-2' as const),
    page.getByText('ASSESSMENT COMPLETE').waitFor({ timeout: 240000 }).then(() => 'done' as const),
  ]).catch(() => 'stalled' as const);
  clearInterval(poller);
  expect(progressed).not.toBe('stalled');

  const probe = await readProbe(page);

  // Identity continuity: exactly one patient, never switched.
  expect(probe.identity).not.toBeNull();
  expect(probe.identity!.samples).toBeGreaterThan(0);
  expect(probe.identity!.idSwitches).toBe(0);
  expect(probe.identity!.activeId).not.toBeNull();

  // Reacquisition: after the full-hide window the ORIGINAL patient is back.
  expect(probe.identity!.activeId).toBe(originalId);

  // Zero chrome: no candidate rectangles drawn during Focus capture.
  expect(probe.boxes).not.toBeNull();
  expect(probe.boxes).toBe(0);

  // Zero wrong-person overlays across the whole scenario.
  expect(probe.wrong).not.toBeNull();
  expect(probe.wrong).toBe(0);

  // Only the two setup taps happened (patient + protocol); capture is tap-free.
  expect(clicks).toBe(2);

  // Reacquisition evidence for the report: transitions + latency estimate.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    dualPersonTransitions: transitions,
    originalId,
    finalId: probe.identity!.activeId,
    idSwitches: probe.identity!.idSwitches,
    trialProgressed: progressed,
  }));

  await page.screenshot({ path: 'test-results/e2e-crossing-final.png' });
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
});
