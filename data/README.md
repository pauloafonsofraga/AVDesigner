# Factory Catalogue (Stage 1)

`factory-catalogue.json` is the repository-owned factory source. The application
fetches this file from its own deployment, never from GitHub. Do not restore an
inline copy in `index.html` or use browser/project data to regenerate it.

## Ownership and Readiness

- `devices`: 81 committed device definitions, in the original order.
- `nodeTypes`: 70 base node records, including hidden aliases/cages.
- `nodes`: the 58 authored factory palette records, applied over the base records
  exactly as before (73 effective types, including the three custom nodes).
- `nodeTags` and `nodeThumbnails`: existing default metadata and artwork mappings.
- `assets`: unique SHA-256 artwork identities, repository paths, actual MIME types
  and byte lengths. `libraryThumbnails` can hold derived previews separately from
  authored definitions; no missing factory thumbnails needed generating here.

`src/factoryCatalogue.js` validates and deeply freezes a detached catalogue.
`src/factoryCatalogueBootstrap.js` is the single initialization gate. The classic
application script executes only after successful loading. `wireNexusReady` is its
shared readiness promise, including the existing shell/editor/Engine initializers.
On catalogue failure the app remains inert, does not initialize
storage/persistence, and offers Retry. The factory remains immutable; project and
editor libraries are clones. Defaults controls and promotion behavior are unchanged.

## Artwork

All 208 unique images were already present as byte-identical **tracked** repository
assets. Reuse those files; no untracked user files were imported. Identical artwork
references now share a canonical existing path and SHA-256 identity. The unused
29-image Power Distro inline fallback was removed; the existing artwork files and
rendering rules remain. No original image was resampled or re-encoded.
Treat these referenced files as immutable. New/replacement factory artwork should
use `assets/factory/<sha256>.<actual-format>` and a new manifest entry, not overwrite
an existing asset locator. Reuse an existing identity when the bytes already match.

All 72 factory definitions with faceplates already have separate curated crops.
These crops remain byte-identical. The existing Device Editor import path generates
bounded 240 x 140 thumbnails for new artwork. Future factory artwork must include a
separate thumbnail (or a derived `libraryThumbnails` entry); validation enforces it.
An IntersectionObserver requests library, node and PD thumbnail artwork only as
entries become visible. Generated adapter/breakout thumbnails are unchanged.
Engine artwork sources no longer include unused library thumbnails. Texture budgets,
faceplate geometry, project LED originals, and personal logos are unchanged.

## Portability and Failures

HTML/Publish still use `outputAssetSources` / `inlineOutputAssets` over the complete
resolved Engine scene, including offscreen objects, with one asset-map entry per
external source. Thumbnails deliberately used as rendered artwork are included;
library-only thumbnails and unused factory devices are not. Publish uses the same
bundle and scene signature as the downloaded viewer. PDF keeps its Engine SVG path.

`src/imageAssets.js` fetches image bytes without canvas decoding/re-encoding, detects
the actual format, verifies factory checksums, and shares concurrent fetches. Missing,
non-image or changed required assets reject the operation with a specific error;
failed fetches can be retried, never silently exported as broken paths.

Saved `.avd` files use the existing schema with inline artwork. A detached snapshot
keeps every used definition (including racks and pair dependencies), every changed
factory definition, and every user-created definition, even if unused. Only untouched,
unused factory entries are omitted; the existing load merge restores those from the
installed catalogue. Used/saved appearances do not depend on later factory changes.
Node artwork, cards, overrides, image objects, LED images and personal logos are all
covered. Library JSON downloads are portable too. Native file writing begins only
after all required assets succeed; the file picker still runs in the user gesture.

## Extraction Audit

Baseline: `82152347d7fa4964dfb296582542025df6ad256a`, build 54.38.16.
Release: 54.38.17, Factory Catalogue and Artwork.

`factory-catalogue-extraction.json` is a checksum inventory, not another definition
source. It records counts, IDs/order, each complete normalized device hash and all
original artwork hashes. Normalization replaces only image references with hashes
of the actual image bytes. Every other value, including coordinates, dimensions,
cards, relationships, lenses, pairing and custom node metadata, is compared exactly.

```sh
node scripts/factory-catalogue-validation.mjs
# Optional historical comparison when the baseline commit exists locally:
node scripts/factory-catalogue-validation.mjs --compare-baseline
node --test test/factoryCatalogue.test.mjs
node scripts/factory-catalogue-smoke.mjs
```

The browser harness uses the same Playwright/Chrome environment variables as the
existing smoke scripts. It tests the real library/pair drag, offline HTML, offscreen
artwork, save/reopen with device asset requests blocked, failed catalogue recovery,
and missing required artwork. Screenshots and measured resource bodies go to a
temporary artifact directory printed by the script.

## Measured Results

Fresh Chromium context, 1800 x 1100 viewport, local uncompressed HTTP server, empty
project, sampled two seconds after Engine/settings readiness. These are raw encoded
body bytes, not a claim about compressed production transfer or total startup time.

| Metric | Before | After |
| --- | ---: | ---: |
| index.html bytes | 5,253,805 | 1,435,527 |
| external catalogue bytes | 0 | 3,851,304 |
| resource requests (excluding document) | 97 | 84 |
| catalogue artwork requests | 20 | 2 |
| catalogue artwork bytes | 227,301 | 23,971 |
| total document + resource bytes | 8,349,648 | 8,188,625 |
| eagerly requested full factory faceplates | 0 | 0 |

The catalogue is now independently loadable/cacheable; it is not smaller device
data. The meaningful artwork saving is visibility-based loading, not compression of
originals. The focused three-device portable fixture produced a 1,372,084-byte `.avd`
and a 1,056,359-byte offline viewer with the formerly offscreen E2 faceplate embedded.

Validation also exercised Defaults/edit/reset in two tabs, Engine and Legacy app
startup, offline/hosted viewers (representative, 100-device, 400-device projects),
company branding, actual vector PDFs and multipage reports. Hosted authentication
was simulated locally; no production deployment or live publish was performed.
