# 0.4.2: saved titles and series navigation

Prepared and installed on 12 October 2026 after the owner authorized the update. The in-place update from 0.4.0 preserved every saved app value. This package includes all 0.4.1 changes and supersedes that prepared package. Nothing has been published.

## My List

Movie and series detail screens offer **Save for later** and **Remove from My List**. The navigation bar opens **My List**, labelled **Saved on this TV**. It is independent of Continue Watching and Plex's cross-device Watchlist.

- Up to 100 titles per server/profile; only numeric IDs and movie/show types persist.
- A full list refuses another save without deleting an older entry. Storage failures do not claim success.
- Opening the list refreshes metadata with at most three requests in flight. Cards appear progressively in the existing virtual grid, retaining order/focus.
- Leaving cancels requests. Failed or missing titles stay saved with Retry/Remove options. Removing a saved entry does not remove media from Plex.
- No saved-title metadata requests occur during app startup or ordinary browsing.

## Series landing and episode completion

Opening a show now presents its description and these actions:

- **Continue S2 · E4** (or **Play S1 · E1** for an unstarted recommendation), using Plex's available next-to-watch information. Explicit activation fetches fresh episode metadata before playing.
- **Seasons & episodes**, restoring the last opened season/episode position.
- **Save for later**, **Show language preferences**, **All episodes** and Back.

Navigation positions are remembered for at most 30 shows per server/profile. They represent last opened grid positions; Plex remains the source of playback progress. Episode details also offer All episodes, and Back restores the actual parent screen and action.

Recommendations use Plex's same-show OnDeck episode where available. Otherwise, a show-only unwatched lookup reads pages of 24 with a 240-entry cap. Unsupported, failed or unusually large results leave manual episode selection available. No show is scanned in the background at startup.

Only natural episode completion opens **Episode finished**, offering **Play next episode**, **All episodes** and **Back to library**. There is no near-end trigger, countdown, automatic credit skip or autoplay. Loading the next recommendation does not move focus or start playback. An explicit Play fetches fresh metadata; leaving cancels late lookups/preparation. The final episode has no Play next action. Manual Stop and movie completion retain their normal behavior.

## Verification

- **80 unit/installer tests passed**, including bounded saved-list validation, scoped recommendation selection, cancellation and distinguishing natural completion from manual Stop—even during an outstanding seek.
- **All 14 browser suites passed.** New suites cover persistence, server/profile isolation, metadata freshness, concurrency, missing titles, quota/full-list behavior, continued playback, remembered paginated positions, parent focus restoration, completion errors/retries and cancellation without autoplay.
- Synthetic My List, series landing and completion screenshots were inspected in normal/larger text. My List retains two complete nine-column rows with unclipped headings, captions and focus outlines. Series actions and the completion choices fit the tested screen.
- Seven alternating desktop samples against 0.4.1 (1920×1080, 4× CPU throttle, 10 ms mock server latency) measured startup medians **325→339 ms**, focus **3→3 ms**, and mocked Play-to-ready **31→32 ms**. Each run used two startup server requests and zero cloud calls. These are small desktop samples, not a TV or official-app performance comparison.
- Runtime syntax, Samsung signing, unchanged app identity and the Tizen 5.0 manifest baseline passed. The package contains 19 reviewed runtime files plus two signatures; certificates, credentials and generated packages stay outside Git.

Signed WGT SHA256: `8855FF661E5D63F07E3D961BA32741322032D31C06F2B8678D77FFC7D467E92A`.

## Remaining TV checks

Installation and navigation smoke checks passed on the Q90R/Tizen 5.0: version 0.4.2, unchanged saved data, My List with its local-storage label, nine columns with two complete film rows inside the viewport, and series actions plus a resolved episode recommendation. Browsing did not start playback. The app was left at Home with AVPlay idle. These checks do not replace the playback and physical-remote acceptance tests below.

1. Recheck normal/larger text and physical-remote navigation from the usual viewing distance.
2. Save/remove a designated movie and show, restart, and verify My List, scope and normal/larger remote navigation.
3. Open a real series with existing progress; compare Continue with Plex and verify saved season/episode position after restart.
4. Reach natural completion and confirm credits remain uninterrupted, nothing autoplays, and all three completion actions work with the physical remote.
5. Recheck late-request cancellation and cleanup; restore test progress/preferences afterward.

The earlier subtitle-language observation, physical-remote performance comparison and 0.4.1 real-thumbnail checks remain open. The separately authorized scheduled thumbnail generation remains unchanged by this release.
