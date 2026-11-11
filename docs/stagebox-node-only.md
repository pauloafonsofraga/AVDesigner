# Passive Stagebox / Snake canvas

The approved node-only prototype is implemented through the Engine's existing
Stagebox projection. Generated ends use the real connector anchors: a compact
grid, adaptive rings, or outward fanout. The outline and fanout tails are
visual only. The thin rims and zoom-scaled port badges apply only to passive
Stagebox ends.

The projection keeps stored connector and anchor IDs, channel mappings, end
offsets and artwork. Generated coordinates are not written to project or
device definitions. Uploaded faceplates and layouts with multiple authored
anchors per connector keep their authored geometry. Definitions beyond 100
visible connectors also keep their existing anchor geometry rather than
dropping nodes.

Stored mappings take priority. Without an explicit mapping for either port,
an unambiguous match requires the same authored channel name and connector
type and opposite directions. The match is derived without rewriting the
definition or inferring contact/pin assignments. A cable on a multipin
connector that can refer to several stored channels cannot identify one
channel by itself; hover and Play Cable stop at that connector.

Canvas highlighting and Play Cable use the same indexed mapping, including
reverse paths. Playback uses a single continuous polyline; arcs and tails
are not new cables. Existing cable schedule, saved document and topology
command formats are unchanged. The read-only viewer uses the same trace,
and SVG/PDF artwork uses the same outlines, tail gradients and badges.

For local verification, serve the working tree and its unmodified baseline
on separate loopback ports and run `scripts/stagebox-node-only-browser-smoke.mjs`.
It uses the usual `AVDESIGNER_PLAYWRIGHT_PATH` and `AVDESIGNER_CHROME_PATH`
overrides and writes screenshots and a synthetic project outside the repository.
