---
name: Onboarding Role Purity
description: Onboarding (Muneeb) navigation, credentials, owner consistency, and stage-label rules
type: feature
---
Onboarding sidebar = Tasks · Trials · Clients only. No Calendar, Team, Directives, Contacts, Pipeline, Settings, Payments, Dashboard, Decisions, Risks. Direct URLs to those pages redirect to /tasks via RoleGuard. /payments redirects onboarding to /clients (read-only roster of converted + trial-active companies, no MRR/billing).

Credentials: onboarding can VIEW + REVEAL + COPY (audited via addActivity 'note' on first reveal/copy per session) but CANNOT EDIT. Edit is leadership-only via canEditCredentials.

Onboarding stage labels (getOnboardingStage in trial-engine): Blocked: Approval needed | Blocked: Credentials missing | Ready to activate | Active: monitor | Check-in due | Usage review due | Ready for SDR handoff | Completed.

When onboarding stage is blocked AND blocker is outside onboarding ownership, StepExecutionPanel hides CTA and shows "Waiting — {label}" with explicit "{Leadership|SDR} must act". Owner header shows SDR Owner · Step Owner · Stage so attribution never contradicts (e.g. step owner = Leadership when approval pending, even if SDR Owner = Areeba).

Task language for onboarding role uses execution phrasing: "Activate trial — {Company}", "Log check-in outcome — {Company}", "Review usage — {Company}", "Waiting for credentials — {Company}", "Hand off to SDR — {Company}". No vague "Continue setup" / "Complete trial setup".
