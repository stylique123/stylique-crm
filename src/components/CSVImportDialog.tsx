/**
 * CSVImportDialog — brand-first CSV upload and website demo import.
 * Supports: CSV upload, preview, field mapping, dedupe, merge/skip/import.
 */
import { useState, useCallback, useMemo, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Upload, FileText, AlertTriangle, CheckCircle, X, ArrowRight,
  Globe, Users, MapPin, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCompanyStore } from '@/lib/company-store';
import { useUser } from '@/lib/user-context';
import {
  Lead, Platform, EntryFlow, SourceDetail, Pipeline, BrandContact,
  SALES_MEMBERS, DEFAULT_STAGE, recalculateNextAction,
} from '@/types/crm';
import { uid } from '@/lib/store';
import { submitBookDemoLead } from '@/lib/backend-api';
import { generateLeadKey } from '@/lib/lead-key';
import { toast } from 'sonner';

// ── Field mapping ────────────────────────────────────────

const LEAD_FIELDS = [
  { key: 'companyName', label: 'Company Name', required: true },
  { key: 'contactName', label: 'Contact Name', required: false },
  { key: 'contactEmail', label: 'Email', required: false },
  { key: 'contactPhone', label: 'Phone', required: false },
  { key: 'website', label: 'Website', required: false },
  { key: 'instagram', label: 'Instagram', required: false },
  { key: 'linkedin', label: 'LinkedIn', required: false },
  { key: 'source', label: 'Source', required: false },
  { key: 'country', label: 'Country', required: false },
  { key: 'city', label: 'City', required: false },
  { key: 'platform', label: 'Platform', required: false },
  { key: 'notes', label: 'Notes', required: false },
  { key: 'owner', label: 'Owner', required: false },
  { key: 'stage', label: 'Stage', required: false },
  { key: 'tags', label: 'Tags', required: false },
] as const;

type LeadFieldKey = typeof LEAD_FIELDS[number]['key'];

interface ParsedRow {
  raw: Record<string, string>;
  mapped: Partial<Record<LeadFieldKey, string>>;
  isDuplicate: boolean;
  duplicateId?: string;
  selected: boolean;
  action: 'import' | 'merge' | 'skip';
}

interface CSVImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultFlow?: EntryFlow;
}

export function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const table: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && quoted && next === '"') {
      cell += '"';
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i++;
      row.push(cell.trim());
      if (row.some(v => v.length > 0)) table.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some(v => v.length > 0)) table.push(row);
  if (table.length < 2) return { headers: [], rows: [] };
  const headers = table[0].map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = table.slice(1).map(values => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = (values[i] || '').trim(); });
    return obj;
  });
  return { headers, rows };
}

export function autoMapHeaders(csvHeaders: string[]): Record<string, LeadFieldKey | ''> {
  const mapping: Record<string, LeadFieldKey | ''> = {};
  const ALIASES: Record<string, string[]> = {
    companyName: ['company', 'company name', 'business', 'brand', 'brand name', 'organization', 'organisation', 'account', 'store', 'shop', 'client', 'merchant'],
    contactName: ['contact', 'contact name', 'name', 'full name', 'person', 'first name', 'lead name', 'prospect', 'decision maker', 'primary contact'],
    contactEmail: ['email', 'e-mail', 'contact email', 'email address', 'work email', 'mail'],
    contactPhone: ['phone', 'telephone', 'mobile', 'contact phone', 'phone number', 'whatsapp', 'number'],
    website: ['website', 'url', 'web', 'site', 'domain', 'store url', 'company website'],
    instagram: ['instagram', 'ig', 'insta', 'instagram url', 'instagram handle'],
    linkedin: ['linkedin', 'linked in', 'linkedin url', 'linkedin profile', 'sales navigator'],
    source: ['source', 'lead source', 'channel', 'origin', 'syncgtm', 'linkedin navigator', 'sales navigator', 'import source'],
    country: ['country', 'region', 'geography', 'market'],
    city: ['city', 'location', 'town'],
    platform: ['platform', 'ecommerce', 'e-commerce'],
    notes: ['notes', 'comments', 'description'],
    owner: ['owner', 'assigned to', 'rep', 'sdr'],
    stage: ['stage', 'status', 'pipeline stage'],
    tags: ['tags', 'labels', 'categories'],
  };
  
  for (const csvH of csvHeaders) {
    const lower = csvH.toLowerCase().trim();
    let matched: LeadFieldKey | '' = '';
    if (lower.includes('sales navigator') || lower.includes('linkedin') || lower.includes('linked in')) {
      mapping[csvH] = 'linkedin';
      continue;
    }
    if (lower.includes('instagram') || lower === 'ig' || lower.includes('insta')) {
      mapping[csvH] = 'instagram';
      continue;
    }
    for (const [field, aliases] of Object.entries(ALIASES)) {
      const normalizedField = field.toLowerCase();
      if (
        aliases.includes(lower) ||
        lower === normalizedField ||
        aliases.some(alias => lower.includes(alias)) ||
        (lower.includes('company') && lower.includes('name') && field === 'companyName') ||
        (lower.includes('contact') && lower.includes('name') && field === 'contactName')
      ) {
        matched = field as LeadFieldKey;
        break;
      }
    }
    mapping[csvH] = matched;
  }
  return mapping;
}

function normalizeBrandName(value?: string) {
  return (value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeSource(value?: string, fallback: SourceDetail = 'manual_import'): SourceDetail {
  const s = (value || '').toLowerCase();
  if (s.includes('syncgtm')) return 'manual_import';
  if (s.includes('navigator') || s.includes('linkedin') || s.includes('evaboot')) return 'linkedin_evaboot';
  if (s.includes('book') || s.includes('demo')) return 'website_demo';
  if (s.includes('website') || s.includes('form')) return 'website_form';
  if (s.includes('instagram')) return 'instagram';
  if (s.includes('google')) return 'google_search';
  if (s.includes('referral')) return 'referral';
  return fallback;
}

function contactAlreadyExists(contacts: BrandContact[] | undefined, email?: string, name?: string) {
  const e = (email || '').trim().toLowerCase();
  const n = (name || '').trim().toLowerCase();
  return (contacts || []).some(c =>
    (e && c.email?.toLowerCase() === e) ||
    (n && c.name.trim().toLowerCase() === n)
  );
}

function fallbackContactName(mapped: Partial<Record<LeadFieldKey, string>>): string {
  const explicit = mapped.contactName?.trim();
  if (explicit) return explicit;
  const emailName = mapped.contactEmail?.split('@')[0]?.replace(/[._-]+/g, ' ').trim();
  if (emailName) return emailName.replace(/\b\w/g, ch => ch.toUpperCase());
  return 'Primary contact';
}

export function CSVImportDialog({ open, onOpenChange, defaultFlow }: CSVImportDialogProps) {
  const { companies, saveCompany, addActivity, refresh } = useCompanyStore();
  const { currentUser, isLeadership } = useUser();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<'upload' | 'map' | 'preview' | 'result'>('upload');
  const [importMode, setImportMode] = useState<'csv' | 'demo'>('csv');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [fieldMapping, setFieldMapping] = useState<Record<string, LeadFieldKey | ''>>({});
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [importResults, setImportResults] = useState<{ imported: number; merged: number; skipped: number; errors: number }>({ imported: 0, merged: 0, skipped: 0, errors: 0 });
  const [sourceTag, setSourceTag] = useState<SourceDetail>('manual_import');
  const [defaultOwner, setDefaultOwner] = useState(currentUser);
  const [defaultPlatform, setDefaultPlatform] = useState<Platform>('shopify');

  const [demoWebhookUrl, setDemoWebhookUrl] = useState('');
  const [demoCompany, setDemoCompany] = useState('');
  const [demoContact, setDemoContact] = useState('');
  const [demoEmail, setDemoEmail] = useState('');
  const [demoPhone, setDemoPhone] = useState('');
  const [demoWebsite, setDemoWebsite] = useState('');
  const [demoNote, setDemoNote] = useState('');

  const entryFlow: EntryFlow = defaultFlow || 'sdr_manual';
  const pipeline: Pipeline = entryFlow === 'inbound' ? 'inbound' : 'outbound-sdr';

  const reset = () => {
    setStep('upload');
    setCsvHeaders([]);
    setFieldMapping({});
    setParsedRows([]);
    setImportResults({ imported: 0, merged: 0, skipped: 0, errors: 0 });
  };

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text) return;

      const { headers, rows } = parseCSV(text);
      if (headers.length === 0) {
        toast.error('Could not parse CSV — check file format');
        return;
      }

      setCsvHeaders(headers);
      const autoMap = autoMapHeaders(headers);
      setFieldMapping(autoMap);

      // Build parsed rows with dedupe check
      const mapped = rows.map(raw => {
        const row: Partial<Record<LeadFieldKey, string>> = {};
        for (const [csvH, leadField] of Object.entries(autoMap)) {
          if (leadField && raw[csvH]) {
            row[leadField] = raw[csvH];
          }
        }

        // Dedupe: check by company name + email
        const existingByName = companies.find(c =>
          normalizeBrandName(c.companyName) === normalizeBrandName(row.companyName)
        );
        const duplicate = existingByName;

        return {
          raw,
          mapped: row,
          isDuplicate: !!duplicate,
          duplicateId: duplicate?.id,
          selected: true,
          action: duplicate ? 'merge' as const : 'import' as const,
        };
      });

      setParsedRows(mapped);
      setStep('map');
      toast.success(`Parsed ${rows.length} rows from CSV`);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [companies]);

  const handleMappingChange = (csvHeader: string, leadField: LeadFieldKey | '') => {
    setFieldMapping(prev => ({ ...prev, [csvHeader]: leadField }));
  };

  const applyMapping = () => {
    // Re-map rows with updated field mapping
    const updated = parsedRows.map(row => {
      const mapped: Partial<Record<LeadFieldKey, string>> = {};
      for (const [csvH, leadField] of Object.entries(fieldMapping)) {
        if (leadField && row.raw[csvH]) {
          mapped[leadField] = row.raw[csvH];
        }
      }

      const existingByName = companies.find(c =>
        normalizeBrandName(c.companyName) === normalizeBrandName(mapped.companyName)
      );
      const duplicate = existingByName;

      return {
        ...row,
        mapped,
        isDuplicate: !!duplicate,
        duplicateId: duplicate?.id,
        action: duplicate ? (row.action === 'skip' ? 'merge' : row.action) : 'import' as const,
      };
    });
    setParsedRows(updated);
    setStep('preview');
  };

  const toggleRowAction = (idx: number, action: 'import' | 'merge' | 'skip') => {
    setParsedRows(prev => prev.map((r, i) => i === idx ? { ...r, action } : r));
  };

  const toggleRowSelect = (idx: number) => {
    setParsedRows(prev => prev.map((r, i) => i === idx ? { ...r, selected: !r.selected } : r));
  };

  const executeImport = () => {
    const now = new Date().toISOString();
    let imported = 0, merged = 0, skipped = 0, errors = 0;

    for (const row of parsedRows) {
      if (!row.selected || row.action === 'skip') { skipped++; continue; }

      const m = row.mapped;
      if (!m.companyName) { errors++; continue; }
      const contactName = fallbackContactName(m);

      if (row.action === 'merge' && row.duplicateId) {
        // Merge into existing brand record. Brands are canonical; people are contacts.
        const existing = companies.find(c => c.id === row.duplicateId);
        if (!existing) { errors++; continue; }
        const baseContacts: BrandContact[] = existing.contacts?.length ? existing.contacts : [{
          id: uid(),
          name: existing.contactName,
          role: existing.contactRole,
          email: existing.contactEmail,
          phone: existing.contactPhone,
          linkedin: existing.linkedin,
          instagram: existing.instagram,
          reached: false,
        }];
        const contact: BrandContact = {
          id: uid(),
          name: contactName,
          email: m.contactEmail?.trim() || undefined,
          phone: m.contactPhone?.trim() || undefined,
          linkedin: m.linkedin?.trim() || undefined,
          instagram: m.instagram?.trim() || undefined,
          reached: false,
        };
        const contacts = contactAlreadyExists(baseContacts, contact.email, contact.name)
          ? baseContacts
          : [...baseContacts, contact];

        const updated: Lead = {
          ...existing,
          contacts,
          secondaryContact: existing.secondaryContact || contacts[1] ? {
            name: contacts[1]?.name || existing.secondaryContact?.name || '',
            email: contacts[1]?.email || existing.secondaryContact?.email,
            phone: contacts[1]?.phone || existing.secondaryContact?.phone,
            linkedin: contacts[1]?.linkedin || existing.secondaryContact?.linkedin,
            instagram: contacts[1]?.instagram || existing.secondaryContact?.instagram,
          } : existing.secondaryContact,
          contactPhone: m.contactPhone || existing.contactPhone,
          website: m.website || existing.website,
          instagram: m.instagram || existing.instagram,
          linkedin: m.linkedin || existing.linkedin,
          source_detail: normalizeSource(m.source, existing.source_detail || sourceTag),
          notes: [
            existing.notes,
            m.notes ? `[Import] ${m.notes}` : '',
            `Imported contact: ${contactName}${m.contactEmail ? ` · ${m.contactEmail}` : ''}`,
          ].filter(Boolean).join('\n'),
          updatedAt: now,
        };
        saveCompany(updated);
        addActivity({
          id: uid(), leadId: existing.id, type: 'stage-change',
          description: `CSV import merged contact into brand`,
          createdAt: now, createdBy: currentUser,
        });
        merged++;
        continue;
      }

      // Import as new
      const stage = DEFAULT_STAGE[pipeline];
      const primaryContactId = uid();
      const source = normalizeSource(m.source, sourceTag);
      const inboundType = pipeline === 'inbound'
        ? (source === 'website_demo' || source === 'website_form' ? 'direct_book_demo' : 'manual_inbound')
        : null;
      const lead: Lead = {
        id: uid(),
        companyName: m.companyName.trim(),
        contactName,
        contactEmail: m.contactEmail?.trim() || '',
        contactPhone: m.contactPhone?.trim() || undefined,
        website: m.website?.trim() || undefined,
        instagram: m.instagram?.trim() || undefined,
        linkedin: m.linkedin?.trim() || undefined,
        contacts: [{
          id: primaryContactId,
          name: contactName,
          email: m.contactEmail?.trim() || undefined,
          phone: m.contactPhone?.trim() || undefined,
          linkedin: m.linkedin?.trim() || undefined,
          instagram: m.instagram?.trim() || undefined,
          reached: false,
        }],
        contactsReachedCount: 0,
        pipeline,
        stage,
        assignedTo: m.owner || defaultOwner,
        platform: (m.platform as Platform) || defaultPlatform,
        entry_flow: entryFlow,
        inbound_type: inboundType,
        source_detail: source,
        action_owner: 'sdr',
        record_owner: m.owner || defaultOwner,
        assigned_sdr: m.owner || defaultOwner,
        notes: [
          m.notes || '',
          m.country || m.city ? `Location: ${[m.city, m.country].filter(Boolean).join(', ')}` : '',
          m.tags ? `Tags: ${m.tags}` : '',
          'Secondary contact missing',
        ].filter(Boolean).join('\n'),
        createdAt: now,
        updatedAt: now,
        tasks: [{
          id: uid(),
          title: 'Secondary contact missing',
          dueDate: now,
          completed: false,
          assignedTo: m.owner || defaultOwner,
          type: 'outreach',
          autoGenerated: true,
          createdAt: now,
          priority: 'medium',
          reason: 'Brand imported with one contact',
          stageFamily: 'sdr',
        }],
        priority: 'medium',
      };

      lead.leadKey = generateLeadKey(lead);
      const intel = recalculateNextAction(lead);
      lead.nextAction = intel.action;
      lead.nextActionReason = intel.reason;
      lead.nextActionUrgency = intel.urgency;
      lead.nextFollowUp = intel.followUpDate;

      saveCompany(lead);
      addActivity({
        id: uid(), leadId: lead.id, type: 'stage-change',
        description: `Brand imported via CSV — ${lead.companyName}`,
        createdAt: now, createdBy: currentUser,
      });
      imported++;
    }

    refresh();
    setImportResults({ imported, merged, skipped, errors });
    setStep('result');
    toast.success(`Import complete: ${imported} imported, ${merged} merged, ${skipped} skipped`);
  };

  const dupeCount = parsedRows.filter(r => r.isDuplicate).length;
  const validCount = parsedRows.filter(r => r.mapped.companyName).length;
  const hasRequiredFields = !!(fieldMapping && Object.values(fieldMapping).includes('companyName'));

  const createDemoLead = async () => {
    if (!demoCompany.trim() || !demoContact.trim() || !demoEmail.trim()) {
      toast.error('Company, contact, and email are required');
      return;
    }
    const now = new Date().toISOString();
    const existing = companies.find(c => normalizeBrandName(c.companyName) === normalizeBrandName(demoCompany));
    if (existing) {
      const baseContacts: BrandContact[] = existing.contacts?.length ? existing.contacts : [{
        id: uid(),
        name: existing.contactName,
        role: existing.contactRole,
        email: existing.contactEmail,
        phone: existing.contactPhone,
        linkedin: existing.linkedin,
        instagram: existing.instagram,
        reached: false,
      }];
      const contact: BrandContact = {
        id: uid(),
        name: demoContact.trim(),
        email: demoEmail.trim(),
        phone: demoPhone.trim() || undefined,
        reached: false,
      };
      const contacts = contactAlreadyExists(baseContacts, contact.email, contact.name) ? baseContacts : [...baseContacts, contact];
      saveCompany({
        ...existing,
        contacts,
        secondaryContact: existing.secondaryContact || contacts[1] ? {
          name: contacts[1]?.name || existing.secondaryContact?.name || '',
          email: contacts[1]?.email || existing.secondaryContact?.email,
          phone: contacts[1]?.phone || existing.secondaryContact?.phone,
        } : existing.secondaryContact,
        source_detail: 'website_demo',
        inbound_type: 'direct_book_demo',
        notes: [existing.notes, demoNote ? `[Book demo] ${demoNote}` : 'Book demo request'].filter(Boolean).join('\n'),
        updatedAt: now,
      });
      addActivity({ id: uid(), leadId: existing.id, type: 'stage-change', description: 'Book-a-demo contact merged into brand', createdAt: now, createdBy: currentUser });
      toast.success('Book-a-demo merged into existing brand');
    } else {
      const lead: Lead = {
        id: uid(),
        companyName: demoCompany.trim(),
        contactName: demoContact.trim(),
        contactEmail: demoEmail.trim(),
        contactPhone: demoPhone.trim() || undefined,
        website: demoWebsite.trim() || undefined,
        contacts: [{ id: uid(), name: demoContact.trim(), email: demoEmail.trim(), phone: demoPhone.trim() || undefined, reached: false }],
        contactsReachedCount: 0,
        pipeline: 'inbound',
        stage: DEFAULT_STAGE.inbound,
        assignedTo: defaultOwner,
        platform: defaultPlatform,
        entry_flow: 'inbound',
        inbound_type: 'direct_book_demo',
        source_detail: 'website_demo',
        action_owner: 'sdr',
        record_owner: defaultOwner,
        assigned_sdr: defaultOwner,
        notes: [demoNote.trim(), 'Secondary contact missing'].filter(Boolean).join('\n'),
        createdAt: now,
        updatedAt: now,
        tasks: [{
          id: uid(),
          title: 'Secondary contact missing',
          dueDate: now,
          completed: false,
          assignedTo: defaultOwner,
          type: 'outreach',
          autoGenerated: true,
          createdAt: now,
          priority: 'medium',
          reason: 'Book-a-demo brand has one contact',
          stageFamily: 'sdr',
        }],
        priority: 'medium',
      };
      lead.leadKey = generateLeadKey(lead);
      const intel = recalculateNextAction(lead);
      lead.nextAction = intel.action;
      lead.nextActionReason = intel.reason;
      lead.nextActionUrgency = intel.urgency;
      lead.nextFollowUp = intel.followUpDate;
      saveCompany(lead);
      addActivity({ id: uid(), leadId: lead.id, type: 'stage-change', description: `Book-a-demo inbound created — ${lead.companyName}`, createdAt: now, createdBy: currentUser });
      try {
        await submitBookDemoLead({
          companyName: lead.companyName,
          contactName: lead.contactName,
          contactEmail: lead.contactEmail,
          contactPhone: lead.contactPhone,
          website: lead.website,
          owner: defaultOwner,
          note: demoNote,
        });
      } catch {
        // Local creation is authoritative for offline preview; backend sync can be configured later.
      }
      toast.success('Book-a-demo lead added to Inbound');
    }
    setDemoCompany('');
    setDemoContact('');
    setDemoEmail('');
    setDemoPhone('');
    setDemoWebsite('');
    setDemoNote('');
    refresh();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4 text-primary" />
            Import Leads
          </DialogTitle>
          <DialogDescription className="text-xs">
            Import brands from CSV, book-a-demo CSV, or configured connectors
          </DialogDescription>
        </DialogHeader>

        <Tabs value={importMode} onValueChange={v => setImportMode(v as 'csv' | 'demo')}>
          <TabsList className="h-8 w-full">
            <TabsTrigger value="csv" className="text-xs flex-1">
              <FileText className="h-3 w-3 mr-1" /> CSV Upload
            </TabsTrigger>
            <TabsTrigger value="demo" className="text-xs flex-1">
              <Globe className="h-3 w-3 mr-1" /> Book-a-demo
            </TabsTrigger>
          </TabsList>

          {/* ── CSV IMPORT ── */}
          <TabsContent value="csv" className="space-y-3 mt-3">
            {step === 'upload' && (
              <div className="space-y-3">
                <div
                  className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
                  <p className="text-sm font-medium">Click to upload CSV</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Company/Brand is the only required field. Contact, Email, Phone, Source, Geography, Platform, Notes are auto-filled when present.
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleFileUpload}
                />

                {/* Import defaults */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Default Source</Label>
                    <Select value={sourceTag} onValueChange={v => setSourceTag(v as SourceDetail)}>
                      <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual_import">Manual Import</SelectItem>
                        <SelectItem value="website_demo">Website Demo</SelectItem>
                        <SelectItem value="linkedin_evaboot">LinkedIn</SelectItem>
                        <SelectItem value="instagram">Instagram</SelectItem>
                        <SelectItem value="google_search">Google Search</SelectItem>
                        <SelectItem value="referral">Referral</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Default Owner</Label>
                    <Select value={defaultOwner} onValueChange={setDefaultOwner}>
                      <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SALES_MEMBERS.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            {step === 'map' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Map CSV columns to lead fields</p>
                  <Badge variant="secondary" className="text-xs">{csvHeaders.length} columns</Badge>
                </div>

                {!hasRequiredFields && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-destructive/10 text-destructive text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Map Company Name. Contact and Email are optional.
                  </div>
                )}

                <ScrollArea className="max-h-64">
                  <div className="space-y-2">
                    {csvHeaders.map(h => (
                      <div key={h} className="flex items-center gap-2">
                        <span className="text-xs font-mono bg-secondary px-2 py-1 rounded min-w-[100px] truncate">{h}</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                        <Select
                          value={fieldMapping[h] || '_skip'}
                          onValueChange={v => handleMappingChange(h, v === '_skip' ? '' : v as LeadFieldKey)}
                        >
                          <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_skip">— Skip —</SelectItem>
                            {LEAD_FIELDS.map(f => (
                              <SelectItem key={f.key} value={f.key}>
                                {f.label} {f.required ? '*' : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => setStep('upload')}>Back</Button>
                  <Button size="sm" onClick={applyMapping} disabled={!hasRequiredFields}>
                    Preview ({parsedRows.length} rows)
                  </Button>
                </div>
              </div>
            )}

            {step === 'preview' && (
              <div className="space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <Badge variant="secondary" className="text-xs">
                    {validCount} valid
                  </Badge>
                  {dupeCount > 0 && (
                    <Badge variant="outline" className="text-xs border-warning text-warning">
                      {dupeCount} duplicates
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-xs">
                    {parsedRows.length - validCount} missing required fields
                  </Badge>
                </div>

                <ScrollArea className="max-h-64">
                  <div className="space-y-1.5">
                    {parsedRows.map((row, idx) => {
                      const valid = !!row.mapped.companyName;
                      return (
                        <div
                          key={idx}
                          className={cn(
                            "flex items-center gap-2 p-2 rounded-lg border text-xs",
                            !valid && 'opacity-50 bg-destructive/5',
                            row.isDuplicate && row.action !== 'skip' && 'border-warning/30 bg-warning/5',
                            row.action === 'skip' && 'opacity-40',
                          )}
                        >
                          <Checkbox
                            checked={row.selected && valid}
                            onCheckedChange={() => valid && toggleRowSelect(idx)}
                            disabled={!valid}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium truncate">{row.mapped.companyName || '—'}</p>
                            <p className="text-muted-foreground truncate">
                              {fallbackContactName(row.mapped)}{row.mapped.contactEmail ? ` · ${row.mapped.contactEmail}` : ''}
                            </p>
                          </div>
                          {row.isDuplicate && (
                            <Select
                              value={row.action}
                              onValueChange={v => toggleRowAction(idx, v as 'import' | 'merge' | 'skip')}
                            >
                              <SelectTrigger className="h-6 text-[10px] w-20"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="skip">Skip</SelectItem>
                                <SelectItem value="merge">Merge</SelectItem>
                                <SelectItem value="import">New</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                          {!valid && <Badge variant="destructive" className="text-[9px]">Missing fields</Badge>}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>

                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => setStep('map')}>Back</Button>
                  <Button size="sm" onClick={executeImport} disabled={parsedRows.filter(r => r.selected && r.action !== 'skip').length === 0}>
                    Import {parsedRows.filter(r => r.selected && r.action !== 'skip').length} leads
                  </Button>
                </div>
              </div>
            )}

            {step === 'result' && (
              <div className="space-y-4 py-4 text-center">
                <CheckCircle className="h-10 w-10 mx-auto text-success" />
                <div>
                  <p className="text-lg font-semibold">Import Complete</p>
                  <div className="flex justify-center gap-4 mt-3 text-sm">
                    {importResults.imported > 0 && (
                      <div className="text-center">
                        <p className="text-2xl font-bold text-success">{importResults.imported}</p>
                        <p className="text-muted-foreground text-xs">Imported</p>
                      </div>
                    )}
                    {importResults.merged > 0 && (
                      <div className="text-center">
                        <p className="text-2xl font-bold text-primary">{importResults.merged}</p>
                        <p className="text-muted-foreground text-xs">Merged</p>
                      </div>
                    )}
                    {importResults.skipped > 0 && (
                      <div className="text-center">
                        <p className="text-2xl font-bold text-muted-foreground">{importResults.skipped}</p>
                        <p className="text-muted-foreground text-xs">Skipped</p>
                      </div>
                    )}
                    {importResults.errors > 0 && (
                      <div className="text-center">
                        <p className="text-2xl font-bold text-destructive">{importResults.errors}</p>
                        <p className="text-muted-foreground text-xs">Errors</p>
                      </div>
                    )}
                  </div>
                </div>
                <Button size="sm" onClick={() => { reset(); onOpenChange(false); }}>Done</Button>
              </div>
            )}
          </TabsContent>

          {/* ── WEBSITE DEMO IMPORT ── */}
          <TabsContent value="demo" className="space-y-3 mt-3">
            <Card className="border-dashed">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-primary" />
                  <p className="text-sm font-medium">Website Demo Source</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Import demo requests as brands. If the same brand appears twice, contacts merge into one brand record.
                </p>

                <div className="space-y-2">
                  <div>
                    <Label className="text-xs">Demo webhook / export source</Label>
                    <Input
                      placeholder="Website form export URL or connector endpoint"
                      value={demoWebhookUrl}
                      onChange={e => setDemoWebhookUrl(e.target.value)}
                      className="mt-1 text-xs"
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Live sync uses Settings → Connectors. CSV exports can be uploaded from the CSV tab.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Brand / company" value={demoCompany} onChange={e => setDemoCompany(e.target.value)} className="h-8 text-xs" />
                  <Input placeholder="Contact name" value={demoContact} onChange={e => setDemoContact(e.target.value)} className="h-8 text-xs" />
                  <Input placeholder="Email" value={demoEmail} onChange={e => setDemoEmail(e.target.value)} className="h-8 text-xs" />
                  <Input placeholder="Phone" value={demoPhone} onChange={e => setDemoPhone(e.target.value)} className="h-8 text-xs" />
                  <Input placeholder="Website" value={demoWebsite} onChange={e => setDemoWebsite(e.target.value)} className="h-8 text-xs col-span-2" />
                  <Input placeholder="Note" value={demoNote} onChange={e => setDemoNote(e.target.value)} className="h-8 text-xs col-span-2" />
                </div>

                <div className="bg-secondary/50 rounded-lg p-3 space-y-2">
                  <p className="text-[11px] font-medium">Import rules</p>
                  <ol className="text-[10px] text-muted-foreground space-y-1 list-decimal pl-4">
                    <li>Company/brand name is the canonical record</li>
                    <li>Multiple people from one brand become contacts on that brand</li>
                    <li>One-contact brands enter pipeline with “Add secondary contact”</li>
                    <li>Source is saved as Website Demo unless overridden by CSV mapping</li>
                  </ol>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Auto-assign Source</Label>
                    <Select value="website_form" disabled>
                      <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="website_form">Website Form</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Route To</Label>
                    <Select value={defaultOwner} onValueChange={setDefaultOwner}>
                      <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SALES_MEMBERS.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button size="sm" className="w-full" onClick={createDemoLead}>
                  <Globe className="h-3 w-3 mr-1" /> Create inbound lead
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
