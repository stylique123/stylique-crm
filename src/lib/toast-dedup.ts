/**
 * Toast deduplication — max 1 visible toast per record+event combo.
 * Prevents stacking and repeated feedback.
 */
import { toast } from 'sonner';

const recentToasts = new Map<string, number>();
const DEDUP_WINDOW_MS = 3000;

function dedup(key: string): boolean {
  const now = Date.now();
  const last = recentToasts.get(key);
  if (last && now - last < DEDUP_WINDOW_MS) return false;
  recentToasts.set(key, now);
  // Cleanup old entries periodically
  if (recentToasts.size > 50) {
    for (const [k, t] of recentToasts) {
      if (now - t > DEDUP_WINDOW_MS * 2) recentToasts.delete(k);
    }
  }
  return true;
}

/** Show one success toast, deduplicated by leadId + event. Non-blocking, bottom-right (Sonner). */
export function showActionToast(
  leadId: string,
  event: string,
  title: string,
  description?: string,
) {
  const key = `${leadId}:${event}`;
  if (!dedup(key)) return;
  toast.success(title, {
    description: description || undefined,
    duration: 2200,
  });
}

/** Show one error toast, deduplicated */
export function showErrorToast(key: string, title: string, description?: string) {
  if (!dedup(`err:${key}`)) return;
  toast.error(title, {
    description: description || undefined,
    duration: 2800,
  });
}

/** Lightweight info toast — non-blocking */
export function showInfoToast(key: string, title: string) {
  if (!dedup(`info:${key}`)) return;
  toast(title, { duration: 1800 });
}
