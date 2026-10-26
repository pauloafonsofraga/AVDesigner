# October 26 Factory Additions

Added two finished devices from `wirenexus-device-library (1).json`:

- Lightware MX8x8DVI-HDCP-Pro: 19 connectors, original faceplate, thumbnail and independent backplate.
- DVI to HDMI: two-connector adapter, retaining its authored adapter geometry.

Source SHA-256: `e44f50a8e5ed2bcef35df12d562a2adf39504de5404a203b94eee4e763eafcbd`.
The unnamed `custom-device-mvp2rr5g` draft is intentionally excluded. All 128
existing devices and all shared node definitions remain byte-for-byte unchanged.
No existing project snapshots or personal overrides are rewritten.

Imported through the existing reviewed factory-promotion validator and atomic
importer. Three content-addressed PNG assets preserve the original source bytes;
no artwork is resampled. Inventory, receipt identity, source fingerprints and
artwork hashes are recorded in `test/fixtures/factory-library-2026-10-26.json`.

Focused regression coverage: `test/factoryLibraryOctober26.test.mjs` verifies
the two additions, unchanged existing definitions, dependencies, exact authored
geometry, adapter classification and original faceplate/backplate bytes.
No deployment or release tag is part of this change.
