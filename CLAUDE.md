# @systemoperator/domains

Custom domain verification for Cloudflare SaaS apps. Extracted from system operator internal tooling.

## development

- run tests: `npm test`
- build: `npm run build`
- publish dry run: `npm publish --dry-run`

## publishing

tag-based via GitHub Actions:
1. bump version in package.json
2. commit and tag: `git tag v0.1.0`
3. push tag: `git push --tags`
4. CI runs tests, builds, publishes to npm

NPM_TOKEN secret expires on May 22, 2026.

## code conventions

- TypeScript, ESM only
- zero runtime dependencies - everything uses fetch()
- works in Workers, Node, Deno, Bun
- no database dependency - users implement DomainStore interface
- keep files under 500 lines
