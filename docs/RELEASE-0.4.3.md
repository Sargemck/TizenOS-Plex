# 0.4.3: public-preview release review

Prepared on 12 October 2026. This is a development-preview source release, not a claim of support across all Samsung TVs. The test TV remains on 0.4.2; this review did not operate it or change real account data. Nothing has been published.

## Changes found necessary during review

- **Account relinking:** sign-out now explicitly asks before clearing this TV's credentials, My List, searches, browsing positions and preferences across local accounts/profiles/servers. Keep signed in is selected by default. Server media and watch progress are unaffected. Cleanup failures retain sign-in until personal records can be cleared. This closes an account-relinking case where a different account on the same server could inherit locally stored owner data.
- **Late watched updates:** a successful watched/unwatched request now refreshes the appropriate cached grid or reopened detail even when the user pressed Back before the reply. Focus and scroll are preserved. A scoped pending-write guard prevents duplicate changes; old-account replies cannot update another account's view or restore cleared local records.
- **Version consistency:** request headers and Diagnostics use one runtime version constant. New release tests compare it with the manifest, package/lockfile and visible version, and check runtime packaging and license consistency.
- **Public documentation:** the README now separates product overview from the user guide, describes tested versus intended support, and links contribution/security guidance. Existing limitations remain visible.
- **Continuous integration:** a read-only Windows GitHub Actions workflow is included for syntax, unit/installer, browser and QR checks, using commit-pinned setup actions. It needs no TV, certificates or household credentials. Hosted CI will run only after publication; no hosted success badge is claimed.

## Release checks

- All **83 unit/installer tests**, runtime syntax checks and **15 browser suites** passed in the local Windows environment. QR images independently decoded at four sizes without network requests.
- A fresh source-only export installed its locked test dependencies and passed syntax, all 83 unit/installer tests, all 15 browser suites in freshly installed Chromium and independent QR decoding. Subsequent changes were documentation and benchmark-environment labeling only. These local checks used Node 24; the configured hosted CI targets Node 22 and has not yet run.
- Dependency advisories reported **zero known vulnerabilities**. Gitleaks found no secrets in the source export or reachable Git history; additional source, Git-object, identity and asset-metadata checks were reviewed. Scanning is not an absolute guarantee. Copyright and font-license notices remain intentional.
- A seven-run desktop comparison against 0.4.2 measured median startup at 274 to 278 ms, focus response at 4 to 3 ms, and mocked playback readiness at 25 to 25 ms. Both builds made two startup server requests and zero cloud requests. This is a controlled regression check, not evidence of TV speed or visual smoothness.
- Documentation links and whitespace checks passed. Generated packages, raw diagnostic evidence and private state are excluded from public source. The source-only archive also excludes existing Git identity/history; review the commit email before publishing any existing history.

The signed package contains the 19 reviewed runtime files plus two signatures, with unchanged app identity and Tizen 5.0 baseline. Package SHA256: `EAD57AF64FE3B318A61A534E05B96107C924B7E667FF5DDABCAD6A3DB8F7C5C0`.

## Limits to communicate

- Hardware evidence is from one Samsung Q90R/Tizen 5.0 device. 0.4.2 was installed and navigation-smoke-tested; full playback evidence is documented separately for 0.4.0 and earlier. 0.4.3's fixes are locally verified and still need a device smoke check.
- One native subtitle-language mismatch observed during a 0.4.0 startup/select/seek sequence remains unexplained. It recovered and did not recur in subsequent traced runs; it is not claimed fixed.
- Physical-remote feel, official-app first-frame/seek comparisons, protected-profile hardware isolation and the current real-thumbnail/completion checks remain incomplete. Desktop timing and native-ready events do not establish visual smoothness or superiority to the official Plex app.
- The tested TV lacks the background-service capability required for this implementation's optional personal launcher preview. The in-app Home screen works independently.

The release is suitable for users willing to install a development preview, report their device/codec results and work within these documented limits.
