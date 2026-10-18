# Recovery utility for a hard-crashed Firefox System VPN.
# It stops only tun2proxy processes running from this project's bin folder.
$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$exe = [System.IO.Path]::GetFullPath((Join-Path $root 'bin\tun2proxy-bin.exe'))
$ended = 0
$processes = @(Get-CimInstance Win32_Process -Filter "Name = 'tun2proxy-bin.exe'")
foreach ($p in $processes) {
  if ([string]::Equals($p.ExecutablePath, $exe, [System.StringComparison]::OrdinalIgnoreCase)) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
    $ended++
  }
}
Start-Sleep -Seconds 2
$stillRunning = @(Get-CimInstance Win32_Process -Filter "Name = 'tun2proxy-bin.exe'" |
  Where-Object { [string]::Equals($_.ExecutablePath, $exe, [System.StringComparison]::OrdinalIgnoreCase) })
if ($stillRunning.Count -gt 0) { throw 'Firefox System VPN adapter process could not be stopped' }
$run = Join-Path $root '.run'
$lock = Join-Path $run 'controller.lock'
if (Test-Path -LiteralPath $lock) {
  $data = Get-Content -LiteralPath $lock -Raw | ConvertFrom-Json
  if (-not (Get-Process -Id $data.pid -ErrorAction SilentlyContinue)) {
    Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue
  }
}
Write-Output ('Stopped orphan tun2proxy processes: ' + $ended)
Get-NetRoute -DestinationPrefix '0.0.0.0/0' -AddressFamily IPv4 |
  ForEach-Object { Write-Output ('Default route: ' + $_.InterfaceAlias + ' via ' + $_.NextHop) }
