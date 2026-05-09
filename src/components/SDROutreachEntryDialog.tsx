/**
 * SDR Day 1 Entry Dialog — "Start outreach"
 * Clean checklist: Email + LinkedIn. Block reasons if needed.
 */
import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Mail, Linkedin, CheckCircle, XCircle, AlertTriangle,
} from 'lucide-react';
import type { OutreachEntryResult } from '@/engine/sdr-flow-engine';

interface SDROutreachEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactLinkedIn?: string;
  onSubmit: (result: OutreachEntryResult) => void;
}

const EMAIL_BLOCK_REASONS = [
  { value: 'no_verified_email', label: 'No verified email' },
  { value: 'mailbox_account_issue', label: 'Mailbox issue' },
  { value: 'email_bounced', label: 'Email bounced' },
  { value: 'sequence_limit', label: 'Daily limit reached' },
  { value: 'other', label: 'Other' },
];

const LINKEDIN_BLOCK_REASONS = [
  { value: 'no_linkedin_profile', label: 'No profile found' },
  { value: 'profile_not_found', label: 'URL invalid' },
  { value: 'connection_limit', label: 'Weekly limit reached' },
  { value: 'account_restricted', label: 'Account restricted' },
  { value: 'other', label: 'Other' },
];

export function SDROutreachEntryDialog({
  open, onOpenChange, companyName, contactName, contactEmail, contactLinkedIn, onSubmit,
}: SDROutreachEntryDialogProps) {
  const [emailStarted, setEmailStarted] = useState<boolean | null>(null);
  const [emailBlockReason, setEmailBlockReason] = useState('');
  const [linkedinSent, setLinkedinSent] = useState<boolean | null>(null);
  const [linkedinBlockReason, setLinkedinBlockReason] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = emailStarted !== null && linkedinSent !== null
    && (emailStarted || emailBlockReason)
    && (linkedinSent || linkedinBlockReason);

  const handleSubmit = () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    onSubmit({
      email1_started: emailStarted!,
      email1_blocked_reason: !emailStarted ? emailBlockReason : undefined,
      linkedin_sent: linkedinSent!,
      linkedin_blocked_reason: !linkedinSent ? linkedinBlockReason : undefined,
    });
    setEmailStarted(null); setLinkedinSent(null);
    setEmailBlockReason(''); setLinkedinBlockReason('');
    setNotes(''); setSubmitting(false);
  };

  const reset = () => {
    setEmailStarted(null); setLinkedinSent(null);
    setEmailBlockReason(''); setLinkedinBlockReason('');
    setNotes(''); setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Outreach</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground/60">
            {contactName} · {companyName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Email */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 text-primary/60" />
              <Label className="text-sm font-medium">Email</Label>
            </div>
            <p className="text-[11px] text-muted-foreground/50 ml-5">
              Send to <strong className="text-foreground/60">{contactEmail}</strong>
            </p>
            <div className="flex gap-2 ml-5">
              <button
                onClick={() => { setEmailStarted(true); setEmailBlockReason(''); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                  emailStarted === true
                    ? 'border-emerald-500/40 bg-emerald-500/8 text-emerald-600'
                    : 'border-border/30 hover:border-emerald-500/30 text-muted-foreground/60'
                }`}
              >
                <CheckCircle className="h-3 w-3" /> Mark email sent
              </button>
              <button
                onClick={() => setEmailStarted(false)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                  emailStarted === false
                    ? 'border-destructive/30 bg-destructive/5 text-destructive/70'
                    : 'border-border/30 hover:border-destructive/20 text-muted-foreground/60'
                }`}
              >
                <XCircle className="h-3 w-3" /> Couldn't send
              </button>
            </div>
            {emailStarted === false && (
              <div className="ml-5 flex flex-wrap gap-1.5">
                {EMAIL_BLOCK_REASONS.map(r => (
                  <button
                    key={r.value}
                    onClick={() => setEmailBlockReason(r.value)}
                    className={`px-2 py-1 rounded text-[10px] border transition-all ${
                      emailBlockReason === r.value
                        ? 'border-destructive/25 bg-destructive/5 text-destructive/60'
                        : 'border-border/20 text-muted-foreground/40 hover:border-destructive/20'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* LinkedIn */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Linkedin className="h-3.5 w-3.5 text-blue-500/60" />
              <Label className="text-sm font-medium">LinkedIn</Label>
            </div>
            <p className="text-[11px] text-muted-foreground/50 ml-5">
              Connect with <strong className="text-foreground/60">{contactName}</strong>
              {contactLinkedIn && <> · <span className="text-primary/50">{contactLinkedIn}</span></>}
            </p>
            <div className="flex gap-2 ml-5">
              <button
                onClick={() => { setLinkedinSent(true); setLinkedinBlockReason(''); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                  linkedinSent === true
                    ? 'border-emerald-500/40 bg-emerald-500/8 text-emerald-600'
                    : 'border-border/30 hover:border-emerald-500/30 text-muted-foreground/60'
                }`}
              >
                <CheckCircle className="h-3 w-3" /> Mark sent
              </button>
              <button
                onClick={() => setLinkedinSent(false)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                  linkedinSent === false
                    ? 'border-destructive/30 bg-destructive/5 text-destructive/70'
                    : 'border-border/30 hover:border-destructive/20 text-muted-foreground/60'
                }`}
              >
                <XCircle className="h-3 w-3" /> Couldn't send
              </button>
            </div>
            {linkedinSent === false && (
              <div className="ml-5 flex flex-wrap gap-1.5">
                {LINKEDIN_BLOCK_REASONS.map(r => (
                  <button
                    key={r.value}
                    onClick={() => setLinkedinBlockReason(r.value)}
                    className={`px-2 py-1 rounded text-[10px] border transition-all ${
                      linkedinBlockReason === r.value
                        ? 'border-destructive/25 bg-destructive/5 text-destructive/60'
                        : 'border-border/20 text-muted-foreground/40 hover:border-destructive/20'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Both blocked warning */}
          {emailStarted === false && linkedinSent === false && emailBlockReason && linkedinBlockReason && (
            <div className="bg-destructive/5 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive/50 shrink-0 mt-0.5" />
              <p className="text-[11px] text-destructive/60">
                Both channels blocked. A research task will be created to resolve this.
              </p>
            </div>
          )}

          {/* Notes */}
          <div>
            <Label className="text-xs text-muted-foreground/40 mb-1.5 block">Notes (optional)</Label>
            <Textarea
              value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Any context..." rows={2} className="text-sm"
            />
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit} disabled={!canSubmit || submitting}>
              {submitting ? 'Saving...' : 'Confirm'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
