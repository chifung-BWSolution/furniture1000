# Quotation PDF fonts (self-hosted)

`QuotationPDFPreview` downloads gzip-compressed complete TC TTFs, plus small HK fallback
fonts containing **all** HK code points absent from TC. Both weights keep exactly
the same combined Unicode coverage as the original full TC/HK TTF pair.

These are served from the same origin as the app (`/fonts/pdf/...`) so preview
works in mainland China and non-Chrome browsers without depending on
`fonts.gstatic.com`.

The full TTFs remain the source files and network fallback. Do **not** replace TC
with a language subset. `scripts/build-quotation-pdf-fonts.py` builds the versioned
assets and asserts full Unicode coverage for both weights. Native browser gzip
decoding restores the original TC TTF byte for byte before PDF font registration;
browsers without native decoding use the original TTF directly. Do not pass WOFF
or WOFF2 directly to the PDF renderer: rendering and embedding need separate checks.
Regenerate with `python scripts/build-quotation-pdf-fonts.py` (requires `fonttools`).
Change the asset version when regenerating changed sources because these URLs
have immutable HTTP caching.

Source: Google Fonts / Noto (SIL Open Font License 1.1).
