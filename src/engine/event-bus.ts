/**
 * STYLIQUE CRM — Central Event Bus V2
 * 
 * Canonical event model with dot-notation names.
 * Every meaningful action fires an event through this bus.
 * Subscribers (UI components, KPI engine, toast system) react to events.
 * 
 * This ensures:
 * 1. Every action updates the correct company/contact/task state
 * 2. Stale tasks are archived
 * 3. Next task is created automatically
 * 4. KPI metrics update
 * 5. Contextual toast is shown
 * 6. Timeline/activity is logged
 * 7. All consuming pages re-render with fresh data
 */

// ═══════════════════════════════════════════════════════════
// CANONICAL EVENT TYPES — dot-notation, entity.verb format
// ═══════════════════════════════════════════════════════════

export type CanonicalEventType =
  // Lead lifecycle
  | 'lead.created'
  | 'lead.imported'
  | 'lead.stage_changed'
  | 'lead.closed'
  | 'lead.reopened'
  // Contact / Brand outreach
  | 'contact.primary_attempted'
  | 'contact.secondary_attempted'
  | 'contact.reached'
  // Outreach
  | 'outreach.started'
  | 'outreach.email_sent'
  | 'outreach.linkedin_sent'
  | 'outreach.call_made'
  | 'outreach.whatsapp_sent'
  // Reply
  | 'reply.received'
  | 'reply.classified'
  // Meeting
  | 'meeting.booked'
  | 'meeting.completed'
  | 'meeting.outcome_logged'
  | 'meeting.rescheduled'
  | 'meeting.no_show'
  // Trial
  | 'trial.proposed'
  | 'trial.approved'
  | 'trial.credentials_requested'
  | 'trial.credentials_added'
  | 'trial.activated'
  | 'trial.checkin_logged'
  | 'trial.ending_soon'
  | 'trial.expired'
  // Payment
  | 'payment.pending'
  | 'payment.reminder_sent'
  | 'payment.confirmed'
  | 'payment.overdue'
  // Client
  | 'client.converted'
  | 'client.retained'
  | 'client.churn_risk'
  // Directive
  | 'directive.sent'
  | 'directive.acknowledged'
  | 'directive.blocked'
  | 'directive.completed'
  // Attendance
  | 'attendance.checked_in'
  | 'attendance.checked_out'
  | 'attendance.late'
  | 'attendance.absent'
  // Leave
  | 'leave.requested'
  | 'leave.approved'
  | 'leave.rejected'
  // KPI
  | 'kpi.brand_completed'
  | 'kpi.contact_reached'
  | 'kpi.target_met';

// Legacy event types (backward compat — mapped to canonical internally)
export type LegacyCRMEventType =
  | 'outreach_completed'
  | 'signal_outcome_logged'
  | 'call_outcome_logged'
  | 'email_sent'
  | 'linkedin_action'
  | 'meeting_booked'
  | 'meeting_outcome_logged'
  | 'trial_approved'
  | 'credentials_added'
  | 'trial_setup_completed'
  | 'trial_activated'
  | 'payment_outcome_logged'
  | 'task_outcome_logged'
  | 'directive_sent'
  | 'directive_acknowledged'
  | 'directive_blocked'
  | 'directive_completed'
  | 'leave_approved'
  | 'checkin_completed'
  | 'checkout_completed'
  | 'lead_created'
  | 'lead_imported'
  | 'stage_changed'
  | 'contact_reached';

export type CRMEventType = CanonicalEventType | LegacyCRMEventType;

// Legacy → Canonical mapping
const LEGACY_TO_CANONICAL: Partial<Record<LegacyCRMEventType, CanonicalEventType>> = {
  outreach_completed: 'outreach.started',
  signal_outcome_logged: 'reply.classified',
  call_outcome_logged: 'outreach.call_made',
  email_sent: 'outreach.email_sent',
  linkedin_action: 'outreach.linkedin_sent',
  meeting_booked: 'meeting.booked',
  meeting_outcome_logged: 'meeting.outcome_logged',
  trial_approved: 'trial.approved',
  credentials_added: 'trial.credentials_added',
  trial_setup_completed: 'trial.activated',
  trial_activated: 'trial.activated',
  payment_outcome_logged: 'payment.confirmed',
  task_outcome_logged: 'lead.stage_changed',
  directive_sent: 'directive.sent',
  directive_acknowledged: 'directive.acknowledged',
  directive_blocked: 'directive.blocked',
  directive_completed: 'directive.completed',
  leave_approved: 'leave.approved',
  checkin_completed: 'attendance.checked_in',
  checkout_completed: 'attendance.checked_out',
  lead_created: 'lead.created',
  lead_imported: 'lead.imported',
  stage_changed: 'lead.stage_changed',
  contact_reached: 'contact.reached',
};

export interface CRMEvent {
  type: CRMEventType;
  /** Canonical type (always dot-notation) */
  canonicalType: CanonicalEventType;
  timestamp: string;
  performedBy: string;
  /** The company/lead affected */
  leadId?: string;
  companyName?: string;
  contactName?: string;
  /** What happened — human-readable */
  description: string;
  /** What's next — human-readable */
  nextStep?: string;
  /** Additional context */
  metadata?: Record<string, unknown>;
}

type EventHandler = (event: CRMEvent) => void;

class EventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private globalHandlers: Set<EventHandler> = new Set();
  private eventLog: CRMEvent[] = [];

  /** Subscribe to a specific event type (supports both legacy and canonical) */
  on(type: CRMEventType, handler: EventHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  /** Subscribe to ALL events */
  onAny(handler: EventHandler): () => void {
    this.globalHandlers.add(handler);
    return () => this.globalHandlers.delete(handler);
  }

  /** Emit an event — notifies all subscribers (both legacy and canonical) */
  emit(event: CRMEvent): void {
    // Log for debugging
    this.eventLog.unshift(event);
    if (this.eventLog.length > 200) this.eventLog.length = 200;

    // Notify handlers for the exact type
    this._notifyHandlers(event.type, event);
    
    // Also notify handlers for the canonical type if different
    if (event.canonicalType && event.canonicalType !== event.type) {
      this._notifyHandlers(event.canonicalType, event);
    }

    // Notify global handlers
    this.globalHandlers.forEach(h => {
      try { h(event); } catch (e) { console.error(`[EventBus] Global handler error:`, e); }
    });
  }

  private _notifyHandlers(type: string, event: CRMEvent): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      handlers.forEach(h => {
        try { h(event); } catch (e) { console.error(`[EventBus] Handler error for ${type}:`, e); }
      });
    }
  }

  /** Get recent event log for debugging */
  getLog(): CRMEvent[] {
    return [...this.eventLog];
  }

  /** Clear all handlers (for cleanup) */
  clear(): void {
    this.handlers.clear();
    this.globalHandlers.clear();
  }
}

/** Singleton event bus instance */
export const crmEventBus = new EventBus();

/** Resolve canonical type from any event type */
function resolveCanonicalType(type: CRMEventType): CanonicalEventType {
  // Already canonical (dot notation)
  if (type.includes('.')) return type as CanonicalEventType;
  // Map legacy to canonical
  return LEGACY_TO_CANONICAL[type as LegacyCRMEventType] || 'lead.stage_changed';
}

/** Helper: create and emit an event in one call */
export function emitCRMEvent(
  type: CRMEventType,
  performedBy: string,
  description: string,
  opts?: Partial<Omit<CRMEvent, 'type' | 'canonicalType' | 'timestamp' | 'performedBy' | 'description'>>,
): CRMEvent {
  const event: CRMEvent = {
    type,
    canonicalType: resolveCanonicalType(type),
    timestamp: new Date().toISOString(),
    performedBy,
    description,
    ...opts,
  };
  crmEventBus.emit(event);
  return event;
}

/** Emit a canonical event directly (preferred for new code) */
export function emitCanonical(
  type: CanonicalEventType,
  performedBy: string,
  description: string,
  opts?: Partial<Omit<CRMEvent, 'type' | 'canonicalType' | 'timestamp' | 'performedBy' | 'description'>>,
): CRMEvent {
  const event: CRMEvent = {
    type,
    canonicalType: type,
    timestamp: new Date().toISOString(),
    performedBy,
    description,
    ...opts,
  };
  crmEventBus.emit(event);
  return event;
}
