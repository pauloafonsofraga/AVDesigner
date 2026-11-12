# SFP and QSFP optical profiles

The module picker keeps the existing generic options and adds named optical
profiles. Cages describe physical fit, not host support. A named module is
verified for the host only when the connector declares support for that profile
or provides matching host/platform and rate data. The link inspector and cable
preview distinguish compatible, incompatible, and unverified links; unverified
links remain drawable. A display-only fibre colour is not a declared fibre type.

| Profiles | Form factor | Optical connection | Reference |
| --- | --- | --- | --- |
| 1000BASE-SX / LX | SFP | Duplex LC; SX multimode 850 nm, LX single-mode 1310 nm | [Cisco 1G SFP](https://www.cisco.com/c/en/us/products/collateral/interfaces-modules/gigabit-ethernet-gbic-sfp-modules/datasheet-c78-366584.html) |
| 10GBASE-SR / LR | SFP+ | Duplex LC; SR multimode 850 nm, LR single-mode 1310 nm | [Cisco 10G SFP+](https://www.cisco.com/c/en/us/products/collateral/interfaces-modules/transceiver-modules/data_sheet_c78-455693.html) |
| 25GBASE-SR / LR | SFP28 | Duplex LC; SR multimode 850 nm, LR single-mode 1310 nm | [Cisco 25G SFP28](https://www.cisco.com/c/en/us/products/collateral/interfaces-modules/transceiver-modules/datasheet-c78-736950.html) |
| 40GBASE-SR4 / LR4 | QSFP+ | SR4 multimode MPO-12 at 850 nm; LR4 duplex single-mode LC at 1271/1291/1311/1331 nm | [Cisco 40G QSFP+](https://www.cisco.com/c/en/us/products/collateral/interfaces-modules/transceiver-modules/data_sheet_c78-660083.html) |
| 100GBASE-SR4 / LR4 | QSFP28 | SR4 multimode MPO-12 at 850 nm; LR4 duplex single-mode LC at 1295/1300/1304/1309 nm (rounded) | [Cisco 100G QSFP28](https://www.cisco.com/c/en/us/products/collateral/interfaces-modules/transceiver-modules/datasheet-c78-736282.html) |
| 3G-SDI TX / RX, 12G-SDI TX / RX | Optical SDI SFP-family modules; 12G offered on SFP+ and SFP28 cages | Directional simplex LC, single-mode, nominal 1310 nm | [AJA FS8](https://www.aja.com/products/fs8), [Embrionix 3G](https://www.embrionix.com/en/product/subfamily/3g-hd-sd-asi-sdi-optical-emsfp), [Embrionix 12G](https://www.embrionix.com/product/subfamily/uhd-12g-sdi-emsfp) |

Profiles describe nominal rates, technologies and wavelength pairings; they do
not infer dual-rate operation or product-specific receiver ranges. A declared
receiver range can rule out an out-of-band transmitter. Unequal nominal
wavelengths alone are unverified rather than rejected. LX over legacy multimode
with a mode-conditioning patch cable is not modelled by the named LX profile.

A compatible result is a match of declared capabilities, not a hardware
guarantee. Check vendor host support, SDI pinout, FEC, fibre grade/reach, MPO
polarity and optical loss separately. No breakout, lane routing, AOC or optical
power-budget calculation is introduced.
