# Hardware results: 0.4.0

Tested on 11 October 2026 after the owner authorized TV access. Nothing was published. This is a development-preview result, not complete release acceptance.

## Environment and method

Samsung Q90R (2019), Tizen 5.0, AVPlay 4.1; application viewport 1920 × 1080. Firmware could not be read through the app's permitted API. AVPlay reported 3840 × 1608 HEVC video for the 4K test file, independently of UI resolution.

The signed 0.4.0 package was installed over 0.2.6 without uninstalling. Its SHA256 is `B608D41D89D3D2A80A8D0C0D697406B1774302DF3D2705A4F6D8F7919AAA555C`. Every pre-existing app storage value survived unchanged.

Checks used the actual installed application, TV browser, AVPlay and local Plex server. Directional/Back events and button activation were injected through the debugger; this does not establish physical-remote feel. Faults and the long CJK description were injected only into this app. The server and household network remained available. Private evidence contains actual library data and is excluded from Git.

## Results

| Area | Observed result |
| --- | --- |
| Layout and navigation | Six 275-pixel cards fit across in normal and larger text, from x=80 to x=1840, without horizontal overflow. Every navigation focus outline fits its clipping ancestors. Settings Back returns to its parent. Sofa-distance readability still needs a person. |
| Descriptions and artwork | A synthetic 10,156-character CJK description scrolls to its end and returns to Read more with focus/scroll restored. Actual episode frames measure 16:9, including spoiler-protected episodes. |
| Focused titles and continuous browsing | Focused-title text follows the card. Six traversals retained at most 24 card nodes; sampled DOM count was 164 before and 166 after. Detail return restored the selected index and exact scroll position. This is a bounded sample, not a heap-leak proof. |
| Home rows | Up/Down restores the column; row-end Right reaches View all and Left returns. Failed rows recover through Retry. Delayed empty rows compact without moving focused actions. Leaving Home cancels pending work; late results do not replace the new library. |
| Search and filters | Readable filter labels, recent-query activation, CJK query preservation, clear history and usable empty results passed. Saved filters/history survived reload and rendered correctly afterward. An injected failed library chunk recovered through Retry. Protected-profile isolation remains desktop-only evidence. |
| Watched status and spoilers | Mark watched and Undo were verified against Plex on a test episode. Unwatched details remain protected until explicitly revealed. Original watched flags were restored. |
| Playback menus and exit | Subtitle size selection returns to the updated parent; Back restores parent and invoking-control focus. Audio/subtitle/seek/timeline menus close safely. Repeated Back does not stop playback. Stop defaults to Keep watching. Pause/Play labels agree with native state. Repeated Play activation opened one native session. |
| Playback and seeking | H.264/AC3 and 4K HEVC/E-AC3 direct playback passed. Plex confirmed video copy with audio conversion for a DTS file, and video/audio conversion with explicit PGS burn-in. All six seek choices and timeline cancellation passed. |
| Subtitle rendering and context | Japanese captions survived a 17-second pause and advanced after resume. Both Chinese tracks produced Han characters; observed 80-pixel captions fit above visible controls. Context showed selected audio/text, Off and burned-in subtitles. See the unresolved startup observation below. Visual single-layer confirmation in this session is still pending; earlier owner confirmations apply to 0.2.6. |
| Episode flow | Cancel/decline Next preserves playback; explicit Next starts the correct episode. Cross-season transition and final-episode handling passed. Natural completion caused neither a prompt during credits nor autoplay. |
| Recovery | An injected native connection error and failed metadata retry retained recovery UI; successful retry resumed within 5 ms of the captured checkpoint in that sample. Cancelling a pending retry aborted it and prevented late playback. |
| QR pairing | Local generation and independent image decoding passed before this session. Phone scanning, sofa-distance readability and a fresh account-pairing flow were not exercised on hardware; the existing sign-in was preserved. |
| Samsung launcher preview | This TV reports `web.service=false`. Settings explains unavailability and prevents enabling the personal preview. The in-app Home screen works. Other TVs' service launch, cached artwork and launcher links remain unverified. |

Samsung explicitly requires the background-service capability check before launching a personal preview service; bypassing it can interfere with foreground video. See [Samsung's Smart Hub Preview FAQ, Q13](https://developer.samsung.com/smarttv/develop/faq/smart-hub-preview.html). This observation applies to this tested device/firmware, not every Q90R or every Samsung preview implementation.

## Open subtitle observation

On one initial 4K start → Chinese selection → seek sequence, AVPlay reported Chinese selected while subsequent subtitle callbacks contained English. Reselecting tracks recovered Chinese output. Both Chinese tracks subsequently worked, including across seeks. A repeat of the startup sequence and three additional traced English-default → Chinese → seek runs passed; each traced run collected five Chinese cues and no non-Chinese cues, with no automatic selection overriding the explicit choice.

The original mismatch remains unexplained and is **not claimed fixed**. No speculative delay or track-reset workaround was added. A future reproduction should record native selection/silent/seek ordering and cue language, without credentials or full subtitle logs. Native selected-track metadata alone is insufficient evidence of the displayed language.

## Performance evidence and limits

- The first instrumented startup-to-library sample was 1,446 ms. A final warm page reload measured 97 ms. These have different cache/process conditions and are not a controlled comparison.
- The six-option seek sample completed in 1,112–4,239 ms. These are native callback timings, not time to the first visibly moving frame.
- A 224-second uninterrupted 4K sample recorded 448 progress callbacks, zero buffering starts and zero JavaScript errors. The maximum observed callback gap was 1,327 ms while diagnostic calls were active; this does not establish dropped-frame performance or freedom from visible stutter.
- The audio-conversion sample recorded 84 callbacks over about 42 seconds, no buffering starts and a 631 ms maximum callback gap. Previous longer 0.2.6 tests are separate evidence.
- Sampled grid key-handler execution was 1–59 ms, including presses at the final row that do not move focus. It is not painted-frame latency.

Physical held-key feel, first-visible-frame timing, official-app comparison, extended playback/subtitle drift, phone QR scanning and protected Home profiles remain unverified for this release. Performance superiority is not an accepted claim.

## Cleanup

The app was reloaded to remove temporary hooks and left signed in at Home with playback stopped. Final storage compared equal to the complete pre-test snapshot, including original preferences; test filters, searches, show overrides and recovery checkpoints were removed. The six played titles' original watched flags, exact resume positions and server track selections were restored. Test playback can still leave server viewing-history timestamps; historical records were not deleted. Plex reported zero playback or transcode sessions belonging to this app.

No runtime code changes were made during this session. Signed packages, credentials, backups and actual-library test evidence remain outside Git.
