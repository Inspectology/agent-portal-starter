# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project uses semantic versioning after 1.0; pre-1.0 versions may change interfaces.

## [Unreleased]

### Security
- Snapshot the complete validated public tree at startup and serve only in-memory allowlisted bytes, eliminating request-time path reopen races.
- Fail closed on malformed relationship resource types/shapes and conflicting company attributes; redact frontend agent routes and omit upstream connection IDs from live DTOs.
- Replace organization-specific scanner content with generic credential rules and fictitious fixtures.
- Keep exact connection lookup and strict `data.id`/`attributes.company_id` checks; remove undocumented `filter[company_id]` from stats and inspection requests.
- Require exactly one connection stats record matching the granted connection and configured company.
- Require every official-shaped inspection relationship set to match the configured company and the granted buying or selling connection; reject mixed or malformed lists with `403`.
- Preserve typed upstream HTTP status internally so only an exact connection GET `404` maps to portal `404`; other upstream failures remain generic `502` responses.
- Add a pinned-SHA Gitleaks v3.0.0 / Gitleaks 8.24.3 CI gate with full-history checkout and redacted output; retain and extend the custom scanner for generic credentialed URLs.
- Authenticate before a grant/connection-hash keyed limiter, reject static symlinks, and scan reachable history/metadata/binary content.
- Pin CI actions and the Docker base by immutable identifiers; execute and health-check the non-root image in CI.

### Changed
- Return safe `meta.mode` payload metadata and render customer notice copy appropriate to demo or live data.
- Remove installable-PWA support, manifests, service workers, icons, configuration, and metadata; the responsive web app remains.
- Require publication through a fresh HEAD archive and new root commit rather than copying or broadly pushing local Git refs.

## [0.2.0] - 2026-09-14

### Added
- Explicit demo/live modes with fail-closed live configuration.
- Expiring, agent-bound HMAC portal grants and a link-generation CLI.
- Company-scoped, privacy-minimized live adapter; upstream and rate bounds.
- Security headers, resilient HTTP handling, PII-safe access logs, CI, container packaging, governance, and release documentation.
- Accessibility focus, motion, and contrast improvements.
- Generic white-label defaults, runtime text/color/contact/demo-identity configuration, Compose example, and human/AI self-hosting runbooks.
- Tracked-tree and reachable-history safety scanning with documented limits.

### Changed
- Branding variables now override fixture defaults.
- Production Spectora origin is fixed to `https://connect.spectora.com`.

## [0.1.0]
- Initial synthetic demo portal.
