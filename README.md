# TizenOS Plex

A lightweight, unofficial Plex client for Samsung Tizen TVs. Browse a local Plex library with the remote, choose your audio and subtitles, and watch through Samsung's native AVPlay player.

**0.4.3 · development preview · Tizen 5.0 baseline.** Intended for Samsung TVs running Tizen 5.0 or later, with 4K TVs as the primary target. Version 0.4.3 is the current source candidate; the tested TV has 0.4.2 installed. Tested support is narrower; see [compatibility](#compatibility-and-status).

## Features

- **Content-first Home:** Continue Watching and recently added films/shows, with two complete rows of nine posters. Libraries scroll continuously, retain your position and remember filters, sorting and recent searches.
- **My List:** save movies and shows for later. Labelled **Saved on this TV**, with up to 100 titles per server/profile. This is a local list, separate from Plex's cross-device Watchlist.
- **Series navigation:** explicit Continue, remembered season/episode positions, All episodes and per-show language preferences. Choose what to play after an episode finishes. **No autoplay, countdown or automatic credit skip.**
- **Deliberate playback controls:** Back closes menus before asking to stop. Left/Right previews a seek position; OK jumps and Back cancels. Frame thumbnails appear when Plex has generated them; timestamp preview works without them.
- **Readable subtitles:** Japanese/Chinese font coverage, adjustable text size, contrast and position, plus audio/subtitle selection. Image subtitles use Plex conversion and have different styling limits.
- **Progress and recovery:** resume or start over, reset progress with Undo, mark watched/unwatched, and explicitly retry failed playback from the last reported position.
- **Local-network playback:** direct play where supported, video-preserving audio conversion when possible, and bounded compatibility fallback. The information panel distinguishes source formats from reported playback decisions.
- **Remote-focused accessibility:** visible focus, larger interface text, scrollable descriptions, spoiler protection and consistent parent-menu navigation.

The runtime uses plain JavaScript, HTML and CSS, with no framework or runtime npm dependencies. Browsing uses bounded requests and virtualized grids; saved-title metadata and series recommendations load when opened. See the [architecture](docs/ARCHITECTURE.md) for implementation decisions.

## Compatibility and status

| Environment | Evidence |
| --- | --- |
| Samsung Q90R (2019), Tizen 5.0, AVPlay 4.1 | Installed and smoke-tested through **0.4.2**. Its in-place update preserved saved app data. Two complete film rows, My List and series navigation were checked on the TV. Earlier 0.4.0 hardware tests covered direct/converted playback, subtitles, seeking, navigation and recovery. |
| Other Samsung TVs running Tizen 5.0 or later | Intended support; not yet tested. Codec, HDR, audio and subtitle behavior depend on model, firmware and receiver. |
| Tizen earlier than 5.0 | Outside the initial baseline. |

The interface uses a logical 1920×1080 canvas, independently of native video resolution; supported 4K playback was exercised on the test TV. Current desktop tests supplement, but do not establish, compatibility with Tizen 5.0's Chromium 63 engine.

**Known limits before trying it:**

- One startup/seek sequence displayed the wrong subtitle language despite the selected-track report. Reselection recovered it and repeated checks passed, but the cause remains unresolved. See the [subtitle observation](docs/TV-RESULTS-0.4.0.md#open-subtitle-observation).
- Physical-remote acceptance of the latest features, real thumbnail checks, phone QR scanning and a controlled official-app performance comparison remain open. Native readiness timings are not first-visible-frame or smoothness measurements.
- Playback uses the first media version of a single-part file. Media-version selection, multipart playback, multi-server browsing and remote relay streaming are not implemented.
- The optional Samsung launcher preview is experimental, off by default and **unavailable on the tested TV**, which reports no background-service support. The in-app Home screen is independent of it.

Read the [0.4.3 release review](docs/RELEASE-0.4.3.md), [0.4.2 release notes](docs/RELEASE-0.4.2.md), [0.4.1 changes](docs/RELEASE-0.4.1.md), [hardware results](docs/TV-RESULTS-0.4.0.md) and [TV acceptance checklist](docs/TV-ACCEPTANCE.md) for evidence and outstanding checks. No claim of performance superiority to the official Plex app is made.

## Install on Windows

You need a local Plex Media Server, a supported Samsung TV in Developer Mode, and a Windows PC on the same network. Node.js is needed for development checks, not for building with the Tizen SDK.

1. Clone or extract the source and open the folder containing this README, `Install-TV.ps1` and `app/`.
2. Install [Tizen Studio and the Samsung TV SDK](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html), including **Web CLI**, **Samsung TV Extension** and **Samsung Certificate Extension**.
3. In Certificate Manager, create a [Samsung TV signing profile](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html). Include your TV's DUID in its distributor certificate. **Public** is an application privilege level; it does not publish your certificate, password or application. Store certificates and backups outside this repository.
4. Enable TV Developer Mode with this PC's local IPv4 address and reboot if requested. Connect in Device Manager and use **Permit to install applications**.
5. Review the installer, then run PowerShell from the project folder:

   ```powershell
   .\Install-TV.ps1 -TvAddress 192.168.1.40 -CertificateProfile 'YourProfile'
   ```

   Replace the example address/profile. For a different SDK location, add `-TizenStudio 'D:\tizen-studio'`. To build and sign without contacting the TV, use `-BuildOnly -CertificateProfile 'YourProfile'`. The generated package is `dist/TizenOSPlex.wgt`.
6. Open the app and choose **Link Plex and find server**. Scan the QR or visit [plex.tv/link](https://plex.tv/link) and enter the displayed code. The locally rendered QR contains only that public URL, never the code or credentials. Manual setup is available: enter the server's network address, such as `http://192.168.1.20:32400`, not `localhost`, `127.0.0.1`, the TV address or `/web`.

Keep the server running and its PC awake. This local setup needs no router port forwarding. Use a working HTTPS server address if encrypted local transport is required; the app does not weaken Plex's secure-connection policy. If Windows blocks the downloaded script, review it before using `Unblock-File .\Install-TV.ps1`; respect managed execution policy.

### Updating

Stop playback, then rerun the installer with the **same author certificate and application identity**. Updates are manual and in-place; the installer does not uninstall first or alter unrelated TV apps. Saved sign-in and preferences survived the tested update to 0.4.2. Uninstalling, clearing app data, revoked credentials or losing the signing certificate can require setup again.

The installer validates its target and signing profile, rejects unexpected source files and filesystem links, checks the Tizen baseline and signed archive contents, then installs only this app. Never distribute signing material with the source.

## Using the remote

| Control | Action |
| --- | --- |
| D-pad / OK | Move focus / activate |
| Back during playback | Return through menus, hide controls, then ask whether to stop; **Keep watching** is selected |
| Left / Right with controls hidden or timeline focused | Preview a seek position; **OK commits, Back cancels** |
| Up / Down on Home | Move between rows while retaining the column |
| Right at a Home row's last card | Reach View all |
| Next episode | Ask before playing the next episode; never automatic |

See the [playback and remote guide](docs/USER-GUIDE.md) for all controls, subtitle limits, conversion tradeoffs and optional launcher-preview privacy.

## Development and verification

Use **Node.js 20 or later** and an installed Microsoft Edge. Installer tests require Windows. Test media, credentials and server responses are synthetic; running these tests does not operate a TV.

```powershell
npm ci
npm test
npm run check
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm run test:browser
npm run test:performance
```

Unit/installer tests cover transport, credentials, selection logic, cancellation, playback lifecycle and package hygiene. Fifteen browser suites exercise remote navigation, layout, playback mocks, local lists, series flow, account cleanup and failure recovery. The performance harness uses controlled desktop mocks; optionally set `PLEX_BENCHMARK_BASELINE` to an older extracted `app` folder for comparison.

To independently decode browser-rendered QR images, install the development-only Python dependency and run:

```powershell
python -m pip install opencv-python-headless
npm run test:qr
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for change and test expectations, and [architecture](docs/ARCHITECTURE.md) for module responsibilities. New-device reports should include model, firmware, Tizen/AVPlay versions and reproducible observations, with personal data removed.

## Privacy and source hygiene

Credentials stay in TV app storage, which this app does **not encrypt**. Profile scoping prevents accidental mixing, not access by someone with developer control of the TV. Plex Home PINs are sent over HTTPS and never saved. Local HTTP streaming and API traffic are unencrypted. Confirmed sign-out clears credentials and this TV's saved lists, history and preferences across profiles; Plex server watch progress remains unchanged. Revoke the device in Plex if needed. There is no analytics integration; diagnostics redact secrets and playback URLs.

My List, recent searches and browsing preferences are local to the TV and scoped by server/profile. The optional launcher preview can expose titles/posters outside the app and is opt-in; cached launcher titles may remain until expiry. Read its [privacy limits](docs/USER-GUIDE.md#samsung-home-preview-experimental) before enabling it on a supported device.

`.gitignore` excludes credentials, certificates, local configuration, diagnostic captures, build output and signed packages. Ignore rules do not remove already-tracked data: review staged files **and history**, including commit identities, before publishing a fork. See [SECURITY.md](SECURITY.md).

## License and attribution

Project code, documentation and launcher icon are licensed under the [MIT License](LICENSE), copyright 2026 Baris. Bundled Japanese and Han fonts derive from [Noto Sans JP](https://github.com/google/fonts/tree/main/ofl/notosansjp) and [Noto Sans SC](https://github.com/google/fonts/tree/main/ofl/notosanssc) and retain their separate [SIL Open Font License](app/font-license.txt). Development dependencies retain their own licenses.

TizenOS Plex is an independent project, not affiliated with or endorsed by Plex or Samsung. Plex, Samsung and Tizen names identify the systems it interoperates with.
