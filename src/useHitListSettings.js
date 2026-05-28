import { useCallback, useState } from 'react';

// ─── TCG Hitlist Display Settings ────────────────────────────────────────────
// Persisted to localStorage so they survive page refreshes.
// URL query params (pageSize, refreshMs) still override these as before.

const STORAGE_KEY = 'tcg-hitlist-display-settings';

export const DEFAULTS = {
  /** Cards displayed per page before auto-advancing. */
  pageSize: 9,
  /** Fixed grid column count (0 = auto/responsive). */
  columns: 3,
  /** How often (ms) to re-fetch data from the API. */
  refreshMs: 60_000,
  /** How often (ms) the display auto-advances to the next page. */
  pageRotationMs: 15_000,
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

function sanitize(raw) {
  return {
    pageSize: clamp(raw.pageSize, 1, 60) ?? DEFAULTS.pageSize,
    columns: clamp(raw.columns, 0, 10) ?? DEFAULTS.columns,
    refreshMs: clamp(raw.refreshMs, 10_000, 3_600_000) ?? DEFAULTS.refreshMs,
    pageRotationMs: clamp(raw.pageRotationMs, 3_000, 300_000) ?? DEFAULTS.pageRotationMs,
  };
}

export function useHitListSettings() {
  const [settings, setSettings] = useState(() => sanitize({ ...DEFAULTS, ...load() }));

  const update = useCallback((patch) => {
    setSettings(prev => {
      const next = sanitize({ ...prev, ...patch });
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch { /* storage unavailable */ }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setSettings(sanitize({ ...DEFAULTS }));
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
  }, []);

  return { settings, update, reset };
}
