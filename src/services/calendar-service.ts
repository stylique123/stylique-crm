/**
 * STYLIQUE CRM — Calendar Service
 * Integration-ready service layer for Google Calendar / Outlook / Teams sync.
 * Currently uses local meeting data. Ready for external calendar APIs.
 */

import type { MeetingNote } from '@/types/crm';

export interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  meetingLink?: string;
  attendees: string[];
  provider: 'google' | 'outlook' | 'teams' | 'local';
  externalId?: string; // External calendar event ID
  syncedAt?: string;
}

const MOCK_MODE = true;

/**
 * Sync meetings to external calendar.
 * In real mode: Uses Google Calendar API / Microsoft Graph API
 */
export async function syncToCalendar(meeting: MeetingNote, leadName: string): Promise<{ eventId: string } | null> {
  if (MOCK_MODE) {
    console.log('[Mock] Calendar sync:', meeting.type, leadName);
    return { eventId: `mock-cal-${Date.now()}` };
  }
  return null;
}

/**
 * Create a calendar event from a CRM meeting.
 */
export function meetingToCalendarEvent(meeting: MeetingNote, leadName: string): CalendarEvent {
  const start = new Date(meeting.date);
  const end = new Date(start.getTime() + 30 * 60 * 1000); // Default 30 min

  return {
    id: meeting.id,
    title: `Meeting: ${leadName}`,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    meetingLink: meeting.link,
    attendees: meeting.attendees,
    provider: 'local',
  };
}

/**
 * Check for meeting conflicts.
 */
export function hasConflict(newMeeting: { date: string }, existingMeetings: MeetingNote[]): MeetingNote | null {
  const newTime = new Date(newMeeting.date).getTime();
  const BUFFER = 30 * 60 * 1000; // 30 min buffer

  for (const m of existingMeetings) {
    const existingTime = new Date(m.date).getTime();
    if (Math.abs(newTime - existingTime) < BUFFER) {
      return m;
    }
  }
  return null;
}
