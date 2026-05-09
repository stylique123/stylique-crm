# Memory: index.md
Updated: today

# Project Memory

## Core
- Calm Dark Luxury UI (bg 228 12% 14%). Muted semantic colors. Hide zero-value KPI cards.
- Only the role owning 'Next Action' sees primary CTA; others see read-only status.
- External actions (Apollo, LinkedIn) require explicit human confirmation.
- Leads never deleted; must exit to specific states (lost, archive, nurture).
- 2-Contact Brand Coverage Rule: Brand counts to KPI only after 2 unique contacts reached.
- Meetings flag 'Outcome Required' once time passes; outcomes map to deterministic stages.
- Universal Navigation: CEO/COO route to Dashboard, SDR/Onboarding to Tasks.

## Memories
- [Project Overview](mem://project/overview) — Single canonical source of truth, role-based CRM
- [Role Permissions](mem://auth/role-permissions) — SDRs see owned trials, Onboarding sees all, CEO/COO global
- [Leadership Navigation](mem://features/leadership-navigation) — 7 separated CEO/COO surfaces: Command Center, Decisions, Risks, Directives, Trials, Payments, People
- [Payment System](mem://features/payment-system) — Lifecycle, subscriptions, pricing, only CEO/COO marks Paid
- [Calling Flow](mem://features/calling-flow) — Manual calling flow mandates logged outcomes for next-action
- [Wait States](mem://features/wait-states) — Formal active wait states prevent over-touching
- [Timing Enforcement](mem://tech/timing-enforcement) — Mandatory gaps: 48h between calls, 24h between emails
- [Action Locking](mem://features/action-locking) — Blocked actions labeled, only CEO/COO can move deal backwards
- [Team Members](mem://project/team-members) — Abdullah (CEO), Hira (COO), Muneeb (Onboarding), Areeba/Taiba/Khadija/Mashael (SDR)
- [Lead Identity](mem://tech/lead-identity) — 'leadKey' is the master deduplication key for all outbound leads
- [Visual Identity](mem://style/visual-identity) — Calm Dark Luxury, muted semantic tones, thin urgency indicators
- [Language System](mem://features/language-system) — Plain human-centric guidance instead of robotic jargon
- [Handoff System](mem://features/handoff-system) — AI to SDR handoff triggers and continuity
- [Trial System](mem://features/trial-system) — Trial progression, CEO approval + credentials for activation
- [Onboarding System](mem://features/onboarding-system) — 6-step 14-day timeline (Day 0, 2, 5, 7, 10, 12)
- [UI Hierarchy](mem://style/ui-hierarchy) — Top: counts, Middle: actions, Bottom: history. Hide zero KPIs
- [Outreach Quotas](mem://features/outreach-quotas) — 25 new brands/day, exactly 1 primary and 1 backup contact
- [Task Engine](mem://tech/task-engine) — Future tasks hidden until due, stale tasks archived
- [Human Confirmation](mem://features/human-confirmation-model) — Explicit confirmation required for external tool interactions
- [Flow Architecture](mem://features/flow-architecture) — 3 flows: AI Outbound, Inbound, SDR Manual
- [Inbound Flow](mem://features/inbound-flow) — Warm by default, direct demo routes to Meeting Booked
- [AI Outbound Flow](mem://features/ai-outbound-flow) — Day 0, 3, 7, 14, 17 cadence and handoff logic
- [SDR Manual Flow](mem://features/sdr-manual-flow) — Day 1 checklist, structured outcome logging
- [Commercial Lifecycle](mem://features/commercial-lifecycle) — Unified path from meeting/trial to retained/churned
- [Lifecycle Constraints](mem://tech/lifecycle-constraints) — Source, Stage, Flow, and Owner are logically independent
- [Priority System](mem://features/priority-system) — Cold/Warm/Hot priority distinct from lifecycle stage
- [Lead Exit States](mem://features/lead-exit-states) — Non-converted leads must exit to specific resolutions
- [Action Gating](mem://auth/action-gating) — Actionable CTAs restricted to role owning Next Action
- [Operational Badges](mem://style/operational-badges) — Green for Ready to Activate, warning for Needs Setup
- [Operational Status](mem://features/operational-status) — Two-layer state: Primary Lifecycle and Secondary Operational
- [SDR Identity](mem://features/sdr-identity) — SDR Owner decoupled from Apollo/Outlook/Twilio channel identities
- [Hardening Engine](mem://tech/hardening-engine) — Stuck leads: 7 days for New, 10 days for Contacted
- [Handoff Continuity](mem://features/handoff-continuity-rules) — Forbidden to restart manual prospecting for handed-off leads
- [Manual Research Queue](mem://features/manual-research-queue) — outreach_blocked=true for missing contact data
- [Plan Logic](mem://features/plan-logic) — Tiered pricing (Lite for PK only, Starter, Growth, Enterprise with addons)
- [Lead Creation](mem://features/lead-creation) — Multi-contact package, min 2 unique contacts per brand
- [Credential Security](mem://auth/credential-security) — CEO/COO/Onboarding full access, SDR masked, others blocked
- [Pipeline Kanban](mem://features/pipeline-kanban) — 8 lanes, Meeting Booked sub-states (Scheduled, Prep due, Result needed)
- [Meeting System](mem://features/meeting-system) — Meetings flag Outcome Required once time passes
- [Universal Navigation](mem://features/universal-navigation) — Role-based routing: CEO/COO to dashboard, SDR to tasks
- [Leadership View](mem://features/leadership-view) — Managerial context copy, raw counts, hide zero KPIs
- [SDR Manual Engine](mem://features/sdr-manual-flow-engine) — Day 1 Protocol, signal-driven triggers (LinkedIn, email opens)
- [Consequence Previews](mem://features/consequence-previews) — Downstream effects shown before business decision
- [NBA Engine](mem://tech/nba-engine) — Signals only active for New Lead or Contacted stages
- [Executive Directives](mem://features/executive-directives) — Leadership pings require explicit acknowledgement and outcome
- [KPI System](mem://features/kpi-system) — 2-Contact Brand Coverage rule for brand target eligibility
- [Lead Ingestion](mem://features/lead-ingestion) — 4-step CSV/Form import workflow and initial task generation
- [Payroll Engine](mem://features/payroll-engine) — Salary rules, PKR 2000 outbound meeting commission, deductions
- [Directive Workflow](mem://features/directive-workflow) — Statuses: New, Acknowledged, In Progress, Blocked, Completed
- [Attendance Management](mem://features/attendance-management) — Shift-aware presence calculation, CEO/COO exempt
- [Employee Profiles](mem://features/employee-profiles) — Hard-assigned shifts and territories (e.g. Khadija for PK/Inbound)
- [Leave System](mem://features/leave-system) — 8 types, 14-day annual, 12-hour lead time required
- [Onboarding Role Purity](mem://features/onboarding-role-purity) — Tasks/Trials/Clients only, view+reveal credentials no edit, owner-aware blocked→waiting
- [Meeting Outcomes](mem://features/meeting-outcome-mappings) — Outcomes deterministically map to commercial stages
