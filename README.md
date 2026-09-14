# Agent Portal with an experimental Spectora adapter

A zero-runtime-dependency, demo-first Node.js portal starter for inspection companies. It ships with synthetic records and includes an optional experimental adapter that can read a deliberately minimized subset of agent/inspection data from Spectora.

> **Independent project:** This repository is independently maintained and is not affiliated with, sponsored by, endorsed by, or an official product of Spectora. Spectora integration is optional; Spectora and its marks belong to their respective owners. See [TRADEMARKS.md](TRADEMARKS.md). The MIT license grants no trademark rights.

## Prerequisites

- Node.js 20 or newer
- npm 10 (the exact development version is in `packageManager`)
- Git for the history-aware public-safety scan
- Docker only if using the container workflow
- HTTPS for deployed portal links and live credentials

## Quick start: synthetic demo

```bash
npm ci
cp .env.example .env       # optional; the built-in zero-dependency loader reads it
npm test
npm start
```

Open <http://localhost:3005/agent/demo-platinum-partner>. No Spectora credentials are read or required in demo mode. `PORTAL_MODE` defaults to `demo`; setting a Spectora key alone does not enable live access.

Health check:

```bash
curl --fail http://127.0.0.1:3005/api/health
# {"status":"ok","service":"spectora-agent-portal","mode":"demo"}
```

## Modes and data behavior

### Demo (default)

`data/sample-agent.json` contains fictional names, contact details, generalized addresses, IDs, and relationship history. The local SVG portrait is constructed. Any `/api/agent/:id` request returns this synthetic dashboard so the UI is immediately usable.

### Live (explicit opt-in)

Live startup requires all four values below. The API key is checked only for a nonempty value; the company ID must be a positive decimal; and only the signing secret receives a strength check (at least 32 UTF-8 bytes). Missing values or an unknown mode terminate startup:

```dotenv
PORTAL_MODE=live
SPECTORA_API_KEY=...
SPECTORA_COMPANY_ID=42 # positive decimal company ID from Spectora
PORTAL_SIGNING_SECRET=... # at least 32 UTF-8 bytes, randomly generated
```

Production requests are pinned to `https://connect.spectora.com`; there is no configurable production origin. Tests inject an `upstreamGet(path)` function directly, and that function is never passed the Spectora credential.

The path and grant identify a Spectora **connection ID** (the company-specific agent identifier), expressed as a positive decimal. The adapter fetches exactly `GET /v2/connections/{connectionId}`, requires `data.id` and `data.attributes.company_id` to match exactly, and validates any present company relationship as one `type: company` resource with that same ID. It requests stats as `GET /v2/connection_stats?filter[id]={connectionId}&page[size]=1`; the response must contain exactly one record with the exact granted ID and configured `attributes.company_id`, with the same validation for any present company relationship. It requests inspections as `GET /v2/inspections?filter[connection_id]={connectionId}&include=buying_agent%2Cselling_agent%2Ccompany&sort=-datetime&page[size]=50`. Every inspection must have one `type: company` company resource with the configured ID. Both buying-agent and selling-agent relationships must be present; each may be null or one `type: connection` resource, and at least one exact ID must match the grant. If an inspection carries `attributes.company_id`, it must exactly match the configured company. Missing, null company, arrays, wrong resource types, or conflicting IDs fail closed with `403`. The adapter does not send undocumented `filter[company_id]` parameters.

Live interoperability is synthetic contract-tested against documented request and response shapes. It has not been smoke-tested with live credentials; operators must treat the adapter as experimental and validate it in an approved non-production environment before relying on it.

The live API intentionally returns only:

- company branding/contact actions configured by the deployer;
- agent name, agency, city/state, and a local placeholder portrait;
- aggregate relationship counts/dates;
- inspection date, city/state-level location, service names, inspector name, and broad status.

It never maps client names, quotes, report URLs/slugs, exact street addresses, agent email/phone, upstream IDs (including the connection ID), or remote photo URLs. This minimization is not consent: operators remain responsible for authorization, retention, notices, and applicable privacy law.

The API payload includes `meta.mode` (`demo` or `live`). The frontend uses that value for customer-facing notice copy: demo pages state that records are fictional, while live pages state that the minimized history is restricted to the authorized connection/company and city/state locations.

## Portal grants

A live request needs an expiring HMAC-SHA-256 bearer grant bound to exactly one positive-decimal Spectora connection ID. Generate a link on the trusted server or administrator workstation:

```bash
npm run create-link -- \
  --connection-id 17 \
  --origin https://portal.example.com \
  --ttl 3600
```

The CLI reads `PORTAL_SIGNING_SECRET` from the environment or `.env`; it never prints the signing secret. It prints a URL like:

```text
https://portal.example.com/agent/17#grant=...
```

The fragment is not sent in the initial HTTP request. The frontend moves the grant into tab-scoped `sessionStorage`, removes the fragment from browser history, and sends `Authorization: Bearer ...` to the API. Grants expire after at most 24 hours and cannot be individually revoked; rotate `PORTAL_SIGNING_SECRET` to invalidate all outstanding grants. Treat generated links as credentials and exclude fragments from analytics, screenshots, chat, tickets, and logs.

Live API status behavior:

- `401`: absent, malformed, tampered, or expired grant
- `403`: valid grant bound to another connection, or upstream identifier/company-scope mismatch
- `404`: an upstream `404` from the exact connection GET
- `429`: bounded in-memory rate limit exceeded
- `502`: upstream timeout, oversize/malformed response, or upstream failure

## Architecture and data flow

```text
Browser -- GET /agent/:connectionId (fragment stays client-side) --> Node static server
Browser -- Bearer HMAC grant --> GET /api/agent/:connectionId
Node -- validate connection ID; verify signature + expiry + binding --> authorization gate
Node -- hash validated grant + connection ID --> process-local rate bucket
Node -- fixed-origin HTTPS + exact connection route/documented filters --> connect.spectora.com
Node -- verify returned IDs/company on every record --> minimize DTO --> Browser
```

`server.js` also serves static files, applies security headers, and writes structured logs containing only method, an allowlisted route template, status, and duration. The allowlist preserves `/api/health` and the redacted `/api/agent/:id` and `/agent/:id` templates; every static, unknown, or malformed path becomes `/:static-or-not-found`. Authentication happens before rate-limit consumption. The process-local limiter uses a SHA-256 hash of the validated grant plus connection ID, never the socket IP or raw credential. Logs exclude arbitrary raw paths, IP addresses, connection IDs, query strings, authorization headers, grants, and upstream bodies.

## White-label configuration

The default UI is deliberately generic (`Agent Portal`, `Example Home Inspections`, and synthetic agent Taylor Morgan). All demo names, contact details, record IDs, and relationship identifiers are fictional fixtures. Spectora is optional. Copy `.env.example` and set these values without editing application code:

```dotenv
PORTAL_APP_NAME=Northstar Partner Hub
COMPANY_NAME=Northstar Home Inspections
COMPANY_TAGLINE=Clear answers for every move
COMPANY_LICENSE=License EX12345
COMPANY_PHONE=(555) 010-1234
COMPANY_WEBSITE=https://inspections.example
BOOKING_URL=https://inspections.example/book
WHATSAPP_URL=https://wa.me/15550101234

BRAND_PRIMARY_COLOR=#f5b819
BRAND_ACCENT_TEXT_COLOR=#765400
BRAND_INK_COLOR=#232323
BRAND_MUTED_COLOR=#6f6f68
BRAND_SURFACE_COLOR=#ffffff
BRAND_BACKGROUND_COLOR=#fafaf7
BRAND_BORDER_COLOR=#e6e2d9
BRAND_SUCCESS_COLOR=#208c5a
BRAND_FOCUS_COLOR=#2563eb

DEMO_AGENT_FIRST_NAME=Casey
DEMO_AGENT_LAST_NAME=Example
DEMO_AGENT_AGENCY=Northstar Realty
DEMO_AGENT_CITY=Example City
DEMO_AGENT_STATE=OR
DEMO_AGENT_PHOTO_PATH=/assets/custom-agent.png
DEMO_TIER_LABEL=Preferred Partner
```

Text, company/contact actions, page title/theme color, UI CSS colors, synthetic profile identity, tier label, and portrait come from configuration. Color values must be six-digit hex; check all customized text/background combinations for WCAG contrast. The default muted token `#6f6f68` has script-verified contrast ratios of `5.060762:1` against surface `#ffffff` and `4.839564:1` against background `#fafaf7`. Contact URLs must be HTTPS. The portrait value must be a traversal-free local `/assets/` path: copy the corresponding approved PNG/SVG file into `public/assets/` before startup. The server does not fetch remote portraits.

Generic action labels and privacy/status language remain product copy rather than company branding. Edit those only when your fork's accessibility, localization, and privacy review accepts the change.

## Self-hosting

- **Human operators:** follow [docs/HUMAN_HOSTING.md](docs/HUMAN_HOSTING.md) for local Node, Docker Compose, reverse proxy/TLS, mock/live choice, grants, updates, backups, rollback, and the deployment security checklist.
- **AI agents/operators:** follow the deterministic [docs/AGENT_HOSTING.md](docs/AGENT_HOSTING.md), including forbidden actions and approval gates.

The sample `compose.yaml` runs the non-root image read-only with dropped capabilities. Validate it before use:

```bash
docker compose config
```

## Configuration

The process loads `.env` without dependencies and never overwrites values already present in the process environment.

| Variable | Default | Notes |
|---|---:|---|
| `PORTAL_MODE` | `demo` | Only `demo` or `live` |
| `PORT` | `3005` | 1–65535 |
| `SPECTORA_API_KEY` | empty | Required in live mode |
| `SPECTORA_COMPANY_ID` | empty | Required positive-decimal documented company ID in live mode |
| `PORTAL_SIGNING_SECRET` | empty | Required in live mode; at least 32 bytes |
| `UPSTREAM_TIMEOUT_MS` | `10000` | 100–30000 |
| `UPSTREAM_MAX_BYTES` | `1000000` | 1024–5000000 |
| `RATE_LIMIT_MAX` | `60` | Per validated-grant/connection hash bucket per window; 1–1000 |
| `RATE_LIMIT_WINDOW_MS` | `60000` | 1000–3600000 |
| `PORTAL_APP_NAME` | `Agent Portal` | Browser/page display name and page title |
| `COMPANY_NAME`, `COMPANY_TAGLINE`, `COMPANY_LICENSE` | generic fixture | Company-facing text |
| `COMPANY_PHONE` | fixture value | Contact override |
| `COMPANY_WEBSITE`, `BOOKING_URL`, `WHATSAPP_URL` | fixture values | HTTPS URLs |
| `BRAND_*_COLOR` | accessible generic palette | Six-digit hex UI colors; see `.env.example` |
| `DEMO_AGENT_*` | synthetic fixture | Demo name, agency, city/state, local portrait path |
| `DEMO_TIER_LABEL` | `Platinum Partner` | Synthetic tier copy |

The rate limiter is deliberately simple and process-local. Multiple replicas need a shared edge/gateway limiter. Do not rely on this application limiter alone for internet abuse resistance.

## Security model and threat model

Controls included:

- explicit fail-closed live configuration;
- positive-decimal company/connection ID validation plus timing-safe HMAC signature comparison, expiration, and connection binding;
- fixed Spectora origin, no redirects implemented by the HTTPS client, upstream timeout and response byte limit;
- exact connection lookup, documented stats/inspection filters, and response-side connection/company verification;
- minimized response DTO and local-only agent image;
- CSP with `frame-ancestors 'none'`, `nosniff`, no-referrer, permissions policy, and no-store API responses;
- startup-time recursive static-tree snapshot after realpath, symlink, and regular-file validation; requests serve only immutable in-memory allowlisted bytes and never reopen request paths;
- post-authentication, credential-hash-keyed bounded in-memory rate buckets and PII-safe access-log fields.

Assumptions and residual risks:

- anyone holding an unexpired portal URL can use its bearer grant;
- HMAC grants have no per-token revocation or server-side session state;
- signing-secret compromise permits grant forgery; Spectora-key compromise bypasses this portal entirely;
- TLS termination, host/firewall controls, process supervision, secret storage, backups, and edge denial-of-service controls belong to the operator;
- aggregate counts, names, city/state, services, and inspection dates may still be personal or commercially sensitive;
- upstream schema/permission changes can cause fail-closed `403`/`502` responses;
- the custom safety scan checks configured patterns, not all possible sensitive data, steganography, binary metadata, or credential formats.

Review [SECURITY.md](SECURITY.md) before exposing live mode. Use least-privilege read-only API credentials and a dedicated deployment secret manager. Never put secrets in images or source control.

## Web app and accessibility

This is an ordinary responsive web app. Installable-PWA support, manifests, service workers, offline caches, and PWA icons are intentionally absent because a root launch cannot safely reconstruct a per-connection bearer grant. Open each live portal only from its current credential-bearing link. The UI includes visible keyboard focus, reduced-motion behavior, and a darker gold text token for normal-text contrast.

## Docker

Build and run the default synthetic demo as a non-root user:

```bash
docker build -t agent-portal .
docker run --rm -p 3005:3005 agent-portal
curl --fail http://127.0.0.1:3005/api/health
```

For live mode, inject secrets at runtime with your platform's secret mechanism—not Docker build arguments or committed env files. The image includes a Node-based health check and contains no development dependencies. The base image is pinned by digest. To update it, pull the intended `node:20-alpine` release, record `docker image inspect node:20-alpine --format '{{index .RepoDigests 0}}'`, review upstream release notes/security fixes, replace the digest, and rebuild/run the full verification set.

## Development and verification

```bash
npm ci
npm run check:syntax
npm test
npm run scan:public
# Required manual release gate; install Gitleaks 8.24.3 first:
gitleaks git --redact --verbose .
npm audit --omit=dev
npm pack --dry-run
```

The safety scan checks current tracked files plus commit metadata and blobs in the public history reachable from `HEAD` (not unrelated local refs). It checks author/committer names and emails, messages, binary names, and both UTF-8/byte-preserving representations of regular files and blobs up to 10 MiB, including NUL-containing content. Oversize and unsupported entries fail closed. Rules cover generic secret/token/key assignments, common token formats, credentialed URLs, environment/key/database/archive/screenshot artifacts, and sensitive record URLs. Fixtures use only generic fictitious identities. It deliberately says only that no configured pattern matched. The pinned Gitleaks 8.24.3 action is the established CI release gate; it checks out full history, invokes Gitleaks with redaction, and disables comments, summaries, and artifact uploads. For organization-owned GitHub repositories, configure the action's required `GITLEAKS_LICENSE` repository/organization secret; personal-account repositories do not require one. Run the redacted Gitleaks CLI command above and perform manual review before release as additional gates.

## Troubleshooting

- **Startup says live variables are required:** set all three live credentials plus `PORTAL_MODE=live`, or return to `PORTAL_MODE=demo`.
- **Signing secret is too short:** generate at least 32 random bytes; do not use a phrase or sample value.
- **Live request is 401/403:** create a new link for the exact positive-decimal path connection ID; check expiry and returned connection/company identifiers. Do not log the grant while debugging.
- **Live request is 429:** wait for the configured window; scale/adjust only after reviewing abuse exposure.
- **Live request is 502:** verify Spectora availability and credential permissions; then inspect non-PII operational logs. The response body intentionally hides upstream details.
- **An older deployment still behaves offline:** clear site data or unregister the service worker left by versions before installable support was removed.
- **`.env` appears ignored:** process environment values intentionally win over `.env`; restart the process after edits.
- **Docker health is unhealthy:** inspect container logs and verify port 3005 is not overridden inconsistently.

## Release checklist

- [ ] Replace only approved synthetic branding/fixtures; never commit a real export.
- [ ] Review tracked files and all reachable history manually and with Gitleaks 8.24.3 using `--redact`.
- [ ] Build any public repository from `git archive HEAD` in a fresh directory and initialize one new root commit; never push/mirror all refs or copy this local `.git`.
- [ ] Run every verification command above from a clean clone.
- [ ] Confirm demo starts without credentials and `/api/health` reports `demo`.
- [ ] Exercise 401, 403, 429, company mismatch, timeout, and response-size behavior with synthetic test doubles.
- [ ] Confirm the deployed live API response contains none of the forbidden fields listed above.
- [ ] Use a least-privilege Spectora key and secrets manager; document rotation and incident response.
- [ ] Put the service behind HTTPS, an edge rate limit/WAF, monitoring, and a process supervisor.
- [ ] Review privacy notices, data-processing terms, API terms, and trademark usage with appropriate counsel.
- [ ] Review `LICENSE`, `NOTICE`, `TRADEMARKS.md`, `SECURITY.md`, the changelog, and community policies.
- [ ] Confirm CI and non-root container health checks pass.

## License

MIT. Copyright (c) 2026 Agent Portal Contributors. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
