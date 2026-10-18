# RelayRoute — Windows

[![Tests](https://github.com/saeed-alimardani/relayroute-windows/actions/workflows/test.yml/badge.svg)](https://github.com/saeed-alimardani/relayroute-windows/actions/workflows/test.yml)

**Experimental, unofficial system TCP/DNS tunnel for Windows.**

RelayRoute can route Windows TCP connections and virtual DNS through the
IP Protection service associated with Mozilla Firefox. A supported, eligible
Firefox Account must already be signed in on the same computer. The
project uses locally held browser session credentials, and the service may
reject, expire, or revoke them.

**RelayRoute is independent and is not made, sponsored, approved, or
supported by Mozilla.** Firefox is a trademark of the Mozilla Foundation.
This project does not ship Firefox code or binaries.

The underlying service is offered for use within the browser. Service terms,
entitlements, limits and protocol compatibility may change; this is not an
official API or a guaranteed service.

## Install

1. Use **Windows 10/11 x64** with **Node.js 20+** and a signed-in,
   eligible Firefox account.
2. Download or clone this repository.
3. Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-Dependencies.ps1`
   in the project directory. This downloads a **pinned, SHA-256-verified**
   tun2proxy/Wintun package from its original publisher.
4. Run **RelayRoute.cmd**, approve the Windows administrator prompt, and
   select Connect. When the app is minimized it stays in the system tray.

Third-party executables and private Firefox profile data are never included
in this repository. Review the open-source code and installer before running.

## Run

Double-click **RelayRoute.cmd**. Windows asks for Administrator rights because
Wintun and routing changes require elevation. The window stays available in the
system tray when minimized. Exit from the tray to disconnect and restore routes.

To operate from PowerShell in this folder:

```powershell
node src/controller.mjs start
node src/controller.mjs status
node src/controller.mjs stop
```

`start` remains in the foreground until stopped. The GUI starts it hidden.
The HTTP CONNECT bridge also listens on localhost:18080 and SOCKS5 on
localhost:18081 while connected. They are local-only.

The controller resolves and pins the Fastly gateway before enabling routes,
authenticates through the Firefox account's local profile, verifies that HTTP
CONNECT works, then starts tun2proxy with Wintun. It checks system egress and
periodically rechecks the upstream. If the bridge fails repeatedly, it stops
the tunnel, which restores the routes. No Firefox credentials are written
to this project's files.

If the controller is forcibly killed while the tunnel is running, an orphaned
Wintun process can hold the network route. Run the following from an elevated
PowerShell in this project folder to stop only this application's tunnel:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Repair-Network.ps1
```

## Limitations and privacy

* **TCP and virtual DNS only**: UDP, games, QUIC, and ICMP may not work.
* Windows may have multiple active interfaces, DNS configurations, other VPNs,
  firewall rules, and IPv6. This project does **not** yet implement a full
  Windows Filtering Platform kill switch or a guarantee against all leaks.
* Firefox account eligibility, monthly quota, and server list can change.
* Do not disable Firefox's own secure account protections. The project uses
  only the current user's existing Firefox Account profile.
* Any other local process can reach the loopback proxy during a connection.
  Do not run RelayRoute on untrusted shared Windows accounts.
* This is **experimental** and is not appropriate when anonymity or a
  guaranteed kill switch is required. See [SECURITY.md](SECURITY.md).

## Dependencies / provenance

* Node.js 20 or newer.
* `tun2proxy` v0.8.5 Windows x64 and Wintun are installed into `bin` using
  `Install-Dependencies.ps1`, which checks the original archive SHA-256.
  The upstream release is
  https://github.com/tun2proxy/tun2proxy/releases/tag/v0.8.5
* The executable is upstream MIT/Apache-2.0 dual licensed. Wintun is provided
  by the WireGuard project. Do not republish these binaries without reviewing
  their licenses and attribution.
* RelayRoute's own source code is available under the [MIT license](LICENSE).

## Open source and responsible use

Contributions and issues are welcome; please avoid posting personal
information, tokens or the contents of browser profile files. For security
reports, read [SECURITY.md](SECURITY.md).

## Diagnostics

Read `.run/status.json` or run `node src/controller.mjs status`. When started
by the GUI, stdout and stderr are in `.run/controller.out` and
`.run/controller.err`. Never put account tokens in logs.

```powershell
npm run check
npm test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/system-smoke.ps1
```
