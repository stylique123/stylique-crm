/**
 * Message Draft Dialog — Shows pre-written, editable message templates.
 */
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { MessageTemplate, fillTemplate, getTemplatesForStage } from '@/lib/message-templates';
import { Copy, Check, Mail, Linkedin, Phone, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TemplateVars {
  companyName: string;
  contactName: string;
  platform?: string;
  sdrName: string;
  meetingDate?: string;
  meetingTime?: string;
  meetingLink?: string;
  trialEndDate?: string;
  daysLeft?: number;
  planName?: string;
  amount?: string;
}

interface MessageDraftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stage: string;
  vars: TemplateVars;
  preselectedTemplateId?: string;
  /** Called when user confirms message was sent — auto-completes the action */
  onMarkSent?: (channel: string) => void;
}

const CHANNEL_ICONS = {
  'email': Mail,
  'linkedin': Linkedin,
  'call-script': Phone,
  'whatsapp': MessageSquare,
};

const CHANNEL_LABELS = {
  'email': 'Email',
  'linkedin': 'LinkedIn',
  'call-script': 'Call Script',
  'whatsapp': 'WhatsApp',
};

export function MessageDraftDialog({ open, onOpenChange, stage, vars, preselectedTemplateId, onMarkSent }: MessageDraftDialogProps) {
  const templates = getTemplatesForStage(stage);
  const [selectedId, setSelectedId] = useState<string>(preselectedTemplateId || templates[0]?.id || '');
  const [editedSubject, setEditedSubject] = useState('');
  const [editedBody, setEditedBody] = useState('');
  const [copied, setCopied] = useState(false);

  const selected = templates.find(t => t.id === selectedId);

  useEffect(() => {
    if (selected) {
      setEditedSubject(selected.subject ? fillTemplate(selected.subject, vars) : '');
      setEditedBody(fillTemplate(selected.body, vars));
    }
  }, [selectedId, selected]);

  useEffect(() => {
    if (preselectedTemplateId) setSelectedId(preselectedTemplateId);
  }, [preselectedTemplateId]);

  const handleCopy = () => {
    const text = editedSubject ? `Subject: ${editedSubject}\n\n${editedBody}` : editedBody;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (templates.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Message Draft</DialogTitle>
          <DialogDescription>Edit and copy — ready to send</DialogDescription>
        </DialogHeader>

        {/* Template selector */}
        <div className="flex gap-2 flex-wrap">
          {templates.map(t => {
            const Icon = CHANNEL_ICONS[t.channel];
            return (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors border",
                  selectedId === t.id
                    ? 'bg-primary/10 border-primary/30 text-primary font-medium'
                    : 'bg-secondary/50 border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="h-3 w-3" />
                {t.label}
              </button>
            );
          })}
        </div>

        {selected && (
          <div className="space-y-4">
            <Badge variant="secondary" className="text-[10px]">
              {CHANNEL_LABELS[selected.channel]}
            </Badge>

            {selected.subject && (
              <div className="space-y-1.5">
                <Label className="text-xs">Subject</Label>
                <Input value={editedSubject} onChange={e => setEditedSubject(e.target.value)} />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">Message</Label>
              <Textarea
                value={editedBody}
                onChange={e => setEditedBody(e.target.value)}
                rows={10}
                className="font-mono text-xs"
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={handleCopy} variant={copied ? 'secondary' : 'outline'} className="flex-1">
                {copied ? <><Check className="h-4 w-4 mr-1" /> Copied!</> : <><Copy className="h-4 w-4 mr-1" /> Copy</>}
              </Button>
              {onMarkSent && (
                <Button onClick={() => { onMarkSent(selected.channel); onOpenChange(false); }} className="flex-1">
                  <Check className="h-4 w-4 mr-1" /> Mark as Sent
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
