/**
 * STYLIQUE CRM — Next Best Action (NBA) Engine
 * 
 * For every SDR-owned record, answers 5 questions:
 *   1. What exactly should I do now?
 *   2. Which channel should I use?
 *   3. Why is this the right move now?
 *   4. What outcomes can happen?
 *   5. What will the system do after I log that outcome?
 * 
 * This module provides manager-grade channel recommendations
 * based on stage, timing, previous actions, and available channels.
 */

import type { Lead } from '@/types/crm';
import { getTrialDaysLeft } from '@/types/crm';
import { getSDRSequenceState } from '@/engine/sdr-flow-engine';

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export type Channel = 'call' | 'email' | 'linkedin' | 'instagram' | 'whatsapp' | 'meeting' | 'system' | 'none';

export interface OutcomePreview {
  label: string;
  systemEffect: string;
}

export interface NextBestAction {
  /** What exactly should I do? */
  instruction: string;
  /** Which channel? */
  channel: Channel;
  /** Channel display label */
  channelLabel: string;
  /** Why this channel now? */
  reason: string;
  /** Due timing */
  dueTiming: string;
  /** Possible outcomes + system effects */
  outcomes: OutcomePreview[];
  /** What if the primary action fails / is blocked? */
  fallback: { instruction: string; channel: Channel } | null;
  /** Is this a condition (awareness) or a real action? */
  isAction: boolean;
}

// ═══════════════════════════════════════════════════════════
// CHANNEL LABELS
// ═══════════════════════════════════════════════════════════

const CHANNEL_LABELS: Record<Channel, string> = {
  call: '📞 Call',
  email: '✉️ Email',
  linkedin: '💼 LinkedIn',
  instagram: '📷 Instagram',
  whatsapp: '💬 WhatsApp',
  meeting: '📅 Meeting',
  system: '⚙️ System',
  none: '',
};

// ═══════════════════════════════════════════════════════════
// MAIN: Derive Next Best Action for any lead
// ═══════════════════════════════════════════════════════════

export function getNextBestAction(lead: Lead): NextBestAction {
  const daysSinceCreation = Math.floor((Date.now() - new Date(lead.createdAt).getTime()) / 86400000);
  const daysSinceContact = lead.lastContactedAt
    ? Math.floor((Date.now() - new Date(lead.lastContactedAt).getTime()) / 86400000)
    : null;
  const seq = getSDRSequenceState(lead.id);
  const daysLeft = getTrialDaysLeft(lead);

  // ── CONVERTED / CLOSED ──
  if (['converted', 'closed-lost'].includes(lead.stage)) {
    return noAction('No action needed', lead.stage === 'converted' ? 'Active client — retention mode' : 'Deal closed');
  }

  // ── PAYMENT PENDING ──
  if (lead.stage === 'payment-pending') {
    const isOverdue = lead.paymentStatus === 'overdue';
    return {
      instruction: isOverdue
        ? `Call ${lead.contactName} now — payment is overdue`
        : `Call ${lead.contactName} to confirm payment`,
      channel: 'call',
      channelLabel: CHANNEL_LABELS.call,
      reason: isOverdue
        ? `Payment overdue — revenue at risk. Call is the fastest way to resolve.`
        : `Payment pending — direct call gets fastest confirmation.`,
      dueTiming: isOverdue ? 'Overdue — call now' : 'Due now',
      outcomes: [
        { label: 'Payment received', systemEffect: '→ Move to Active Client, close payment tasks' },
        { label: 'Payment promised on date', systemEffect: '→ Create reminder task for promised date' },
        { label: 'Payment delayed', systemEffect: '→ Create follow-up in 2 days' },
        { label: 'Payment refused', systemEffect: '→ Close deal, archive' },
      ],
      fallback: { instruction: `Email ${lead.contactName} payment reminder`, channel: 'email' },
      isAction: true,
    };
  }

  // ── TRIAL ACTIVE ──
  if (lead.stage === 'trial-active' && daysLeft !== null) {
    if (daysLeft <= 3) {
      return {
        instruction: `Call ${lead.contactName} for conversion — trial ends in ${daysLeft}d`,
        channel: 'call',
        channelLabel: CHANNEL_LABELS.call,
        reason: `Trial ending in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}. Direct call creates urgency and gets a decision faster than email.`,
        dueTiming: daysLeft <= 0 ? 'Trial expired — call NOW' : `${daysLeft}d left — call today`,
        outcomes: [
          { label: 'Ready to convert', systemEffect: '→ Move to Payment Pending, create payment task' },
          { label: 'Needs more time', systemEffect: '→ Extend trial, create follow-up' },
          { label: 'Not converting', systemEffect: '→ Close deal, archive' },
        ],
        fallback: { instruction: `WhatsApp ${lead.contactName} if call unanswered`, channel: 'whatsapp' },
        isAction: true,
      };
    }
    return noAction(
      `Trial running — Day ${14 - daysLeft} of 14`,
      `Onboarding monitoring. Your next action: conversion push when ${daysLeft <= 5 ? daysLeft + 'd left' : 'trial nears end'}.`
    );
  }

  // ── TRIAL PROPOSED — SDR awareness ──
  if (lead.stage === 'trial-proposed') {
    if (!lead.approvedBy) {
      return noAction('Awaiting CEO/COO approval', 'No SDR action until trial is approved. Leadership will review and decide.');
    }
    return noAction('Approved — onboarding setting up', 'Credentials and activation pending. Onboarding owns this step.');
  }

  // ── MEETING COMPLETED — log outcome ──
  if (lead.stage === 'meeting-completed') {
    const pastNoSummary = lead.meetingNotes?.find(m =>
      new Date(m.date) < new Date() && !m.summary?.trim()
    );
    if (pastNoSummary) {
      return {
        instruction: `Add meeting outcome for ${lead.companyName}`,
        channel: 'meeting',
        channelLabel: CHANNEL_LABELS.meeting,
        reason: `Meeting happened but outcome not recorded. System cannot generate next steps until you add what happened.`,
        dueTiming: 'Overdue — add now',
        outcomes: [
          { label: 'Standard trial agreed', systemEffect: '→ Move to Trial Proposed, create approval request' },
          { label: 'Pricing discussion first', systemEffect: '→ Create send pricing task, due now' },
          { label: 'Internal decision pending', systemEffect: '→ Create follow-up on agreed date' },
          { label: 'Not a fit', systemEffect: '→ Close deal, archive' },
          { label: 'Rescheduled', systemEffect: '→ Create new meeting, close old one' },
          { label: 'No show', systemEffect: '→ Create reschedule outreach, due now' },
        ],
        fallback: null,
        isAction: true,
      };
    }
    // Post-meeting follow-up needed
    return {
      instruction: `Follow up with ${lead.contactName} — send requested materials or proposal`,
      channel: 'email',
      channelLabel: CHANNEL_LABELS.email,
      reason: `Meeting completed. Send any promised materials or proposal to keep momentum.`,
      dueTiming: 'Due now',
      outcomes: [
        { label: 'Materials sent', systemEffect: '→ Create follow-up check task in 2 days' },
        { label: 'Proposal sent', systemEffect: '→ Create follow-up task for response' },
      ],
      fallback: { instruction: `Call ${lead.contactName} to discuss next steps`, channel: 'call' },
      isAction: true,
    };
  }

  // ── MEETING BOOKED — prepare or log ──
  if (lead.stage === 'meeting-booked') {
    const now = new Date();
    const pastMeeting = lead.meetingNotes?.find(m => new Date(m.date) < now && !m.summary?.trim());
    if (pastMeeting) {
      return {
        instruction: `Add meeting outcome for ${lead.companyName}`,
        channel: 'meeting',
        channelLabel: CHANNEL_LABELS.meeting,
        reason: `Meeting has passed but no outcome added. Record what happened so the system can create next steps.`,
        dueTiming: 'Overdue — add now',
        outcomes: [
          { label: 'Standard trial agreed', systemEffect: '→ Move to Trial Proposed, create approval request' },
          { label: 'Not a fit / No show', systemEffect: '→ Close or reschedule' },
        ],
        fallback: null,
        isAction: true,
      };
    }
    const futureMeeting = lead.meetingNotes?.find(m => new Date(m.date) > now);
    if (futureMeeting) {
      const daysUntil = Math.ceil((new Date(futureMeeting.date).getTime() - now.getTime()) / 86400000);
      if (daysUntil <= 1) {
        return {
          instruction: `Prepare for meeting with ${lead.contactName} — research brand and test product`,
          channel: 'meeting',
          channelLabel: CHANNEL_LABELS.meeting,
          reason: `Meeting is ${daysUntil <= 0 ? 'today' : 'tomorrow'}. Research their brand, check their website/store, and prepare talking points.`,
          dueTiming: daysUntil <= 0 ? 'Today' : 'Tomorrow',
          outcomes: [
            { label: 'Preparation complete', systemEffect: '→ Ready for meeting, add outcome after' },
          ],
          fallback: null,
          isAction: true,
        };
      }
      return noAction(
        `Meeting in ${daysUntil}d with ${lead.contactName}`,
        `Scheduled ${new Date(futureMeeting.date).toLocaleDateString()}. Preparation task will appear 1 day before.`
      );
    }
    return noAction('Meeting booked — details pending', 'Waiting for meeting date/time to be finalized.');
  }

  // ── REPLIED — guide based on reply type ──
  if (lead.stage === 'replied' || lead.stage === 'sdr-replied') {
    const repliedDaysAgo = daysSinceContact || 0;
    if (repliedDaysAgo >= 3) {
      return {
        instruction: `Call ${lead.contactName} now — reply ${repliedDaysAgo}d ago, losing momentum`,
        channel: 'call',
        channelLabel: CHANNEL_LABELS.call,
        reason: `Lead replied ${repliedDaysAgo} days ago and no meeting booked yet. Call is urgent — email delays lose warm leads.`,
        dueTiming: 'Overdue — act now',
        outcomes: [
          { label: 'Interested — book meeting', systemEffect: '→ Open meeting booking, move to Meeting Booked' },
          { label: 'Wants info first', systemEffect: '→ Create send-info task, due now' },
          { label: 'Wants pricing', systemEffect: '→ Create send-pricing task, due now' },
          { label: 'Follow up later', systemEffect: '→ Create dated follow-up task' },
          { label: 'Not interested', systemEffect: '→ Close lead, archive' },
        ],
        fallback: { instruction: `LinkedIn message ${lead.contactName} if no answer`, channel: 'linkedin' },
        isAction: true,
      };
    }
    return {
      instruction: `Book meeting with ${lead.contactName} — they replied and are engaged`,
      channel: 'call',
      channelLabel: CHANNEL_LABELS.call,
      reason: `Lead is engaged. Call to book a meeting while interest is high. Email is too slow for warm leads.`,
      dueTiming: 'Due now',
      outcomes: [
        { label: 'Meeting booked', systemEffect: '→ Move to Meeting Booked, create prep task' },
        { label: 'Wants info/pricing first', systemEffect: '→ Create send task, due now' },
        { label: 'Follow up later', systemEffect: '→ Create dated follow-up' },
        { label: 'Not interested', systemEffect: '→ Close, archive' },
      ],
      fallback: { instruction: `Email ${lead.contactName} meeting time options`, channel: 'email' },
      isAction: true,
    };
  }

  // ── CONTACTED — signal-driven ──
  if (['contacted', 'sdr-contacted', 'outreach-1', 'outreach-2', 'outreach-3', 'sequence-completed', 'awaiting-sdr'].includes(lead.stage)) {
    // Reply received?
    if (seq.reply_received) {
      return {
        instruction: `Classify reply from ${lead.contactName} — stop outreach and decide next step`,
        channel: 'email',
        channelLabel: CHANNEL_LABELS.email,
        reason: `Lead replied. All outreach must stop. Classify the reply to determine whether to book meeting, send info, or close.`,
        dueTiming: 'Due now — reply waiting',
        outcomes: [
          { label: 'Interested — wants meeting', systemEffect: '→ Move to Replied, open meeting booking' },
          { label: 'Interested — wants info', systemEffect: '→ Move to Replied, create send-info task' },
          { label: 'Not interested', systemEffect: '→ Close lead' },
          { label: 'Wrong person', systemEffect: '→ Create find-alternate-contact task' },
        ],
        fallback: null,
        isAction: true,
      };
    }

    // LinkedIn accepted → send message
    if (seq.linkedin_accepted && !seq.linkedin_message_sent) {
      return {
        instruction: `Send LinkedIn message to ${lead.contactName} — connection just accepted`,
        channel: 'linkedin',
        channelLabel: CHANNEL_LABELS.linkedin,
        reason: `${lead.contactName} accepted your connection. Send a personalized message today while the acceptance is fresh.`,
        dueTiming: 'Due today',
        outcomes: [
          { label: 'Message sent', systemEffect: '→ Mark LinkedIn message sent, wait for response' },
          { label: 'Could not send', systemEffect: '→ Fallback to call or email follow-up' },
        ],
        fallback: { instruction: `Call ${lead.contactName} instead`, channel: 'call' },
        isAction: true,
      };
    }

    // Email opened 2+ → urgent call
    const openCount = seq.email_open_count || 0;
    if (openCount >= 2 && !seq.call_attempted) {
      return {
        instruction: `Call ${lead.contactName} now — email opened ${openCount} times`,
        channel: 'call',
        channelLabel: CHANNEL_LABELS.call,
        reason: `${lead.contactName} opened your email ${openCount} times. This is a warm signal — call immediately while interest is high.`,
        dueTiming: 'Call NOW — warm signal',
        outcomes: [
          { label: 'Connected — interested', systemEffect: '→ Move to Replied, open meeting booking' },
          { label: 'Connected — follow up later', systemEffect: '→ Create dated follow-up task' },
          { label: 'No answer', systemEffect: '→ Create retry tomorrow + LinkedIn follow-up' },
          { label: 'Wrong person', systemEffect: '→ Create find-alternate-contact task' },
          { label: 'Not interested', systemEffect: '→ Close lead' },
        ],
        fallback: { instruction: `Send LinkedIn message if no answer on call`, channel: 'linkedin' },
        isAction: true,
      };
    }

    // Day 5 no response → call
    if (daysSinceCreation >= 5 && !seq.call_attempted && !seq.reply_received) {
      return {
        instruction: `Call ${lead.contactName} — no response after ${daysSinceCreation} days`,
        channel: 'call',
        channelLabel: CHANNEL_LABELS.call,
        reason: `${daysSinceCreation} days since first contact with no reply. Email sequence alone isn't working — switch to direct call.`,
        dueTiming: 'Due now — Day 5+ no response',
        outcomes: [
          { label: 'Connected — interested', systemEffect: '→ Move to Replied, open meeting booking' },
          { label: 'No answer', systemEffect: '→ Create Instagram DM task as next fallback' },
          { label: 'Not interested', systemEffect: '→ Close lead' },
          { label: 'Wrong person', systemEffect: '→ Create find-alternate-contact task' },
        ],
        fallback: lead.instagram
          ? { instruction: `Send Instagram DM to ${lead.contactName}`, channel: 'instagram' }
          : lead.linkedin
          ? { instruction: `Send LinkedIn follow-up to ${lead.contactName}`, channel: 'linkedin' }
          : null,
        isAction: true,
      };
    }

    // Post-call no response → Instagram DM
    if (seq.call_attempted && !['interested', 'answered'].includes(seq.call_outcome || '') && !seq.instagram_dm_sent) {
      return {
        instruction: `Send Instagram DM to ${lead.contactName} — call didn't connect`,
        channel: 'instagram',
        channelLabel: CHANNEL_LABELS.instagram,
        reason: `Call attempt didn't connect. Instagram DM is the next best channel to try a different medium.`,
        dueTiming: 'Due now',
        outcomes: [
          { label: 'DM sent', systemEffect: '→ Wait for response, create follow-up check' },
          { label: 'No Instagram account', systemEffect: '→ Try WhatsApp or LinkedIn instead' },
          { label: 'Account private / blocked', systemEffect: '→ Mark channel unavailable, try alternative' },
        ],
        fallback: lead.contactPhone
          ? { instruction: `WhatsApp ${lead.contactName} as alternative`, channel: 'whatsapp' }
          : { instruction: `Send LinkedIn follow-up message`, channel: 'linkedin' },
        isAction: true,
      };
    }

    // Day 1 not done
    if (!seq.email1_started || !seq.linkedin_request_sent) {
      return {
        instruction: `Contact ${lead.contactName}`,
        channel: 'email',
        channelLabel: 'Email + LinkedIn',
        reason: '',
        dueTiming: daysSinceCreation === 0 ? 'Today' : `${daysSinceCreation}d overdue`,
        outcomes: [],
        fallback: lead.instagram
          ? { instruction: `Instagram fallback`, channel: 'instagram' }
          : null,
        isAction: true,
      };
    }

    if (seq.linkedin_request_sent && !seq.linkedin_accepted && daysSinceCreation >= 3) {
      return noAction(
        `LinkedIn request pending — sent ${daysSinceCreation - (daysSinceCreation >= 3 ? 0 : 3)}d ago`,
        `Waiting for ${lead.contactName} to accept. Email cadence continuing. Next action triggers on: LinkedIn accept, 2+ email opens, or Day 5 no-response.`
      );
    }

    return noAction(
      `Email cadence running — Day ${daysSinceCreation}`,
      `Outreach in progress. No manual action needed yet. System watching for: reply, 2+ opens, LinkedIn accept, or Day 5 no-response.`
    );
  }

  // ── NEW LEAD ──
  if (['new-lead', 'sdr-new-lead', 'lead-added'].includes(lead.stage)) {
    // Inbound leads
    if (lead.pipeline === 'inbound' || ['new-inquiry', 'qualified', 'awaiting-sdr'].includes(lead.stage)) {
      return {
        instruction: `Call ${lead.contactName} immediately — inbound lead, respond within 10 minutes`,
        channel: 'call',
        channelLabel: CHANNEL_LABELS.call,
        reason: `Inbound leads expect fast response. Call within 10 minutes for best conversion. Email is too slow for inbound.`,
        dueTiming: 'Respond NOW',
        outcomes: [
          { label: 'Connected — interested', systemEffect: '→ Book meeting, move to Replied' },
          { label: 'No answer', systemEffect: '→ Send immediate email + retry call in 1h' },
          { label: 'Not qualified', systemEffect: '→ Close lead' },
        ],
        fallback: { instruction: `Email ${lead.contactName} immediately if no answer`, channel: 'email' },
        isAction: true,
      };
    }

    // Instagram-first source
    if (lead.source_detail === 'instagram' && !lead.contactEmail) {
      return {
        instruction: `Send Instagram DM to ${lead.contactName} — Instagram-sourced lead, no email`,
        channel: 'instagram',
        channelLabel: CHANNEL_LABELS.instagram,
        reason: `Lead was sourced from Instagram and has no email on file. Instagram DM is the only available channel.`,
        dueTiming: 'Due now',
        outcomes: [
          { label: 'DM sent', systemEffect: '→ Move to Contacted, wait for response' },
          { label: 'Account unavailable', systemEffect: '→ Create research task for email/phone' },
        ],
        fallback: lead.contactPhone
          ? { instruction: `WhatsApp ${lead.contactName}`, channel: 'whatsapp' }
          : null,
        isAction: true,
      };
    }

    // Standard new lead
    return {
      instruction: `Contact ${lead.contactName}`,
      channel: 'email',
      channelLabel: 'Email + LinkedIn',
      reason: '',
      dueTiming: 'Today',
      outcomes: [],
      fallback: lead.instagram
        ? { instruction: `Instagram fallback`, channel: 'instagram' }
        : null,
      isAction: true,
    };
  }

  return noAction('No action needed', 'Record is in a terminal or unrecognized state.');
}

// ═══════════════════════════════════════════════════════════
// HELPER
// ═══════════════════════════════════════════════════════════

function noAction(instruction: string, reason: string): NextBestAction {
  return {
    instruction,
    channel: 'none',
    channelLabel: '',
    reason,
    dueTiming: '',
    outcomes: [],
    fallback: null,
    isAction: false,
  };
}

/** Get channel color class for badges */
export function getChannelColor(channel: Channel): string {
  switch (channel) {
    case 'call': return 'bg-green-500/15 text-green-400 border-green-500/20';
    case 'email': return 'bg-blue-500/15 text-blue-400 border-blue-500/20';
    case 'linkedin': return 'bg-sky-500/15 text-sky-400 border-sky-500/20';
    case 'instagram': return 'bg-pink-500/15 text-pink-400 border-pink-500/20';
    case 'whatsapp': return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
    case 'meeting': return 'bg-purple-500/15 text-purple-400 border-purple-500/20';
    case 'system': return 'bg-muted text-muted-foreground border-muted';
    default: return 'bg-muted text-muted-foreground border-muted';
  }
}
