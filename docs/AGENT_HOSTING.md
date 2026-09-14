# Deterministic hosting runbook for AI agents

## Goal

Prepare and verify a self-hosted, independent white-label Agent Portal without publishing, touching production, or handling real customer data by default.

## Prerequisites

- An isolated checkout and explicitly approved target environment
- Node.js >=20, npm 10, Git; Docker/Compose only if approved
- Synthetic data for all pre-production checks
- Human owner for DNS, TLS, secrets, live-mode, and publication approvals

## Forbidden actions

Do not publish or create a remote; access production; retrieve or print real Spectora/customer data; read unrelated credential stores; commit `.env`; expose grants/secrets in output; change DNS/firewalls/proxies; spend money; rotate secrets; enable live mode; or delete backups without explicit human approval.

## Approval gates

1. **Before live mode:** owner plus privacy/security approval and approved least-privilege credentials.
2. **Before network exposure:** owner approval for hostname, DNS, TLS, proxy, and edge controls.
3. **Before publication:** repository owner approval after history/identity/license/trademark review.
4. **Before rotation/rollback:** service owner approval unless an incident runbook already authorizes it.

Stop if a gate is missing. Never substitute example credentials or infer approval.

## Procedure

1. Verify isolation and branch:
   ```bash
   pwd
   git status --short --branch
   git remote -v
   ```
   Acceptance: expected path/branch, understood changes, and no unexpected remote action required.

2. Install reproducibly:
   ```bash
   node --version
   npm --version
   npm ci
   ```
   Acceptance: Node >=20 and install exits 0.

3. Verify source in demo mode:
   ```bash
   npm run check:syntax
   npm test
   npm run scan:public
   gitleaks git --redact --verbose .  # requires Gitleaks 8.24.3
   npm audit --omit=dev
   npm pack --dry-run
   ```
   Acceptance: all exit 0; scanner includes its limitation statement; package contents are expected.

4. Create local configuration without credentials:
   ```bash
   cp .env.example .env
   ```
   Set `PORTAL_MODE=demo` and approved white-label values only. Acceptance: `.env` remains ignored by Git (`git status --short` does not show it).

5. Start on a non-production port and verify:
   ```bash
   PORT=3305 npm start
   curl --fail http://127.0.0.1:3305/api/health
   ```
   Acceptance: HTTP 200, JSON `status=ok`, `mode=demo`; stop the process after checking.

6. If Docker is approved:
   ```bash
   docker compose config
   docker compose build --pull
   docker compose up -d
   docker compose ps
   curl --fail http://127.0.0.1:3005/api/health
   docker compose down
   ```
   Acceptance: config resolves, image builds, container runs non-root/healthy, health reports demo, and cleanup completes.

7. Present evidence and request the relevant approval gate. Do not continue merely because tests pass.

8. After explicit live-mode approval, accept secrets only through the platform's protected secret mechanism. Set all required live values atomically and restart. Never print env or use shell tracing. Acceptance: health reports live; synthetic/test-double checks prove 401/403/429, company mismatch, upstream timeout/size bounds, and minimized schema.

9. Generate links on the trusted host:
   ```bash
   npm run create-link -- --connection-id 17 --origin https://APPROVED_HOST --ttl 3600
   ```
   Replace `17` only with the approved positive-decimal Spectora connection ID (never an agent UUID). Deliver output only through the approved confidential channel. Acceptance: URL uses HTTPS and `#grant=`; no secret appears.

10. Follow `HUMAN_HOSTING.md` for reverse proxy, updates, backup, and rollback. Record commit hash/image digest and health evidence without PII.

## Publication procedure after explicit approval

Create a fresh publication repository from the reviewed tracked bytes only:

```bash
source_repo=/path/to/reviewed/source
publish_tree="$(mktemp -d)"
git -C "$source_repo" archive --format=tar HEAD | tar -xf - -C "$publish_tree"
git -C "$publish_tree" init -b main
git -C "$publish_tree" config user.name 'Agent Portal Contributors'
git -C "$publish_tree" config user.email 'agent-portal-contributors@users.noreply.github.com'
git -C "$publish_tree" add -A
git -C "$publish_tree" commit -m 'Initial open-source release'
test "$(git -C "$publish_tree" rev-list --parents -n 1 HEAD | wc -w)" -eq 1
```

Never copy the source repository's `.git`, never mirror it, never use `git push --all` or `git push --mirror`, and never publish unrelated local refs. Re-run every verification gate in the fresh repository and stop for owner review before creating a remote or pushing.

## Final acceptance report

Report: commit hash; mode; tests/audit/scan/pack results; health status; Docker status if used; white-label variables exercised; exact approval gates obtained; unresolved blockers. State explicitly that the project is independently maintained and non-affiliated with Spectora, and that its Spectora adapter is optional, experimental, synthetic contract-tested, and not credentialed-smoke-tested.
