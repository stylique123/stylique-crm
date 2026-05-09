/**
 * MeetingBookingDialog — clean, light booking modal.
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle } from 'lucide-react';

export type MeetingType = 'zoom' | 'google-meet' | 'teams' | 'other';

export interface MeetingBooking {
  type: MeetingType;
  link: string;
  dateTime: string;
  notes?: string;
}

const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  'teams': 'Microsoft Teams',
  'zoom': 'Zoom',
  'google-meet': 'Google Meet',
  'other': 'Other',
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyName: string;
  onConfirm: (booking: MeetingBooking) => void;
  brandProgress?: { contactsTotal: number; contactsReached: number };
}

export function MeetingBookingDialog({ open, onOpenChange, companyName, onConfirm, brandProgress }: Props) {
  const [type, setType] = useState<MeetingType>('teams');
  const [link, setLink] = useState('');
  const [dateTime, setDateTime] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = () => {
    if (submitting) return;
    if (!link.trim()) { setError('Meeting link is required'); return; }
    if (!dateTime) { setError('Pick a date and time'); return; }
    setError('');
    setSubmitting(true);
    onConfirm({ type, link: link.trim(), dateTime, notes: notes.trim() || undefined });
    setType('teams'); setLink(''); setDateTime(''); setNotes('');
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">Book meeting</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground/60">{companyName}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          {error && (
            <div className="flex items-center gap-2 text-xs text-destructive/70">
              <AlertCircle className="h-3 w-3" />
              {error}
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground/50">Platform</Label>
            <Select value={type} onValueChange={v => setType(v as MeetingType)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(MEETING_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground/50">Meeting link</Label>
            <Input value={link} onChange={e => setLink(e.target.value)} placeholder="https://zoom.us/j/..." className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground/50">Date & time</Label>
            <Input type="datetime-local" value={dateTime} onChange={e => setDateTime(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground/50">Notes (optional)</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="text-sm" />
          </div>
          <Button onClick={handleConfirm} disabled={submitting} className="w-full h-9 text-sm">
            {submitting ? 'Saving...' : 'Confirm meeting'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
