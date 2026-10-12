# Contributing

TizenOS Plex is a development-preview client targeting Tizen 5.0 and later. Changes should preserve responsive remote navigation, accessible text, explicit playback decisions and the ability to update without losing setup.

## Before making a change

- Read the [architecture](docs/ARCHITECTURE.md) and relevant release/device notes.
- Keep runtime syntax and APIs compatible with the Tizen 5.0 / Chromium 63 baseline. A passing current-Edge test alone is insufficient evidence of TV support.
- Keep work bounded: cancel abandoned requests, scope saved data by server/profile and avoid startup requests for features that are not open.
- Preserve application/package IDs and storage keys. New packaged files require deliberate updates to the installer's allowlist and package tests.

The stable application ID is `TizenPlex1.TizenOSPlex`, package ID `TizenPlex1`, and widget ID `https://tizenosplex.local/app`. Earlier prototypes with a different identity are not migrated or removed.

## Verification

Follow the [README development setup](README.md#development-and-verification). Run `npm test`, `npm run check` and the relevant browser suite while developing, then the full browser suite before proposing runtime changes. Add regression coverage for observable defects and meaningful failure paths. Check normal/larger text, long Japanese/Chinese text, focus restoration and screen bounds when changing UI.

Use `npm run test:performance` for changes affecting startup, browsing or playback preparation. Describe the baseline, environment and limits; neither mocked readiness nor AVPlay's ready callback measures visible smoothness. Use `npm run test:qr` when modifying pairing or QR rendering.

TV testing requires access to a development-enabled device and your own signing profile. Record the model, firmware, Tizen/AVPlay versions and what was actually observed. Distinguish injected key events from physical-remote testing, and restore test preferences/progress where possible. Never operate someone else's TV or mutate their server just to reproduce a report without permission.

## Reports and pull requests

Describe the problem, resulting behavior and validation. For bugs, include concise reproduction steps and whether the problem occurs on a TV or in desktop tests. For media issues, codec/container names are more useful than personal library screenshots. State what remains untested.

Keep fixtures synthetic. Do not include Plex tokens, PINs, server/account exports, local IPs, certificate files, signed packages, real-library captures or private logs. Review staged content and Git history, including author email addresses. For suspected credential exposure or another vulnerability, follow [SECURITY.md](SECURITY.md).

Preserve third-party notices. Contributions are provided under the project's MIT license; bundled fonts retain their separate SIL Open Font License.

Font generation is optional development work; runtime fonts are bundled. `tools/build-font.py` uses fonttools/brotli to create a weight-500, renamed derivative from the upstream font. Its `--supplement` mode selects common Han characters missing from the Japanese base. Keep the source license, validate glyph coverage and avoid changing the licensed font notices when regenerating assets.
