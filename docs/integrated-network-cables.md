# DAC and AOC cable assemblies

| Type | Nominal Ethernet rate | End and host cage |
| --- | --- | --- |
| SFP+ DAC / AOC | 10G | SFP+; the SFP+ AOC also fits SFP28 cages when the host supports it |
| SFP28 DAC / AOC | 25G | SFP28 |
| QSFP+ DAC / AOC | 40G | QSFP cage supporting QSFP+ and 40G |
| QSFP28 DAC / AOC | 100G | QSFP cage supporting QSFP28 and 100G |
| Legacy QSFP DAC | Not inferred | Existing QSFP cage profile; use declared rates |

Vendor examples: [Cisco SFP+](https://www.cisco.com/c/en/us/products/collateral/interfaces-modules/transceiver-modules/data_sheet_c78-455693.html),
[Cisco SFP28](https://www.cisco.com/c/en/us/products/collateral/interfaces-modules/transceiver-modules/datasheet-c78-736950.html),
[Cisco 40G QSFP+](https://www.cisco.com/c/en/us/products/collateral/interfaces-modules/transceiver-modules/data_sheet_c78-660083.html),
and [Cisco 100G QSFP28](https://www.cisco.com/c/en/us/products/collateral/interfaces-modules/transceiver-modules/datasheet-c78-736282.html).
These are symmetric, integrated Ethernet assemblies. Their ends go directly
into the equipment cages; AOC does not expose an LC or MPO patch socket.

Choose the same assembly profile on both cages using the module picker, then
draw the cable. It has one route, length, cable ID and schedule entry. Replug
to another matching, free cage without changing the physical cable. Disconnect
before replacing an installed end with a different profile. A Loom may route
the cable without splitting it into additional physical cables; Jump Nodes,
Multi-Core ports and detachable connectors cannot terminate it.

The cable remains **Unverified** when host support, rates, or saved assembly
details are missing. Contradictory declarations are **Incompatible**. Opening
older files does not rewrite their assembly records or invent a QSFP rate.
**Compatible** means the declared capabilities agree, not that a vendor
certifies the cable. This phase does not verify FEC, reach, vendor locks or
breakout/lane configurations.
