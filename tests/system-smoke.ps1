param(
  [ValidateSet('virtual', 'over-tcp', 'direct')]
  [string]$DnsStrategy = 'virtual',
  [string]$UpstreamIp = '23.235.42.11'
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$root = (Get-Location).Path
New-Item -ItemType Directory -Force '.run' | Out-Null
$tun = Join-Path $root 'bin\tun2proxy-bin.exe'
if (-not (Test-Path $tun)) { throw 'tun2proxy binary missing' }
if (-not (Get-NetTCPConnection -LocalPort 18080 -State Listen -ErrorAction SilentlyContinue)) {
  throw 'Firefox HTTP bridge must be running on 127.0.0.1:18080'
}
$before = @((Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' |
  ForEach-Object { $_.InterfaceAlias + '/' + $_.NextHop }))
$external = @(Resolve-DnsName api.ipify.org -Type A -ErrorAction Stop |
  Where-Object { $_.IPAddress -match '^\d+\.\d+\.\d+\.\d+$' } |
  Select-Object -ExpandProperty IPAddress -Unique)[0]
$arguments = @(
  '--setup', '--proxy', 'http://127.0.0.1:18080', '--dns', $DnsStrategy,
  '--mtu', '1400', '--tcp-mss', '1360', '--max-sessions', '300',
  '--verbosity', 'warn',
  '--bypass', $UpstreamIp,
  '--bypass', '146.75.117.91',
  '--bypass', '151.101.1.91'
)
$proc = $null
try {
  $proc = Start-Process -FilePath $tun -ArgumentList $arguments -PassThru -WindowStyle Hidden -RedirectStandardError '.run\smoke.err' -RedirectStandardOutput '.run\smoke.out'
  Start-Sleep -Seconds 3
  $proc.Refresh()
  Write-Output ('TunnelRunning=' + (-not $proc.HasExited))
  $during = @(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' |
    ForEach-Object { $_.InterfaceAlias + '/' + $_.NextHop })
  Write-Output ('DefaultRoutesDuring=' + ($during -join ','))
  Get-DnsClientServerAddress -AddressFamily IPv4 |
    Where-Object { $_.ServerAddresses.Count -gt 0 } |
    ForEach-Object { Write-Output ('DNS=' + $_.InterfaceAlias + ':' + ($_.ServerAddresses -join ',')) }
  if (-not $proc.HasExited) {
    $env:NO_PROXY = ''
    $env:no_proxy = ''
    $ip = & curl.exe -q -sS --connect-timeout 4 --max-time 9 --resolve ('api.ipify.org:443:' + $external) 'https://api.ipify.org' 2>$null
    Write-Output ('TunneledIp=' + ($ip -join ''))
    Write-Output ('CurlExitCode=' + $LASTEXITCODE)
  }
} finally {
  if ($proc) {
    $proc.Refresh()
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
  }
  $after = @((Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' |
    ForEach-Object { $_.InterfaceAlias + '/' + $_.NextHop }))
  Write-Output ('DefaultRoutesRestored=' + ((@($before) -join ',') -eq (@($after) -join ',')))
}
