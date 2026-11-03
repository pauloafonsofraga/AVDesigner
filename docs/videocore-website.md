# Phase C: VideoCore website and product integration

The marketing site lives separately in `website/`. It does not replace the root
WireNexus entry, designer, authentication, APIs or runtime asset allowlist.
Squarespace, Vercel and Google Cloud configuration are unchanged. Nothing is
deployed and no DNS, account, registration or production settings are changed.

Pages: `index.html` (VideoCore, two featured products and About Paulo Fraga),
`wirenexus.html`, `ledforge.html`, and `pricing.html` (WireNexus plans only).
`website/config.js` provides a small product catalogue for future products and
the app link shared by all WireNexus actions. Neither product is assigned an
invented release date, price or download URL.

## Personal brand positioning

VideoCore is Paulo Fraga's professional brand and the home of his AV software,
not an advertised full-suite event-services company. The About section uses only
the provided professional video engineering background and its connection to the
tools. No years, clients, qualifications, team members or project credits are added.
The existing logo is unchanged. Dark neutral surfaces, cyan-blue accents and
consistent navigation/type/spacing apply across both product pages and plans.
The public Squarespace page was inspected read-only for visual context; its
services/cart/team template copy is not reused as biography or product evidence.

The owner confirmed that the local `led_screen_tool` project is LEDForge. Product
copy is limited to verified README capabilities: layouts, panel specifications,
calculations, local projects and 3D dimensions, with geometry/data limitations.
No development mock licence terms are presented as commercial entitlements.
LEDForge imagery is copied byte-for-byte from these synthetic development captures:

- `debug_dumps/phase28c_screen_size/03_valid_120_panels.png`
- `debug_dumps/phase24b_navigation_cube/01_default_iso.png`

The source project and screenshots remain untouched. Captions identify development
test data, including the mock licence indicators. WireNexus login does not confer
LEDForge access; no LEDForge launch/download target is created.

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

The personal-brand follow-up passed all 2,320 repository tests (zero failures or
skips), all 16 validators, the standalone website build and both website and
Account/dashboard browser smoke tests in an isolated staged tree. The four pages
were checked at widths 320, 390, 900, 1440 and 1920, including product navigation,
About anchors, menu behavior, image loading and the separate login handoff.
Both LEDForge image copies were hash-verified against their untouched sources.

Original Phase C validation passed all 2,318 repository tests (zero failures/skips),
all 16 static validators, and both website and Account/dashboard browser smoke
tests. Website screenshots and overflow/hero-spacing checks cover widths 320,
390, 1440 and 1920. The static build and its isolated contents are tested.
Protected original artwork, Masters, backups and unrelated edits are excluded.

`node --test test/videocoreWebsite.test.mjs` checks URL safety, content boundaries,
semantic entry and isolated build contents. `node scripts/videocore-website-smoke.mjs`
checks all pages at desktop/mobile widths, assets, links, menu and FAQ controls,
and navigation to the existing standalone login using local Auth configuration.
No remote authentication, staging acceptance or deployment is performed.
