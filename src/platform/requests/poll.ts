type RefreshResult = { ok: true; data: { status: string } } | { ok: false };

/**
 * Refreshes each shown request (one at a time) and reports whether the server's status differs from what the page shows.
 * Compares with the page, not with this poll's own transitions: another viewer may already have saved the change.
 */
export async function pollShownStatuses(
  shown: Record<string, string>,
  refresh: (input: { id: string }) => Promise<RefreshResult>,
  stopped: () => boolean = () => false,
): Promise<boolean> {
  let stale = false;
  for (const [id, status] of Object.entries(shown)) {
    if (stopped()) break;
    const res = await refresh({ id });
    if (res.ok && res.data.status !== status) stale = true;
  }
  return stale;
}
