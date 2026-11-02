# Phase C: VideoCore website and product integration

The marketing site lives separately in `website/`. It does not replace the root
WireNexus entry, designer, authentication, APIs or runtime asset allowlist.
Squarespace, Vercel and Google Cloud configuration are unchanged. Nothing is
deployed and no DNS, account, registration or production settings are changed.

Pages: `index.html` (VideoCore), `wirenexus.html` (product and workflows),
`pricing.html` (Free/Paid/Enterprise structure, availability and FAQ).
`website/config.js` provides a small product catalogue for future products and
the app link shared by all actions. No other products or release dates are invented.

## Preview and build

Serve the repository root, then open `/website/`. By default all Launch/Sign In
links resolve to the existing sibling `index.html`, which restores the normal
session or shows standalone login. The marketing site never reads session storage
or calls Auth/RPC endpoints. There is no second login or registration form.

For a separate static build:

```sh
node scripts/build-videocore-website.mjs /tmp/videocore-site
```

The default build expects the same sibling app arrangement. For future separately
approved hosting, pass the approved absolute application URL as a third argument.
The bundle and static HTML app links use that URL. Do not point public visitors at
the operator-only staging service; no public app domain is assumed live. Static
HTML app-link fallbacks also work without JavaScript; the application itself
requires JavaScript. Serve the build over HTTP(S).

The builder requires a new output directory and copies only the marketing files
and imagery, not the designer, API code, account configuration or credentials.
No host integration, root rewrite, deployment pipeline or secret is added.

## Content boundaries

Plan structure follows the existing policy catalogue: cloud saving/history across
plans, publishing entitlements for Paid/Enterprise, teams for Enterprise. Quotas
remain configurable and are not advertised as fixed commercial promises. Prices,
checkout, SLAs and general availability have not been announced. Registration is
explicitly closed. Enterprise live collaboration is labeled private staging.
Any future commercial release needs a fresh copy/policy review.

The imagery is captured from the actual local Engine with the synthetic
`fixtures/website-preview.mjs` project, not customer data. Regenerate using
`node scripts/website-preview-assets.mjs` against a local server. The small logo
is a derived copy of `VideoCoreLogo.png`; the original remains untouched.

## Validation

The isolated staged tree passed all 2,318 repository tests (zero failures/skips),
all 16 static validators, and both website and Account/dashboard browser smoke
tests. Website screenshots and overflow/hero-spacing checks cover widths 320,
390, 1440 and 1920. The static build and its isolated contents are tested.
Protected original artwork, Masters, backups and unrelated edits are excluded.

`node --test test/videocoreWebsite.test.mjs` checks URL safety, content boundaries,
semantic entry and isolated build contents. `node scripts/videocore-website-smoke.mjs`
checks all pages at desktop/mobile widths, assets, links, menu and FAQ controls,
and navigation to the existing standalone login using local Auth configuration.
No remote authentication, staging acceptance or deployment is performed.
