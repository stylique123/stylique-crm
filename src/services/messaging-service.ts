/**
 * STYLIQUE CRM — Messaging Service
 * Handles email sending, draft preparation, and template management.
 * Currently uses mock mode. Ready for transactional email integration.
 */

export interface EmailDraft {
  id: string;
  to: string;
  subject: string;
  body: string;
  templateId?: string;
  status: 'draft' | 'sent' | 'failed';
  sentAt?: string;
  channel: 'email' | 'linkedin' | 'whatsapp';
}

export interface EmailEvent {
  type: 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'replied';
  emailId: string;
  timestamp: string;
}

const MOCK_MODE = true;

/**
 * Send a transactional email.
 * In real mode: Use Resend, SendGrid, or similar via edge function.
 */
export async function sendEmail(draft: Omit<EmailDraft, 'id' | 'status'>): Promise<{ success: boolean; messageId?: string }> {
  if (MOCK_MODE) {
    console.log('[Mock] Email sent:', draft.subject, 'to', draft.to);
    return { success: true, messageId: `mock-${Date.now()}` };
  }
  return { success: false };
}

/**
 * Send a meeting confirmation email.
 */
export async function sendMeetingConfirmation(params: {
  to: string;
  contactName: string;
  companyName: string;
  meetingDate: string;
  meetingType: string;
  meetingLink: string;
  sdrName: string;
}): Promise<boolean> {
  return (await sendEmail({
    to: params.to,
    subject: `Meeting Confirmed — ${params.companyName}`,
    body: `Hi ${params.contactName},\n\nYour meeting has been confirmed.\n\nDate: ${params.meetingDate}\nType: ${params.meetingType}\nLink: ${params.meetingLink}\n\nLooking forward!\n${params.sdrName}`,
    channel: 'email',
  })).success;
}

/**
 * Send a trial welcome email.
 */
export async function sendTrialWelcome(params: {
  to: string;
  contactName: string;
  companyName: string;
  trialEndDate: string;
  platform: string;
}): Promise<boolean> {
  return (await sendEmail({
    to: params.to,
    subject: `Welcome to Your Trial — ${params.companyName}`,
    body: `Hi ${params.contactName},\n\nYour trial is now active!\n\nTrial ends: ${params.trialEndDate}\nPlatform: ${params.platform}\n\nOur onboarding team will reach out shortly to help you get set up.\n\nBest regards`,
    channel: 'email',
  })).success;
}

/**
 * Send a payment reminder.
 */
export async function sendPaymentReminder(params: {
  to: string;
  contactName: string;
  companyName: string;
  planName: string;
  amount: number;
  dueDate: string;
}): Promise<boolean> {
  return (await sendEmail({
    to: params.to,
    subject: `Payment Reminder — ${params.companyName}`,
    body: `Hi ${params.contactName},\n\nThis is a reminder that your ${params.planName} subscription payment of $${params.amount}/mo is due on ${params.dueDate}.\n\nPlease process the payment at your earliest convenience.\n\nThank you!`,
    channel: 'email',
  })).success;
}
