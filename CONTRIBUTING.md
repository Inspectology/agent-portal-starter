# Contributing

## Setup

Use Node.js 20 or newer and the npm version declared in `packageManager`.

```bash
npm ci
npm test
npm run check:syntax
npm run scan:public
npm audit --omit=dev
```

Demo mode must remain the default and require no credentials. Use only synthetic fixtures. Never commit `.env` files, credentials, portal links, customer records, screenshots, databases, exports, or report URLs.

## Changes

1. Open a focused issue before a large change.
2. Use RED–GREEN–REFACTOR for behavior changes and preserve the failing/passing evidence in the pull request.
3. Update threat-model and configuration documentation when boundaries change.
4. Run every command above before submitting.
5. Keep runtime dependencies at zero unless maintainers explicitly accept a dependency and its audit burden.

Pull requests must explain privacy effects, tests, and deployment implications. By participating, you agree to `CODE_OF_CONDUCT.md` and license contributions under MIT.
