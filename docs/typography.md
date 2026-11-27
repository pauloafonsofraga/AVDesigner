# WireNexus typography

WireNexus uses [Cabin](https://fonts.google.com/specimen/Cabin) by Impallari Type and Rodrigo Fuenzalida under the [SIL Open Font License 1.1](../assets/fonts/OFL-Cabin.txt). The assets were derived from the [official Google Fonts source](https://github.com/google/fonts/tree/5026800714d07231937d92eb4cceabf06e05d74e/ofl/cabin) with FontTools 4.60.1. `ttLib.woff2 compress` preserves the complete upright and italic variable fonts; `varLib.instancer` with `wdth=100 wght=400` and `wdth=100 wght=700 --update-name-table` produces the static faces for PDF.

- The app preloads one upright WOFF2 (roughly 67 KiB); italic loads only when used. Both cover weights 400–700. Existing UI weight requests above 700 use Cabin Bold.
- Canvas, WebGL label textures and the print renderer use Cabin before their first measurement pass. Diagnostic fixed-width text and user-supplied artwork retain their own typography.
- Downloaded HTML and hosted Technician Viewer output include the font bytes and OFL notice. They never request the font from Google. Native PDFs embed subsets of Cabin Regular and Bold as vector text.
- XLSX workbooks request Cabin for editable cells and render Cable ID images in Cabin. A spreadsheet application without Cabin installed can substitute its default font for editable cells. CSV has no font information.
- Cabin covers Latin, extended Latin and Vietnamese. Browser views fall back to system fonts for unsupported glyphs; native PDF does not embed extra script-specific fonts.
