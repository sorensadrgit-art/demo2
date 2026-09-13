"""Validation statistics: MAE/RMSE/bias/Pearson/Bland-Altman (+ explicit ICC)."""
from __future__ import annotations

import math


def mae(a: list[float], b: list[float]) -> float:
    return sum(abs(x - y) for x, y in zip(a, b)) / max(1, len(a))


def rmse(a: list[float], b: list[float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)) / max(1, len(a)))


def bias(a: list[float], b: list[float]) -> float:
    return sum(x - y for x, y in zip(a, b)) / max(1, len(a))


def pearson_r(a: list[float], b: list[float]) -> float:
    n = len(a)
    if n < 2:
        return float("nan")
    ma, mb = sum(a) / n, sum(b) / n
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    den = math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))
    return num / den if den > 0 else float("nan")


def bland_altman(kinelab: list[float], reference: list[float]) -> dict:
    diffs = [k - r for k, r in zip(kinelab, reference)]
    n = len(diffs)
    mean = sum(diffs) / max(1, n)
    sd = math.sqrt(sum((d - mean) ** 2 for d in diffs) / max(1, n - 1)) if n > 1 else 0.0
    return {
        "meanDifference": mean,
        "sdDifferences": sd,
        "upperLoA": mean + 1.96 * sd,
        "lowerLoA": mean - 1.96 * sd,
        "n": n,
    }


def icc_3_1(targets: list[list[float]]) -> float:
    """ICC(3,1): two-way mixed, single measurement, consistency. Explicit only."""
    import numpy as np

    X = np.asarray(targets, dtype=float)
    n, k = X.shape
    mean = X.mean()
    row_mean = X.mean(axis=1, keepdims=True)
    col_mean = X.mean(axis=0, keepdims=True)
    ss_total = float(((X - mean) ** 2).sum())
    ss_rows = float((k * (row_mean - mean) ** 2).sum())
    ss_cols = float((n * (col_mean - mean) ** 2).sum())
    ss_err = ss_total - ss_rows - ss_cols
    ms_rows = ss_rows / (n - 1)
    ms_err = ss_err / ((n - 1) * (k - 1))
    return float((ms_rows - ms_err) / (ms_rows + (k - 1) * ms_err))


def full_report(kinelab: list[float], reference: list[float], unit: str) -> dict:
    return {
        "unit": unit,
        "n": len(kinelab),
        "mae": mae(kinelab, reference),
        "rmse": rmse(kinelab, reference),
        "bias": bias(kinelab, reference),
        "pearsonR": pearson_r(kinelab, reference),
        "blandAltman": bland_altman(kinelab, reference),
    }
