/**
 * LeadershipActionPanel — CEO/COO-only action panel.
 * Shows leadership-appropriate actions: approve, confirm payment, add credentials, review.
 * NEVER shows: Start trial setup, Day 1 outreach, Email/Call execution, Log setup result.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Lead } from '@/types/crm';
import { hasValidCredentials, TEAM_MEMBERS, PLAN_LABELS, PLAN_PRICES } from '@/types/crm';
import type { StepOutcome } from '@/engine/decision-engine';
import {
  type CanonicalLeadView,
  getCanonicalDisplayState,
} from '@/engine/canonical-view';
import {
  Shield, CreditCard, Key, CheckCircle, Eye, Clock,
  AlertCircle, Info, ChevronRight, User,
} from 'lucide-react';

interface LeadershipActionPanelProps {
  lead: Lead;
  /** Canonical view — single source of visible truth */
  view: CanonicalLeadView;
  onAction?: (action: 'call' | 'email' | 'linkedin' | 'meeting' | 'credentials' | 'approve' | 'payment' | 'trial-setup') => void;
  onOutcomeSubmit?: (outcome: StepOutcome, notes: string) => void;
}

export function LeadershipActionPanel({ lead, view, onAction, onOutcomeSubmit }: LeadershipActionPanelProps) {
  const [noteText, setNoteText] = useState('');
  const owner = TEAM_MEMBERS.find(m => m.id === lead.assignedTo);
  const hasCreds = hasValidCredentials(lead);
  const display = getCanonicalDisplayState(view);
  // CANONICAL gating — no raw stage checks here.
  const needsApproval = view.permissions.canApproveTrial;
  const isPaymentAction = view.permissions.canConfirmPayment;
  const canAddCreds = view.permissions.canEditCredentials
    && (view.bucket === 'trial_pending_approval' || view.bucket === 'trial_ready_to_start_blocked')
    && !hasCreds;
  const isActionable = needsApproval || isPaymentAction || canAddCreds;

  const urgencyStyles = {
    critical: 'bg-destructive/5 border-destructive/20',
    'action-needed': 'bg-warning/5 border-warning/20',
    'on-track': 'bg-secondary/50 border-muted',
    waiting: 'bg-secondary/30 border-muted/50',
  };

  return (
    <div className={cn("rounded-lg border p-3 space-y-2.5", urgencyStyles[display.urgency])}>
      {/* Status summary */}
      <div className="flex items-start gap-2">
        <div className={cn("w-2 h-2 rounded-full mt-1.5 shrink-0",
          display.urgency === 'critical' ? 'bg-destructive' :
          display.urgency === 'action-needed' ? 'bg-warning' :
          'bg-success'
        )} />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-muted-foreground">{display.summary}</p>
          <p className="text-sm font-semibold leading-tight mt-0.5">{display.nextAction}</p>
          {(display.urgency === 'critical' || display.urgency === 'action-needed') && display.reason && (
            <p className="text-[11px] text-muted-foreground mt-0.5">{display.reason}</p>
          )}
        </div>
      </div>

      {/* Owner attribution */}
      {owner && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <User className="h-2.5 w-2.5" />
          <span>Owner: {owner.name}</span>
          {lead.subscriptionPlan && (
            <>
              <span>·</span>
              <span>{PLAN_LABELS[lead.subscriptionPlan]} · ${PLAN_PRICES[lead.subscriptionPlan]}/mo</span>
            </>
          )}
        </div>
      )}

      {/* Approval action — ONLY when canonical permissions allow it */}
      {needsApproval && (
        <div className="space-y-2 pt-1">
          {/* Blocker checklist */}
          <div className="space-y-1 text-xs">
            <div className="flex items-center gap-2">
              {lead.approvedBy
                ? <CheckCircle className="h-3 w-3 text-success" />
                : <AlertCircle className="h-3 w-3 text-warning" />}
              <span>{lead.approvedBy ? 'Approved' : 'Approval needed'}</span>
            </div>
            <div className="flex items-center gap-2">
              {hasCreds
                ? <CheckCircle className="h-3 w-3 text-success" />
                : <AlertCircle className="h-3 w-3 text-warning" />}
              <span>{hasCreds ? 'Credentials added' : 'Credentials missing'}</span>
            </div>
            {lead.platform && (
              <div className="flex items-center gap-2">
                <Info className="h-3 w-3 text-muted-foreground" />
                <span>Platform: {lead.platform}</span>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-xs flex-1" onClick={() => onAction?.('approve')}>
              <Shield className="h-3 w-3 mr-1" /> Approve Trial
            </Button>
            {!hasCreds && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onAction?.('credentials')}>
                <Key className="h-3 w-3 mr-1" /> Add Credentials
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Payment confirmation — leadership only */}
      {isPaymentAction && (
        <div className="flex gap-2 pt-1">
          <Button size="sm" className="h-7 text-xs flex-1" onClick={() => onAction?.('payment')}>
            <CreditCard className="h-3 w-3 mr-1" /> Confirm Payment
          </Button>
        </div>
      )}

      {/* Approved but credentials missing — leadership can add (canonical-driven) */}
      {!needsApproval && canAddCreds && (
        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => onAction?.('credentials')}>
            <Key className="h-3 w-3 mr-1" /> Add Credentials
          </Button>
        </div>
      )}

      {/* Non-actionable — read-only status for leadership */}
      {!isActionable && (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <Eye className="h-3 w-3" />
          <span>{(() => {
            const role = view.nextActionOwnerRole;
            const who = role === 'onboarding' ? 'onboarding'
              : role === 'sdr' ? 'sales'
              : role === 'automation' ? 'automation'
              : role === 'leadership' ? 'leadership'
              : null;
            return who ? `With ${who}` : 'Read-only';
          })()}</span>
        </div>
      )}
    </div>
  );
}
