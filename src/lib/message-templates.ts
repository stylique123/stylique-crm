/**
 * STYLIQUE CRM — Message Draft Engine
 * Pre-written, editable message templates tied to stage and action type.
 */

export type MessageTemplate = {
  id: string;
  label: string;
  subject?: string;
  body: string;
  channel: 'email' | 'linkedin' | 'whatsapp' | 'call-script';
  stage?: string;
};

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

export function fillTemplate(template: string, vars: TemplateVars): string {
  return template
    .replace(/\{\{companyName\}\}/g, vars.companyName || '[Company]')
    .replace(/\{\{contactName\}\}/g, vars.contactName || '[Contact]')
    .replace(/\{\{platform\}\}/g, vars.platform || '[Platform]')
    .replace(/\{\{sdrName\}\}/g, vars.sdrName || '[SDR]')
    .replace(/\{\{meetingDate\}\}/g, vars.meetingDate || '[Date]')
    .replace(/\{\{meetingTime\}\}/g, vars.meetingTime || '[Time]')
    .replace(/\{\{meetingLink\}\}/g, vars.meetingLink || '[Link]')
    .replace(/\{\{trialEndDate\}\}/g, vars.trialEndDate || '[End Date]')
    .replace(/\{\{daysLeft\}\}/g, String(vars.daysLeft ?? '[X]'))
    .replace(/\{\{planName\}\}/g, vars.planName || '[Plan]')
    .replace(/\{\{amount\}\}/g, vars.amount || '[Amount]');
}

export const MESSAGE_TEMPLATES: MessageTemplate[] = [
  // ─── Intro / Outreach ─────────────────────────────────
  {
    id: 'intro-email',
    label: 'Intro Outreach Email',
    channel: 'email',
    stage: 'new-lead',
    subject: 'Virtual try-on for {{companyName}}',
    body: `Hi {{contactName}},

I came across {{companyName}} and love what you're building. I wanted to reach out because we help {{platform}} brands like yours increase conversions by 30-40% with AI-powered virtual try-on.

Would you be open to a quick 15-minute call to see if it could work for your store?

Best,
{{sdrName}}
Stylique`,
  },
  {
    id: 'linkedin-connect',
    label: 'LinkedIn Connect Message',
    channel: 'linkedin',
    stage: 'new-lead',
    body: `Hi {{contactName}}, I work with fashion & beauty brands on {{platform}} to boost conversions with virtual try-on technology. Would love to connect and share how brands like yours are seeing 30%+ lift. — {{sdrName}}`,
  },

  // ─── Follow-up ────────────────────────────────────────
  {
    id: 'follow-up-no-reply',
    label: 'Follow-Up (No Reply)',
    channel: 'email',
    stage: 'contacted',
    subject: 'Re: Virtual try-on for {{companyName}}',
    body: `Hi {{contactName}},

Just following up on my previous message. I know you're busy — I wanted to share that similar {{platform}} brands we work with typically see a 30-40% increase in conversion rate within the first month.

Would a quick 10-minute call work this week?

Best,
{{sdrName}}`,
  },
  {
    id: 'follow-up-call-script',
    label: 'Follow-Up Call Script',
    channel: 'call-script',
    stage: 'contacted',
    body: `Hi {{contactName}}, this is {{sdrName}} from Stylique.

I sent you an email earlier about virtual try-on for {{companyName}}.

Quick question — are you currently looking at ways to reduce return rates and increase conversion on your {{platform}} store?

[If yes] → Great, I'd love to show you how it works. Can we do a quick 15-min demo?
[If not now] → No problem. When would be a good time to revisit?
[If not interested] → Understood. Mind if I ask what's your current approach to reducing returns?`,
  },

  // ─── Post-Meeting ─────────────────────────────────────
  {
    id: 'post-meeting-thankyou',
    label: 'Post-Meeting Thank You',
    channel: 'email',
    stage: 'meeting-booked',
    subject: 'Great chatting, {{contactName}}!',
    body: `Hi {{contactName}},

Thank you for taking the time to chat today! I really enjoyed learning more about {{companyName}}.

As discussed, here's what we'll do next:
1. I'll set up your trial environment on {{platform}}
2. Our onboarding team will reach out within 24 hours
3. You'll have full access for 14 days

Looking forward to seeing Stylique in action on your store!

Best,
{{sdrName}}`,
  },

  // ─── Trial ────────────────────────────────────────────
  {
    id: 'trial-start',
    label: 'Trial Welcome Email',
    channel: 'email',
    stage: 'trial-active',
    subject: 'Your Stylique trial is live! 🎉',
    body: `Hi {{contactName}},

Great news — your 14-day Stylique trial is now live on your {{platform}} store!

Here's what to expect:
• Day 1-3: Our onboarding specialist Muneeb will help you set up
• Day 7: We'll check in on how things are going
• Day 14: We'll review results and discuss next steps

Your trial ends on {{trialEndDate}}.

If you have any questions, don't hesitate to reach out.

Best,
{{sdrName}}`,
  },
  {
    id: 'trial-conversion-push',
    label: 'Trial Conversion Push',
    channel: 'email',
    stage: 'trial-active',
    subject: '{{daysLeft}} days left on your trial — let\'s talk next steps',
    body: `Hi {{contactName}},

Your Stylique trial ends in {{daysLeft}} days. I wanted to check in and see how things are going.

From what we've seen on your store, the virtual try-on has been getting great engagement. I'd love to discuss making this permanent.

We have a few plan options that could work for {{companyName}}. Can we jump on a quick call to go over them?

Best,
{{sdrName}}`,
  },

  // ─── Payment ──────────────────────────────────────────
  {
    id: 'payment-reminder',
    label: 'Payment Reminder',
    channel: 'email',
    stage: 'payment-pending',
    subject: 'Payment reminder — {{companyName}} × Stylique',
    body: `Hi {{contactName}},

This is a friendly reminder that your Stylique subscription payment of {{amount}}/month ({{planName}} plan) is coming up.

Please let us know if you have any questions about the billing process.

Best,
{{sdrName}}`,
  },
  {
    id: 'payment-overdue',
    label: 'Payment Overdue Follow-Up',
    channel: 'email',
    stage: 'payment-pending',
    subject: 'Action needed — payment overdue for {{companyName}}',
    body: `Hi {{contactName}},

We noticed that the payment for your Stylique {{planName}} subscription hasn't been received yet. 

To avoid any interruption to your virtual try-on service, please process the payment at your earliest convenience.

If there are any issues, I'm happy to help resolve them.

Best,
{{sdrName}}`,
  },
];

export function getTemplatesForStage(stage: string): MessageTemplate[] {
  return MESSAGE_TEMPLATES.filter(t => !t.stage || t.stage === stage);
}

export function getTemplatesForAction(actionType: string): MessageTemplate[] {
  if (actionType.includes('linkedin') || actionType.includes('LinkedIn')) {
    return MESSAGE_TEMPLATES.filter(t => t.channel === 'linkedin');
  }
  if (actionType.includes('call') || actionType.includes('Call')) {
    return MESSAGE_TEMPLATES.filter(t => t.channel === 'call-script');
  }
  if (actionType.includes('payment') || actionType.includes('Payment')) {
    return MESSAGE_TEMPLATES.filter(t => t.id.includes('payment'));
  }
  if (actionType.includes('trial') || actionType.includes('Trial')) {
    return MESSAGE_TEMPLATES.filter(t => t.id.includes('trial'));
  }
  if (actionType.includes('follow') || actionType.includes('Follow')) {
    return MESSAGE_TEMPLATES.filter(t => t.id.includes('follow'));
  }
  if (actionType.includes('intro') || actionType.includes('Intro') || actionType.includes('Send intro')) {
    return MESSAGE_TEMPLATES.filter(t => t.id === 'intro-email');
  }
  return [];
}
