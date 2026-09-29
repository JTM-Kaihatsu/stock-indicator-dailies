/** How much of a manual-refresh cooldown remains, in the same coarse
 * buckets a watchlisted ticker's refresh button already used before this
 * became shared: exact minutes aren't the point, just enough to know
 * whether it's "any second now" or "go do something else." */
export function formatCooldown(msRemaining: number): string {
  const mins = Math.ceil(msRemaining / 60000);
  if (mins <= 1) return 'in under a minute';
  if (mins < 60) return `in ~${mins} min`;
  return 'in ~1 hr';
}
