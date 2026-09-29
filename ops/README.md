# IVY - Inspectology Virtual Operations Assistant

IVY is the internal Inspectology operations agent. Phase 1 automates third-party vendor document intake conservatively.

## Current Phase 1 flow

1. A vendor email is forwarded to the Inspectology Resend inbound address.
2. Resend sends a signed `email.received` webhook to IVY.
3. IVY verifies the webhook signature before doing anything.
4. IVY retrieves the full email and attachment metadata from Resend.
5. IVY recognizes the vendor and document type from real Inspectology email patterns.
6. Reports are matched to Spectora by property address, service, ZIP, and date.
7. Existing Spectora attachments are checked for duplicate filenames.
8. Every decision is written to the Inspectology Operations Google Sheet.
9. Ambiguous items go to the Exceptions tab instead of being guessed.
10. Automatic Spectora upload remains disabled until dry-run results are approved.

## Vendors and learned email patterns

### Lynn Pest Management
- Service: Termite / WDO
- Sender: `lynnpestmgmt@gmail.com`
- Reports usually use the property address as the subject and PDF filename.
- Separate invoice emails use subjects like `Invoice 9-3792 from L&J Lynn LLC`.
- Invoices are ledger entries, never report uploads.

### Cambro Services
- Service: Chimney
- Sender: `mattglick@cambro.services`
- Reports commonly use subjects like `1003 Kingston Rd chimney inspection`.
- PDF filenames commonly end in `Chim Insp.pdf`.

### Atlantic Blue
- Service: Well / Water Testing
- Senders include `@atlanticblue.net`, including the lab.
- Report subjects include Water Test Results, Failing Bacteria, and Lead Results.
- Generic `Well Yield Disclaimer.pdf` booking attachments are ignored.
- Spectora documents the `water` attachment type, so this category can be enabled after dry-run validation.

### Young Septic
- Service: Septic
- Direct reports commonly arrive from `anna@youngseptic.com` / `info@youngseptic.com`.
- Some are forwarded through Atlantic Blue.
- Report subjects use `Septic Inspection Report for [address]`.
- Video attachments remain review-only until a separate video policy is approved.

## Google Workspace ledger

Spreadsheet: **Inspectology Operations**

Tabs:
- Vendor Activity
- Exceptions
- Vendors
- Weekly Summary

Vendor Activity keeps reports and invoices as separate entry types so weekly inspection counts are not inflated by vendor invoices.

The spreadsheet is stored inside the `IVY - Inspectology Operations` folder in the Inspectology Admin Drive and is shared with the existing Inspectology dashboard service account.

## Safety controls

`OPS_AUTO_UPLOAD=false` is the required starting mode.

In dry-run mode IVY can:
- recognize vendor reports
- match them to Spectora inspections
- detect duplicate filenames
- record invoices and vendor costs
- populate the Google Sheet
- create exceptions

In dry-run mode IVY cannot modify a Spectora inspection.

An automatic upload will only be allowed when:
- vendor classification is confident
- a supported report PDF is present
- exactly one Spectora inspection is a strong match
- the filename is not already attached
- that vendor's Spectora attachment type is explicitly configured
- `OPS_AUTO_UPLOAD=true`

## Email identity

Every automated IVY message must use the central `ops/ivy-email.js` helper.

Approved identity:
- IVY
- Inspectology Virtual Operations Assistant
- `ivy@inspect-ology.com`
- Replies route to `info@inspect-ology.com`

The helper appends IVY's Inspectology-branded signature to both plain-text and HTML versions.

## Inbound configuration

Resend supports inbound email through an `email.received` webhook. The endpoint for this app is:

`POST /api/ops/resend-webhook`

The webhook secret must be stored only in:

`OPS_RESEND_WEBHOOK_SECRET`

The endpoint verifies the raw body against the Resend/Svix signature headers and rejects stale or invalid signatures.

## Next milestones

1. Configure the Preview Resend inbound webhook and Gmail vendor forwarding.
2. Run real vendor traffic through IVY with automatic upload disabled.
3. Review the Vendor Activity and Exceptions tabs.
4. Determine the exact Spectora attachment types for termite, chimney, and septic.
5. Approve and enable automatic report uploads.
6. Build Jessica's Friday vendor summary from the same ledger.
7. Add narrowly scoped routine email replies.
