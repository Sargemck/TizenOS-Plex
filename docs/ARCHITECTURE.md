# Architecture and contribution notes

TizenOS Plex is a small, framework-free TV client. The baseline is Tizen 5.0 / Chromium 63. A current desktop browser is a useful test environment, but does not establish compatibility with that browser engine, Samsung AVPlay or Smart Hub.

## Responsibilities

| Module | Responsibility |
| --- | --- |
| `core.js` | Bounded requests, URL validation, metadata extraction and redacted errors |
| `features.js` | Pure preference, language, track, filter and spoiler decisions |
| `saved.js` | Strict local saved-title normalization, deduplication and capacity policy |
| `services.js` | Plex discovery, profile operations and cancellable next/continue episode lookup |
| `home.js` | Home row lifecycle, deferred loading, focus restoration and nearby poster DOM |
| `player.js` | AVPlay state, callbacks, watchdogs, seek serialization and caption lifetime |
| `subtitles.js` | Bounded parsing and time-based lookup of text cues |
| `preview.js` | Optional launcher snapshots, strict deep-link parsing and service bridge |
| `preview-service.js` | Short-lived artwork download/cache and Samsung preview publication |
| `qr.js` | Locally rendered, fixed public Plex linking URL; no code, token or network request |
| `app.js` | Screen composition and coordination of those modules |

The existing screen coordinator remains larger than ideal. New features should have explicit ownership and testable boundaries instead of adding unrelated state to it. Split further when a concrete change justifies it; avoid a framework migration simply to reduce line count.

## Browsing and latency

Connecting starts the section list and Continue Watching requests together. Home renders that first row before requesting recently added feeds. Two animation frames followed by a short delay give the first screen a paint opportunity. Explicit remote navigation may request its destination immediately.

Home shows nine cards per row. Recently added feeds are requested near the viewport, and distant poster nodes are released unless they hold focus. Metadata stays in the current Home instance, with at most nine items per library; it is discarded when leaving Home. There is no persistent cross-profile home cache. Each row has independent empty, loading, failure and Retry states. Late responses are ignored after disposal; outstanding requests are aborted.

View all opens the existing virtual library: 12-item server chunks, an eight-chunk cache, and nearby rows only. Nine columns are shared by layout and remote navigation. Keep those two assumptions together if a future design changes the column count. `minmax(0, 1fr)` and a zero card minimum width are deliberate: older Chromium can otherwise widen a column to an unbroken title. Focus outlines must fit inside the scroll viewport. Long titles truncate; poster columns do not widen.

My List uses `savedTitles.<server/profile scope>` with at most 100 numeric IDs/types. It stores no title/poster metadata or additional credential copies. A full list refuses new additions without eviction. Opening the list mounts virtualized placeholders immediately, then loads fresh metadata with at most three cancellable requests. Local pages feed the same virtual-grid renderer; the `/saved` route never reaches Plex. Individual card replacement preserves focus/index/scroll. Failed titles remain stored and provide Retry/Remove. Storage errors do not claim a successful save.

Opening a series requests `includeOnDeck=1` with its existing metadata lookup. `continueSeries` accepts only same-show episode recommendations. When absent, its fallback requests show-only unwatched episodes in pages of 24, capped at 240 entries. That work occurs only on the landing screen, and explicit Continue refreshes full episode metadata before playback. `seriesPositions.<scope>` remembers last opened season/episode and All episodes indices/scroll for at most 30 shows. It is navigation history, not a substitute for Plex playback progress. Saved lists, show recommendations and these positions never add startup requests.

AVPlay's natural completion is propagated as `stopped({completed:true})` after normal cleanup; explicit Stop and errors do not open the episode-finished screen. A pending explicit Stop takes precedence over an end event during a seek. Completion resolves the successor on screen entry, keeps focus stable while loading, and fetches playable metadata only after explicit Play next episode. The usual revision/scope/abort guards cancel late results. No near-end timer, countdown or autoplay is introduced.

## Interface coordinates and navigation

The interface uses a single logical 1920×1080 canvas. 4K TVs are the primary target: Samsung documents 1920×1080 as the standard web-app interface resolution on UHD models, separately from video decoding resolution. `fitInterface` scales and centers the UI without changing AVPlay's display rectangle. At Samsung's standard UHD application viewport the scale is one. Do not mix physical `getBoundingClientRect` measurements with logical scroll offsets: the virtual grid divides rectangle differences by the current scale. Browser checks exercise a 3840×2160 viewport as well as smaller 16:9 and letterboxed viewports; native video-plane alignment still needs hardware verification for a new device/firmware.

`gridMetrics` supplies column count, gap and card height to both CSS and the virtual-grid calculations. Height derives from the available width, artwork frame and text mode; remote row movement uses the same column count. Version 0.4.1 uses nine columns and fits two complete rows in both text modes. Progress/remaining time overlays the poster so metadata does not add another row of vertical space. Home requests match the column count; the library loads enough small pages to populate the visible rows immediately. Mixed rows use consistent 2:3 film/show posters. Episode-only grids use shorter 16:9 frames, with protected episodes using the show poster inside that frame. Watched/progress indicators use existing metadata and add no requests; browsing artwork is requested at 240×360 (240×135 landscape).

Auxiliary screens use `visit` to retain their parent renderer or library route, focus identity and scroll position. Back restores focus after the destination has rendered; normal navigation invalidates pending restoration. This avoids a late library response stealing focus from a returned Settings button. Screen revisions still protect asynchronous requests. Existing media-detail/grid stack entries remain supported.

Left/Right from hidden controls or the focused timeline enters the same staged seek state as Timeline. Candidate position is independent of advancing playback time. No AVPlay seek occurs before explicit OK/Seek to; Back/Cancel discards the candidate. Held directional input is throttled to 100 ms, while image requests wait for a 220 ms quiet interval. Images use Plex's indexed-frame endpoint rather than downloading an entire BIF or generating frames on the TV. Per-candidate epochs and detached image handlers prevent late loads/errors from showing stale frames. Missing indexes, disabled previews and failed images retain timestamp-only operation. The overlay's measured height reserves subtitle clearance. Stop remains an explicit confirmation with Keep watching selected.

`resetProgressAction` writes a stopped Plex timeline at offset zero with the active profile's headers; it does not issue a watched/unwatched mutation. A scoped in-flight map prevents duplicate reset/playback races. Successful writes clear older local recovery checkpoints and invalidate browsing cache; late completions refresh the current route while preserving focus/scroll. Undo writes the preceding offset. Scope/revision checks prevent a completed request from updating another profile or detail screen.

Settings owns Refresh, Diagnostics, connection changes and preference screens. Initial setup leads with linking/discovery and exposes manual IP entry as a secondary action. The QR symbol is fixed data for the public linking URL, generated offline and rendered as SVG with a four-module quiet zone. No QR runtime dependency or external image service is introduced. `test:qr` independently decodes browser-rendered pixels using OpenCV as a development-only tool; the TV requires neither Python nor OpenCV.

Long descriptions open in a bounded text dialog with explicit directional scrolling. The description cannot push its trigger offscreen, and closing it restores both trigger focus and detail scroll. Playback submenus retain a small parent stack of render functions, focus indices and scroll offsets. Returning rerenders current setting values; pending menu requests are invalidated. Closing the whole menu or ending playback releases the stack.

Home preserves the preferred column through adjacent rows. Right after the last card reaches View all, with a visible footer hint; Up from the first row reaches navigation. An empty row collapses only when scroll compensation can retain the current control's physical position. If either scroll boundary makes that impossible, collapse is deferred until focus or scroll moves. Rollback events cannot create a frame loop. Settled request promises leave the cancellation registry, including repeated failed Retry attempts.

Card focus updates two existing text nodes in a fixed-height information area. It does not rebuild cards or fetch metadata. Filter labels are saved alongside validated filter values, never sent as query parameters. Recent searches are bounded to five distinct submitted titles per server/profile; selection submits, focus does not. Watched state, partial progress and rewatches remain distinct.

Playback context reads current TV track selections or an active external/burned subtitle, with explicit unknown labels. Native track reads are bounded to interaction/preference events rather than playback-time ticks; ticks update remaining minutes only while controls are visible. Pressed-state feedback is a short surface-color change, and held OK is suppressed. Existing request revisions, pending-target checks and playback guards prevent duplicate or abandoned operations from starting later.

There are no hover animations, rotating banners, automatic trailers or background recommendation polling. Artwork uses server-sized thumbnails. The optional launcher job performs its downloads in a separate service, with at most two requests at once. Its network and disk work are still real costs; keep it disabled when measuring core browsing/playback performance.

## Cancellation and identity

The screen coordinator's revision invalidates old screen requests. Home owns a separate disposable request collection. AVPlay and playback preparation have their own lifecycle guards; UI cancellation must not revive a video through a late callback. Recovery uses the last reported position rather than replacing it with zero after a failed preparation.

Profiles use scoped server credentials and separate preferences. This prevents accidental mixing; it does not protect secrets from a person with developer access to the TV. Never log authorization headers, Plex URLs with tokens, PINs or certificate information.

Launcher preview is explicit opt-in. It accepts internal snapshots only from the foreground application ID. The service validates a strict server origin and relative image paths, sends the scoped token only in HTTP headers, rejects redirects, bounds images to 384 KiB each, and stops after 20 seconds. A normal job contains at most 18 images, so cached artwork is bounded to approximately 6.75 MiB. Cache filenames are generated internally. No credential-bearing refresh state is written to disk.

Published tiles contain local artwork references and a random activation scope plus numeric metadata ID. Opening a tile fetches metadata with the current session; it cannot change server/profile, inject a playback URL or autoplay. The scope is invalidated when preview is disabled, on sign-out and on server/profile changes. A tile cannot interrupt active playback.

Samsung documents a minimum ten-minute update interval. Personalized tiles request a ten-minute expiry. A clear request deletes cached artwork immediately when the service handles it, but already-rendered launcher titles may survive until expiry. This is an explicit privacy limitation. The OS may start the service periodically; without a fresh foreground snapshot it exits without network work. It does not persist tokens to support autonomous polling.

## Validation and release discipline

Run `npm test`, `npm run check` and `npm run test:browser` with the installed Edge channel selected as described in the README. Unit tests exercise decisions, service limits and lifecycle failures; browser tests exercise observable remote behavior and layout. Test fixtures must remain synthetic.

`npm run test:performance` checks a controlled desktop environment. An optional `PLEX_BENCHMARK_BASELINE` points to a previous extracted `app` directory. Keep model hardware, mock latency, CPU throttling and sample counts identical. Small differences between runs are noise. Neither this harness nor AVPlay's ready callback proves first-visible-frame time or smooth TV playback.

Build with `Install-TV.ps1 -BuildOnly` to sign without contacting a TV. Its explicit source and archive allowlists must be updated deliberately for a new runtime file. A passing package/signing check is not a successful TV installation. Keep the foreground app ID and author certificate stable to preserve in-place updates.

Before publishing, inspect the staged files and Git history, including commit email addresses. Do not add certificates, tokens, server snapshots, generated packages, screenshots of real libraries or `.local` diagnostics. The MIT license covers this project's code and documentation; bundled fonts retain their separate OFL notices. Publishing a source repository is distinct from redistributing a personally signed package.

The 0.4.0 hardware run verified installation over 0.2.6, six-column geometry, Home key handling and recovery on the TV browser. Physical remote feel and visual acceptance remain separate. The tested Q90R reports background web services unavailable, so personal preview stays disabled; service launch/exit, cached-artwork accessibility, expiry and launcher links need another supported device. See [hardware results](TV-RESULTS-0.4.0.md). Preserve the distinction between intended support, mocked validation, user feedback and measured device results.

The layout introduced in 0.3.1 also has local checks at 3840×2160, 1920×1080, 1280×720 and 1024×768 in `tests/ui-browser.cjs`, including synthetic Japanese/Chinese titles. Hardware key injection and geometry checks supplement these tests; physical-remote feel, larger-text sofa readability and visible video-plane alignment still need human confirmation.

The current browser coverage comprises fifteen suites, including search/history, remote UX, two-row density, progress reset, seek previews, My List, series landing, episode completion and account cleanup. See [TV acceptance](TV-ACCEPTANCE.md), the [0.4.2 installation and smoke checks](RELEASE-0.4.2.md) and the [0.4.3 release review](RELEASE-0.4.3.md) for the distinction between local checks and device evidence. Keep source/test fixtures synthetic and record real device observations privately. Estimated finish time remains deferred; it is not part of the implemented playback context.
