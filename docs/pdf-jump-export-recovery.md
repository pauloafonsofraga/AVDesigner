# PDF Jump Export Recovery

Build 54.38.129, starting from `c82b8d31c3bfde5f390d93655db3c0bda90f14f6`.

## Cause

PDF generation renders Jump labels before downloading the file. A Jump's local endpoint can have no device connector, including Jump-to-Jump spans and unresolved endpoints. The module lookup accepted undefined through a default parameter but still dereferenced an explicit null. The resulting exception stopped PDF creation:

```text
TypeError: Cannot read properties of null (reading 'installedModule')
  at installedModuleCapabilities (src/engine/transceiverModules.js:69)
  at installedModuleDetailsForEngine
  at engineConnectorFiberMode
  at jumpInfoFromLocal
  at jumpNodeConnectionInfo
  at SceneGraph.jumpNodeConnectionInfo
  at drawJumpNodeInfoBox
  at drawEngineOutputLabels
```

Reproduced on the starting commit using `node scripts/engine-pdf-production-smoke.mjs`, and through the PDF options/Export buttons after opening the user's saved Lovin Dubai project in installed Google Chrome. A basic fully connected Jump fixture already downloaded successfully, explaining the project-dependent symptom.

## Repair

Both module value and capability readers treat null like an absent connector: no module, no fiber capability, and no granted connector compatibility. They do not alter project data or infer a missing connector.

Export failures now reopen the PDF options with an accessible visible error and enabled Export/Cancel controls. Failed PDF module fetches use a new URL on retry because Chrome caches rejected imports. Successful module imports retain their stable URL. PDF generation, artwork quality, page layout and Jump navigation remain on their existing paths.

The successful PDF still uses the existing browser download mechanism. A native Save As window depends on Chrome's download preferences; absence of that window alone does not mean an export failed.

## Verification

- Regression tests first reproduced the null failure, then passed after the repair: absent module/fiber lookup and complete PDF rendering of a Jump-to-Jump span.
- Full isolated repository Node suite: 1,858 passed. All 16 static validators and all three generated bundle checks passed.
- The previously failing production PDF smoke now passes all 23 cases with no artwork warnings, including dense, cross-page and page-size/navigation variants. The smoke assertions are unchanged.
- Chrome export/options/download test passes. A deliberately blocked PDF bundle displays the error dialog, creates no partial download, and succeeds on retry once the route is restored.
- The user's saved project exports a 3-page, 3,277,655-byte A3 PDF with its faceplates, LED PNGs and title block. Poppler opened and rendered the PDF, and the drawing page was inspected. Source project SHA-256 is unchanged.
- The original unfinished Device JSON Import patch and all 101 protected paths remain unchanged and excluded from this commit.

Reproduction with another local saved project:

```sh
AVDESIGNER_BASE_URL=http://127.0.0.1:8773 node scripts/engine-pdf-project-smoke.mjs /absolute/path/project.avd
```

Temporary evidence is under `/tmp/wirenexus-pdf-*.log` and the `wirenexus-project-pdf-*` / `wirenexus-pdf-browser-*` temporary directories printed by the scripts. No project data or exported PDF is committed.
