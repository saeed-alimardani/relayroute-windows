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

## Download and install (Windows 10/11 x64)

1. Download **RelayRoute-Setup-v0.2.0-win-x64.exe** from the
   [GitHub Releases page](https://github.com/saeed-alimardani/relayroute-windows/releases).
2. Run the installer and accept Windows administrator privileges.
3. Open RelayRoute from the Start menu or desktop. Sign in to an eligible
   Firefox Account on the same Windows user account before connecting.
4. Click the large power button to connect or disconnect. Minimize to keep
   RelayRoute in the system tray; closing the app disconnects first.

The installer bundles a self-contained .NET desktop application, Node.js and
the tunnel engine; **users do not need Node.js or .NET separately installed**.
The installer is currently unsigned, so Windows may show a publisher warning.
Verify its SHA-256 against the release notes before opening it.

## Build from source

1. Use **Windows 10/11 x64** with **Node.js 20+** and a signed-in,
   eligible Firefox account.
2. Download or clone this repository.
3. Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-Dependencies.ps1`
   in the project directory. This downloads a **pinned, SHA-256-verified**
   tun2proxy/Wintun package from its original publisher.
4. Run **RelayRoute.cmd** for the old developer interface, or install .NET 8 SDK,
   Node.js 24 and Inno Setup 6 and execute
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Build-Release.ps1`
   to build the native installer.

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

The packaged GUI stores runtime status under
`%LOCALAPPDATA%\RelayRoute\state\status.json`. Running the controller from
source uses that same location unless `RELAYROUTE_STATE_DIR` is set. Do not
put account tokens in logs. For diagnosis, use `node src/controller.mjs status`.

```powershell
npm run check
npm test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/system-smoke.ps1
```
