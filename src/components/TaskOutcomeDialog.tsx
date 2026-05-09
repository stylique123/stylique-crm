/**
 * TaskOutcomeDialog — Contextual outcome capture for all task types.
 * Shows role-appropriate outcome options based on task type.
 * 
 * SDR decision: Interested / Not now / No answer / Lost
 * Muneeb onboarding: Setup done / Setup issue
 * Muneeb check-in: Using / Not using
 * Muneeb follow-up: Feedback received / Problem / No answer
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { CheckCircle, AlertTriangle, Phone, TrendingUp, ThumbsDown, X, Clock } from 'lucide-react';

export type TaskOutcome = 'completed' | 'issue' | 'active' | 'not-using' | 'interested' | 'not-ready' | 'not-now' | 'lost' | 'no-answer';

interface OutcomeOption {
  value: TaskOutcome;
  label: string;
  description: string;
  icon: typeof CheckCircle;
  color: string;
}

const TASK_OUTCOMES: Record<string, OutcomeOption[]> = {
  'onboarding': [
    { value: 'completed', label: 'Done & verified', description: 'Client is ready', icon: CheckCircle, color: 'border-success/30 hover:border-success' },
    { value: 'issue', label: 'Blocked', description: 'Needs attention', icon: AlertTriangle, color: 'border-destructive/20 hover:border-destructive/50' },
  ],
  'check-in': [
    { value: 'active', label: 'Active', description: 'Client is active', icon: CheckCircle, color: 'border-success/30 hover:border-success' },
    { value: 'not-using', label: 'Inactive', description: 'No activity yet', icon: AlertTriangle, color: 'border-warning/30 hover:border-warning' },
    { value: 'issue', label: 'Needs help', description: 'Client has questions or issues', icon: Phone, color: 'border-primary/30 hover:border-primary' },
  ],
  'follow-up': [
    { value: 'completed', label: 'Feedback received', description: 'Feedback recorded', icon: CheckCircle, color: 'border-success/30 hover:border-success' },
    { value: 'issue', label: 'Problem reported', description: 'Needs attention', icon: AlertTriangle, color: 'border-destructive/20 hover:border-destructive/50' },
    { value: 'not-ready', label: 'No answer', description: 'Could not reach', icon: Phone, color: 'border-warning/30 hover:border-warning' },
  ],
  'conversion-push': [
    { value: 'interested', label: 'Interested', description: 'Awaiting payment', icon: TrendingUp, color: 'border-success/30 hover:border-success' },
    { value: 'not-now', label: 'Not now', description: 'Needs more time', icon: Clock, color: 'border-warning/30 hover:border-warning' },
    { value: 'no-answer', label: 'No answer', description: 'Could not reach', icon: Phone, color: 'border-muted hover:border-muted-foreground' },
    { value: 'lost', label: 'Closed Lost', description: 'Not proceeding', icon: X, color: 'border-destructive/20 hover:border-destructive/50' },
  ],
  'trial-end': [
    { value: 'interested', label: 'Awaiting payment', description: 'Client wants to pay', icon: TrendingUp, color: 'border-success/30 hover:border-success' },
    { value: 'not-now', label: 'Needs time', description: 'Decision pending', icon: Clock, color: 'border-warning/30 hover:border-warning' },
    { value: 'lost', label: 'Closed Lost', description: 'Not proceeding', icon: ThumbsDown, color: 'border-destructive/20 hover:border-destructive/50' },
  ],
  'meeting-prep': [
    { value: 'completed', label: 'Prep done', description: 'Research completed — ready for meeting', icon: CheckCircle, color: 'border-success/30 hover:border-success' },
  ],
  'meeting-summary': [
    { value: 'completed', label: 'Summary added', description: 'Notes recorded', icon: CheckCircle, color: 'border-success/30 hover:border-success' },
    { value: 'issue', label: 'Follow-up needed', description: 'Action items from meeting', icon: AlertTriangle, color: 'border-warning/30 hover:border-warning' },
  ],
  'payment': [
    { value: 'completed', label: 'Paid', description: 'Payment confirmed', icon: CheckCircle, color: 'border-success/30 hover:border-success' },
    { value: 'not-ready', label: 'Not yet', description: 'Still waiting', icon: Clock, color: 'border-warning/30 hover:border-warning' },
    { value: 'lost', label: 'Will not pay', description: 'Close the deal', icon: X, color: 'border-destructive/20 hover:border-destructive/50' },
  ],
};

interface TaskOutcomeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyName: string;
  taskTitle: string;
  taskType: string;
  onSubmit: (outcome: TaskOutcome, notes: string) => void;
}

export function TaskOutcomeDialog({ open, onOpenChange, companyName, taskTitle, taskType, onSubmit }: TaskOutcomeDialogProps) {
  const [selected, setSelected] = useState<TaskOutcome | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const outcomes = TASK_OUTCOMES[taskType] || TASK_OUTCOMES['follow-up'] || [];

  const handleSubmit = () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    onSubmit(selected, notes);
    setSelected(null);
    setNotes('');
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">
            {taskType === 'onboarding' ? 'You worked on the setup. How did it go?' :
             taskType === 'check-in' ? 'You checked in. What did you find?' :
             taskType === 'conversion-push' ? 'Decision update' :
             'You completed this. What happened?'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {taskTitle} — {companyName}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div className="grid grid-cols-2 gap-2">
            {outcomes.map(opt => {
              const Icon = opt.icon;
              const isSelected = selected === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setSelected(opt.value)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all text-center ${
                    isSelected ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : opt.color
                  }`}
                >
                  <Icon className={`h-4 w-4 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className={`text-xs font-medium ${isSelected ? 'text-primary' : ''}`}>{opt.label}</span>
                  <span className="text-[10px] text-muted-foreground leading-tight">{opt.description}</span>
                </button>
              );
            })}
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Notes (optional)</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any details..." rows={2} className="text-sm" />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit} disabled={!selected || submitting}>{submitting ? 'Saving...' : 'Save outcome'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
