/**
 * AddLeadDialog — Structured lead creation with dual contacts, auto-fill, enterprise add-ons.
 * Owner auto-fills from logged-in user. Entry flow auto-fills from context.
 * Secondary contact has full business fields matching primary.
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Lead, Pipeline, SourceDetail, SubscriptionPlan, PLAN_PRICES,
  SALES_MEMBERS, DEFAULT_STAGE, recalculateNextAction, SecondaryContact, BrandContact,
  type EntryFlow, type Platform,
} from '@/types/crm';
import { uid } from '@/lib/store';
import { generateLeadKey } from '@/lib/lead-key';
import { useCompanyStore } from '@/lib/company-store';
import { useUser } from '@/lib/user-context';
import { toast } from 'sonner';
import {
  Building2, User, Globe, Phone, Mail, Instagram, Linkedin, MapPin,
  ChevronDown, UserPlus, Package,
} from 'lucide-react';

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: 'shopify', label: 'Shopify' },
  { value: 'woocommerce', label: 'WooCommerce' },
  { value: 'custom', label: 'Custom' },
];

const SOURCES: { value: SourceDetail; label: string }[] = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'instagram_dm', label: 'Instagram DM' },
  { value: 'linkedin_evaboot', label: 'LinkedIn / Evaboot' },
  { value: 'linkedin_dm', label: 'LinkedIn DM' },
  { value: 'google_search', label: 'Google Search' },
  { value: 'website_demo', label: 'Website Demo' },
  { value: 'website_form', label: 'Website Form' },
  { value: 'email_inbound', label: 'Email Inbound' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'referral', label: 'Referral' },
  { value: 'manual_import', label: 'Manual Import' },
  { value: 'other', label: 'Other' },
];

const PLAN_OPTIONS: { value: SubscriptionPlan; label: string; price: string; note?: string }[] = [
  { value: 'lite', label: 'Lite', price: '$49/mo', note: 'Pakistan only' },
  { value: 'starter', label: 'Starter', price: '$149/mo' },
  { value: 'growth', label: 'Growth', price: '$299/mo' },
  { value: 'enterprise', label: 'Enterprise', price: '$499/mo' },
];

interface AddLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultFlow?: EntryFlow;
}

export function AddLeadDialog({ open, onOpenChange, defaultFlow }: AddLeadDialogProps) {
  const { saveCompany, addActivity, refresh } = useCompanyStore();
  const { currentUser, isLeadership } = useUser();

  // Company
  const [companyName, setCompanyName] = useState('');
  const [website, setWebsite] = useState('');
  const [platform, setPlatform] = useState<Platform>('shopify');

  // Primary contact
  const [contactName, setContactName] = useState('');
  const [contactRole, setContactRole] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [instagram, setInstagram] = useState('');
  const [linkedin, setLinkedin] = useState('');

  // Secondary contact. Missing second contact becomes a quiet SDR reminder.
  const [showSecondary, setShowSecondary] = useState(true);
  const [sec, setSec] = useState<SecondaryContact>({ name: '' });
  const updateSec = (field: keyof SecondaryContact, val: string) =>
    setSec(prev => ({ ...prev, [field]: val }));

  // Flow / Source — Anything not 'inbound' is SDR manual.
  const autoFlow: EntryFlow = defaultFlow === 'inbound' ? 'inbound' : 'sdr_manual';
  const [sourceDetail, setSourceDetail] = useState<SourceDetail>('other');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [notes, setNotes] = useState('');

  // Plan (optional at creation)
  const [plan, setPlan] = useState<SubscriptionPlan | ''>('');
  const [extraTryOns, setExtraTryOns] = useState(0);
  const [inStoreInstallation, setInStoreInstallation] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  // Owner auto-fills — only leadership can reassign
  const [owner, setOwner] = useState(currentUser);

  const PIPELINE_MAP: Record<EntryFlow, Pipeline> = {
    inbound: 'inbound',
    sdr_manual: 'outbound-sdr',
  };

  const reset = () => {
    setCompanyName(''); setWebsite(''); setContactName(''); setContactRole('');
    setContactEmail(''); setContactPhone(''); setInstagram(''); setLinkedin('');
    setPlatform('shopify'); setSourceDetail('other');
    setOwner(currentUser); setCountry(''); setCity(''); setNotes('');
    setPlan(''); setExtraTryOns(0); setInStoreInstallation(false);
    setShowSecondary(true); setSec({ name: '' });
    setSubmitting(false);
  };

  const hasSecondContact = showSecondary && sec.name.trim().length > 0 && (
    (sec.email && sec.email.trim()) ||
    (sec.phone && sec.phone.trim()) ||
    (sec.linkedin && sec.linkedin.trim()) ||
    (sec.instagram && sec.instagram.trim())
  );
  const canSubmit = !!(
    companyName.trim() &&
    contactName.trim() &&
    contactEmail.trim() &&
    platform
  );

  const handleSubmit = () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);

    const pipeline = PIPELINE_MAP[autoFlow];
    const stage = DEFAULT_STAGE[pipeline];
    const now = new Date().toISOString();

    const secondaryContact: SecondaryContact | undefined =
      showSecondary && sec.name.trim()
        ? { ...sec, name: sec.name.trim() }
        : undefined;

    // Build canonical contacts[] array from primary + secondary
    const brandContacts: BrandContact[] = [];
    const primaryContactId = uid();
    brandContacts.push({
      id: primaryContactId,
      name: contactName.trim(),
      role: contactRole.trim() || undefined,
      email: contactEmail.trim() || undefined,
      phone: contactPhone.trim() || undefined,
      linkedin: linkedin.trim() || undefined,
      instagram: instagram.trim() || undefined,
      reached: false,
    });
    if (showSecondary && sec.name.trim()) {
      brandContacts.push({
        id: uid(),
        name: sec.name.trim(),
        role: sec.role || undefined,
        email: sec.email || undefined,
        phone: sec.phone || undefined,
        linkedin: sec.linkedin || undefined,
        instagram: sec.instagram || undefined,
        reached: false,
      });
    }

    const lead: Lead = {
      id: uid(),
      companyName: companyName.trim(),
      contactName: contactName.trim(),
      contactRole: contactRole.trim() || undefined,
      contactEmail: contactEmail.trim(),
      contactPhone: contactPhone.trim() || undefined,
      website: website.trim() || undefined,
      instagram: instagram.trim() || undefined,
      linkedin: linkedin.trim() || undefined,
      secondaryContact,
      contacts: brandContacts,
      contactsReachedCount: 0,
      pipeline,
      stage,
      assignedTo: owner,
      platform,
      entry_flow: autoFlow,
      inbound_type: autoFlow === 'inbound' ? 'manual_inbound' : null,
      source_detail: sourceDetail,
      action_owner: 'sdr',
      record_owner: owner,
      assigned_sdr: owner,
      notes: [
        notes.trim(),
        country.trim() || city.trim() ? `Location: ${[city, country].filter(Boolean).join(', ')}` : '',
      ].filter(Boolean).join('\n'),
      createdAt: now,
      updatedAt: now,
      tasks: hasSecondContact ? [] : [{
        id: uid(),
        title: 'Add secondary contact',
        dueDate: now,
        completed: false,
        assignedTo: owner,
        type: 'outreach',
        autoGenerated: true,
        createdAt: now,
        priority: 'medium',
        reason: 'Brand has one contact',
        stageFamily: 'sdr',
      }],
      priority: 'medium',
      // Plan & enterprise add-ons
      ...(plan ? {
        proposed_package: plan as SubscriptionPlan,
        proposed_currency: 'USD' as const,
        proposed_value: PLAN_PRICES[plan as SubscriptionPlan] ?? 0,
        planRegion: plan === 'lite' ? 'pakistan' : undefined,
        extraTryOns: plan === 'enterprise' ? extraTryOns : undefined,
        inStoreInstallation: plan === 'enterprise' ? inStoreInstallation : undefined,
      } : {}),
    };

    lead.leadKey = generateLeadKey(lead);

    const intel = recalculateNextAction(lead);
    lead.nextAction = intel.action;
    lead.nextActionReason = intel.reason;
    lead.nextActionUrgency = intel.urgency;
    lead.nextFollowUp = intel.followUpDate;

    saveCompany(lead);
    addActivity({
      id: uid(),
      leadId: lead.id,
      type: 'stage-change',
      description: `Lead created — ${lead.companyName} (${autoFlow})`,
      createdAt: now,
      createdBy: currentUser,
    });
    refresh();
    reset();
    onOpenChange(false);
    toast.success(`Brand added: ${lead.companyName}`, {
      description: hasSecondContact ? `${pipeline} → ${stage}` : 'Add secondary contact',
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4 text-primary" />
            Add New Lead
          </DialogTitle>
          <DialogDescription className="text-xs">
            New lead for <strong>{autoFlow === 'inbound' ? 'Inbound' : 'SDR Manual'}</strong> flow · Owner: {SALES_MEMBERS.find(m => m.id === owner)?.name || owner}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {/* Company */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Company *</Label>
            <Input placeholder="Company name" value={companyName} onChange={e => setCompanyName(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs font-medium">Website *</Label>
              <div className="relative mt-1">
                <Globe className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input className="pl-8" placeholder="https://..." value={website} onChange={e => setWebsite(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs font-medium">Platform *</Label>
              <Select value={platform} onValueChange={v => setPlatform(v as Platform)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── Primary Contact ── */}
          <div className="space-y-2 border-t pt-3">
            <Label className="text-xs font-medium flex items-center gap-1.5">
              <User className="h-3 w-3" /> Primary Contact *
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Full name *" value={contactName} onChange={e => setContactName(e.target.value)} />
              <Input placeholder="Role (e.g. CEO, Manager)" value={contactRole} onChange={e => setContactRole(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="relative">
                <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input className="pl-8" placeholder="Email *" value={contactEmail} onChange={e => setContactEmail(e.target.value)} />
              </div>
              <div className="relative">
                <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input className="pl-8" placeholder="Phone" value={contactPhone} onChange={e => setContactPhone(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="relative">
                <Linkedin className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input className="pl-8" placeholder="LinkedIn URL" value={linkedin} onChange={e => setLinkedin(e.target.value)} />
              </div>
              <div className="relative">
                <Instagram className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input className="pl-8" placeholder="Instagram" value={instagram} onChange={e => setInstagram(e.target.value)} />
              </div>
            </div>
          </div>

          {/* ── Secondary Contact ── */}
          <Collapsible open={showSecondary} onOpenChange={setShowSecondary}>
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors">
                <UserPlus className="h-3 w-3" />
                Secondary Contact
                <ChevronDown className={`h-3 w-3 transition-transform ${showSecondary ? 'rotate-180' : ''}`} />
              </button>
            </CollapsibleTrigger>
            {!hasSecondContact && (
              <p className="text-[10px] text-muted-foreground mt-1">
                Brand will enter pipeline. SDR will see “Add secondary contact”.
              </p>
            )}
            <CollapsibleContent className="space-y-2 pt-2">
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Full name" value={sec.name} onChange={e => updateSec('name', e.target.value)} />
                <Input placeholder="Role" value={sec.role || ''} onChange={e => updateSec('role', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="relative">
                  <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input className="pl-8" placeholder="Email" value={sec.email || ''} onChange={e => updateSec('email', e.target.value)} />
                </div>
                <div className="relative">
                  <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input className="pl-8" placeholder="Phone" value={sec.phone || ''} onChange={e => updateSec('phone', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="relative">
                  <Linkedin className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input className="pl-8" placeholder="LinkedIn URL" value={sec.linkedin || ''} onChange={e => updateSec('linkedin', e.target.value)} />
                </div>
                <div className="relative">
                  <Instagram className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input className="pl-8" placeholder="Instagram" value={sec.instagram || ''} onChange={e => updateSec('instagram', e.target.value)} />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* ── Source & Location ── */}
          <div className="space-y-2 border-t pt-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs font-medium">Source</Label>
                <Select value={sourceDetail} onValueChange={v => setSourceDetail(v as SourceDetail)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SOURCES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {/* Owner — only leadership can change */}
              {isLeadership && (
                <div>
                  <Label className="text-xs font-medium">Owner</Label>
                  <Select value={owner} onValueChange={setOwner}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SALES_MEMBERS.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="relative">
                <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input className="pl-8" placeholder="Country" value={country} onChange={e => setCountry(e.target.value)} />
              </div>
              <Input placeholder="City" value={city} onChange={e => setCity(e.target.value)} />
            </div>
          </div>

          {/* ── Plan & Enterprise Add-ons ── */}
          <Collapsible>
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                <Package className="h-3 w-3" /> Plan (optional)
                <ChevronDown className="h-3 w-3" />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-2">
              <Select value={plan} onValueChange={v => setPlan(v as SubscriptionPlan)}>
                <SelectTrigger><SelectValue placeholder="Select plan..." /></SelectTrigger>
                <SelectContent>
                  {PLAN_OPTIONS.map(p => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label} — {p.price} {p.note ? `(${p.note})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {plan === 'enterprise' && (
                <div className="bg-secondary/50 rounded-lg p-3 space-y-2">
                  <p className="text-[11px] font-medium text-muted-foreground">Enterprise Add-ons</p>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Extra Try-On Volume</Label>
                    <Input
                      type="number" min={0} className="w-20 h-7 text-xs"
                      value={extraTryOns} onChange={e => setExtraTryOns(parseInt(e.target.value) || 0)}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">In-Store Installation</Label>
                    <Switch checked={inStoreInstallation} onCheckedChange={setInStoreInstallation} />
                  </div>
                </div>
              )}
              {plan === 'lite' && (
                <p className="text-[10px] text-warning">Lite plan is available only for Pakistan region (Khadija's territory)</p>
              )}
            </CollapsibleContent>
          </Collapsible>

          {/* Notes */}
          <div>
            <Label className="text-xs text-muted-foreground">Notes</Label>
            <Textarea className="mt-1" placeholder="Any context, links, or details..." value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </div>

          {/* Submit */}
          <div className="flex gap-2 justify-end pt-2 border-t">
            <Button variant="outline" size="sm" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit} disabled={!canSubmit || submitting}>
              {submitting ? 'Saving...' : 'Add lead'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
