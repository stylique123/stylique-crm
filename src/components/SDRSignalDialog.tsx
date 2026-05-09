/**
 * SDR Signal-Based Dialogs — triggered by rules, not guesswork.
 *
 * Each dialog explains WHY it appeared, shows the exact trigger,
 * asks for the exact action/outcome, and prevents dead ends.
 *
 * Types:
 * - LinkedIn accepted → send message
 * - Warm open signal → call immediately
 * - Day 5 no response → call now
 * - Post-call no response → Instagram DM
 * - LinkedIn pending → check status
 * - Reply received → classify and route
 */

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Linkedin, Phone, Instagram, MessageCircle, AlertTriangle,
  CheckCircle, XCircle, Clock, ArrowRight, Mail, ThumbsUp, ThumbsDown, HelpCircle,
} from 'lucide-react';
import type { SDRTriggerType, FallbackAction } from '@/engine/sdr-flow-engine';
import {
  type LinkedInMessageOutcome,
  type CallOutcomeSDR,
  type InstagramDMOutcome,
  type LinkedInPendingOutcome,
  type ReplyClassificationSDR,
  getFallbackActions,
} from '@/engine/sdr-flow-engine';
import type { Lead } from '@/types/crm';

// ── Outcome option definitions ────────────────────────────

interface OutcomeOption {
  value: string;
  label: string;
  description: string;
  icon: typeof CheckCircle;
  color: string;
}

const LINKEDIN_MESSAGE_OPTIONS: OutcomeOption[] = [
  { value: 'message_sent', label: 'Message sent', description: 'Personalized LinkedIn message delivered', icon: CheckCircle, color: 'border-green-500/30 hover:border-green-500' },
  { value: 'could_not_send', label: 'Could not send', description: 'Message failed or not possible', icon: XCircle, color: 'border-destructive/20 hover:border-destructive/50' },
  { value: 'account_issue', label: 'Account issue', description: 'LinkedIn account restricted or limited', icon: AlertTriangle, color: 'border-warning/30 hover:border-warning' },
  { value: 'wrong_profile', label: 'Wrong profile', description: 'Connected to wrong person', icon: XCircle, color: 'border-muted hover:border-muted-foreground' },
];

const CALL_OPTIONS: OutcomeOption[] = [
  { value: 'answered', label: 'Answered', description: 'Connected and spoke with contact', icon: CheckCircle, color: 'border-green-500/30 hover:border-green-500' },
  { value: 'no_answer', label: 'No answer', description: 'Call not picked up', icon: Phone, color: 'border-warning/30 hover:border-warning' },
  { value: 'interested', label: 'Interested', description: 'Expressed clear interest', icon: ThumbsUp, color: 'border-green-500/30 hover:border-green-500' },
  { value: 'not_interested', label: 'Not interested', description: 'Declined or not a fit', icon: ThumbsDown, color: 'border-destructive/20 hover:border-destructive/50' },
  { value: 'call_back_later', label: 'Call back later', description: 'Asked to call at another time', icon: Clock, color: 'border-primary/30 hover:border-primary' },
  { value: 'wrong_contact', label: 'Wrong contact', description: 'Reached wrong person', icon: XCircle, color: 'border-muted hover:border-muted-foreground' },
  { value: 'number_missing', label: 'No phone number', description: 'Number missing or invalid', icon: AlertTriangle, color: 'border-destructive/20 hover:border-destructive/50' },
];

const INSTAGRAM_OPTIONS: OutcomeOption[] = [
  { value: 'dm_sent', label: 'DM sent', description: 'Instagram message delivered', icon: CheckCircle, color: 'border-green-500/30 hover:border-green-500' },
  { value: 'no_account', label: 'No account found', description: 'Cannot find their Instagram', icon: XCircle, color: 'border-muted hover:border-muted-foreground' },
  { value: 'blocked', label: 'Blocked', description: 'Account blocked or restricted', icon: AlertTriangle, color: 'border-destructive/20 hover:border-destructive/50' },
  { value: 'private_unavailable', label: 'Private / unavailable', description: 'Account is private or DMs closed', icon: XCircle, color: 'border-warning/30 hover:border-warning' },
  { value: 'wrong_brand', label: 'Wrong brand account', description: 'Not the right business account', icon: XCircle, color: 'border-muted hover:border-muted-foreground' },
];

const LINKEDIN_PENDING_OPTIONS: OutcomeOption[] = [
  { value: 'still_pending', label: 'Still pending', description: 'Request not yet accepted', icon: Clock, color: 'border-warning/30 hover:border-warning' },
  { value: 'accepted', label: 'Accepted!', description: 'They accepted — send message now', icon: CheckCircle, color: 'border-green-500/30 hover:border-green-500' },
  { value: 'withdrawn', label: 'Withdrawn', description: 'Request was withdrawn', icon: XCircle, color: 'border-muted hover:border-muted-foreground' },
  { value: 'rejected', label: 'Rejected', description: 'Request was declined', icon: ThumbsDown, color: 'border-destructive/20 hover:border-destructive/50' },
  { value: 'wrong_profile', label: 'Wrong profile', description: 'Sent to wrong person', icon: AlertTriangle, color: 'border-warning/30 hover:border-warning' },
];

const REPLY_OPTIONS: OutcomeOption[] = [
  { value: 'interested', label: 'Interested', description: 'Wants to continue conversation', icon: ThumbsUp, color: 'border-green-500/30 hover:border-green-500' },
  { value: 'later', label: 'Later', description: 'Not now but maybe later', icon: Clock, color: 'border-warning/30 hover:border-warning' },
  { value: 'not_interested', label: 'Not interested', description: 'Declined or not a fit', icon: ThumbsDown, color: 'border-destructive/20 hover:border-destructive/50' },
  { value: 'wrong_person', label: 'Wrong person', description: 'Contact is not the decision maker', icon: XCircle, color: 'border-muted hover:border-muted-foreground' },
  { value: 'neutral_unclear', label: 'Neutral / unclear', description: 'Reply doesn\'t clearly indicate interest', icon: HelpCircle, color: 'border-primary/30 hover:border-primary' },
];

// ── Config per trigger type ───────────────────────────────

interface TriggerConfig {
  icon: typeof Linkedin;
  iconColor: string;
  options: OutcomeOption[];
  blockedChannel: string;
  nextStepMap: Record<string, string>;
}

const TRIGGER_CONFIGS: Record<string, TriggerConfig> = {
  linkedin_accepted: {
    icon: Linkedin,
    iconColor: 'text-blue-600',
    options: LINKEDIN_MESSAGE_OPTIONS,
    blockedChannel: 'linkedin_message',
    nextStepMap: {
      message_sent: 'Message recorded — monitoring for reply. Follow up in 2 days if no response.',
      could_not_send: 'Retry task created. Try again tomorrow or use alternate channel.',
      account_issue: 'LinkedIn issue flagged. System will suggest alternate channels.',
      wrong_profile: 'Wrong contact flagged. Research task created for correct profile.',
    },
  },
  warm_open_signal: {
    icon: Phone,
    iconColor: 'text-green-600',
    options: CALL_OPTIONS,
    blockedChannel: 'call',
    nextStepMap: {
      answered: 'Call connected — continue conversation or book meeting.',
      no_answer: 'No answer recorded. Retry scheduled or move to Instagram DM.',
      interested: 'Interest confirmed — book meeting immediately.',
      not_interested: 'Not interested recorded. Lead may be closed.',
      call_back_later: 'Callback scheduled at requested time.',
      wrong_contact: 'Wrong contact flagged. Research correct decision maker.',
      number_missing: 'No number available. System will suggest alternate channels.',
    },
  },
  day5_no_response: {
    icon: Phone,
    iconColor: 'text-orange-600',
    options: CALL_OPTIONS,
    blockedChannel: 'call',
    nextStepMap: {
      answered: 'Call connected — continue conversation or book meeting.',
      no_answer: 'No answer — Instagram DM task created as next channel.',
      interested: 'Interest confirmed — book meeting immediately.',
      not_interested: 'Not interested — consider closing lead.',
      call_back_later: 'Callback scheduled at requested time.',
      wrong_contact: 'Wrong contact — research task created.',
      number_missing: 'No number — alternate channel task created.',
    },
  },
  post_call_no_response: {
    icon: Instagram,
    iconColor: 'text-pink-600',
    options: INSTAGRAM_OPTIONS,
    blockedChannel: 'instagram',
    nextStepMap: {
      dm_sent: 'Instagram DM sent — monitoring for response.',
      no_account: 'No Instagram found. Alternate rescue sequence created.',
      blocked: 'Blocked on Instagram. Retry call or rescue sequence.',
      private_unavailable: 'Account private. Retry call or LinkedIn follow-up.',
      wrong_brand: 'Wrong account. Research correct brand Instagram.',
    },
  },
  linkedin_pending: {
    icon: Linkedin,
    iconColor: 'text-blue-600',
    options: LINKEDIN_PENDING_OPTIONS,
    blockedChannel: 'linkedin_request',
    nextStepMap: {
      still_pending: 'Still waiting — monitor. Use other channels if warm signals appear.',
      accepted: 'Accepted! LinkedIn message task created — send message now.',
      withdrawn: 'Withdrawn — research correct profile or try another channel.',
      rejected: 'Rejected — monitor email sequence and try alternate channels.',
      wrong_profile: 'Wrong profile — research correct contact and resend.',
    },
  },
  reply_received: {
    icon: Mail,
    iconColor: 'text-primary',
    options: REPLY_OPTIONS,
    blockedChannel: '',
    nextStepMap: {
      interested: 'Interested — book meeting immediately.',
      later: 'Follow up later — nurture task created.',
      not_interested: 'Not interested — close lead or archive.',
      wrong_person: 'Wrong person — research correct contact.',
      neutral_unclear: 'Unclear reply — send clarifying follow-up.',
    },
  },
};

// ── Component ─────────────────────────────────────────────

interface SDRSignalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerType: SDRTriggerType;
  triggerTitle: string;
  triggerReason: string;
  lead: Lead;
  onSubmit: (outcome: string, notes: string) => void;
}

export function SDRSignalDialog({
  open, onOpenChange, triggerType, triggerTitle, triggerReason, lead, onSubmit,
}: SDRSignalDialogProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showFallbacks, setShowFallbacks] = useState(false);

  const config = TRIGGER_CONFIGS[triggerType];
  if (!config) return null;

  const TriggerIcon = config.icon;
  const isBlocked = selected && !['message_sent', 'dm_sent', 'answered', 'interested', 'accepted', 'still_pending'].includes(selected);
  const fallbacks = isBlocked ? getFallbackActions(lead, config.blockedChannel) : [];

  const handleSubmit = () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    onSubmit(selected, notes);
    setSelected(null);
    setNotes('');
    setSubmitting(false);
    setShowFallbacks(false);
  };

  const reset = () => {
    setSelected(null);
    setNotes('');
    setSubmitting(false);
    setShowFallbacks(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <TriggerIcon className={`h-4 w-4 ${config.iconColor}`} />
            {triggerTitle}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {lead.contactName} · {lead.companyName}
            <br />
            <span className="text-muted-foreground/70">{triggerReason}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {/* Outcome options */}
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">What happened?</Label>
            <div className="grid grid-cols-2 gap-2">
              {config.options.map(opt => {
                const Icon = opt.icon;
                const isSelected = selected === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => { setSelected(opt.value); setShowFallbacks(false); }}
                    className={`flex flex-col items-center gap-1 p-2.5 rounded-lg border-2 transition-all text-center ${
                      isSelected ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : opt.color
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span className={`text-[11px] font-medium leading-tight ${isSelected ? 'text-primary' : ''}`}>{opt.label}</span>
                    <span className="text-[9px] text-muted-foreground leading-tight">{opt.description}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Next step preview */}
          {selected && config.nextStepMap[selected] && (
            <div className="bg-secondary/50 rounded-lg p-2.5 text-xs">
              <span className="text-muted-foreground">Next step: </span>
              <span className="font-medium">{config.nextStepMap[selected]}</span>
            </div>
          )}

          {/* Fallback alternatives for blocked outcomes */}
          {isBlocked && fallbacks.length > 0 && (
            <div className="space-y-2">
              <button
                onClick={() => setShowFallbacks(!showFallbacks)}
                className="text-[11px] text-primary font-medium flex items-center gap-1"
              >
                <ArrowRight className="h-3 w-3" />
                {showFallbacks ? 'Hide alternatives' : 'Show alternative actions'}
              </button>
              {showFallbacks && (
                <div className="bg-accent/20 rounded-lg p-2.5 space-y-1.5">
                  <p className="text-[10px] font-medium text-muted-foreground">Channel blocked — alternatives:</p>
                  {fallbacks.map((fb, i) => (
                    <div key={i} className="flex items-start gap-2 text-[11px]">
                      <ArrowRight className="h-3 w-3 shrink-0 text-primary mt-0.5" />
                      <div>
                        <span className="font-medium">{fb.label}</span>
                        <span className="text-muted-foreground ml-1">— {fb.description}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          {selected && (
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Notes</Label>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="What specifically happened? Any details for follow-up..."
                rows={2}
                className="text-sm"
              />
            </div>
          )}

          {/* Submit */}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit} disabled={!selected || submitting}>
              {submitting ? 'Saving...' : 'Save outcome'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
