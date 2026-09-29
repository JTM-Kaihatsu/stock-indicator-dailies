/** How much of a manual-refresh cooldown remains, in coarse buckets: exact
 * minutes aren't the point, just enough to know whether it's "any second
 * now" or "go do something else." Uncapped past an hour (unlike this
 * function's original single-cooldown version, which flattened anything
 * over 60 minutes to a blanket "in ~1 hr"): the market-hours guardrail in
 * apps/api/src/refreshCooldown.ts can legitimately leave many hours, or an
 * entire weekend, remaining, and showing "in ~1 hr" for a wait that's
 * actually not over until Monday would be actively misleading rather than
 * just coarse. */
export function formatCooldown(msRemaining: number): string {
  const mins = Math.ceil(msRemaining / 60000);
  if (mins <= 1) return 'in under a minute';
  if (mins < 60) return `in ~${mins} min`;
  const hours = Math.ceil(mins / 60);
  if (hours < 24) return `in ~${hours} hr`;
  const days = Math.ceil(hours / 24);
  return `in ~${days} day${days === 1 ? '' : 's'}`;
}
