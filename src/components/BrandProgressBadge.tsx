/**
 * BrandProgressBadge — Pre-outreach contact gate ONLY.
 *
 * Active pipeline cards must NOT show this. The 2-contact rule is a *precondition*
 * to enter active outreach (enforced at lead creation). Once a brand is in active
 * SDR outreach, contact coverage is no longer surfaced as a progress badge.
 *
 * This component now renders nothing for any active-pipeline lead. It only fires
 * the "Add 2nd contact" prompt when explicitly used in pre-outreach flows
 * (e.g. inside a research/draft view, NOT on pipeline cards).
 */

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { UserPlus } from 'lucide-react';
import type { Lead } from '@/types/crm';
import { getBrandProgress } from '@/engine/kpi-integration';

type Size = 'sm' | 'md';

interface BrandProgressBadgeProps {
  lead: Lead;
  size?: Size;
  /** Pre-outreach gate only. Pipeline cards must pass false (or omit). */
  showAddPrompt?: boolean;
  className?: string;
}

const PRE_OUTREACH_STAGES = ['sdr-new-lead', 'new-lead', 'lead-added', 'inbound-new', 'new-inquiry'];

export function BrandProgressBadge({ lead, size = 'sm', showAddPrompt = false, className }: BrandProgressBadgeProps) {
  if (!showAddPrompt) return null;

  // Hard rule: only surface in pre-outreach states. Once outreach has started,
  // brand coverage is not a visible progress state on pipeline cards.
  if (!PRE_OUTREACH_STAGES.includes(lead.stage)) return null;

  const bp = getBrandProgress(lead);
  if (bp.contactsTotal >= 2) return null;

  const isSmall = size === 'sm';
  const textClass = isSmall ? 'text-[9px]' : 'text-xs';

  return (
    <Badge
      variant="outline"
      className={cn(
        'h-4 px-1.5 gap-0.5 border-warning/30 bg-warning/5 text-warning',
        textClass,
        className,
      )}
    >
      <UserPlus className="h-2.5 w-2.5" /> Add 2nd contact
    </Badge>
  );
}

/** Inline (table) variant — same rule. */
export function BrandProgressInline({ lead, className }: { lead: Lead; className?: string }) {
  if (!PRE_OUTREACH_STAGES.includes(lead.stage)) return null;
  const bp = getBrandProgress(lead);
  if (bp.contactsTotal >= 2) return null;
  return (
    <Badge variant="outline" className={cn('text-[9px] h-4 px-1.5 bg-warning/5 text-warning border-warning/20', className)}>
      +2nd
    </Badge>
  );
}
