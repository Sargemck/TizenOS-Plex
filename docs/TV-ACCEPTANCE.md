# TV acceptance checklist for 0.4.0

Version 0.4.0 was installed and exercised on the authorized test TV on 11 October 2026. See [hardware results and remaining checks](TV-RESULTS-0.4.0.md), including the unresolved subtitle observation. Desktop results do not prove Samsung AVPlay behavior, physical-remote feel, phone scanning or readability from a sofa. Obtain the owner's authorization before using a TV for future testing. Nothing in this checklist authorizes publication.

## Before testing

- Record the candidate version, package hash, TV model/firmware, app viewport, physical resolution and AVPlay version in a private report. The primary audience is 4K Samsung TVs; Samsung's UHD web-app viewport is normally 1920×1080, independently of video resolution.
- Record the existing version and preferences privately. Install in place using the same app identity and author certificate, without uninstalling. Confirm sign-in, server connection, profile preferences and existing library filters survive. Confirm new recent searches persist through a later in-place update or app restart as applicable.
- Leave the optional launcher preview off unless intentionally testing it. Do not include household addresses, account data, certificates or real-library screenshots in public test artifacts.

## The thirteen changes

| Item | Local evidence | Physical-device check still required |
| --- | --- | --- |
| 1. Remote-readable descriptions | `ux-browser.cjs`: open with directional keys/OK, scroll a long Japanese/Chinese description to its last and first lines, Back restores Read more and detail scroll. | Read the whole description using only the physical remote. Check visible focus, wrapping, scroll increments and the final line at normal/larger text. |
| 2. Unclipped navigation focus | `ux-browser.cjs`: each navigation button's complete outline fits all clipping ancestors, normal/larger text at two viewport sizes. | Inspect all four outline edges, including the first/last navigation button and horizontally scrolled navigation. Check from normal viewing distance. |
| 3. Consistent row artwork | `ux-browser.cjs`: mixed Home cards have aligned portrait frames; episode-only grids use shorter landscape frames including protected episodes. | Check mixed films/episodes, missing artwork, watched episodes and spoiler-protected episodes. No stretching/cropping, mismatched metadata baselines or oversized blank cards. |
| 4. Focused-title information | `ux-browser.cjs`: long CJK titles, year/episode context, spoiler safety, stable grid geometry, no focus-triggered requests. | Rapidly navigate long titles. Read the stable information area without opening details; check it matches the current card and never reveals protected episode titles. |
| 5. Watched indicators | `features.test.cjs`, `search-browser.cjs`: watched, partial, rewatch and unknown duration; PUT/Undo/Back and profile isolation. | Check badges/progress against Plex. Mark and undo watched status on a designated test title; restore its original state. |
| 6. Explicit filters | `search-browser.cjs`: readable labels match queries, survive restart and unavailable filter metadata; library/profile isolation and one Edit filters action. | Apply several filters, restart, switch libraries and clear one library. Confirm the explanation and displayed results agree. |
| 7. Symmetrical Home navigation | `home-browser.cjs`: column retention through full, short, empty, pending and failed rows; View all, Retry and Back. | Up/Down should follow content rows. Right past the last card reaches View all; Left returns to titles. Check fast/held input, visible focus and no trapped path. |
| 8. Parent playback submenus | `ux-browser.cjs`: More → Subtitle style → Size; Back and selection restore the correct parent, updated label and focus without Stop. | Adjust several subtitle settings without repeatedly reopening controls. Walk Back through each level while playing and paused. Stop must still require explicit confirmation. |
| 9. Compact empty Home rows | `home-browser.cjs`: delayed empty responses, focus/scroll anchoring, compact height and cancellation. | Navigate while delayed rows finish. Empty rows should become compact without moving a focused card/action underneath the user; failures must still offer Retry. |
| 10. Recent searches | `features.test.cjs`, `search-browser.cjs`: five-item history, Unicode, deduplication, submission versus focus, restart, scope and Clear history. | Submit Latin/Japanese/Chinese searches with the TV keyboard. Select a recent search with OK; focusing it must not submit. Check profile isolation and clearing. |
| 11. Activation feedback | `ux-browser.cjs` plus existing playback/recovery suites: pressed state, immediate loading text, rapid/held OK, one operation, cancelled/failed requests. | Slow an app-local request and press OK repeatedly. Confirm clear feedback, no duplicate playback, usable Back/cancel and recovery after failure. |
| 12. Playback context | `ux-browser.cjs`, `features-browser.cjs`: remaining time, pause/seek, selected audio, native/external/off/unknown subtitles and conversion/burn-in labels. | Compare the context with the actual heard audio, visible subtitles and current position. Check direct playback, audio conversion and burned subtitles. Unknown metadata must remain unconfirmed. Finish-time estimates remain deferred. |
| 13. Local QR pairing | `qr.test.cjs`, `qr-browser.cjs`: fixed public URL, quiet zone, independently decoded rendered images at four sizes and no requests. `ux-browser.cjs`: readable code, cancellation and expiry remove the panel. | Scan with phones from normal sofa distance in typical lighting. Confirm it opens `https://plex.tv/link`, enter the separate displayed code, and verify readable URL/code remain a usable fallback. |

## Playback and performance gates

- Use a normal direct-play title, a file needing audio conversion and a 4K title with Japanese or Chinese subtitles. Recheck 4K output, separate native-video-plane alignment, caption positions, menu bounds and six-column browsing in both text modes. Use only the app's local failure injection for fault tests; do not disrupt the household network.
- Exercise safe Back/Stop, all six seek choices, Timeline confirm/cancel, track switching, resume, recovery, manual Next Episode and natural completion. Nothing may autoplay or interrupt credits. Check that abandoned attempts leave no conversion session running.
- Run a sustained playback session and recheck browsing afterward. Watch for buffering, subtitle drift, leaked cards/requests, poster reloads and degraded remote response.
- Compare the previous client and candidate under the same TV/network/title/track conditions. Record startup to usable content, button-to-focus response, Play to first visible frame and seek to moving video. Compare against the official Plex app only when the owner is available to operate it. Repeat runs and distinguish conversion from original playback.
- Desktop performance uses the same mock latency, CPU throttle and seven-load sampling as the saved baseline. It checks startup requests, navigation and mocked readiness; it does **not** measure real poster transfer, dropped frames or native first-frame latency.

## Finish the session

Restore preferences, watched state and test filters/history changed for testing. Stop playback and confirm cleanup. Record each item as passed, failed or unverified, including observable timing outliers. Keep the signed package, private logs, credentials, account/library screenshots and certificate files out of Git. A failed or incomplete hardware check must not be presented as tested-device support.
