# 0.4.1: denser browsing, progress reset and seek previews

Prepared on 12 October 2026. The signed candidate has passed local validation. Hardware installation/testing is pending; the existing TV session was paused and left untouched. Nothing has been published.

## Behavior

- **Two complete rows:** Home and film grids fit nine portrait cards per row, including title/context text, in both normal and larger interface text. Header spacing is smaller; full focused-title information remains available. Progress and remaining time overlay the poster. Three rows are not forced at the expense of legibility. Episode grids retain landscape artwork and all grids retain vertical virtualization.
- **Reset playback progress:** a resumable movie/episode detail offers confirmation, defaulting to Cancel. Reset clears the Plex resume offset and older recovery data on this TV without changing watched status. Undo restores the original position while the detail screen remains open. Failed requests preserve progress and remain retryable; duplicate requests and playback during a pending reset are blocked. Movies at zero progress leave the resumed-movie view. Plex may still recommend episodes independently of their resume position.
- **Preview before seeking:** Left/Right with controls hidden, or with the timeline focused, changes a proposed position. Left/Right changes 10 seconds; Up/Down changes one minute. OK performs one seek; Back/Cancel discards the proposal. Playback continues in its previous playing/paused state. Timeline opens the same interaction; the explicit Backward/Forward step menus remain available.
- **Preview frames:** generated Plex index frames load after a short quiet interval between presses. Old image responses cannot replace the current candidate. Missing/disabled/failed previews show an explanation and leave timestamp selection usable. No video decoding, whole-index download, background polling or server thumbnail-generation request is added to playback.

Plex must generate video preview thumbnails before a title can display these frames. Enable generation in the server's Library settings and the desired library's Advanced settings. Scheduled generation is suitable for avoiding new generation work during ordinary browsing; it may take substantial processing time and disk space. See [Plex's video preview thumbnail documentation](https://support.plex.tv/articles/202197528-video-preview-thumbnails/). This setting is separate from this app's optional Samsung launcher preview.

## Validation

- 73 unit/installer tests and runtime syntax checks passed.
- All eleven browser suites passed. New suites cover two complete rows and filter/focus separation, reset/Undo/failure/scope/restart behavior, and seek confirmation/cancellation, paused playback, indexed-image requests, request debouncing, stale callbacks and missing-preview fallbacks.
- Geometry checks cover normal/larger text at 1920×1080, 3840×2160 and 1280×720. Synthetic screenshots were inspected; film posters retain their 2:3 ratio and the filter summary clears the first card's complete focus outline.
- Browsing artwork requests were reduced from 320×480 to 240×360 (landscape 240×135) to offset the additional visible cards. Home remains at two startup server requests and zero cloud calls in the controlled comparison.
- Seven alternating desktop samples against 0.4.0, with 4× CPU throttle and 10 ms mock latency: startup medians 332→341 ms, focus 3→3 ms, mocked Play-to-ready 32→33 ms. This is a small increase under a denser workload, not a real-TV or official-app performance comparison.
- Samsung signing passed with unchanged identity, author profile and Tizen 5.0 baseline. The WGT contains only the 18 reviewed runtime files plus two signatures. Credentials and packages remain excluded from Git.

Package SHA256: `2F66BCE9DC91600E6E88AE99E820168D095465A4D2845E032A8AFCF17DDFAF91`.

## Next hardware checks

1. Install in place and compare saved settings with the pre-update snapshot.
2. Confirm two complete rows and clear filter labels on the actual TV, in both text sizes; traverse rows and return from details without clipping or focus loss.
3. Reset a designated test movie, confirm it leaves Continue Watching and watched status is retained; Undo and verify the original position. Preserve unrelated titles and the owner's active session.
4. While playing and paused, use Left/Right to move the candidate, Back to cancel and OK to seek once. Check held arrows, subtitle clearance and explicit step menus.
5. Use an actual title with generated preview indexes to verify frame contents and timing. Until the server finishes generation, only timestamp fallback can be verified for titles without indexes.
6. Restore test preferences/progress and check that stopped playback leaves no conversion session behind. The unresolved 0.4.0 subtitle observation and human performance/remote checks remain open.
