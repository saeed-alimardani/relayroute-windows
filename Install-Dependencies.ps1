# Downloads independently licensed third-party binaries from their upstream.
# Only the upstream ZIP with the pinned SHA256 is trusted.
[CmdletBinding()]
param([switch]$Force)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$bin = Join-Path $root 'bin'
$exe = Join-Path $bin 'tun2proxy-bin.exe'
$dll = Join-Path $bin 'wintun.dll'
$url = 'https://github.com/tun2proxy/tun2proxy/releases/download/v0.8.5/tun2proxy-x86_64-pc-windows-msvc.zip'
$expected = '323D3F899D9229B8D65983D5ABF90CD1E77540EA96AC026DEB63E9E38C860471'

if ((Test-Path -LiteralPath $exe) -and (Test-Path -LiteralPath $dll) -and -not $Force) {
  Write-Output 'tun2proxy and Wintun already installed. Use -Force to reinstall from the pinned release.'
  exit 0
}
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$temp = Join-Path ([IO.Path]::GetTempPath()) ('ffvpn-dependency-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  $zip = Join-Path $temp 'upstream.zip'
  Write-Output 'Downloading tun2proxy v0.8.5 from GitHub Releases...'
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 90
  $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
  if ($actual -ne $expected) { throw ('SHA256 mismatch. Refusing to install. Got ' + $actual) }
  $unpack = Join-Path $temp 'unpacked'
  Expand-Archive -LiteralPath $zip -DestinationPath $unpack
  foreach ($name in @('tun2proxy-bin.exe', 'wintun.dll')) {
    $found = Get-ChildItem -LiteralPath $unpack -File -Recurse -Filter $name | Select-Object -First 1
    if (-not $found) { throw ('Upstream release missing ' + $name) }
    Copy-Item -LiteralPath $found.FullName -Destination (Join-Path $bin $name) -Force
  }
  Write-Output 'Dependencies installed successfully from verified release.'
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
