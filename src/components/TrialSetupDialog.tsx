/**
 * Commercial approval + credentials in one compact modal.
 * 
 * FIXED: Resets internal step state when props change (new company / reopened).
 */
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle, Shield, KeyRound } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TrialSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyName: string;
  contactName: string;
  needsApproval: boolean;
  needsCredentials: boolean;
  existingUsername?: string;
  onComplete: (result: TrialSetupResult) => void;
}

export interface TrialSetupResult {
  approved: boolean;
  credentials?: { username: string; password: string; loginUrl?: string; installationNotes?: string };
}

export function TrialSetupDialog({
  open, onOpenChange, companyName, contactName,
  needsApproval, needsCredentials, existingUsername,
  onComplete,
}: TrialSetupDialogProps) {
  // Compute initial step from props
  const initialStep = needsApproval ? 'approval' : needsCredentials ? 'credentials' : 'done';

  const [step, setStep] = useState<'approval' | 'credentials' | 'done'>(initialStep);
  const [approved, setApproved] = useState(!needsApproval);
  const [username, setUsername] = useState(existingUsername || '');
  const [password, setPassword] = useState('');
  const [loginUrl, setLoginUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // CRITICAL FIX: Reset state when dialog opens or props change
  useEffect(() => {
    if (open) {
      const newStep = needsApproval ? 'approval' : needsCredentials ? 'credentials' : 'done';
      setStep(newStep);
      setApproved(!needsApproval);
      setUsername(existingUsername || '');
      setPassword('');
      setLoginUrl('');
      setNotes('');

      // If nothing is needed, auto-complete
      if (!needsApproval && !needsCredentials) {
        onComplete({ approved: true });
        onOpenChange(false);
      }
    }
  }, [open, needsApproval, needsCredentials, existingUsername]);

  const handleApprove = () => {
    if (submitting) return;
    setApproved(true);
    if (needsCredentials) {
      setStep('credentials');
    } else {
      setSubmitting(true);
      setStep('done');
      onComplete({ approved: true });
      setSubmitting(false);
    }
  };

  const handleCredentialsSave = () => {
    if (!username.trim() || !password.trim() || submitting) return;
    setSubmitting(true);
    setStep('done');
    onComplete({
      approved,
      credentials: {
        username: username.trim(),
        password: password.trim(),
        loginUrl: loginUrl.trim() || undefined,
        installationNotes: notes.trim() || undefined,
      },
    });
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Client Approval — {companyName}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {contactName} • approve package, then add credentials
          </DialogDescription>
        </DialogHeader>

        {/* Progress indicator */}
        <div className="flex items-center gap-2 mt-2 text-xs">
          <div className={cn("flex items-center gap-1 px-2 py-1 rounded",
            step === 'approval' ? 'bg-primary/10 text-primary font-medium' :
            approved ? 'text-success' : 'text-muted-foreground'
          )}>
            {approved ? <CheckCircle className="h-3 w-3" /> : <span className="h-3 w-3 rounded-full border border-current flex items-center justify-center text-[8px]">1</span>}
            Approval
          </div>
          <span className="text-muted-foreground">→</span>
          <div className={cn("flex items-center gap-1 px-2 py-1 rounded",
            step === 'credentials' ? 'bg-primary/10 text-primary font-medium' :
            step === 'done' ? 'text-success' : 'text-muted-foreground'
          )}>
            {step === 'done' ? <CheckCircle className="h-3 w-3" /> : <span className="h-3 w-3 rounded-full border border-current flex items-center justify-center text-[8px]">2</span>}
            Credentials
          </div>
        </div>

        <div className="space-y-4 mt-3">
          {step === 'approval' && (
            <div className="space-y-3">
              <p className="text-sm text-foreground">
                Approve <strong>{companyName}</strong>?
              </p>
              <p className="text-xs text-muted-foreground">
                This moves the brand toward payment and onboarding.
              </p>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button size="sm" onClick={handleApprove} disabled={submitting}>
                  <Shield className="h-3.5 w-3.5 mr-1" /> {submitting ? 'Saving...' : 'Approve'}
                </Button>
              </div>
            </div>
          )}

          {step === 'credentials' && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Store Username *</Label>
                <Input value={username} onChange={e => setUsername(e.target.value)} placeholder="Enter store username" className="text-sm" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Store Password *</Label>
                <Input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Enter store password" className="text-sm" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Login URL (optional)</Label>
                <Input value={loginUrl} onChange={e => setLoginUrl(e.target.value)} placeholder="https://store.myshopify.com/admin" className="text-sm" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Setup Notes (optional)</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any special instructions..." rows={2} className="text-sm" />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button size="sm" onClick={handleCredentialsSave} disabled={!username.trim() || !password.trim() || submitting}>
                  <KeyRound className="h-3.5 w-3.5 mr-1" /> {submitting ? 'Saving...' : 'Save credentials'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
