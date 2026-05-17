/**
 * STYLIQUE CRM — Payment Ledger Engine (first-class)
 *
 * Single source of truth for per-client billing entries. Payments page,
 * client drawer, and overdue/risk surfaces all read from here. Replaces the
 * old "single nextPaymentDate + paymentReceivedAt" flag pair as the truth.
 *
 * Lead.paymentLedger[] is append-only: every billing month gets one entry,
 * confirming a payment marks the current entry paid AND prepares the next
 * monthly entry. Legacy fields (paymentReceivedAt / nextPaymentDate /
 * paymentStatus) are still updated for backwards compatibility but are
 * NO LONGER the source of truth.
 */

import type { Lead, PaymentLedgerEntry, LedgerStatus, Currency } from '@/types/crm';
import { getActiveDeal } from '@/types/crm';

const MS_DAY = 86400000;

function ymd(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function addMonths(d: Date, n: number): Date {
  const next = new Date(d);
  next.setMonth(next.getMonth() + n);
  return next;
}

/** Recompute statuses (overdue if past due and unpaid). */
function refreshStatuses(entries: PaymentLedgerEntry[]): PaymentLedgerEntry[] {
  const now = Date.now();
  return entries.map(e => {
    if (e.status === 'paid') return e;
    const due = new Date(e.dueDate).getTime();
    return { ...e, status: due < now ? ('overdue' as LedgerStatus) : ('unpaid' as LedgerStatus) };
  });
}

/** Read the ledger for a lead, computing statuses on the fly. */
export function getLedger(lead: Lead): PaymentLedgerEntry[] {
  return refreshStatuses(lead.paymentLedger || []);
}

/** Current billing entry = oldest unpaid (or last entry if all paid). */
export function getCurrentBillingEntry(lead: Lead): PaymentLedgerEntry | null {
  const ledger = getLedger(lead);
  if (ledger.length === 0) return null;
  const open = ledger
    .filter(e => e.status !== 'paid')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  if (open.length > 0) return open[0];
  return ledger.sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0];
}

/**
 * Ensure a ledger exists with at least one current billing entry.
 * Called when a record enters the billing window or first becomes a client.
 */
export function ensureLedgerInitialized(lead: Lead): Lead {
  if ((lead.paymentLedger || []).length > 0) return lead;
  const deal = getActiveDeal(lead);
  const due = lead.nextPaymentDate
    ? new Date(lead.nextPaymentDate)
    : addMonths(new Date(), 0); // due today by default
  const entry: PaymentLedgerEntry = {
    id: crypto.randomUUID(),
    billingMonth: ymd(due),
    amount: deal.value,
    currency: deal.currency,
    dueDate: due.toISOString(),
    status: 'unpaid',
  };
  return { ...lead, paymentLedger: [entry] };
}

/**
 * Confirm payment for the current billing entry and roll forward to next month.
 * Returns an updated Lead with ledger advanced + legacy fields kept in sync.
 */
export function confirmPaymentAndRoll(
  lead: Lead,
  paidBy: string,
  reference?: string,
  notes?: string,
  paidAt?: string,
): Lead {
  const seeded = ensureLedgerInitialized(lead);
  const ledger = [...(seeded.paymentLedger || [])];
  const now = paidAt ? new Date(paidAt) : new Date();
  const nowIso = now.toISOString();

  // Find current entry to pay.
  const idx = ledger
    .map((e, i) => ({ e, i }))
    .filter(x => x.e.status !== 'paid')
    .sort((a, b) => a.e.dueDate.localeCompare(b.e.dueDate))[0]?.i ?? ledger.length - 1;

  if (idx >= 0 && ledger[idx]) {
    ledger[idx] = {
      ...ledger[idx],
      status: 'paid',
      paidAt: nowIso,
      paidBy,
      reference,
      notes,
    };
  }

  // Prepare next billing entry — one month after the just-paid entry.
  const justPaid = ledger[idx];
  const baseDue = justPaid ? new Date(justPaid.dueDate) : now;
  const nextDue = addMonths(baseDue, 1);
  const deal = getActiveDeal(seeded);
  const nextEntry: PaymentLedgerEntry = {
    id: crypto.randomUUID(),
    billingMonth: ymd(nextDue),
    amount: deal.value,
    currency: deal.currency,
    dueDate: nextDue.toISOString(),
    status: 'unpaid',
  };
  ledger.push(nextEntry);

  // Keep legacy compat fields aligned for any code still reading them.
  return {
    ...seeded,
    paymentLedger: ledger,
    paymentStatus: 'paid',
    paymentReceivedAt: nowIso,
    nextPaymentDate: nextDue.toISOString(),
    subscriptionStatus: 'active',
    subscriptionStartDate: seeded.subscriptionStartDate || nowIso,
    // Promote proposed → active commercial truth on first paid confirmation.
    active_package: seeded.active_package ?? deal.package,
    active_currency: seeded.active_currency ?? deal.currency,
    active_value: seeded.active_value ?? deal.value,
  };
}

/** Days until current entry is due (negative = overdue). */
export function getCurrentDueDays(lead: Lead): number | null {
  const cur = getCurrentBillingEntry(lead);
  if (!cur) return null;
  return Math.ceil((new Date(cur.dueDate).getTime() - Date.now()) / MS_DAY);
}

/** Aggregate paid total in a given month (for "Paid this month"). */
export function paidThisMonth(leads: Lead[]): number {
  const now = new Date();
  const key = ymd(now);
  let sum = 0;
  for (const lead of leads) {
    for (const e of getLedger(lead)) {
      if (e.status === 'paid' && e.billingMonth === key) sum += e.amount;
    }
  }
  return sum;
}
