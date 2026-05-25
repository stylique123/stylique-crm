/**
 * STYLIQUE CRM — Comprehensive Seed Data
 * 50 TEST leads across all stages, geographies, flows, and owners.
 * Plus test attendance, leave, and directive scenarios.
 */
import { Lead, BrandContact, PaymentLedgerEntry, PLAN_PRICES, recalculateNextAction } from '@/types/crm';
import { saveLead, addActivity, uid } from '@/lib/store';
import { generateLeadKey } from '@/lib/lead-key';
import { safeRead, safeWrite, safeId } from '@/lib/safe-storage';

interface SeedLeaveRequest {
  id: string;
  userId: string;
  type: string;
  startDate: string;
  reason: string;
  status: string;
  paidOrUnpaid: string;
  isLateRequest: boolean;
  approvedBy?: string;
  approverNote?: string;
  createdAt: string;
  updatedAt: string;
}

interface SeedAttendance {
  id: string;
  userId: string;
  date: string;
  status: string;
  checkInTime?: string;
  isLate?: boolean;
  leaveReason?: string;
}

interface SeedDirective {
  id: string;
  senderId: string;
  senderName: string;
  receiverId: string;
  receiverName: string;
  scope: string;
  targets: Array<{ leadId: string; companyName: string }>;
  actionType: string;
  priority: string;
  dueAt: string;
  requireAck: boolean;
  requireOutcome: boolean;
  note: string;
  status: string;
  acknowledgedAt?: string;
  blockerReason?: string;
  completedAt?: string;
  createdAt: string;
  outcomes: unknown[];
}

function daysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString();
}
function daysFromNow(n: number): string {
  const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString();
}

function makeContacts(c1: Partial<BrandContact>, c2?: Partial<BrandContact>): BrandContact[] {
  const contacts: BrandContact[] = [{
    id: uid(), name: c1.name || '', role: c1.role, email: c1.email, phone: c1.phone,
    linkedin: c1.linkedin, instagram: c1.instagram, reached: c1.reached || false, firstReachedAt: c1.firstReachedAt,
  }];
  if (c2?.name) {
    contacts.push({
      id: uid(), name: c2.name, role: c2.role, email: c2.email, phone: c2.phone,
      linkedin: c2.linkedin, instagram: c2.instagram, reached: c2.reached || false, firstReachedAt: c2.firstReachedAt,
    });
  }
  return contacts;
}

export function seedSampleData() {
  const leads: Lead[] = [];

  // Helper to push a lead with defaults
  function add(partial: Partial<Lead> & { companyName: string; contactName: string; contactEmail: string }) {
    const lead: Lead = {
      id: uid(),
      pipeline: 'outbound-sdr',
      stage: 'sdr-new-lead',
      assignedTo: 'areeba',
      notes: '',
      createdAt: daysAgo(1),
      updatedAt: daysAgo(0),
      tasks: [],
      priority: 'medium',
      entry_flow: 'sdr_manual',
      source_detail: 'linkedin_evaboot',
      action_owner: 'sdr',
      ...partial,
    };
    // ── Backfill first-class commercial model from legacy subscriptionPlan ──
    if (lead.subscriptionPlan && !lead.proposed_package) {
      lead.proposed_package = lead.subscriptionPlan;
      lead.proposed_currency = lead.proposed_currency ?? 'USD';
      lead.proposed_value = lead.proposed_value ?? PLAN_PRICES[lead.subscriptionPlan] ?? 0;
    }
    const isPaidClient = lead.paymentStatus === 'paid' && !!lead.paymentReceivedAt;
    if (isPaidClient && !lead.active_package) {
      lead.active_package = lead.subscriptionPlan ?? lead.proposed_package;
      lead.active_currency = lead.active_currency ?? 'USD';
      lead.active_value = lead.active_value ?? PLAN_PRICES[lead.active_package ?? 'starter'] ?? 0;
    }
    // ── Seed payment ledger for any record in billing scope ──
    const inBillingScope =
      lead.paymentStatus === 'paid' ||
      lead.paymentStatus === 'pending' ||
      lead.paymentStatus === 'overdue';
    if (inBillingScope && (!lead.paymentLedger || lead.paymentLedger.length === 0)) {
      const amount =
        lead.active_value ?? lead.proposed_value ??
        PLAN_PRICES[(lead.subscriptionPlan ?? 'starter')] ?? 0;
      const currency = lead.active_currency ?? lead.proposed_currency ?? 'USD';
      const ledger: PaymentLedgerEntry[] = [];
      // If already paid, log the prior month as paid + open the current cycle.
      if (isPaidClient && lead.paymentReceivedAt) {
        const paidAt = new Date(lead.paymentReceivedAt);
        ledger.push({
          id: uid(),
          billingMonth: `${paidAt.getUTCFullYear()}-${String(paidAt.getUTCMonth() + 1).padStart(2, '0')}`,
          amount, currency,
          dueDate: paidAt.toISOString(),
          status: 'paid',
          paidAt: paidAt.toISOString(),
          paidBy: lead.approvedBy ?? 'system',
        });
      }
      // Open entry for the next/current due cycle.
      const dueIso = lead.nextPaymentDate ?? new Date().toISOString();
      const dueDate = new Date(dueIso);
      ledger.push({
        id: uid(),
        billingMonth: `${dueDate.getUTCFullYear()}-${String(dueDate.getUTCMonth() + 1).padStart(2, '0')}`,
        amount, currency,
        dueDate: dueDate.toISOString(),
        status: dueDate.getTime() < Date.now() ? 'overdue' : 'unpaid',
      });
      lead.paymentLedger = ledger;
    }
    leads.push(lead);
  }

  // ═══════════════════════════════════════════════════
  // 1-8: NEW LEADS (distributed across owners/geos)
  // ═══════════════════════════════════════════════════

  add({
    companyName: 'Velvet Rose Cosmetics', contactName: 'Emily Chen', contactEmail: 'emily@velvetrose.com',
    contactPhone: '+1-555-2001', website: 'https://velvetrose.com', linkedin: 'linkedin.com/in/emilychen',
    assignedTo: 'areeba', platform: 'shopify', source_detail: 'linkedin_evaboot',
    contacts: makeContacts(
      { name: 'Emily Chen', role: 'CEO', email: 'emily@velvetrose.com', phone: '+1-555-2001', linkedin: 'linkedin.com/in/emilychen' },
      { name: 'Jessica Wong', role: 'Marketing Director', email: 'jessica@velvetrose.com', phone: '+1-555-2002', linkedin: 'linkedin.com/in/jessicawong' }
    ),
    notes: 'USA-based premium cosmetics brand, 65k Instagram followers',
    intelligence: { source: 'linkedin', instagramFollowers: 65000, tier: 'tier-1' },
  });

  add({
    companyName: 'Noor Skincare', contactName: 'Fatima Zahid', contactEmail: 'fatima@noorskincare.pk',
    contactPhone: '+92-300-5001', assignedTo: 'khadija', platform: 'woocommerce', source_detail: 'instagram',
    contacts: makeContacts(
      { name: 'Fatima Zahid', role: 'Founder', email: 'fatima@noorskincare.pk', phone: '+92-300-5001' },
      { name: 'Sara Ahmed', role: 'Operations Manager', email: 'sara@noorskincare.pk', phone: '+92-321-5002' }
    ),
    notes: 'Pakistan skincare brand, growing fast on Instagram',
    intelligence: { source: 'instagram', instagramFollowers: 42000, tier: 'tier-1' },
  });

  add({
    companyName: 'Royal Bloom UK', contactName: 'Charlotte Mills', contactEmail: 'charlotte@royalbloom.co.uk',
    contactPhone: '+44-7700-3001', website: 'https://royalbloom.co.uk', assignedTo: 'taiba', platform: 'shopify',
    source_detail: 'google_search',
    contacts: makeContacts(
      { name: 'Charlotte Mills', role: 'Co-Founder', email: 'charlotte@royalbloom.co.uk', phone: '+44-7700-3001' },
      { name: 'Olivia James', role: 'Head of E-commerce', email: 'olivia@royalbloom.co.uk' }
    ),
    notes: 'UK luxury floral beauty brand',
    intelligence: { source: 'google', instagramFollowers: 38000, tier: 'tier-2' },
  });

  add({
    companyName: 'Desert Glow UAE', contactName: 'Mariam Al-Rashid', contactEmail: 'mariam@desertglow.ae',
    contactPhone: '+971-50-4001', website: 'https://desertglow.ae', assignedTo: 'asjad', platform: 'shopify',
    source_detail: 'instagram',
    contacts: makeContacts(
      { name: 'Mariam Al-Rashid', role: 'CEO', email: 'mariam@desertglow.ae', phone: '+971-50-4001' },
      { name: 'Noura Bin Khalid', role: 'Brand Manager', email: 'noura@desertglow.ae' }
    ),
    notes: 'UAE-based natural beauty brand',
    intelligence: { source: 'instagram', instagramFollowers: 55000, tier: 'tier-1' },
  });

  add({
    companyName: 'Aurora Beauty USA', contactName: 'Madison Taylor', contactEmail: 'madison@aurorabeauty.com',
    contactPhone: '+1-555-2010', assignedTo: 'areeba', platform: 'shopify', source_detail: 'referral',
    contacts: makeContacts(
      { name: 'Madison Taylor', role: 'Founder', email: 'madison@aurorabeauty.com', phone: '+1-555-2010' },
      { name: 'Riley Cooper', role: 'CTO', email: 'riley@aurorabeauty.com' }
    ),
    notes: 'Referral from existing client',
    intelligence: { source: 'referral', tier: 'tier-1' },
  });

  add({
    companyName: 'Karachi Couture', contactName: 'Ayesha Malik', contactEmail: 'ayesha@karachicouture.pk',
    assignedTo: 'khadija', platform: 'woocommerce', source_detail: 'whatsapp',
    contacts: makeContacts(
      { name: 'Ayesha Malik', role: 'Owner', email: 'ayesha@karachicouture.pk', phone: '+92-333-5010' }
    ), // Only 1 contact — KPI incomplete test case
    notes: 'Single contact only — needs second contact for brand KPI',
    intelligence: { source: 'referral', tier: 'tier-2' },
  });

  add({
    companyName: 'Camden Beauty Lab', contactName: 'Sophie Turner', contactEmail: 'sophie@camdenbeautylab.co.uk',
    assignedTo: 'taiba', platform: 'shopify', source_detail: 'instagram_dm',
    pipeline: 'inbound', entry_flow: 'inbound', inbound_type: 'manual_inbound',
    contacts: makeContacts(
      { name: 'Sophie Turner', role: 'Creative Director', email: 'sophie@camdenbeautylab.co.uk', phone: '+44-7700-3010' },
      { name: 'Emma Watson', role: 'CEO', email: 'emma@camdenbeautylab.co.uk' }
    ),
    notes: 'Instagram DM inbound inquiry',
    intelligence: { source: 'instagram', instagramFollowers: 72000, tier: 'tier-1' },
  });

  add({
    companyName: 'Luxe Aura USA', contactName: 'Sarah Johnson', contactEmail: 'sarah@luxeaura.com',
    contactPhone: '+1-555-2020', assignedTo: 'areeba', platform: 'shopify', source_detail: 'manual_import',
    contacts: makeContacts(
      { name: 'Sarah Johnson', role: 'VP Sales', email: 'sarah@luxeaura.com', phone: '+1-555-2020' },
      { name: 'Kate Anderson', role: 'Marketing Lead', email: 'kate@luxeaura.com' }
    ),
    notes: 'CSV import lead',
    intelligence: { source: 'linkedin', instagramFollowers: 45000, tier: 'tier-1' },
  });

  // ═══════════════════════════════════════════════════
  // 9-16: CONTACTED (with varying contact reach states)
  // ═══════════════════════════════════════════════════

  add({
    companyName: 'Silk & Sage Beauty', contactName: 'Nina Patel', contactEmail: 'nina@silksage.com',
    contactPhone: '+1-555-2030', assignedTo: 'areeba', platform: 'shopify', stage: 'sdr-contacted',
    source_detail: 'linkedin_evaboot',
    lastContactedAt: daysAgo(2), lastEmailAt: daysAgo(2),
    contacts: makeContacts(
      { name: 'Nina Patel', role: 'Founder', email: 'nina@silksage.com', reached: true, firstReachedAt: daysAgo(2) },
      { name: 'Priya Sharma', role: 'COO', email: 'priya@silksage.com' }
    ),
    contactsReachedCount: 1,
    notes: 'First contact reached via email. Second contact not yet touched. Brand KPI = 0.',
    createdAt: daysAgo(5),
    intelligence: { source: 'linkedin', tier: 'tier-1' },
  });

  add({
    companyName: 'Pearl & Petal UK', contactName: 'Alice Brown', contactEmail: 'alice@pearlpetal.co.uk',
    assignedTo: 'taiba', platform: 'shopify', stage: 'sdr-contacted',
    lastContactedAt: daysAgo(4), lastEmailAt: daysAgo(4),
    contacts: makeContacts(
      { name: 'Alice Brown', role: 'CEO', email: 'alice@pearlpetal.co.uk', reached: true, firstReachedAt: daysAgo(4) },
      { name: 'Grace Lee', role: 'Digital Manager', email: 'grace@pearlpetal.co.uk', reached: true, firstReachedAt: daysAgo(3) }
    ),
    contactsReachedCount: 2,
    notes: 'Both contacts reached. Brand KPI = 1. Waiting for reply.',
    createdAt: daysAgo(7),
    intelligence: { source: 'google', tier: 'tier-1' },
  });

  add({
    companyName: 'Lahore Luxe', contactName: 'Hina Raza', contactEmail: 'hina@lahoreluxe.pk',
    assignedTo: 'khadija', platform: 'woocommerce', stage: 'sdr-contacted',
    lastContactedAt: daysAgo(1), lastEmailAt: daysAgo(1),
    contacts: makeContacts(
      { name: 'Hina Raza', role: 'Founder', email: 'hina@lahoreluxe.pk', reached: true, firstReachedAt: daysAgo(1) },
      { name: 'Zainab Shah', role: 'Marketing Head', email: 'zainab@lahoreluxe.pk' }
    ),
    contactsReachedCount: 1,
    notes: 'Pakistan market, first contact reached',
    createdAt: daysAgo(4),
    intelligence: { source: 'instagram', instagramFollowers: 30000, tier: 'tier-2' },
  });

  add({
    companyName: 'Golden Sands Beauty', contactName: 'Hessa Al-Maktoum', contactEmail: 'hessa@goldensands.ae',
    assignedTo: 'asjad', platform: 'shopify', stage: 'sdr-contacted',
    lastContactedAt: daysAgo(6),
    contacts: makeContacts(
      { name: 'Hessa Al-Maktoum', role: 'CEO', email: 'hessa@goldensands.ae', phone: '+971-55-4010', reached: true, firstReachedAt: daysAgo(6) },
      { name: 'Maryam Saeed', role: 'Head of Digital', email: 'maryam@goldensands.ae' }
    ),
    contactsReachedCount: 1,
    notes: 'UAE brand, no response after 6 days — call task should trigger',
    createdAt: daysAgo(8),
    intelligence: { source: 'linkedin', tier: 'tier-2' },
  });

  add({
    companyName: 'Bloom & Blossom NYC', contactName: 'Rachel Kim', contactEmail: 'rachel@bloomblossomnyc.com',
    assignedTo: 'areeba', platform: 'shopify', stage: 'sdr-contacted',
    lastContactedAt: daysAgo(3),
    contacts: makeContacts(
      { name: 'Rachel Kim', role: 'Director', email: 'rachel@bloomblossomnyc.com', reached: true, firstReachedAt: daysAgo(3) },
      { name: 'Mia Chen', role: 'Brand Manager', email: 'mia@bloomblossomnyc.com' }
    ),
    contactsReachedCount: 1,
    notes: 'Follow up due today — 3 days since contact',
    createdAt: daysAgo(6),
    intelligence: { source: 'instagram', instagramFollowers: 88000, tier: 'tier-1' },
  });

  add({
    companyName: 'Ivory Rose London', contactName: 'Elizabeth Hart', contactEmail: 'liz@ivoryrose.co.uk',
    assignedTo: 'taiba', platform: 'shopify', stage: 'sdr-contacted',
    lastContactedAt: daysAgo(5),
    contacts: makeContacts(
      { name: 'Elizabeth Hart', role: 'Founder', email: 'liz@ivoryrose.co.uk', reached: true, firstReachedAt: daysAgo(5) },
      { name: 'Catherine Mills', role: 'VP Operations', email: 'cath@ivoryrose.co.uk', reached: true, firstReachedAt: daysAgo(4) }
    ),
    contactsReachedCount: 2,
    notes: 'Both contacts reached, brand counted. No reply yet — call today.',
    createdAt: daysAgo(8),
    intelligence: { source: 'linkedin', tier: 'tier-1' },
  });

  add({
    companyName: 'Islamabad Skincare Co', contactName: 'Amna Tariq', contactEmail: 'amna@isbskincare.pk',
    assignedTo: 'khadija', platform: 'woocommerce', stage: 'sdr-contacted',
    lastContactedAt: daysAgo(7),
    contacts: makeContacts(
      { name: 'Amna Tariq', role: 'CEO', email: 'amna@isbskincare.pk', reached: true, firstReachedAt: daysAgo(7) }
    ), // Single contact — KPI blocked
    contactsReachedCount: 1,
    notes: 'Only 1 contact — add second contact for KPI eligibility',
    createdAt: daysAgo(10),
    intelligence: { source: 'referral', tier: 'tier-2' },
  });

  add({
    companyName: 'Sapphire Jewels Dubai', contactName: 'Layla Hassan', contactEmail: 'layla@sapphirejewels.ae',
    assignedTo: 'asjad', platform: 'shopify', stage: 'sdr-contacted',
    lastContactedAt: daysAgo(2),
    contacts: makeContacts(
      { name: 'Layla Hassan', role: 'Managing Director', email: 'layla@sapphirejewels.ae', phone: '+971-56-4020', reached: true, firstReachedAt: daysAgo(2) },
      { name: 'Aisha Bin Yousuf', role: 'Brand Lead', email: 'aisha@sapphirejewels.ae' }
    ),
    contactsReachedCount: 1,
    notes: 'UAE jewelry brand, good potential',
    createdAt: daysAgo(5),
    intelligence: { source: 'instagram', instagramFollowers: 110000, tier: 'tier-1' },
  });

  // ═══════════════════════════════════════════════════
  // 17-23: REPLIED
  // ═══════════════════════════════════════════════════

  add({
    companyName: 'Radiance Labs USA', contactName: 'Jennifer Adams', contactEmail: 'jen@radiancelabs.com',
    assignedTo: 'areeba', platform: 'shopify', stage: 'sdr-replied',
    lastContactedAt: daysAgo(1), lastReplyAt: daysAgo(1),
    contacts: makeContacts(
      { name: 'Jennifer Adams', role: 'CEO', email: 'jen@radiancelabs.com', reached: true, firstReachedAt: daysAgo(5) },
      { name: 'Michelle Park', role: 'CTO', email: 'michelle@radiancelabs.com', reached: true, firstReachedAt: daysAgo(3) }
    ),
    contactsReachedCount: 2,
    notes: 'Replied — interested in demo. Book meeting ASAP.',
    createdAt: daysAgo(8),
    intelligence: { source: 'linkedin', tier: 'tier-1' },
  });

  add({
    companyName: 'Elegance Hub UK', contactName: 'Victoria Clarke', contactEmail: 'victoria@elegancehub.co.uk',
    assignedTo: 'taiba', platform: 'shopify', stage: 'sdr-replied',
    lastContactedAt: daysAgo(0), lastReplyAt: daysAgo(0),
    contacts: makeContacts(
      { name: 'Victoria Clarke', role: 'Founder', email: 'victoria@elegancehub.co.uk', reached: true, firstReachedAt: daysAgo(4) },
      { name: 'Hannah Green', role: 'Marketing Director', email: 'hannah@elegancehub.co.uk', reached: true, firstReachedAt: daysAgo(2) }
    ),
    contactsReachedCount: 2,
    notes: 'Warm reply today — wants to discuss pricing',
    createdAt: daysAgo(6),
    intelligence: { source: 'google', instagramFollowers: 48000, tier: 'tier-1' },
  });

  add({
    companyName: 'Peshawar Beauty House', contactName: 'Sana Afridi', contactEmail: 'sana@peshawarBH.pk',
    assignedTo: 'khadija', stage: 'sdr-replied',
    lastContactedAt: daysAgo(1), lastReplyAt: daysAgo(1),
    contacts: makeContacts(
      { name: 'Sana Afridi', role: 'Owner', email: 'sana@peshawarBH.pk', reached: true, firstReachedAt: daysAgo(3) },
      { name: 'Nadia Khan', role: 'Store Manager', email: 'nadia@peshawarBH.pk', reached: true, firstReachedAt: daysAgo(2) }
    ),
    contactsReachedCount: 2,
    notes: 'Needs more info — send pricing today',
    createdAt: daysAgo(5),
    intelligence: { source: 'instagram', tier: 'tier-2' },
  });

  add({
    companyName: 'Marina Cosmetics UAE', contactName: 'Fatima Al-Zaabi', contactEmail: 'fatima@marinacosmetics.ae',
    assignedTo: 'asjad', platform: 'shopify', stage: 'sdr-replied',
    lastContactedAt: daysAgo(2), lastReplyAt: daysAgo(2),
    contacts: makeContacts(
      { name: 'Fatima Al-Zaabi', role: 'CEO', email: 'fatima@marinacosmetics.ae', reached: true, firstReachedAt: daysAgo(6) },
      { name: 'Sheikha Bint Ali', role: 'VP Sales', email: 'sheikha@marinacosmetics.ae', reached: true, firstReachedAt: daysAgo(4) }
    ),
    contactsReachedCount: 2,
    notes: 'Interested in virtual try-on. Book meeting within 24h.',
    createdAt: daysAgo(9),
    intelligence: { source: 'instagram', instagramFollowers: 92000, tier: 'tier-1' },
  });

  // Inbound replied
  add({
    companyName: 'Lush Garden Beauty', contactName: 'Amina Khalil', contactEmail: 'amina@lushgarden.ae',
    assignedTo: 'asjad', pipeline: 'inbound', stage: 'inbound-qualified', entry_flow: 'inbound',
    inbound_type: 'manual_inbound', source_detail: 'instagram_dm',
    lastContactedAt: daysAgo(0),
    contacts: makeContacts(
      { name: 'Amina Khalil', role: 'CEO', email: 'amina@lushgarden.ae', phone: '+971-55-4050' },
      { name: 'Reem Al-Maktoum', role: 'Operations', email: 'reem@lushgarden.ae' }
    ),
    notes: 'Instagram DM inbound — qualified, needs SDR follow-up',
    createdAt: daysAgo(1),
    intelligence: { source: 'instagram', instagramFollowers: 45000, tier: 'tier-1' },
  });

  // ═══════════════════════════════════════════════════
  // 24-28: MEETING BOOKED
  // ═══════════════════════════════════════════════════

  add({
    companyName: 'Crystal Clear Optics', contactName: 'James Park', contactEmail: 'james@crystaloptics.com',
    assignedTo: 'areeba', platform: 'shopify', stage: 'meeting-booked',
    meeting_status: 'booked',
    contacts: makeContacts(
      { name: 'James Park', role: 'CEO', email: 'james@crystaloptics.com', reached: true, firstReachedAt: daysAgo(7) },
      { name: 'David Lee', role: 'VP Product', email: 'david@crystaloptics.com', reached: true, firstReachedAt: daysAgo(5) }
    ),
    contactsReachedCount: 2,
    meetingNotes: [{ id: uid(), date: daysFromNow(2), type: 'zoom', summary: '', outcome: '', nextStep: '', attendees: ['areeba'], actionItems: [] }],
    notes: 'Demo meeting in 2 days — prepare brand research',
    createdAt: daysAgo(12),
    intelligence: { source: 'google', tier: 'tier-1' },
  });

  add({
    companyName: 'Bloom & Glow UK', contactName: 'Charlotte Williams', contactEmail: 'charlotte@bloomglow.co.uk',
    assignedTo: 'taiba', platform: 'shopify', stage: 'meeting-booked',
    pipeline: 'inbound', entry_flow: 'inbound', inbound_type: 'direct_book_demo', source_detail: 'website_demo',
    meeting_status: 'booked',
    contacts: makeContacts(
      { name: 'Charlotte Williams', role: 'Founder', email: 'charlotte@bloomglow.co.uk', phone: '+44-7700-3020', reached: true, firstReachedAt: daysAgo(3) },
      { name: 'Amelia Stone', role: 'CTO', email: 'amelia@bloomglow.co.uk', reached: true, firstReachedAt: daysAgo(2) }
    ),
    contactsReachedCount: 2,
    meetingNotes: [{ id: uid(), date: daysFromNow(1), type: 'google-meet', summary: '', outcome: '', nextStep: '', attendees: ['taiba'], actionItems: [] }],
    notes: 'Inbound demo booking — meeting tomorrow',
    createdAt: daysAgo(5),
    intelligence: { source: 'website', instagramFollowers: 28000, tier: 'tier-1' },
  });

  add({
    companyName: 'Faisalabad Fashion Co', contactName: 'Usman Iqbal', contactEmail: 'usman@faisalabadfashion.pk',
    assignedTo: 'khadija', platform: 'woocommerce', stage: 'meeting-booked',
    meeting_status: 'booked',
    contacts: makeContacts(
      { name: 'Usman Iqbal', role: 'Owner', email: 'usman@faisalabadfashion.pk', reached: true, firstReachedAt: daysAgo(5) },
      { name: 'Bilal Rehman', role: 'Operations', email: 'bilal@faisalabadfashion.pk', reached: true, firstReachedAt: daysAgo(3) }
    ),
    contactsReachedCount: 2,
    meetingNotes: [{ id: uid(), date: daysFromNow(3), type: 'zoom', summary: '', outcome: '', nextStep: '', attendees: ['khadija'], actionItems: [] }],
    notes: 'Pakistan e-commerce brand — meeting in 3 days',
    createdAt: daysAgo(8),
    intelligence: { source: 'referral', tier: 'tier-2' },
  });

  add({
    companyName: 'Abu Dhabi Luxury', contactName: 'Amira Hassan', contactEmail: 'amira@adluxury.ae',
    assignedTo: 'asjad', platform: 'shopify', stage: 'meeting-booked',
    meeting_status: 'booked',
    contacts: makeContacts(
      { name: 'Amira Hassan', role: 'CEO', email: 'amira@adluxury.ae', reached: true, firstReachedAt: daysAgo(4) },
      { name: 'Sara Bin Ahmed', role: 'Marketing', email: 'sara@adluxury.ae', reached: true, firstReachedAt: daysAgo(2) }
    ),
    contactsReachedCount: 2,
    meetingNotes: [{ id: uid(), date: daysFromNow(2), type: 'zoom', summary: '', outcome: '', nextStep: '', attendees: ['asjad'], actionItems: [] }],
    notes: 'High-value UAE luxury brand — Zoom demo upcoming',
    createdAt: daysAgo(6),
    intelligence: { source: 'instagram', instagramFollowers: 95000, tier: 'tier-1' },
  });

  // Past meeting — outcome needed
  add({
    companyName: 'Evergreen Beauty Boston', contactName: 'Amanda Foster', contactEmail: 'amanda@evergreenbeauty.com',
    assignedTo: 'areeba', platform: 'shopify', stage: 'meeting-booked',
    meeting_status: 'booked',
    contacts: makeContacts(
      { name: 'Amanda Foster', role: 'CEO', email: 'amanda@evergreenbeauty.com', reached: true, firstReachedAt: daysAgo(10) },
      { name: 'Lisa Chang', role: 'CMO', email: 'lisa@evergreenbeauty.com', reached: true, firstReachedAt: daysAgo(8) }
    ),
    contactsReachedCount: 2,
    meetingNotes: [{ id: uid(), date: daysAgo(1), type: 'zoom', summary: '', outcome: '', nextStep: '', attendees: ['areeba'], actionItems: [] }],
    notes: 'Meeting happened yesterday — ADD OUTCOME NOW',
    createdAt: daysAgo(14),
    intelligence: { source: 'linkedin', tier: 'tier-1' },
  });

  // ═══════════════════════════════════════════════════
  // 29-33: MEETING DONE / POST-MEETING
  // ═══════════════════════════════════════════════════

  add({
    companyName: 'Sunrise Skincare LA', contactName: 'Ashley Robinson', contactEmail: 'ashley@sunriseskincare.com',
    assignedTo: 'areeba', platform: 'shopify', stage: 'meeting-completed',
    meeting_status: 'completed',
    contacts: makeContacts(
      { name: 'Ashley Robinson', role: 'CEO', email: 'ashley@sunriseskincare.com', reached: true, firstReachedAt: daysAgo(12) },
      { name: 'Brandon White', role: 'CTO', email: 'brandon@sunriseskincare.com', reached: true, firstReachedAt: daysAgo(10) }
    ),
    contactsReachedCount: 2,
    meetingNotes: [{ id: uid(), date: daysAgo(2), type: 'zoom', summary: 'Great demo, client very interested in virtual try-on', outcome: 'interested', nextStep: 'Send pricing proposal', attendees: ['areeba'], actionItems: ['Send pricing'] }],
    notes: 'Interested — send pricing and propose trial',
    createdAt: daysAgo(15),
    intelligence: { source: 'linkedin', tier: 'tier-1' },
  });

  add({
    companyName: 'Oxford Beauty Co', contactName: 'Helen Davies', contactEmail: 'helen@oxfordbeauty.co.uk',
    assignedTo: 'taiba', platform: 'shopify', stage: 'meeting-completed',
    meeting_status: 'completed',
    contacts: makeContacts(
      { name: 'Helen Davies', role: 'Director', email: 'helen@oxfordbeauty.co.uk', reached: true, firstReachedAt: daysAgo(8) },
      { name: 'Margaret Smith', role: 'Operations', email: 'margaret@oxfordbeauty.co.uk', reached: true, firstReachedAt: daysAgo(6) }
    ),
    contactsReachedCount: 2,
    meetingNotes: [{ id: uid(), date: daysAgo(1), type: 'google-meet', summary: 'Wants to discuss internally first', outcome: 'followup_later', nextStep: 'Follow up in 3 days', attendees: ['taiba'], actionItems: [] }],
    notes: 'Follow-up needed — circle back in 3 days',
    createdAt: daysAgo(10),
    intelligence: { source: 'google', tier: 'tier-1' },
  });

  add({
    companyName: 'Multan Organics', contactName: 'Rabia Sharif', contactEmail: 'rabia@multanorganics.pk',
    assignedTo: 'khadija', platform: 'woocommerce', stage: 'meeting-completed',
    meeting_status: 'completed',
    contacts: makeContacts(
      { name: 'Rabia Sharif', role: 'CEO', email: 'rabia@multanorganics.pk', reached: true, firstReachedAt: daysAgo(6) },
      { name: 'Sadia Hussain', role: 'Head of Sales', email: 'sadia@multanorganics.pk', reached: true, firstReachedAt: daysAgo(4) }
    ),
    contactsReachedCount: 2,
    meetingNotes: [{ id: uid(), date: daysAgo(1), type: 'zoom', summary: 'Very interested, wants pricing', outcome: 'interested', nextStep: 'Send pricing + proposal', attendees: ['khadija'], actionItems: ['Send pricing'] }],
    notes: 'Interested — send pricing and proposal',
    createdAt: daysAgo(9),
    intelligence: { source: 'referral', tier: 'tier-2' },
  });

  add({
    companyName: 'Sharjah Chic', contactName: 'Rania Al-Qassimi', contactEmail: 'rania@sharjahchic.ae',
    assignedTo: 'asjad', platform: 'shopify', stage: 'meeting-completed',
    meeting_status: 'completed',
    contacts: makeContacts(
      { name: 'Rania Al-Qassimi', role: 'Founder', email: 'rania@sharjahchic.ae', reached: true, firstReachedAt: daysAgo(5) },
      { name: 'Dana Al-Hosani', role: 'Marketing', email: 'dana@sharjahchic.ae', reached: true, firstReachedAt: daysAgo(3) }
    ),
    contactsReachedCount: 2,
    meetingNotes: [{ id: uid(), date: daysAgo(2), type: 'zoom', summary: 'Wants to move forward', outcome: 'interested', nextStep: 'Send proposal', attendees: ['asjad'], actionItems: [] }],
    notes: 'Interested — send proposal',
    createdAt: daysAgo(10),
    intelligence: { source: 'instagram', instagramFollowers: 68000, tier: 'tier-1' },
  });

  add({
    companyName: 'Brooklyn Botanicals', contactName: 'Olivia Martinez', contactEmail: 'olivia@brooklynbotanicals.com',
    assignedTo: 'areeba', platform: 'shopify', stage: 'meeting-completed',
    meeting_status: 'completed',
    contacts: makeContacts(
      { name: 'Olivia Martinez', role: 'CEO', email: 'olivia@brooklynbotanicals.com', reached: true, firstReachedAt: daysAgo(9) },
      { name: 'Carlos Rivera', role: 'CTO', email: 'carlos@brooklynbotanicals.com', reached: true, firstReachedAt: daysAgo(7) }
    ),
    contactsReachedCount: 2,
    meetingNotes: [{ id: uid(), date: daysAgo(3), type: 'zoom', summary: 'Loved the demo, wants to move forward', outcome: 'interested', nextStep: 'Send proposal', attendees: ['areeba'], actionItems: [] }],
    notes: 'Interested — send proposal',
    createdAt: daysAgo(12),
    intelligence: { source: 'referral', tier: 'tier-1' },
  });

  // ═══════════════════════════════════════════════════
  // DECISION PENDING (post-meeting, client deciding internally — SDR still owns)
  // ═══════════════════════════════════════════════════

  add({
    companyName: 'Crescent Beauty Karachi', contactName: 'Maryam Iqbal', contactEmail: 'maryam@crescentbeauty.pk',
    assignedTo: 'khadija', platform: 'woocommerce', stage: 'internal-decision',
    contacts: makeContacts(
      { name: 'Maryam Iqbal', role: 'CEO', email: 'maryam@crescentbeauty.pk', reached: true, firstReachedAt: daysAgo(11) },
      { name: 'Saima Ali', role: 'COO', email: 'saima@crescentbeauty.pk', reached: true, firstReachedAt: daysAgo(9) }
    ),
    contactsReachedCount: 2,
    meetingNotes: [{ id: uid(), date: daysAgo(4), type: 'zoom', summary: 'Strong fit — partners reviewing internally', outcome: 'followup_later', nextStep: 'Follow up in 3 days', attendees: ['khadija'], actionItems: [] }],
    notes: 'Decision pending — client team reviewing internally',
    createdAt: daysAgo(16),
    intelligence: { source: 'referral', tier: 'tier-1' },
  });

  add({
    companyName: 'Greenwich Glow London', contactName: 'Beatrice Hall', contactEmail: 'bea@greenwichglow.co.uk',
    assignedTo: 'taiba', platform: 'shopify', stage: 'pricing-discussion',
    contacts: makeContacts(
      { name: 'Beatrice Hall', role: 'Founder', email: 'bea@greenwichglow.co.uk', reached: true, firstReachedAt: daysAgo(9) },
      { name: 'Florence Adams', role: 'CFO', email: 'flo@greenwichglow.co.uk', reached: true, firstReachedAt: daysAgo(7) }
    ),
    contactsReachedCount: 2,
    meetingNotes: [{ id: uid(), date: daysAgo(3), type: 'google-meet', summary: 'Pricing sent — comparing with one other vendor', outcome: 'followup_later', nextStep: 'Pricing decision this week', attendees: ['taiba'], actionItems: [] }],
    notes: 'Decision pending — comparing pricing options',
    createdAt: daysAgo(13),
    intelligence: { source: 'google', tier: 'tier-1' },
  });

  // ═══════════════════════════════════════════════════
  // 34-37: CEO REVIEW / APPROVAL PENDING (post-meeting commercial decision)
  // ═══════════════════════════════════════════════════

  add({
    companyName: 'Silk & Satin Fashion', contactName: 'Maria Lopez', contactEmail: 'maria@silksatin.com',
    assignedTo: 'areeba', platform: 'shopify', stage: 'trial-proposed',
    action_owner: 'leadership', trial_status: 'setup-pending',
    contacts: makeContacts(
      { name: 'Maria Lopez', role: 'CEO', email: 'maria@silksatin.com', reached: true, firstReachedAt: daysAgo(15) },
      { name: 'Ana Garcia', role: 'CTO', email: 'ana@silksatin.com', reached: true, firstReachedAt: daysAgo(12) }
    ),
    contactsReachedCount: 2,
    notes: 'Awaiting CEO approval to move forward (Growth plan)',
    subscriptionPlan: 'growth',
    createdAt: daysAgo(18),
    intelligence: { source: 'referral', tier: 'tier-1' },
  });

  add({
    companyName: 'Manchester Glam', contactName: 'Rebecca Wilson', contactEmail: 'rebecca@manchesterglam.co.uk',
    assignedTo: 'taiba', platform: 'shopify', stage: 'trial-proposed',
    action_owner: 'leadership', trial_status: 'setup-pending',
    contacts: makeContacts(
      { name: 'Rebecca Wilson', role: 'CEO', email: 'rebecca@manchesterglam.co.uk', reached: true, firstReachedAt: daysAgo(10) },
      { name: 'Lucy Evans', role: 'Head of Product', email: 'lucy@manchesterglam.co.uk', reached: true, firstReachedAt: daysAgo(8) }
    ),
    contactsReachedCount: 2,
    notes: 'Needs COO approval + store credentials (Enterprise plan)',
    subscriptionPlan: 'enterprise',
    createdAt: daysAgo(14),
    intelligence: { source: 'google', tier: 'tier-1' },
  });

  // Approved but needs credentials
  add({
    companyName: 'Quetta Naturals', contactName: 'Farah Baloch', contactEmail: 'farah@quettanaturals.pk',
    assignedTo: 'khadija', platform: 'woocommerce', stage: 'trial-proposed',
    action_owner: 'onboarding', trial_status: 'setup-pending',
    approvedBy: 'abdullah',
    contacts: makeContacts(
      { name: 'Farah Baloch', role: 'CEO', email: 'farah@quettanaturals.pk', reached: true, firstReachedAt: daysAgo(8) },
      { name: 'Noor Jahan', role: 'Admin', email: 'noor@quettanaturals.pk', reached: true, firstReachedAt: daysAgo(6) }
    ),
    contactsReachedCount: 2,
    notes: 'Approved by Abdullah — awaiting store credentials from client',
    subscriptionPlan: 'starter',
    createdAt: daysAgo(12),
    intelligence: { source: 'referral', tier: 'tier-2' },
  });

  // Ready to activate
  add({
    companyName: 'Fujairah Fashion Hub', contactName: 'Nouf Al-Sharqi', contactEmail: 'nouf@fujairahfashion.ae',
    assignedTo: 'asjad', platform: 'shopify', stage: 'trial-proposed',
    action_owner: 'onboarding', trial_status: 'setup-pending',
    approvedBy: 'hira',
    credentials: { username: 'fujairahfashion_admin', password: 'trial2026', loginUrl: 'https://fujairahfashion.ae/admin' },
    contacts: makeContacts(
      { name: 'Nouf Al-Sharqi', role: 'CEO', email: 'nouf@fujairahfashion.ae', reached: true, firstReachedAt: daysAgo(7) },
      { name: 'Meera Bin Rashid', role: 'Digital', email: 'meera@fujairahfashion.ae', reached: true, firstReachedAt: daysAgo(5) }
    ),
    contactsReachedCount: 2,
    notes: 'Approved + credentials ready — Muneeb to begin onboarding',
    subscriptionPlan: 'growth',
    createdAt: daysAgo(10),
    intelligence: { source: 'instagram', instagramFollowers: 78000, tier: 'tier-1' },
  });

  // ═══════════════════════════════════════════════════
  // 38-40: AWAITING PAYMENT / ONBOARDING PENDING
  // ═══════════════════════════════════════════════════

  add({
    companyName: 'Pacific Beauty Co', contactName: 'Sophia Lee', contactEmail: 'sophia@pacificbeauty.com',
    assignedTo: 'areeba', platform: 'shopify', stage: 'payment-pending',
    action_owner: 'leadership', trial_status: 'none',
    approvedBy: 'abdullah', subscriptionPlan: 'growth',
    paymentStatus: 'pending', nextPaymentDate: daysFromNow(3),
    credentials: { username: 'pacificbeauty_admin', password: 'trial2026' },
    contacts: makeContacts(
      { name: 'Sophia Lee', role: 'CEO', email: 'sophia@pacificbeauty.com', reached: true, firstReachedAt: daysAgo(18) },
      { name: 'Daniel Kim', role: 'CTO', email: 'daniel@pacificbeauty.com', reached: true, firstReachedAt: daysAgo(15) }
    ),
    contactsReachedCount: 2,
    tasks: [
      { id: uid(), title: 'Confirm payment received — Pacific Beauty Co', dueDate: daysFromNow(0), completed: false, assignedTo: 'abdullah', type: 'check-in', autoGenerated: true, createdAt: daysAgo(2), priority: 'high', stageFamily: 'payment' },
    ],
    notes: 'Awaiting first payment — CEO/COO to confirm and unlock onboarding',
    createdAt: daysAgo(22),
    intelligence: { source: 'linkedin', tier: 'tier-1' },
  });

  // Onboarding pending — payment confirmed, client setup in progress
  add({
    companyName: 'Blossom & Ivy UK', contactName: 'Sophie Turner', contactEmail: 'sophie@blossomivy.co.uk',
    assignedTo: 'taiba', platform: 'woocommerce', stage: 'converted',
    action_owner: 'onboarding', trial_status: 'converted',
    approvedBy: 'hira', subscriptionPlan: 'enterprise',
    subscriptionStatus: 'active', paymentStatus: 'paid',
    paymentReceivedAt: daysAgo(1), subscriptionStartDate: daysAgo(1),
    nextPaymentDate: daysFromNow(29),
    credentials: { username: 'blossomivy_admin', password: 'trial2026' },
    contacts: makeContacts(
      { name: 'Sophie Turner', role: 'Founder', email: 'sophie@blossomivy.co.uk', reached: true, firstReachedAt: daysAgo(20) },
      { name: 'Eleanor Wright', role: 'VP Sales', email: 'eleanor@blossomivy.co.uk', reached: true, firstReachedAt: daysAgo(18) }
    ),
    contactsReachedCount: 2,
    tasks: [
      { id: uid(), title: 'Complete onboarding setup — Blossom & Ivy', dueDate: daysFromNow(1), completed: false, assignedTo: 'muneeb', type: 'onboarding', autoGenerated: true, createdAt: daysAgo(1), priority: 'high', stageFamily: 'onboarding' },
    ],
    notes: 'Payment received — onboarding pending with Muneeb',
    createdAt: daysAgo(25),
    priority: 'high',
    intelligence: { source: 'instagram', instagramFollowers: 85000, tier: 'tier-1' },
  });

  // Awaiting payment — Pakistan
  add({
    companyName: 'Rawalpindi Essentials', contactName: 'Mehwish Hayat', contactEmail: 'mehwish@rpessentials.pk',
    assignedTo: 'khadija', platform: 'woocommerce', stage: 'payment-pending',
    action_owner: 'leadership', trial_status: 'none',
    approvedBy: 'hira', subscriptionPlan: 'starter',
    paymentStatus: 'pending', nextPaymentDate: daysFromNow(5),
    credentials: { username: 'rpessentials_admin', password: 'trial2026' },
    contacts: makeContacts(
      { name: 'Mehwish Hayat', role: 'CEO', email: 'mehwish@rpessentials.pk', reached: true, firstReachedAt: daysAgo(10) },
      { name: 'Bushra Iqbal', role: 'Operations', email: 'bushra@rpessentials.pk', reached: true, firstReachedAt: daysAgo(8) }
    ),
    contactsReachedCount: 2,
    tasks: [
      { id: uid(), title: 'Follow up on payment — Rawalpindi Essentials', dueDate: daysFromNow(0), completed: false, assignedTo: 'khadija', type: 'check-in', autoGenerated: true, createdAt: daysAgo(3), priority: 'high', stageFamily: 'payment' },
    ],
    notes: 'Awaiting first payment — Starter plan',
    createdAt: daysAgo(15),
    intelligence: { source: 'referral', tier: 'tier-2' },
  });

  // ═══════════════════════════════════════════════════
  // 41-42: AWAITING PAYMENT / OVERDUE
  // ═══════════════════════════════════════════════════

  add({
    companyName: 'Pearl & Jade Accessories', contactName: 'Aisha Khan', contactEmail: 'aisha@pearljadeacc.com',
    assignedTo: 'khadija', platform: 'shopify', stage: 'payment-pending',
    action_owner: 'leadership', trial_status: 'none',
    approvedBy: 'abdullah', subscriptionPlan: 'starter', paymentStatus: 'pending',
    nextPaymentDate: daysFromNow(4),
    credentials: { username: 'pearljadeacc', password: 'trial2026' },
    contacts: makeContacts(
      { name: 'Aisha Khan', role: 'CEO', email: 'aisha@pearljadeacc.com', reached: true, firstReachedAt: daysAgo(25) },
      { name: 'Fatima Noor', role: 'Operations', email: 'fatima@pearljadeacc.com', reached: true, firstReachedAt: daysAgo(22) }
    ),
    contactsReachedCount: 2,
    notes: 'Awaiting first payment confirmation',
    createdAt: daysAgo(30),
    intelligence: { source: 'referral', tier: 'tier-2' },
  });

  add({
    companyName: 'Highland Beauty Scotland', contactName: 'Fiona MacLeod', contactEmail: 'fiona@highlandbeauty.co.uk',
    assignedTo: 'taiba', platform: 'shopify', stage: 'payment-pending',
    action_owner: 'leadership', trial_status: 'none',
    approvedBy: 'hira', subscriptionPlan: 'growth', paymentStatus: 'overdue',
    nextPaymentDate: daysAgo(5),
    contacts: makeContacts(
      { name: 'Fiona MacLeod', role: 'Director', email: 'fiona@highlandbeauty.co.uk', reached: true, firstReachedAt: daysAgo(30) },
      { name: 'Elaine Robertson', role: 'Finance', email: 'elaine@highlandbeauty.co.uk', reached: true, firstReachedAt: daysAgo(28) }
    ),
    contactsReachedCount: 2,
    notes: 'OVERDUE — payment 5 days past due, escalate',
    createdAt: daysAgo(35),
    priority: 'high',
    intelligence: { source: 'google', tier: 'tier-1' },
  });

  // ═══════════════════════════════════════════════════
  // 43-44: ACTIVE CLIENTS (converted)
  // ═══════════════════════════════════════════════════

  add({
    companyName: 'Oasis Beauty Dubai', contactName: 'Layla Al-Rashid', contactEmail: 'layla@oasisbeauty.ae',
    assignedTo: 'asjad', platform: 'shopify', stage: 'converted',
    trial_status: 'converted', subscriptionPlan: 'growth', subscriptionStatus: 'active',
    paymentStatus: 'paid', paymentReceivedAt: daysAgo(5), subscriptionStartDate: daysAgo(5),
    nextPaymentDate: daysFromNow(25),
    credentials: { username: 'oasisbeauty_admin', password: 'live2026' },
    contacts: makeContacts(
      { name: 'Layla Al-Rashid', role: 'CEO', email: 'layla@oasisbeauty.ae', reached: true, firstReachedAt: daysAgo(40) },
      { name: 'Maya Al-Nahyan', role: 'CTO', email: 'maya@oasisbeauty.ae', reached: true, firstReachedAt: daysAgo(38) }
    ),
    contactsReachedCount: 2,
    notes: 'Active Growth plan client — next billing in 25 days',
    createdAt: daysAgo(45),
    priority: 'low',
    intelligence: { source: 'instagram', instagramFollowers: 120000, tier: 'tier-1' },
  });

  add({
    companyName: 'Boston Glow Aesthetics', contactName: 'Jennifer Walsh', contactEmail: 'jen@bostonglow.com',
    assignedTo: 'areeba', platform: 'shopify', stage: 'converted',
    trial_status: 'converted', subscriptionPlan: 'enterprise', subscriptionStatus: 'active',
    paymentStatus: 'paid', paymentReceivedAt: daysAgo(10), subscriptionStartDate: daysAgo(10),
    nextPaymentDate: daysFromNow(20),
    credentials: { username: 'bostonglow_admin', password: 'live2026' },
    contacts: makeContacts(
      { name: 'Jennifer Walsh', role: 'CEO', email: 'jen@bostonglow.com', reached: true, firstReachedAt: daysAgo(50) },
      { name: 'Michael Chen', role: 'VP Engineering', email: 'michael@bostonglow.com', reached: true, firstReachedAt: daysAgo(48) }
    ),
    contactsReachedCount: 2,
    notes: 'Enterprise client — active, well engaged',
    createdAt: daysAgo(55),
    priority: 'low',
    intelligence: { source: 'referral', tier: 'tier-1' },
  });

  // ═══════════════════════════════════════════════════
  // 45-50: MIXED INBOUND / CLOSED
  // ═══════════════════════════════════════════════════

  // Inbound — chatbot qualified
  add({
    companyName: 'Sapphire Skincare Lahore', contactName: 'Layla Hussain', contactEmail: 'layla@sapphireskin.pk',
    assignedTo: 'khadija', pipeline: 'inbound', stage: 'inbound-new', entry_flow: 'inbound',
    inbound_type: 'manual_inbound', source_detail: 'website_form',
    contacts: makeContacts(
      { name: 'Layla Hussain', role: 'Founder', email: 'layla@sapphireskin.pk', phone: '+92-300-5050' },
      { name: 'Zara Akhtar', role: 'Co-founder', email: 'zara@sapphireskin.pk' }
    ),
    notes: 'AI chatbot qualified — respond in 10 min',
    createdAt: daysAgo(0),
    priority: 'high',
    intelligence: { source: 'website', tier: 'tier-1' },
  });

  // Closed / Lost
  add({
    companyName: 'Emerald Isle Beauty', contactName: 'Siobhan Murphy', contactEmail: 'siobhan@emeraldisle.ie',
    assignedTo: 'taiba', platform: 'shopify', stage: 'closed-lost',
    close_reason: 'not-interested',
    contacts: makeContacts(
      { name: 'Siobhan Murphy', role: 'CEO', email: 'siobhan@emeraldisle.ie', reached: true, firstReachedAt: daysAgo(20) },
      { name: 'Ciara Kelly', role: 'VP Marketing', email: 'ciara@emeraldisle.ie', reached: true, firstReachedAt: daysAgo(18) }
    ),
    contactsReachedCount: 2,
    notes: 'Not interested — revisit in 3 months',
    createdAt: daysAgo(30),
    intelligence: { source: 'linkedin', tier: 'tier-2' },
  });

  // Cold — no response
  add({
    companyName: 'Al Ain Fashion', contactName: 'Maha Al-Ketbi', contactEmail: 'maha@alainfashion.ae',
    assignedTo: 'asjad', platform: 'shopify', stage: 'cold-no-response',
    contacts: makeContacts(
      { name: 'Maha Al-Ketbi', role: 'Owner', email: 'maha@alainfashion.ae', reached: true, firstReachedAt: daysAgo(25) },
      { name: 'Shamsa Bin Zayed', role: 'Admin', email: 'shamsa@alainfashion.ae' }
    ),
    contactsReachedCount: 1,
    notes: 'Cold after full sequence — park and revisit',
    createdAt: daysAgo(30),
    intelligence: { source: 'instagram', tier: 'tier-2' },
  });

  // ═══════════════════════════════════════════════════
  // SAVE ALL LEADS
  // ═══════════════════════════════════════════════════

  leads.forEach(lead => {
    lead.leadKey = generateLeadKey(lead);
    lead.entrySource = lead.pipeline === 'inbound' ? 'inbound' : 'sdr-manual';
    const intel = recalculateNextAction(lead);
    lead.nextAction = intel.action;
    lead.nextActionReason = intel.reason;
    lead.nextActionUrgency = intel.urgency;
    lead.nextFollowUp = intel.followUpDate;
    saveLead(lead);
  });

  // ═══════════════════════════════════════════════════
  // ACTIVITIES
  // ═══════════════════════════════════════════════════

  const sampleActivities = [
    { type: 'stage-change' as const, description: 'Silk & Sage Beauty moved to Contacted — first email sent', leadId: leads[8].id, createdBy: 'areeba' },
    { type: 'email' as const, description: 'Email sent to Nina Patel at Silk & Sage Beauty', leadId: leads[8].id, createdBy: 'areeba' },
    { type: 'stage-change' as const, description: 'Pearl & Petal UK — both contacts reached, brand KPI +1', leadId: leads[9].id, createdBy: 'taiba' },
    { type: 'stage-change' as const, description: 'Radiance Labs USA replied — interested in demo', leadId: leads[16].id, createdBy: 'areeba' },
    { type: 'meeting' as const, description: 'Meeting booked with James Park at Crystal Clear Optics — Zoom demo in 2 days', leadId: leads[23].id, createdBy: 'areeba' },
    { type: 'meeting' as const, description: 'Meeting completed with Ashley Robinson at Sunrise Skincare LA — client very interested', leadId: leads[28].id, createdBy: 'areeba' },
    { type: 'stage-change' as const, description: 'Trial proposed for Silk & Satin Fashion — awaiting CEO approval', leadId: leads[35].id, createdBy: 'areeba' },
    { type: 'stage-change' as const, description: 'Pacific Beauty Co moved to Awaiting Payment — proposal accepted', leadId: leads[39].id, createdBy: 'abdullah' },
    { type: 'payment' as const, description: 'Payment overdue for Highland Beauty Scotland — 5 days past due', leadId: leads[43].id, createdBy: 'system' },
    { type: 'conversion' as const, description: 'Oasis Beauty Dubai converted to Growth plan — $249/mo', leadId: leads[44].id, createdBy: 'asjad' },
    { type: 'conversion' as const, description: 'Boston Glow Aesthetics converted to Enterprise plan — $499/mo', leadId: leads[45].id, createdBy: 'areeba' },
  ];

  sampleActivities.forEach(a => {
    addActivity({
      id: uid(),
      ...a,
      createdAt: daysAgo(Math.floor(Math.random() * 5)),
    });
  });

  // ═══════════════════════════════════════════════════
  // SEED ATTENDANCE / LEAVE / DIRECTIVE CASES
  // ═══════════════════════════════════════════════════
  seedOperationalTestData(leads);
}

/**
 * Seed attendance, leave, and directive test scenarios.
 */
function seedOperationalTestData(leads: Lead[]) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);

  // ── LEAVE REQUESTS ──
  const leaveKey = 'stylique-leave-requests';
  const leaveRequests = safeRead<SeedLeaveRequest[]>(leaveKey, []);

  // 1. Approved leave >12h before shift (Areeba — full day tomorrow)
  leaveRequests.push({
    id: safeId('leave'), userId: 'areeba', type: 'full_day',
    startDate: tomorrow, reason: 'Personal day (approved >12h before shift)',
    status: 'approved', paidOrUnpaid: 'paid', isLateRequest: false,
    approvedBy: 'hira', approverNote: 'Approved — adequate notice',
    createdAt: new Date(now.getTime() - 24 * 3600000).toISOString(), updatedAt: now.toISOString(),
  });

  // 2. Late leave request <12h before shift (Taiba — today)
  leaveRequests.push({
    id: safeId('leave'), userId: 'taiba', type: 'full_day',
    startDate: today, reason: 'Family emergency (late request <12h)',
    status: 'pending', paidOrUnpaid: 'auto', isLateRequest: true,
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  });

  // 3. Probationary leave (Khadija — half day yesterday, unpaid)
  leaveRequests.push({
    id: safeId('leave'), userId: 'khadija', type: 'half_day',
    startDate: yesterday, reason: 'Medical appointment (probationary/unpaid)',
    status: 'approved', paidOrUnpaid: 'unpaid', isLateRequest: false,
    approvedBy: 'hira',
    createdAt: new Date(now.getTime() - 48 * 3600000).toISOString(), updatedAt: yesterday + 'T10:00:00.000Z',
  });

  // 4. Unpaid leave (Asjad — yesterday)
  leaveRequests.push({
    id: safeId('leave'), userId: 'asjad', type: 'full_day',
    startDate: yesterday, reason: 'Personal matter (unpaid leave)',
    status: 'approved', paidOrUnpaid: 'unpaid', isLateRequest: false,
    approvedBy: 'hira',
    createdAt: new Date(now.getTime() - 72 * 3600000).toISOString(), updatedAt: yesterday + 'T09:00:00.000Z',
  });

  safeWrite(leaveKey, leaveRequests);

  // ── ATTENDANCE ──
  const attendanceKey = 'stylique-attendance';
  const attendance = safeRead<SeedAttendance[]>(attendanceKey, []);

  // Late check-in (Khadija — today, checked in 30 min late)
  attendance.push({
    id: safeId('attendance'), userId: 'khadija', date: today,
    status: 'late', checkInTime: '10:30', isLate: true,
  });

  // On leave (Asjad — yesterday)
  attendance.push({
    id: safeId('attendance'), userId: 'asjad', date: yesterday,
    status: 'leave_approved', leaveReason: 'Personal matter (unpaid leave)',
  });

  // Present on time (Areeba — today)
  attendance.push({
    id: safeId('attendance'), userId: 'areeba', date: today,
    status: 'present', checkInTime: '05:55', isLate: false,
  });

  safeWrite(attendanceKey, attendance);

  // ── DIRECTIVES ──
  const directiveKey = 'stylique-crm-directives';
  const directives = safeRead<SeedDirective[]>(directiveKey, []);

  // Directive from CEO — active
  directives.push({
    id: safeId('directive'),
    senderId: 'abdullah', senderName: 'Abdullah',
    receiverId: 'areeba', receiverName: 'Areeba',
    scope: 'specific',
    targets: [{ leadId: leads[28]?.id || 'general', companyName: leads[28]?.companyName || 'Sunrise Skincare LA' }],
    actionType: 'push_conversion',
    priority: 'urgent',
    dueAt: new Date(now.getTime() + 8 * 3600000).toISOString(),
    requireAck: true, requireOutcome: true,
    note: 'Push conversion for Sunrise Skincare — client loved demo, close today',
    status: 'sent',
    createdAt: new Date(now.getTime() - 2 * 3600000).toISOString(),
    outcomes: [],
  });

  // Directive from COO — acknowledged
  directives.push({
    id: safeId('directive'),
    senderId: 'hira', senderName: 'Hira',
    receiverId: 'taiba', receiverName: 'Taiba',
    scope: 'specific',
    targets: [{ leadId: leads[24]?.id || 'general', companyName: leads[24]?.companyName || 'Bloom & Glow UK' }],
    actionType: 'book_meeting',
    priority: 'today',
    dueAt: new Date(now.getTime() + 6 * 3600000).toISOString(),
    requireAck: true, requireOutcome: true,
    note: 'High-value inbound demo — make sure meeting happens',
    status: 'acknowledged',
    acknowledgedAt: new Date(now.getTime() - 1 * 3600000).toISOString(),
    createdAt: new Date(now.getTime() - 3 * 3600000).toISOString(),
    outcomes: [],
  });

  // Directive — blocked
  directives.push({
    id: safeId('directive'),
    senderId: 'abdullah', senderName: 'Abdullah',
    receiverId: 'khadija', receiverName: 'Khadija',
    scope: 'specific',
    targets: [{ leadId: leads[10]?.id || 'general', companyName: leads[10]?.companyName || 'Lahore Luxe' }],
    actionType: 'call_now',
    priority: 'immediate',
    dueAt: new Date(now.getTime() - 1 * 3600000).toISOString(),
    requireAck: true, requireOutcome: true,
    note: 'Call Lahore Luxe immediately',
    status: 'blocked',
    blockerReason: '[Client unavailable / unreachable] Client phone disconnected, tried 3 times',
    createdAt: new Date(now.getTime() - 4 * 3600000).toISOString(),
    outcomes: [],
  });

  // Directive — completed
  directives.push({
    id: safeId('directive'),
    senderId: 'hira', senderName: 'Hira',
    receiverId: 'asjad', receiverName: 'Asjad',
    scope: 'specific',
    targets: [{ leadId: leads[44]?.id || 'general', companyName: leads[44]?.companyName || 'Oasis Beauty Dubai' }],
    actionType: 'follow_up_today',
    priority: 'normal',
    dueAt: new Date(now.getTime() - 20 * 3600000).toISOString(),
    requireAck: true, requireOutcome: true,
    note: 'Follow up with Oasis Beauty on usage',
    status: 'completed',
    acknowledgedAt: new Date(now.getTime() - 22 * 3600000).toISOString(),
    completedAt: new Date(now.getTime() - 18 * 3600000).toISOString(),
    createdAt: new Date(now.getTime() - 24 * 3600000).toISOString(),
    outcomes: [{ targetLeadId: leads[44]?.id || 'general', outcome: 'contacted', notes: 'Spoke with client, usage is good', completedAt: new Date(now.getTime() - 18 * 3600000).toISOString(), completedBy: 'asjad' }],
  });

  safeWrite(directiveKey, directives);
}
