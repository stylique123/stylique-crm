/**
 * CredentialsDialog — Standalone modal for adding store credentials.
 * Context-locked: shows company name, contact, stage.
 * Does NOT redirect to pipeline.
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Package, CheckCircle } from 'lucide-react';

interface CredentialsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyName: string;
  contactName: string;
  hasExisting?: boolean;
  existingUsername?: string;
  onSave: (credentials: { username: string; password: string; loginUrl?: string; installationNotes?: string }) => void;
}

export function CredentialsDialog({ open, onOpenChange, companyName, contactName, hasExisting, existingUsername, onSave }: CredentialsDialogProps) {
  const [username, setUsername] = useState(existingUsername || '');
  const [password, setPassword] = useState('');
  const [loginUrl, setLoginUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSave = () => {
    if (!username.trim() || !password.trim() || submitting) return;
    setSubmitting(true);
    onSave({
      username: username.trim(),
      password: password.trim(),
      loginUrl: loginUrl.trim() || undefined,
      installationNotes: notes.trim() || undefined,
    });
    setUsername('');
    setPassword('');
    setLoginUrl('');
    setNotes('');
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4 text-primary" />
            Store Credentials
          </DialogTitle>
          <DialogDescription>
            {companyName} — {contactName}
          </DialogDescription>
        </DialogHeader>

        {hasExisting && (
          <div className="flex items-center gap-2 text-xs text-success bg-success/10 rounded-lg p-2">
            <CheckCircle className="h-3 w-3" />
            Credentials already saved ({existingUsername})
          </div>
        )}

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Username *</Label>
            <Input
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Store admin username"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Password *</Label>
            <Input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Store admin password"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Login URL <span className="text-muted-foreground">(optional)</span></Label>
            <Input
              value={loginUrl}
              onChange={e => setLoginUrl(e.target.value)}
              placeholder="https://store.com/admin"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Setup Notes <span className="text-muted-foreground">(optional)</span></Label>
            <Input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any special instructions..."
            />
          </div>
          <Button
            onClick={handleSave}
            disabled={!username.trim() || !password.trim() || submitting}
            className="w-full"
          >
            {submitting ? 'Saving...' : 'Save credentials'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
