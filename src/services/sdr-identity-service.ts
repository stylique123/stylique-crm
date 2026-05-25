/**
 * STYLIQUE CRM — SDR Identity Service
 * 
 * Manages per-SDR Apollo identities, Outlook mailboxes, and Twilio numbers.
 * Each SDR may have different identities for different channels.
 * 
 * Owner != Mailbox != Apollo identity — they are stored separately.
 */

import type { SDRIdentityConfig } from '@/types/crm';

const STORAGE_KEY = 'stylique-sdr-identities';

// Default SDR configurations
const DEFAULT_CONFIGS: SDRIdentityConfig[] = [
  { sdrId: 'areeba', apolloIdentity: 'areeba@stylique.co', outlookMailbox: '', replyMailbox: '', twilioNumbers: [], defaultTwilioNumber: '' },
  { sdrId: 'taiba', apolloIdentity: 'taiba@stylique.co', outlookMailbox: '', replyMailbox: '', twilioNumbers: [], defaultTwilioNumber: '' },
  { sdrId: 'khadija', apolloIdentity: 'khadija@stylique.co', outlookMailbox: '', replyMailbox: '', twilioNumbers: [], defaultTwilioNumber: '' },
];

function loadConfigs(): SDRIdentityConfig[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) return JSON.parse(data);
  } catch { /* ignore */ }
  return [...DEFAULT_CONFIGS];
}

function saveConfigs(configs: SDRIdentityConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
}

export function getSDRIdentity(sdrId: string): SDRIdentityConfig | undefined {
  return loadConfigs().find(c => c.sdrId === sdrId);
}

export function getAllSDRIdentities(): SDRIdentityConfig[] {
  return loadConfigs();
}

export function updateSDRIdentity(config: SDRIdentityConfig): void {
  const configs = loadConfigs();
  const idx = configs.findIndex(c => c.sdrId === config.sdrId);
  if (idx >= 0) configs[idx] = config;
  else configs.push(config);
  saveConfigs(configs);
}

export function addTwilioNumber(sdrId: string, number: string): void {
  const configs = loadConfigs();
  const config = configs.find(c => c.sdrId === sdrId);
  if (config) {
    if (!config.twilioNumbers.includes(number)) {
      config.twilioNumbers.push(number);
      if (!config.defaultTwilioNumber) config.defaultTwilioNumber = number;
    }
  } else {
    configs.push({ sdrId, twilioNumbers: [number], defaultTwilioNumber: number });
  }
  saveConfigs(configs);
}

export function setDefaultTwilioNumber(sdrId: string, number: string): void {
  const configs = loadConfigs();
  const config = configs.find(c => c.sdrId === sdrId);
  if (config) {
    config.defaultTwilioNumber = number;
    saveConfigs(configs);
  }
}

export function getDefaultTwilioNumber(sdrId: string): string | undefined {
  return getSDRIdentity(sdrId)?.defaultTwilioNumber;
}

export function getApolloIdentity(sdrId: string): string | undefined {
  return getSDRIdentity(sdrId)?.apolloIdentity;
}

export function getOutlookMailbox(sdrId: string): string | undefined {
  return getSDRIdentity(sdrId)?.outlookMailbox;
}
