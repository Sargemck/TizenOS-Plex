# TizenOS Plex — an unofficial Plex client for Samsung TVs

A lightweight client for watching your local Plex library on a Samsung TV. Built with plain JavaScript and Samsung's native video player, with no runtime npm dependencies.

- Continue Watching, recently added titles and continuous library browsing.
- Save movies and shows to **My List** on your TV.
- Audio/subtitle selection, adjustable subtitle styling and Japanese/Chinese support.
- Seek previews with OK to confirm and Back to cancel. Thumbnails appear when Plex has generated them.
- Larger interface text, visible remote focus and **no episode autoplay**.

## Requirements

- Samsung TV running **Tizen 5.0 or later**. This is a development preview, tested on a **Samsung Q90R**; other models are not yet verified.
- A **local Plex Media Server** and a **Windows PC** on the same network as the TV.
- Samsung developer tools and your own signing certificate. Installation requires sideloading.

## Install on Windows

1. [Download the source](https://github.com/Sargemck/samsung-tizen-plex/archive/refs/heads/main.zip) and extract it, or clone this repository.
2. Install [Tizen Studio and the Samsung TV SDK](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html), including **Web CLI**, **Samsung TV Extension** and **Samsung Certificate Extension**.
3. Enable **Developer Mode** on the TV, enter your PC's local IPv4 address, and restart the TV. Connect to it through Tizen Studio's **Device Manager**.
4. In Certificate Manager, create a [Samsung TV signing profile](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html) that includes your TV's DUID. Keep the certificate outside this repository. In Device Manager, choose **Permit to install applications**.
5. Open PowerShell in the extracted project folder and run:

   ```powershell
   .\Install-TV.ps1 -TvAddress 192.168.1.40 -CertificateProfile 'YourProfile'
   ```

   Replace the example TV address and profile name with yours. If the SDK is installed elsewhere, add `-TizenStudio 'D:\tizen-studio'`.
6. Open **TizenOS Plex** on the TV and choose **Link Plex and find server**. Use the QR code or visit [plex.tv/link](https://plex.tv/link) and enter the displayed code.

For manual connection, use your Plex server's network address, such as `http://192.168.1.20:32400`, not `localhost`. Keep the Plex server running while watching; the installation PC is only needed again for updates.

**Updating:** download the latest source, stop playback and rerun the installer using the same signing certificate. In-place updates preserve sign-in and preferences; don't uninstall first.

## More information

- [User guide](docs/USER-GUIDE.md) — remote controls, subtitles and playback options.
- [Contributing](CONTRIBUTING.md) — development setup and tests.
- [Architecture](docs/ARCHITECTURE.md) — how the app is built.
- [Security and privacy](SECURITY.md) — credential storage and private issue reporting.

## License

[MIT](LICENSE). Bundled Noto-derived fonts retain their separate [SIL Open Font License](app/font-license.txt).

Independent project; not affiliated with or endorsed by Plex or Samsung.
