/**
 * StageMoveSheet — Mobile-friendly "Move to stage" action sheet.
 * Tap a card → see valid next stages → tap to move → stage-specific modal opens.
 * Works as a Drawer on mobile viewports.
 */
import { useMemo } from 'react';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Lead, STAGE_LABELS } from '@/types/crm';
import { getCanonicalState } from '@/engine/canonical-state';
import {
  ArrowRight, Mail, MessageCircle, Calendar,
  XCircle, CheckCircle, Eye, Snowflake, HelpCircle, Send,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Valid forward transitions per SDR column
// Simplified SDR pipeline transitions (Part 1).
// Old trial/pricing semantics removed from SDR flow.
const SDR_TRANSITIONS: Record<string, { key: string; label: string; description: string; icon: typeof Mail }[]> = {
  new_lead: [
    { key: 'contacted', label: 'Contacted', description: 'Outreach started', icon: Mail },
    { key: 'closed', label: 'Closed Lost', description: 'Close with reason', icon: XCircle },
  ],
  contacted: [
    { key: 'replied', label: 'Replied', description: 'Lead responded', icon: MessageCircle },
    { key: 'cold', label: 'Cold', description: 'No response yet', icon: Snowflake },
    { key: 'closed', label: 'Closed Lost', description: 'Not proceeding', icon: XCircle },
  ],
  replied: [
    { key: 'meeting_booked', label: 'Meeting Scheduled', description: 'Business conversation scheduled', icon: Calendar },
    { key: 'cold', label: 'Cold', description: 'Recoverable later', icon: Snowflake },
    { key: 'closed', label: 'Closed Lost', description: 'Not interested', icon: XCircle },
  ],
  meeting_booked: [
    { key: 'meeting_completed', label: 'Meeting Done', description: 'Log meeting outcome', icon: CheckCircle },
    { key: 'cold', label: 'Cold', description: 'No show or no outcome', icon: Snowflake },
    { key: 'closed', label: 'Closed Lost', description: 'Cancelled', icon: XCircle },
  ],
  meeting_completed: [
    { key: 'internal_decision', label: 'Decision Pending', description: 'Awaiting client decision', icon: HelpCircle },
    { key: 'trial_proposed', label: 'Moved to Client Review', description: 'Leadership review', icon: Send },
    { key: 'cold', label: 'Cold', description: 'Stalled after meeting', icon: Snowflake },
    { key: 'closed', label: 'Closed Lost', description: 'Not a fit', icon: XCircle },
  ],
  internal_decision: [
    { key: 'trial_proposed', label: 'Moved to Client Review', description: 'Leadership review', icon: Send },
    { key: 'cold', label: 'Cold', description: 'Inactive, recoverable', icon: Snowflake },
    { key: 'closed', label: 'Closed Lost', description: 'Decision was no', icon: XCircle },
  ],
  pricing_discussion: [
    { key: 'trial_proposed', label: 'Moved to Client Review', description: 'Leadership review', icon: Send },
    { key: 'cold', label: 'Cold', description: 'Inactive, recoverable', icon: Snowflake },
    { key: 'closed', label: 'Closed Lost', description: 'Not a fit', icon: XCircle },
  ],
  // Leadership-owned: SDR awareness only, no SDR transitions.
  trial_proposed: [],
  trial_active: [],
  cold: [
    { key: 'replied', label: 'Replied', description: 'Lead responded again', icon: MessageCircle },
    { key: 'meeting_booked', label: 'Meeting Scheduled', description: 'Meeting booked', icon: Calendar },
    { key: 'closed', label: 'Closed Lost', description: 'Final close', icon: XCircle },
  ],
  converted: [],
  closed: [],
};

type PipelineView = 'list' | 'sdr_flow' | 'inbound';

interface StageMoveSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead | null;
  currentColumnKey: string;
  view: PipelineView;
  onMoveToStage: (lead: Lead, targetColumnKey: string) => void;
  onViewDetails: (lead: Lead) => void;
}

export function StageMoveSheet({
  open, onOpenChange, lead, currentColumnKey, view, onMoveToStage, onViewDetails,
}: StageMoveSheetProps) {
  const transitions = useMemo(() => {
    if (!lead) return [];
    return SDR_TRANSITIONS[currentColumnKey] || [];
  }, [lead, currentColumnKey, view]);

  if (!lead) return null;

  const cs = getCanonicalState(lead);
  const owner = lead.assignedTo;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="pb-2">
          <DrawerTitle className="text-base flex items-center gap-2">
            {lead.companyName}
            <Badge variant="outline" className={cn("text-[10px]", cs.primary_badge.color)}>
              {cs.primary_badge.label}
            </Badge>
          </DrawerTitle>
          <DrawerDescription className="text-xs">
            {lead.contactName} · {cs.next_action_label || 'Select next action'}
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-6 space-y-3">
          {/* View details button */}
          <Button
            variant="outline"
            className="w-full justify-start gap-2 h-10"
            onClick={() => { onOpenChange(false); onViewDetails(lead); }}
          >
            <Eye className="h-4 w-4 text-muted-foreground" />
            View full record
          </Button>

          {/* Stage transitions */}
          {transitions.length > 0 && (
            <>
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Move to stage
              </p>
              <div className="space-y-1.5">
                {transitions.map(t => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.key}
                      className="flex items-center gap-3 w-full text-left p-3 rounded-lg border hover:border-primary/40 hover:bg-secondary/30 transition-colors"
                      onClick={() => {
                        onOpenChange(false);
                        onMoveToStage(lead, t.key);
                      }}
                    >
                      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium block">{t.label}</span>
                        <span className="text-[11px] text-muted-foreground">{t.description}</span>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {transitions.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              No forward transitions from this stage.
            </p>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
