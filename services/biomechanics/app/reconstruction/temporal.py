"""Temporal filtering with explicit gap handling: raw and filtered kept separately."""
from __future__ import annotations

import math


class OneEuroFilter:
    def __init__(self, min_cutoff=1.0, beta=0.05, d_cutoff=1.0):
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.d_cutoff = d_cutoff
        self._x_prev: float | None = None
        self._dx_prev = 0.0
        self._t_prev: float | None = None

    @staticmethod
    def _alpha(cutoff: float, dt: float) -> float:
        tau = 1.0 / (2 * math.pi * cutoff)
        return 1.0 / (1.0 + tau / dt)

    def update(self, x: float, t: float) -> float:
        if self._x_prev is None or self._t_prev is None:
            self._x_prev, self._t_prev = x, t
            return x
        dt = max(1e-6, t - self._t_prev)
        dx = (x - self._x_prev) / dt
        a_d = self._alpha(self.d_cutoff, dt)
        dx_hat = a_d * dx + (1 - a_d) * self._dx_prev
        cutoff = self.min_cutoff + self.beta * abs(dx_hat)
        a = self._alpha(cutoff, dt)
        x_hat = a * x + (1 - a) * self._x_prev
        self._x_prev, self._dx_prev, self._t_prev = x_hat, dx_hat, t
        return x_hat

    def reset_gap(self):
        self._x_prev = None
        self._t_prev = None
        self._dx_prev = 0.0


def filter_trajectory(
    samples: list[tuple[float, float | None]], gap_s: float = 0.25, **kw
) -> list[float | None]:
    """Filter a (t, value) series; None = gap: state resets, gap stays explicit."""
    f = OneEuroFilter(**kw)
    out: list[float | None] = []
    prev_t: float | None = None
    for t, v in samples:
        if v is None or (prev_t is not None and t - prev_t > gap_s):
            f.reset_gap()
            out.append(None)
        else:
            out.append(f.update(v, t))
        if v is not None:
            prev_t = t
    return out
