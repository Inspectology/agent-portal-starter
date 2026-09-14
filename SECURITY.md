# Security Policy

## Supported version

Security fixes are made on the current default branch. This pre-1.0 project does not promise fixes for older releases.

## Reporting a vulnerability

Do not include credentials, portal grants, customer data, or exploit details in a public issue. Use the repository host's private security-advisory feature on the fork or deployment you are evaluating. If that feature is unavailable, contact that deployment's maintainer through a private channel they publish.

Include affected version, reproduction steps using synthetic data, impact, and a suggested mitigation. Maintainers should acknowledge a complete report within seven days. No bounty or response SLA is promised.

Never test against a third party's deployment or real Spectora account without written authorization.

## Scope notes

Portal grants are bearer credentials. Keep links out of logs, analytics, referrers, tickets, and chat history; revoke exposure by rotating `PORTAL_SIGNING_SECRET`. This repository's safety scanner is heuristic, not a guarantee.
