# Third-party software distributed with the Windows installer

RelayRoute's installer includes unmodified upstream components:

* **Node.js**, version 24.x, for executing the JavaScript VPN controller.
  Node.js is distributed under the MIT license and includes other components
  with their own licenses. See `runtime/LICENSE` shipped with the installer
  and [nodejs.org](https://nodejs.org/).
* **tun2proxy** 0.8.5, built by the tun2proxy project, with its bundled
  **Wintun** driver DLL. The official project release is at
  https://github.com/tun2proxy/tun2proxy/releases/tag/v0.8.5.
  tun2proxy is MIT/Apache-2.0 dual-licensed. Wintun is maintained by the
  WireGuard team; copyright and applicable conditions are documented at
  https://www.wintun.net/ and
  https://git.zx2c4.com/wintun/.

The original tun2proxy release archive is verified against an exact pinned
SHA-256 hash during bundling. Do not replace individual components without
reviewing their provenance and licenses.

RelayRoute is independent and not affiliated with Mozilla, Fastly, WireGuard,
or the Node.js project.
