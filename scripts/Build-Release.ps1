param([switch]$SkipInstaller)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
$stage = Join-Path $root 'build\staging'
$output = Join-Path $root 'build\releases'
New-Item -ItemType Directory -Force $stage,$output | Out-Null
$env:DOTNET_CLI_TELEMETRY_OPTOUT='1'
& (Join-Path $root 'Install-Dependencies.ps1')
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw 'Dependency verification failed' }

& (Join-Path $PSScriptRoot 'Create-Icon.ps1')
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw 'Icon build failed' }
& dotnet publish 'desktop\RelayRoute.Desktop.csproj' -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:DebugType=None -o $stage
if ($LASTEXITCODE -ne 0) { throw 'WPF app publish failed' }
$exe = Join-Path $stage 'RelayRoute.exe'
if (-not (Test-Path $exe)) { throw 'RelayRoute.exe missing after publish' }
foreach ($name in @('src','bin','runtime')) {
  New-Item -ItemType Directory -Force (Join-Path $stage $name) | Out-Null
}
Copy-Item 'src\*.mjs' (Join-Path $stage 'src') -Force
foreach ($name in @('tun2proxy-bin.exe','wintun.dll')) {
  $file = Join-Path $root ('bin\'+$name)
  if (-not (Test-Path $file)) { throw ('Missing dependency: '+$file+'. Run Install-Dependencies.ps1.') }
  Copy-Item $file (Join-Path $stage 'bin') -Force
}
$node = (Get-Command node.exe -ErrorAction Stop).Source
$version = (& $node --version).Trim()
if ($version -notmatch '^v24\.') { throw ('Node.js 24.x required for deterministic packaging, detected ' + $version) }
Copy-Item $node (Join-Path $stage 'runtime\node.exe') -Force
$license = Join-Path $stage 'runtime\LICENSE'
Invoke-WebRequest -Uri ('https://raw.githubusercontent.com/nodejs/node/' + $version + '/LICENSE') -UseBasicParsing -OutFile $license -TimeoutSec 60
if (-not (Test-Path $license) -or (Get-Item $license).Length -lt 1000) { throw 'Unable to include Node.js license' }
& (Join-Path $stage 'runtime\node.exe') (Join-Path $stage 'src\controller.mjs') status
if ($LASTEXITCODE -ne 0) { throw 'Packaged runtime smoke test failed' }
if (-not $SkipInstaller) {
  $compiler = @(Get-ChildItem 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe','C:\Program Files\Inno Setup 6\ISCC.exe',(Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe') -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName)
  if (-not $compiler) { throw 'Inno Setup 6 compiler missing; install JRSoftware.InnoSetup' }
  & $compiler (Join-Path $root 'installer\RelayRoute.iss')
  if ($LASTEXITCODE -ne 0) { throw 'Installer compile failed' }
  Get-ChildItem $output -Filter 'RelayRoute-Setup-*.exe' | ForEach-Object {
    Write-Output ('Release asset: '+$_.FullName+' ('+[math]::Round($_.Length/1MB,1)+' MB)')
    Get-FileHash $_.FullName -Algorithm SHA256 | ForEach-Object { Write-Output ('SHA256: '+$_.Hash) }
  }
}
