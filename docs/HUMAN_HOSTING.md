# Human self-hosting guide

This guide deploys your own independent, white-label copy. Spectora is optional; demo mode is the safe default.

## 1. Prepare

Install Node.js 20+, npm 10, and Git. For containers, install Docker Engine with Compose v2. Put the source in a private working directory until the public-safety review is complete.

```bash
npm ci
cp .env.example .env
npm test
npm run scan:public
gitleaks git --redact --verbose .  # install Gitleaks 8.24.3 first
```

Edit `.env` with your public branding. Keep `PORTAL_MODE=demo` first. Never commit `.env` or generated portal links.

## 2. Run with local Node

```bash
npm start
curl --fail http://127.0.0.1:3005/api/health
```

Run Node under a service supervisor for persistent hosting. The health response must report `demo` unless live mode was intentionally approved.

## 3. Run with Docker Compose

```bash
docker compose config

docker compose build --pull

docker compose up -d

docker compose ps
curl --fail http://127.0.0.1:3005/api/health
```

The sample Compose service is read-only, drops Linux capabilities, uses a small temporary filesystem, and runs as the image's non-root `node` user.

## 4. Put HTTPS in front

Bind the app to a private host/network where practical. Use a maintained reverse proxy or managed load balancer to terminate TLS, redirect HTTP to HTTPS, preserve the client IP only in trusted infrastructure, enforce request/body/time limits, and add an edge rate limit. Proxy only to port 3005; do not serve `.env`, source, backups, or Docker socket mounts. The portal is an ordinary responsive web app without a service worker or offline cache.

Example Caddy configuration:

```caddyfile
portal.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3005
}
```

Obtain DNS/TLS approval before making a hostname public. Validate certificate renewal and `curl --fail https://portal.example.com/api/health`.

## 5. Choose demo or live

- **Demo:** leave `PORTAL_MODE=demo`. Spectora settings may stay empty. Only synthetic fixture data is returned.
- **Live:** obtain explicit owner/privacy approval, use a least-privilege read-only Spectora key, then set `PORTAL_MODE=live`, `SPECTORA_API_KEY`, a positive-decimal documented `SPECTORA_COMPANY_ID`, and a random 32-byte-or-longer `PORTAL_SIGNING_SECRET`. Restart and verify health reports `live`.

Create each agent connection's short-lived link only on the trusted host. Use the positive-decimal Spectora connection ID, not an agent UUID:

```bash
npm run create-link -- --connection-id 17 --origin https://portal.example.com --ttl 3600
```

Deliver it as a credential. Do not paste it into logs, analytics, issues, screenshots, or public messages.

## 6. Back up and update

Back up only operator-owned configuration and deployment metadata: encrypted secret-manager entries, approved `.env` equivalent, proxy configuration, and the exact Git commit/image digest. The application has no database or writable state to back up.

Before an update:

```bash
git rev-parse HEAD
cp .env /secure/operator-backup/location/portal.env
npm ci
npm test
npm run scan:public
gitleaks git --redact --verbose .  # install Gitleaks 8.24.3 first
```

Build a versioned image from the candidate commit, verify it on a non-production port, then switch the proxy. Never overwrite the known-good image tag.

Rollback by restoring the prior commit/image digest and prior compatible operator configuration, restarting, and checking `/api/health`. Rotating `PORTAL_SIGNING_SECRET` invalidates all outstanding links; do so after suspected link/secret exposure.

## 7. Security checklist

- [ ] HTTPS and automatic certificate renewal work.
- [ ] Demo/live mode matches the approved intent.
- [ ] Live secrets are in a secret manager or protected runtime env, never source/image layers.
- [ ] Spectora credential is read-only and company-scoped where supported.
- [ ] An edge rate limit/WAF and process supervisor are enabled.
- [ ] API tests confirm 401 without grant, 403 for wrong agent/company, and no forbidden PII fields.
- [ ] Access, proxy, analytics, and error logs exclude URL fragments, authorization headers, connection IDs, addresses, and upstream bodies.
- [ ] Update, backup, rollback, secret rotation, and incident owners are documented.
- [ ] Terms, privacy notice, retention, and trademark presentation received appropriate review.
