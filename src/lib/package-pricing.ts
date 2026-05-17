import { PLAN_LABELS, type Currency, type SubscriptionPlan } from '@/types/crm';
import { safeRead, safeWrite } from '@/lib/safe-storage';

export type PackagePriceTable = Record<SubscriptionPlan, Record<Currency, number>>;
export type PackageLabelTable = Record<SubscriptionPlan, string>;

const STORAGE_KEY = 'stylique-package-pricing';
const LABEL_STORAGE_KEY = 'stylique-package-labels';

export const DEFAULT_PACKAGE_PRICING: PackagePriceTable = {
  lite: { PKR: 35000, USD: 129, GBP: 99, AED: 475 },
  starter: { PKR: 85000, USD: 299, GBP: 239, AED: 1099 },
  growth: { PKR: 185000, USD: 699, GBP: 549, AED: 2575 },
  enterprise: { PKR: 350000, USD: 1299, GBP: 1049, AED: 4775 },
  custom: { PKR: 0, USD: 0, GBP: 0, AED: 0 },
};

export const DEFAULT_PACKAGE_LABELS: PackageLabelTable = {
  lite: 'Lite',
  starter: 'Starter',
  growth: 'Growth',
  enterprise: 'Enterprise',
  custom: 'Custom',
};

const PLANS: SubscriptionPlan[] = ['lite', 'starter', 'growth', 'enterprise', 'custom'];
const CURRENCIES: Currency[] = ['PKR', 'USD', 'GBP', 'AED'];

export function getPackagePricing(): PackagePriceTable {
  try {
    const saved = safeRead<Partial<PackagePriceTable>>(STORAGE_KEY, {});
    const merged = { ...DEFAULT_PACKAGE_PRICING };
    for (const plan of PLANS) {
      merged[plan] = { ...DEFAULT_PACKAGE_PRICING[plan], ...(saved[plan] || {}) };
    }
    return merged;
  } catch {
    return DEFAULT_PACKAGE_PRICING;
  }
}

export function savePackagePricing(pricing: PackagePriceTable) {
  safeWrite(STORAGE_KEY, pricing);
}

export function getPackageLabels(): PackageLabelTable {
  const saved = safeRead<Partial<PackageLabelTable>>(LABEL_STORAGE_KEY, {});
  const labels = { ...DEFAULT_PACKAGE_LABELS, ...saved };
  Object.assign(PLAN_LABELS, labels);
  return labels;
}

export function savePackageLabels(labels: PackageLabelTable) {
  safeWrite(LABEL_STORAGE_KEY, labels);
  Object.assign(PLAN_LABELS, labels);
}

export function getPackagePrice(plan: SubscriptionPlan, currency: Currency): number {
  return getPackagePricing()[plan]?.[currency] ?? 0;
}

getPackageLabels();
