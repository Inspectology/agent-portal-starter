# Open-source readiness evidence

This record captures representative test-first cycles. Full terminal output belongs in CI/build logs; this file does not claim formal security certification or final release approval.

| Cycle | RED (expected failure) | GREEN |
|---|---|---|
| Live configuration | `createConfig is not a function` | fail-closed mode/configuration test passed |
| Connection grant | `createGrant is not a function` | positive-decimal HMAC expiry/binding/tamper test passed |
| Live privacy/auth | `createPortal is not a function` | 401/403, branding, and minimized DTO test passed |
| Browser grant | source did not match `location.hash` | fragment removal and Bearer-header test passed |
| Link CLI | `MODULE_NOT_FOUND ... create-portal-link.js` | zero-dependency CLI test passed |
| History scanner | deleted `.env.production` fixture incorrectly exited 0 | fixture rejected from `HEAD`-reachable history |
| Upstream size bound | `readUpstreamJson is not a function` | oversized streamed response test passed |
| Branding URL validation | malicious `javascript:` URL was accepted | configuration test rejects non-HTTPS branding links |
| White-label config | defaults were product-branded and overrides did not reach UI | generic text/color/contact/demo-identity/asset overrides passed |
| Spectora request paths | expected path diff showed unsupported `filter[company_id]` on stats and inspections | exact connection GET; stats use only `filter[id]` plus page size; inspections use `filter[connection_id]`, explicit relationship includes, sort, and page size |
| Inspection connection binding | same-company inspection linked only to connection `18` returned `200`, expected `403` | every inspection requires configured company relationship and granted buyer or seller relationship |
| Strict connection company field | relationship-only company fixture returned `200`, expected `403` | connection and stats require exact `attributes.company_id`; connection also requires exact `data.id` |
| Inspection adversarial matrix | cross-connection tracer exposed missing relationship validation | official-shaped buyer/seller fixtures pass; other-connection, missing company, missing agents, ambiguous company, mixed connection, and mixed company fixtures all return `403` |
| Typed upstream status | `instanceof` failed because `UpstreamHttpError` did not exist | non-2xx upstream status is preserved in a typed error without upstream body data |
| Exact connection 404 | upstream connection `404` returned generic `502` | only exact connection GET `404` maps to portal `404`; stats/inspection `404` remain generic `502` |
| PWA removal | source still registered a service worker and installable assets existed | registration, manifest route/link/file, worker, icons, configuration, package keyword, and installable-PWA claims removed; responsive web app retained |
| Mode metadata | demo payload `meta` was `undefined` | demo/live payloads include safe `meta.mode` |
| Mode-aware copy | `MODULE_NOT_FOUND ../public/mode-copy` | tested demo/live/fail-closed notices render from payload mode |
| Generic credential scanner | a credentialed `DATABASE_URL` fixture exited 0 | generic credentialed URLs are rejected in tracked and reachable-history content |
| Gitleaks gate | deterministic workflow test could not find a Gitleaks action | pinned `gitleaks/gitleaks-action` v3.0.0 SHA, pinned Gitleaks 8.24.3, full-history checkout, redaction, and disabled comment/summary/artifact surfaces are asserted |
| Grant limiter order/key | invalid attempts consumed the IP/agent bucket | grant verification precedes a SHA-256 token/connection keyed bucket |
| Static snapshot race | a file swapped to an outside symlink after portal creation could expose outside bytes | the entire validated public tree is loaded at startup; post-creation swaps still serve the original snapshot bytes and never reopen the path |
| Upstream destination/timeout | injected transport reached the real client and timed out | fixed-origin credential destination and request-destruction timeout tests passed |
| Public-history scan | metadata, NUL binary, and unrelated-ref tests failed | generic credential metadata and bounded binary bytes are inspected; only `HEAD`-reachable history is scanned |
| Relationship resource types | wrong-type and conflicting relationship resources returned `200` | company resources require `type: company`; agent resources require `type: connection`; arrays, null company, missing agent fields, conflicts, and optional attribute mismatches return `403` |
| Frontend route logs | `/agent/{id}` emitted the raw identifier | frontend and API access logs use `:id` route templates |
| Live DTO identifier | live `agent.connectionId` exposed the upstream ID | live DTO omits the upstream connection ID entirely; demo fixture IDs remain explicitly synthetic |
| Muted contrast | `#747474` measured `4.469698:1` against the default background | `#6f6f68` measures `5.060762:1` on `#ffffff` and `4.839564:1` on `#fafaf7` in the executable contrast test |
| Release automation | floating action tags and build-only Docker CI test failed | action SHAs, base digest, non-root UID, run, and HTTP-health assertions passed |

Additional regression coverage verifies malformed/static requests, hostile Host input, `clientError`, security headers, bounded live rate limiting, PII-safe log shape, stats cardinality/identity/company, and fail-closed malformed inspection relationships. See `test/` for executable acceptance tests.
