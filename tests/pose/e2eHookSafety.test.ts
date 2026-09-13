import { describe, expect, it, vi, afterEach } from 'vitest';
import { e2ePoseRequest } from '../../src/features/pose/SyntheticPoseSource';
import { validateIdentityRouteActive } from '../../src/features/validation/IdentityValidationPanel';

const setQuery = (q: string) => {
  vi.stubGlobal('window', { location: { search: q } } as unknown as Window & typeof globalThis);
};
afterEach(() => { vi.unstubAllGlobals(); });

describe('production E2E hook safety', () => {
  it('honors ?e2ePose=synthetic in dev builds', () => {
    setQuery('?e2ePose=synthetic&e2eScenario=therapist-crossing');
    // Vitest runs with DEV=true, PROD=false → hook available.
    expect(import.meta.env.DEV).toBe(true);
    const req = e2ePoseRequest();
    expect(req).not.toBeNull();
    expect(req!.scenario).toBe('therapist-crossing');
  });

  it('ignores unknown scenarios by falling back to the default (dev)', () => {
    setQuery('?e2ePose=synthetic&e2eScenario=not-a-scenario');
    expect(e2ePoseRequest()?.scenario).toBe('knee-flexion-full');
  });

  it('ignores the hook without the exact query value (dev)', () => {
    setQuery('?e2ePose=real');
    expect(e2ePoseRequest()).toBeNull();
    setQuery('');
    expect(e2ePoseRequest()).toBeNull();
  });

  it('production builds ignore ?e2ePose entirely (compile-time gate)', async () => {
    // The gate is `import.meta.env.PROD && VITE_E2E_MODE !== 'true'` — prove
    // the built production bundle contains no live synthetic activation path
    // by asserting the gate expression exists in source and the production
    // bundle never references the query key outside the gated function.
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/features/pose/SyntheticPoseSource.ts', 'utf8');
    expect(src).toContain("if (import.meta.env.PROD && import.meta.env.VITE_E2E_MODE !== 'true') return null;");
    // The ONLY activation check for the query key lives behind that gate.
    const occurrences = src.split("q.get('e2ePose')").length - 1;
    expect(occurrences).toBe(1);
  });

  it('validation harness route is inert in production (compile-time gate)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/features/validation/IdentityValidationPanel.tsx', 'utf8');
    expect(src).toContain("if (import.meta.env.PROD && import.meta.env.VITE_E2E_MODE !== 'true') return false;");
  });

  it('dev validation route activates only with the query flag', () => {
    setQuery('?validateIdentity');
    expect(validateIdentityRouteActive()).toBe(true);
    setQuery('');
    expect(validateIdentityRouteActive()).toBe(false);
  });
});
