import React from 'react';

interface State { error: Error | null }

function safeStart(): void {
  try {
    window.localStorage.removeItem('kinelab:ui');
    window.sessionStorage.clear();
  } catch { /* storage may be unavailable; navigation still recovers */ }
  window.location.assign('/');
}

/** Production error boundary: professional recovery, no raw stacks to users. */
export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    if (!import.meta.env.PROD) {
      // eslint-disable-next-line no-console
      console.error('[KineLab] render failure', error, info.componentStack);
    }
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#04070d] p-8 text-center text-slate-100" role="alert">
        <h1 className="text-lg font-extrabold tracking-widest">SOMETHING WENT WRONG</h1>
        <p className="max-w-md text-sm text-slate-400">
          KineLab hit an unexpected interface error. Your captured evidence and saved
          sessions are untouched. Retry, or return to a safe start.
        </p>
        {!import.meta.env.PROD && (
          <pre className="max-w-full overflow-auto rounded bg-black/60 p-3 text-left text-[11px] text-red-300">
            {String(error.message)}
          </pre>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="rounded bg-sky-500/25 px-4 py-2 text-sm font-bold text-sky-100 ring-1 ring-sky-400/50"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={safeStart}
            className="rounded bg-white/10 px-4 py-2 text-sm font-bold text-slate-200 ring-1 ring-white/20"
          >
            Return to safe start
          </button>
        </div>
      </div>
    );
  }
}
