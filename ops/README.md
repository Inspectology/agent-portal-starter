# Inspectology Operations Agent

Phase 1 focuses on safe third-party vendor report intake.

## Vendors

- Lynn Pest Management — Termite / WDO
- Cambro Services — Chimney
- Atlantic Blue — Well / Water Testing
- Young Septic — Septic

## Safety rules

The intake engine never guesses which inspection should receive a document.

An automatic upload is planned only when:

1. The vendor is recognized.
2. A street address can be extracted from the message or attachment filename.
3. A single Spectora inspection is a strong match.
4. The same filename is not already attached.
5. A valid Spectora attachment type is configured.

Otherwise the item returns `action: review` for the future Jessica exception queue.

## Spectora integration

The engine uses:

- `GET /v2/inspections` to find candidate inspections.
- `GET /v2/inspection_attachments` for duplicate checks.
- `POST /v2/inspection_attachments` for the final multipart upload.

Well / Water uses Spectora's documented `water` attachment type by default.

The remaining vendor attachment categories should be explicitly configured after we confirm the correct Spectora enum values:

- `OPS_ATTACHMENT_TYPE_TERMITE`
- `OPS_ATTACHMENT_TYPE_CHIMNEY`
- `OPS_ATTACHMENT_TYPE_SEPTIC`

Optional override:

- `OPS_ATTACHMENT_TYPE_WELL_WATER`

## Next step

Connect the actual Inspectology operations mailbox. The currently connected Gmail account did not contain recent attachment traffic from these vendors, so the email ingestion layer has intentionally not been trained on guessed subject lines or filenames.

Once the operations mailbox is connected, the next workflow is:

Gmail attachment → vendor/address extraction → Spectora match → duplicate check → upload or Jessica review queue → ledger entry.

The ledger will later power Jessica's weekly vendor count/cost email.
