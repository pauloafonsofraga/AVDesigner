# Jump pair copying and real E2 card reordering

Build 54.38.138. Supersedes the previous blanket unpaired-copy rule when both members of an existing Jump pair are selected.

## Clipboard contract

- Copying one Jump without its peer creates an empty unpaired Jump.
- Copying both members preserves one pair link between the new Jump IDs, with a fresh link ID. No new link refers to an original Jump.
- Only pair relationships internal to the selection are copied, including historical `pairId` pairs. Links are device-independent because external device cables are deliberately not copied.
- Loom ownership, Multi-Core associations, device attachments and external cables are still removed before strict serialization. Originals are untouched. Duplicate clipboard payloads retain independent identities. Save/reopen and undo/redo retain the copied pair.

## Confirmed E2 defects

The actual factory E2 Gen2 reproduces a failed Connectors-tab reorder, unlike the earlier small acceptance chassis. At fitted zoom its lanes occupy fewer than 12 screen pixels. The generic target hysteresis imposed a 12-pixel minimum, so pointer position did not match the visible insertion position. Card dragging now uses the measured lane projection with a one-pixel minimum; other connector-drag defaults are unchanged.

The generic collision chain could include every contiguous card and push into fixed chassis connectors. Card reordering first closes the vacated source interval locally, using the existing placement-result and insertion validators. Where a raw pointer lane falls inside a differently sized card, preview can snap to a feasible card insertion boundary. Physical/locked bays and fixed chassis connectors remain reservations; device height, slot identities and card assignments do not change.

Save had a separate identity-resolution defect for wired, geometry-only card moves: the safety gate looked for the generated installed port among standalone connectors because the installed card definition had not changed. It now identifies the owning original card slot. Exact local-port identity, uniqueness, endpoint and compatibility checks remain in place. No cable remapping or wire deletion is authorized by a reorder.

## Verification

- Focused Node tests cover selected pair remapping, single/partial selections, legacy pairs, repeated paste, source immutability, cyclic/undefined runtime properties, copied owner isolation, packed rows against fixed chassis ports, mixed card heights and fitted zoom projection.
- `scripts/jump-card-followup-smoke.mjs` uses the actual factory E2 Gen2 with a cable attached to the moving input card: native fitted drag, swapped neighbors, ghost/target, unchanged fixed connectors/cards/IDs/height/cable, draft undo/redo, cancellation, Save, editor reopen, project undo/redo, project save/reopen.
- `scripts/editor-followups-smoke.mjs` exercises actual pair paste and undo/redo without changing original topology, followed by save/reopen. Existing Backplate, connected-card replacement, opposing field and export checks remain enabled.
- Existing dense card reorder acceptance, full isolated Node suite, 16 validators and generated bundle checks are run before commit. Screenshots of the actual E2 drag and result are reviewed.
- Original uncommitted Device JSON Import changes, protected artwork, backups and Masters files remain excluded and hash-checked. No deployment or release tag.
