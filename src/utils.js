export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

export function formatDuration(ms) {
  if (!ms || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
}

export const withDefault = (v, d = "—") =>
  v === undefined || v === null ? d : v;
