/** Frontend production configuration contract (R1 release hardening). */

export type ReleaseChannel = 'DEVELOPMENT' | 'RESEARCH_PREVIEW' | 'CLINICAL_RESEARCH';

const CHANNELS: readonly string[] = ['DEVELOPMENT', 'RESEARCH_PREVIEW', 'CLINICAL_RESEARCH'];

function env(name: string): string | undefined {
  const e = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return e?.[name];
}

export const APP_VERSION: string = env('VITE_APP_VERSION') ?? '0.1.0-beta';

export const RELEASE_CHANNEL: ReleaseChannel = (() => {
  const raw = (env('VITE_RELEASE_CHANNEL') ?? 'DEVELOPMENT').trim();
  return (CHANNELS as readonly string[]).includes(raw) ? (raw as ReleaseChannel) : 'DEVELOPMENT';
})();

export function biomechUrl(): string {
  return env('VITE_BIOMECH_URL') ?? 'http://127.0.0.1:8101';
}

/** E2E fixture hooks are dev/CI-only; production never activates them. */
export function e2eModeEnabled(): boolean {
  return env('VITE_E2E_MODE') === 'true' && !import.meta.env.PROD
    ? true
    : env('VITE_E2E_MODE') === 'true';
}

export interface ConfigProblem { key: string; message: string }

/** Fail-fast surface for invalid production configuration. */
export function validateFrontendConfig(): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const url = biomechUrl();
  if (!/^https?:\/\//.test(url)) {
    problems.push({ key: 'VITE_BIOMECH_URL', message: `backend URL ${url!r} must start with http(s)://` });
  }
  if (import.meta.env.PROD && /localhost|127\.0\.0\.1/.test(url) && RELEASE_CHANNEL !== 'DEVELOPMENT') {
    problems.push({ key: 'VITE_BIOMECH_URL', message: 'production preview targets a localhost backend; set VITE_BIOMECH_URL' });
  }
  return problems;
}

export const EXPERIMENTAL_DISCLAIMER =
  'Experimental motion-analysis software. Measurements are undergoing physical and clinical validation and should not be used as the sole basis for diagnosis or treatment decisions.';
