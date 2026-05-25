# Stylique CRM SOP

Last updated: 2026-05-18

This SOP explains how the Stylique CRM should be used day to day. The CRM is a role-based operational state system. It is not a coaching tool, HR system, or complicated enterprise CRM.

The goal is simple: every role should see what is happening right now, what they own, and what they can act on.

## 1. Access

Local preview:

```text
http://127.0.0.1:8787
```

Live app:

```text
https://stylique-crm.onrender.com
```

Login steps:

1. Open the CRM.
2. Select your account.
3. Enter your CRM password.
4. The system opens the correct role view automatically.

## 2. Account Passwords

Do not share CEO/COO passwords in team channels. Abdullah and Hira passwords are intentionally excluded from this SOP.

| User | Role | Password |
| --- | --- | --- |
| Areeba | SDR | `mmvoG1QT7cJH` |
| Khadija | SDR | `8ibVDHQCCpSn` |
| Muneeb | Onboarding | `f_gKB0KlzwER` |
| Taiba | SDR | `Rg78L28W-GZE` |

Password management:

1. CEO/COO opens `Settings`.
2. Go to `Passwords`.
3. Generate or edit the user password.
4. Save.
5. Give the password only to that user.

When adding a new teammate, assign their password during teammate setup.

## 3. Roles

### CEO / COO

CEO/COO owns:

- Command Center
- Client Review
- payment verification
- credentials
- team settings
- KPI policy
- attendance visibility
- leave approvals
- package and pricing control

CEO/COO should not do SDR follow-up work inside the CRM unless manually taking ownership.

### SDR

SDR owns:

- outbound leads
- inbound leads assigned to them
- outreach
- replies
- meetings
- meeting notes
- decision pending
- moving ready brands to Client Review

SDR does not own:

- commercial approval
- payment verification
- credentials
- onboarding
- overdue billing

### Onboarding

Onboarding owns:

- onboarding queue
- setup completion
- done and verified
- active client contacts relevant to onboarding

Onboarding does not own:

- SDR pipeline
- payment verification
- CEO review
- SDR KPI
- overdue billing

### Operations

Operations is view-only. Operations can see leadership-level information but cannot change records, settings, payments, credentials, users, or passwords.

## 4. Core CRM Rule

The pipeline stage is the source of truth.

Do not create duplicate client states manually. Do not use old trial labels. Do not treat awaiting payment, credentials, onboarding, pilot, and contract as separate disconnected systems.

One brand record must carry the full history:

- contacts
- outreach
- replies
- meetings
- meeting notes
- CEO review
- payment record
- credentials
- onboarding result
- pilot status
- contract status
- payment cycles

## 5. SDR Pipeline

SDR pipeline stages:

```text
New Lead
Contacted
Replied
Meeting Scheduled
Meeting Done
Decision Pending
Moved to Client Review
Pilot
Cold
Closed Lost
```

Correct movement:

1. `New Lead` means the brand has not been worked.
2. SDR contacts the brand and moves it to `Contacted`.
3. When a reply exists, move it to `Replied` and add reply summary.
4. When a meeting is booked, move it to `Meeting Scheduled` and add date, time, platform, link, and note.
5. After the meeting, move it to `Meeting Done` and add written meeting notes.
6. If the brand needs time, move it to `Decision Pending`.
7. If commercially ready, move it to `Moved to Client Review`.
8. If inactive but recoverable, move it to `Cold`.
9. If commercially dead, move it to `Closed Lost`.

Meeting notes must always be written in plain context. Do not rely only on preset outcomes.

## 6. Inbound Flow

Inbound leads come from:

- Book a Demo form
- website inquiries
- manual inbound entry
- CSV import from inbound sources
- future Claude/Codex/API connectors

Inbound should remain separate from outbound SDR leads unless intentionally filtered.

Inbound stages:

```text
New Inquiry
Contacted
Replied
Meeting Scheduled
Meeting Done
Decision Pending
Moved to Client Review
Cold
Closed Lost
```

Inbound brands should be assigned to the correct SDR. If the same brand appears twice, merge contacts into one brand record instead of creating duplicate brand pipelines.

## 7. Client Review

Client Review starts when SDR says the brand is commercially ready.

SDR submits:

- recommended package
- value
- currency
- notes

CEO/COO reviews:

- package
- value
- currency
- terms
- payment status
- credentials

Client Review should not be confused with onboarding. A brand is not ready for onboarding until payment is verified and credentials exist.

## 8. Payment and Credentials

CEO/COO verifies payment once.

Payment verification should capture:

- payment date
- amount
- currency
- package
- payment note

After payment, CEO/COO adds credentials:

- URL
- username
- password
- notes

Once credentials exist, the brand goes to onboarding queue.

## 9. Onboarding

Onboarding sees only work they can do.

Onboarding task rule:

```text
Payment verified + credentials exist + onboarding not done = Onboarding Task
```

Muneeb clicks:

```text
Done & Verified
```

After verification:

- onboardingDoneAt is set
- onboardingDoneBy is set
- record moves to Pilot
- history is preserved
- CEO/COO and SDR can see the updated state

## 10. Pilot

Pilot is paid. Pilot begins after onboarding verifies setup.

Pilot rule:

```text
Payment verified + credentials exist + onboarding done = Pilot
```

After one month, SDR should decide:

- move to Contract
- move to Lost

Pilot is not the same as active contract. Active contract means the client signs the 3-month recurring contract.

## 11. Contract / Active Clients

Contract clients are recurring clients.

Contract means:

- pilot completed
- client agreed to continue
- 3-month contract signed or accepted
- recurring billing cycle exists

Active client records should show:

- package
- currency
- value
- payment history
- next due date
- credentials
- notes
- owner
- timeline

## 12. Payments Page

Payments page is for CEO/COO billing visibility.

It should show:

- payment history
- next payment due
- due soon
- overdue

Due Soon:

```text
active recurring client renewal is within 5 days
```

Overdue:

```text
active recurring client passed renewal date and current cycle is unpaid
```

New Client Review records must not appear as overdue.

## 13. Contacts / Colonial View

Contacts is the universal memory of the business.

Every brand should show:

- current stage
- owner
- contacts
- secondary contact status
- reply summaries
- meeting notes
- reschedules
- payment history
- credentials
- onboarding notes
- pilot status
- contract status
- lost/churn history

Use Contacts when you need the full story of a brand.

## 14. Attendance

Attendance is mandatory for SDRs.

SDR daily use:

1. Log in.
2. Open Team / Attendance.
3. Click `Check In`.
4. Work normally.
5. Click `Check Out` at end of shift.

CEO/COO can see:

- present today
- late today
- on leave
- absent
- not checked in
- monthly attendance
- login time
- logout time
- late count
- absent count
- leave count

Attendance must not include salary deductions or payroll calculations.

## 15. Leave

SDRs can apply for leave.

Leave rules:

- leave should be applied at least 12 hours before shift start
- late leave requests are still logged but require manager attention
- CEO/COO approves or rejects
- approved leave affects attendance records
- monthly leave totals remain visible

## 16. KPI

SDR KPI is only for SDRs.

Default KPI:

- brands contacted weekly
- meetings booked monthly
- meetings completed monthly
- conversions monthly

Brands contacted KPI is based on real contacted brands, not leads added.

Onboarding users should not show SDR KPI.

CEO/COO can edit KPI policy in Team / KPI settings. KPI changes should affect the team KPI view immediately.

## 17. CSV Import

Use CSV import for:

- new outbound lead lists
- LinkedIn Navigator exports
- SyncGTM exports
- Book a Demo exports
- manual brand lists

Import rules:

- CRM treats brands as the main record, not people.
- If two contacts belong to one brand, keep one brand record with multiple contacts.
- If a second contact is missing, CRM should remind SDR to add secondary contact.
- Do not create duplicate brand pipelines.

## 18. Book a Demo

Book a Demo should create inbound records.

If the brand already exists:

- merge the contact into the existing brand
- log the inbound request
- keep the existing timeline

If the brand does not exist:

- create a new inbound lead
- assign owner
- place it in inbound flow

## 19. Settings

CEO/COO can manage:

- teammates
- roles
- managers
- shifts
- KPI tracking
- attendance tracking
- packages
- package values
- currencies
- permissions
- passwords

When deactivating a teammate:

1. Reassign active leads.
2. Reassign active clients.
3. Preserve old owner in history.
4. Then deactivate.

No lead or client should disappear when a teammate leaves.

## 20. Packages and Pricing

Packages can be edited by CEO/COO.

Default package types:

- Lite
- Starter
- Growth
- Enterprise
- Custom

Currencies:

- PKR
- USD
- GBP
- AED

Enterprise/custom deals may use custom value.

## 21. Connectors

Connectors are for automation, not for changing CRM ownership rules.

Planned connector use:

- Claude: inbound interpretation, lead enrichment, summaries
- Codex: CRM automation support and controlled workflows
- Clort/Botex: external sync sources where configured
- Microsoft Teams/Outlook: meeting/calendar linkage

Connector data must still land in the same brand record and timeline.

## 22. Daily Workflow

### SDR Daily Workflow

1. Log in.
2. Check in attendance.
3. Open Dashboard.
4. Review personal pipeline.
5. Work New Lead / Contacted / Replied records.
6. Add notes after replies.
7. Book meetings.
8. Add meeting notes after meetings.
9. Move ready brands to Client Review.
10. Check KPI progress.
11. Check out at end of shift.

### CEO/COO Daily Workflow

1. Log in.
2. Open Command Center.
3. Review Client Review.
4. Verify payment where relevant.
5. Add credentials.
6. Review onboarding queue and pilot movement.
7. Check due soon and overdue clients.
8. Check attendance and KPI.
9. Approve or reject leave.
10. Adjust settings only when needed.

### Onboarding Daily Workflow

1. Log in.
2. Open Onboarding Tasks.
3. Complete setup for queued clients.
4. Click Done & Verified.
5. Review active client contacts if needed.
6. Do not work SDR pipeline.

## 23. Cleanup / Reset

To wipe local preview data:

```text
http://127.0.0.1:8787/pipeline?reset=1
```

This clears browser CRM data for that browser.

Important: each browser has its own local storage. If old leads appear in Safari but not Chrome, reset Safari. If old leads appear in the in-app browser, reset the in-app browser.

## 24. Production Rules

Before daily production use:

- confirm login works
- confirm passwords are assigned
- confirm no demo leads are present
- confirm CSV import works with a small test file
- confirm one SDR lead can move from New Lead to Client Review
- confirm CEO can verify payment and add credentials
- confirm onboarding can mark Done & Verified
- confirm Pilot appears
- confirm KPI and attendance update

## 25. What Not To Do

Do not:

- add duplicate brand records
- use trial language
- treat awaiting review as overdue
- put onboarding users in SDR KPI
- use the CRM as a coaching script
- delete lost history
- bypass Client Review for real clients
- store business truth in separate sheets if CRM already has the record

## 26. Support Checklist

If something looks wrong:

1. Check the role you are logged in as.
2. Check whether the record is inbound or SDR flow.
3. Open Contacts and inspect the full brand timeline.
4. Check whether browser local storage has stale demo records.
5. Use `?reset=1` only if you intentionally want to wipe local preview data.
6. Check Settings for role, password, KPI, attendance, and package setup.
7. If live backend data is involved, verify the live API and environment variables.
