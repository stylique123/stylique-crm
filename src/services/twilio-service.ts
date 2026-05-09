/**
 * STYLIQUE CRM — Twilio Service
 * Integration-ready service layer for calling and WhatsApp.
 * Currently uses mock mode with manual call logging.
 */

export interface CallRecord {
  id: string;
  leadId: string;
  direction: 'outbound' | 'inbound';
  duration?: number; // seconds
  outcome: 'answered' | 'no-answer' | 'interested' | 'not-interested' | 'call-back-later';
  notes?: string;
  nextStep?: string;
  callbackDate?: string;
  recordingUrl?: string; // Twilio recording URL
  twilioSid?: string; // Twilio call SID
  calledAt: string;
  calledBy: string;
}

export interface WhatsAppMessage {
  id: string;
  leadId: string;
  direction: 'outbound' | 'inbound';
  body: string;
  mediaUrl?: string;
  sentAt: string;
  deliveredAt?: string;
  readAt?: string;
  twilioSid?: string;
}

const MOCK_MODE = true;

/**
 * Initiate an outbound call.
 * In real mode: POST /api/v1/calls via Twilio connector gateway
 */
export async function initiateCall(phoneNumber: string, fromNumber: string): Promise<{ sid: string; status: string }> {
  if (MOCK_MODE) {
    return { sid: `mock-${Date.now()}`, status: 'initiated' };
  }
  // Real: Use Twilio connector gateway
  // const res = await fetch('https://connector-gateway.lovable.dev/twilio/Calls.json', { ... });
  return { sid: '', status: 'error' };
}

/**
 * Send a WhatsApp message.
 * In real mode: POST /api/v1/messages via Twilio connector gateway
 */
export async function sendWhatsApp(to: string, body: string): Promise<{ sid: string }> {
  if (MOCK_MODE) {
    return { sid: `mock-wa-${Date.now()}` };
  }
  return { sid: '' };
}

/**
 * Get call history for a lead.
 */
export function getCallHistory(leadId: string): CallRecord[] {
  // In real mode: query from database
  return [];
}

/**
 * Map call outcome to CRM next action.
 */
export function getPostCallAction(outcome: CallRecord['outcome']): {
  action: string;
  urgency: 'now' | 'today' | 'upcoming';
  followUpDays: number;
} {
  switch (outcome) {
    case 'interested':
      return { action: 'Book a meeting — they expressed interest', urgency: 'now', followUpDays: 1 };
    case 'call-back-later':
      return { action: 'Call back at scheduled time', urgency: 'today', followUpDays: 0 };
    case 'no-answer':
      return { action: 'Try again tomorrow or switch to email', urgency: 'today', followUpDays: 1 };
    case 'not-interested':
      return { action: 'Note reason — consider closing', urgency: 'upcoming', followUpDays: 7 };
    case 'answered':
      return { action: 'Follow up based on discussion', urgency: 'today', followUpDays: 2 };
  }
}
