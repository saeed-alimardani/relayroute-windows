# RelayRoute Security

## Supported version

This is an experimental independent Windows client, currently version 0.1.x.
It is **not** a hardened VPN, and has no guarantee of anonymity or leak prevention.

## Threat model and known limitations

* The app reads an existing Firefox Account session token locally, in memory.
  Keep the Firefox profile and Windows user account private. Do not share
  `signedInUser.json`, tokens, `.run/` data, or authentication error responses.
* The local HTTP CONNECT and SOCKS5 listeners bind to `127.0.0.1` and do not
  authenticate other processes belonging to the same computer. Local untrusted
  programs may be able to use the proxy while it is enabled.
* No WFP kill switch is present. Other interfaces, IPv6, unsupported UDP,
  Windows services, browser-specific proxy settings, or crash paths can leak
  traffic or interrupt connectivity.
* Firefox IP Protection is a browser-specific service. API compatibility,
  eligibility, legal terms, limits and availability may change without notice.
* The controller runs elevated to configure system routes. Review code and
  downloaded dependencies before running it. Install script verifies the
  pinned upstream ZIP SHA-256.

## Report a vulnerability

Please avoid opening public issues containing credentials, session tokens,
private profile files, or personal identifiers. Contact the repository owner
privately using GitHub's private vulnerability reporting if enabled.
