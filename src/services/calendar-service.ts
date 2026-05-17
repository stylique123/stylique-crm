/**
 * STYLIQUE CRM — Calendar Service
 * Calendar service layer. Microsoft Graph calls go through the Stylique
 * backend so OAuth secrets never enter the browser.
 */

import type { MeetingNote } from '@/types/crm';
import { getApiBaseUrl, getApiToken } from '@/lib/backend-api';

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

export interface MicrosoftCalendarHealth {
  ok: boolean;
  configured: boolean;
  tenant: boolean;
  clientId: boolean;
  clientSecret: boolean;
  calendarUser: boolean;
  timeZone: string;
}

export interface MicrosoftEventRequest {
  subject: string;
  startTime: string;
  durationMinutes?: number;
  attendees?: Array<{ email: string; name?: string }>;
  notes?: string;
  timeZone?: string;
}

/**
 * Sync meetings to external calendar.
 * In real mode: Uses Google Calendar API / Microsoft Graph API
 */
export async function syncToCalendar(meeting: MeetingNote, leadName: string): Promise<{ eventId: string } | null> {
  if (meeting.type !== 'teams') return null;
  const result = await createMicrosoftTeamsEvent({
    subject: `Meeting: ${leadName}`,
    startTime: meeting.date,
    attendees: meeting.attendees.map(email => ({ email })),
    notes: meeting.summary,
  });
  return result.ok ? { eventId: result.eventId } : null;
}

async function calendarFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getApiToken();
  if (!token) throw new Error('Backend login required for calendar sync');
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Calendar request failed (${response.status})`);
  return data as T;
}

export async function getMicrosoftCalendarHealth(): Promise<MicrosoftCalendarHealth> {
  return calendarFetch<MicrosoftCalendarHealth>('/api/calendar/microsoft/health');
}

export async function createMicrosoftTeamsEvent(request: MicrosoftEventRequest): Promise<{
  ok: boolean;
  provider: 'microsoft';
  eventId: string;
  joinUrl: string;
  webLink: string;
}> {
  return calendarFetch('/api/calendar/microsoft/events', {
    method: 'POST',
    body: JSON.stringify(request),
  });
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
