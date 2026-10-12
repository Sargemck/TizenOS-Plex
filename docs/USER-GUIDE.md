# Playback and remote guide

This guide describes the available controls and their limits. For installation and compatibility, start with the [README](../README.md).

## Saving titles and clearing progress

Choose **Save for later** on a movie or series detail screen, then open **My List** from navigation. The list is labelled **Saved on this TV**, stores up to 100 titles per server/profile and refreshes metadata when opened. It does not synchronize to Plex Watchlist. Removing a saved entry never removes media from Plex; unavailable entries remain saved until explicitly removed.

On a resumable title's detail screen, choose **Reset playback progress** and confirm. This clears its resume position on Plex and this TV without changing watched status. **Undo progress reset** restores the previous offset while that detail screen remains open. This does not erase viewing history or delete media. A movie with zero progress leaves the resumed-movie view; Plex may still recommend episodes according to its own Continue Watching rules.

**Mark watched/unwatched** is separate. Its Undo restores the previous watched flag while the screen remains open; it does not recreate historical play counts or viewing history.

## Series and episode flow

Opening a show presents **Continue** or **Play**, **Seasons & episodes**, saved-title controls and language preferences. No video starts on entry. The app remembers the last opened season/episode positions for up to 30 shows per server/profile. These navigation positions are separate from server playback progress.

Natural episode completion offers **Play next episode**, **All episodes** and **Back to library**. There is no near-end prompt, countdown or autoplay. The next episode starts only after explicit activation; a missing recommendation leaves manual episode browsing available.

## Signing out

Sign out opens a confirmation with **Keep signed in** selected. Confirming clears this TV's credentials, saved lists, search/navigation history and preferences across profiles. Plex server watch progress remains unchanged. Cancel to keep your local data. This prevents a later account using the same TV from inheriting the previous account's local lists or preferences.

## Seek previews

Left/Right with playback controls hidden, or with the timeline focused, moves a candidate position without seeking. **OK** performs one jump; **Back** cancels. Playing/paused state is retained. The overlay works with timestamps even when images are unavailable.

Images require Plex-generated video preview thumbnails for the media. The app requests available indexed frames; it does not generate them on the TV. Generation is a Plex server/library setting and can use substantial server processing and disk space. The app does not enable generation automatically.

## Why the playback modes matter

**Direct play** sends the original file to AVPlay. It avoids server conversion and preserves source quality; it is normally the cheapest and fastest path.

**Repackaging / audio conversion** asks Plex to copy compatible video into a stream the TV can use while converting audio to AAC. This fixes files whose video is fine but whose audio is unsupported, without recompressing the picture. Whether the video can be copied is ultimately decided by Plex.

**Compatibility conversion** asks the server for H.264 video and AAC stereo, capped at 1080p/20 Mbps. This is a last resort for unsupported video or subtitles that must be rendered into the picture. It costs server resources, may take longer to start and can reduce resolution, HDR fidelity and audio capabilities. It is not a lossless mode. The server must permit and have sufficient capacity for transcoding.

Choose **Settings → Playback & languages** for Automatic, Direct play only or Compatibility. Automatic attempts are bounded and cancelled sessions are stopped on the server. A failed attempt retains the intended resume position.

## Subtitle behavior and limits

For embedded text tracks exposed by AVPlay, the app renders native subtitle callbacks with its own fonts and appearance controls. Older AVPlay versions sometimes report abbreviated or incorrect language names; Plex metadata enriches ordered lists only when language matches support their ordering. The observed Japanese `jp` abbreviation also maps independently when there is exactly one corresponding native/Plex text track. Ambiguous mappings are left alone. Unsupported or truncated tracks remain selectable through Plex conversion.

On the tested AVPlay 4.1 firmware, `setSilentSubtitle(true)` suppresses text callbacks. Selected text tracks therefore remain enabled (`false`); the off/external-text paths use `true`. Subtitle visibility and duplicate native rendering should be checked when adding another firmware to the supported list.

External text tracks with a Plex stream URL are downloaded incrementally, parsed as SRT/WebVTT and rendered locally. They support timing offsets of up to ±10 seconds. Native-track timing depends on the TV's `setSubtitlePosition` support; failures are reported without saving an ineffective change. ASS/SSA styling, embedded fonts and karaoke effects are not reproduced.

Native text captions remain visible while playback is paused and resume their remaining display time afterward. Seeking clears the old native caption. A real Japanese caption remained visible through a 17-second pause and advanced after resume on the test TV.

PGS/VobSub and embedded tracks that the TV cannot expose require Plex to render the subtitle into the video. This forces video conversion. Those subtitles are part of the picture: app text color, position and timing controls do not apply. The appearance menu explains this instead of pretending to change them. Embedded-subtitle export is not assumed to work on every Plex server.

The bundled font assets retain the Japanese source repertoire and supplement common Han characters absent from it. This supports Japanese kana/kanji and many simplified/traditional Chinese characters; it does not promise every rare CJK extension character. Subtitle text is inserted as text, never HTML.

## Samsung home preview (experimental)

The launcher strip is separate from the in-app Home screen. Samsung documents Smart Hub Preview for 2016–2021 models; this does not imply that every later TV exposes it. This implementation uses the personal-preview web service and keeps the Tizen 5.0 baseline. The tested Q90R reports `web.service=false`, so this feature is unavailable there and Settings prevents enabling it. Samsung [requires this capability check](https://developer.samsung.com/smarttv/develop/faq/smart-hub-preview.html); it must not be bypassed. Service launch, local-image access, tile expiry and cold/warm deep links still need a supported test device. Successful signing and mocked tests do not establish those behaviors.

Choose **Settings → TV home preview** to opt in. Anyone using the TV may see titles and posters. The short-lived service accepts snapshots only from the bundled foreground app, downloads up to 18 small posters from the selected server using its scoped token in HTTP headers, and publishes local artwork references. Credentials and server URLs are not included in launcher JSON or persisted by the service. It rejects redirects, limits each image to 384 KiB, runs two downloads at a time, and exits within 20 seconds. Existing local HTTP transport remains unencrypted.

Updates respect Samsung’s minimum ten-minute interval. Personalized tiles request a ten-minute expiry; opening Home again can refresh them. There is no credential-bearing background polling while the app is closed. Disabling the option, signing out, changing servers or switching profiles invalidates old deep links and requests artwork cleanup. Samsung may retain already-rendered titles until expiry, so this is **not a private screen or an instant-clear guarantee**. The option must be enabled again after a profile/server change. A missing capability or failed preview never blocks ordinary browsing or playback.

## Remote controls

| Control | Action |
| --- | --- |
| D-pad / OK | Move focus / activate; OK also reveals hidden playback controls |
| Up / Down on Home | Move between content rows, preserving the column through short/empty rows |
| Right at the last Home card / Left from View all | Reach View all / return to the last card |
| Up / Down in Read more | Scroll the description; Back or OK returns to Read more |
| Back during playback | Return to a parent submenu or close the root menu; otherwise hide controls; with controls hidden, ask whether to stop (Keep watching selected) |
| Back while browsing | Return to the previous title/grid position; double press at home to exit the app |
| Left / Right with playback controls hidden, or the timeline focused | Preview a position 10 seconds backward/forward; further presses move the candidate. OK performs one jump; Back cancels without seeking. Held arrows move the preview at a bounded rate. |
| Backward / Forward; Rewind / Fast-forward | Choose 10 seconds, 1 minute or 10 minutes |
| Audio / Subtitles | Select from the available track list; includes Subtitles off |
| More → Subtitle style | Size, background, color, position and timing for text subtitles |
| Timeline | The same preview interaction: Left/Right adjusts 10 seconds, Up/Down 1 minute, OK confirms, Back or Cancel cancels. Playing/paused state is retained. |
| Play/Pause media keys | Pause/resume |
| More → Stop / Stop media key | Ask for confirmation before stopping |
| Next episode | Find the successor, then explicitly choose Play next episode; never automatic |
| More → Playback info | Show current formats and available server conversion decisions |

Resume before changing an audio track. Wait for a pending seek or track change to finish before starting another. TV volume buttons retain their normal function. Setup uses the TV keyboard; selection fields use app dialogs so the remote does not get stuck in browser dropdowns.
