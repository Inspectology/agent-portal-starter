# Proposed publication handoff — approval required

Do not publish from this repository without explicit repository-owner approval.

## Proposed public repository metadata

- **Name:** `agent-portal-starter`
- **Description:** `White-label, demo-first agent portal starter with an optional experimental Spectora adapter, expiring HMAC links, and zero runtime dependencies.`
- **Topics:** `agent-portal`, `home-inspection`, `white-label`, `nodejs`, `responsive-web-app`, `self-hosted`, `spectora`, `privacy`, `hmac`, `zero-dependencies`

## Publication repository construction — approval required

After repository-owner approval, build the publication candidate from tracked `HEAD` bytes only. Never copy this local `.git`, use `git push --all`, use `git push --mirror`, or publish any other local ref/object store.

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
git -C "$publish_tree" status --short
```

Run syntax, tests, the custom scan, redacted Gitleaks 8.24.3, audit, pack, Compose validation, Docker build/run/health, identity/content review, and manual tracked-byte review inside that fresh repository. Stop for final owner review before creating a remote or pushing its single root commit.

## Copy-ready Spectora / YouTube description

> Agent Portal Starter is a free, independently maintained white-label portal template for home-inspection companies. It runs immediately with synthetic demo data and includes an optional experimental Spectora adapter for an explicit, fail-closed live mode. Its request/response behavior is synthetic contract-tested, but it has not been smoke-tested with live credentials. Live access uses short-lived connection-bound links and a privacy-minimized API that omits client names, exact addresses, quotes, report links, agent contact details, remote photos, and upstream IDs. The repository includes Node and Docker self-hosting guides, CI, security documentation, and no runtime dependencies. This community project is not affiliated with, sponsored by, endorsed by, or an official product of Spectora.

After approval, replace this sentence with one canonical GitHub URL; do not create multiple mirrors or imply Spectora endorsement.
