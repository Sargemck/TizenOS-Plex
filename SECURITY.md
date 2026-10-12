# Security and privacy

This is a development-preview client intended for a local Plex server and a TV you control. No independent security certification or guaranteed response time is offered.

## Trust boundaries

- Plex credentials are stored in TV app storage without application-level encryption. Someone with developer access to the TV may be able to read them. Profile scoping is not a security boundary against that person.
- Local HTTP sends API and media traffic without transport encryption. Use a working HTTPS server address when encryption is required. Plex Home PINs use HTTPS and are not persisted.
- Optional launcher previews expose library titles and posters outside the app. They are off by default; already-rendered titles may remain until expiry. See the [preview guide](docs/USER-GUIDE.md#samsung-home-preview-experimental).
- Author certificates and passwords belong outside the repository. A signed package is tied to its signing identity and should not be confused with redistributable source.

## Reporting a problem

Do not post tokens, passwords, certificates, private server addresses, full request URLs or real-library captures in a public issue. Use GitHub's [Report a vulnerability](https://github.com/Sargemck/TizenOS-Plex/security/advisories/new) action for a private report. On a fork where private reporting is unavailable, open an issue asking for a private contact method without including the vulnerability details or sensitive data.

Provide the affected version, environment, a minimal reproduction and the likely impact using synthetic/redacted data. Do not access someone else's account or library to demonstrate a problem.

If a credential has already been exposed, revoke it through the relevant account/service and replace it. Removing a file from the current checkout or adding an ignore rule does not remove it from Git history, published archives or existing clones. Confirmed sign-out clears local credentials, saved lists, history and preferences across profiles on this TV; it does not erase Plex server watch progress. Revoke its Plex authorization when appropriate.
