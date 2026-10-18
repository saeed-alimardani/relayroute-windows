# Firefox System VPN for Windows - GUI
# Runs in the current user's elevated session; local processes and tokens
# are never exposed to a remote management port.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$runPath = Join-Path $root '.run'
$statusPath = Join-Path $runPath 'status.json'
$lockPath = Join-Path $runPath 'controller.lock'
$node = (Get-Command node.exe -ErrorAction Stop).Source

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $shell = (Get-Process -Id $PID).Path
  $arguments = '-NoProfile -ExecutionPolicy Bypass -STA -File "' + $PSCommandPath + '"'
  Start-Process -FilePath $shell -ArgumentList $arguments -Verb RunAs
  exit
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object System.Windows.Forms.Form
$form.Text = 'RelayRoute'
$form.Width = 470
$form.Height = 430
$form.MinimumSize = New-Object System.Drawing.Size(470, 430)
$form.MaximumSize = New-Object System.Drawing.Size(470, 430)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false
$form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi
$form.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#0F172A')
$form.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#E2E8F0')
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$form.RightToLeft = [System.Windows.Forms.RightToLeft]::Yes
$form.RightToLeftLayout = $true

function Color([string]$hex) { return [System.Drawing.ColorTranslator]::FromHtml($hex) }

function New-Text([string]$content, [int]$top, [int]$height, [int]$size, [string]$hex) {
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $content
  $label.SetBounds(24, $top, 410, $height)
  $label.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
  $label.ForeColor = Color $hex
  $label.Font = New-Object System.Drawing.Font('Segoe UI', $size)
  $form.Controls.Add($label)
  return $label
}

$header = New-Text 'RelayRoute' 25 38 19 '#F8FAFC'
$subtitle = New-Text 'اینترنت ویندوز از مسیر VPN فایرفاکس' 65 28 10 '#94A3B8'
$statusPanel = New-Object System.Windows.Forms.Panel
$statusPanel.SetBounds(27, 112, 400, 125)
$statusPanel.BackColor = Color '#1E293B'
$form.Controls.Add($statusPanel)
$statusText = New-Object System.Windows.Forms.Label
$statusText.SetBounds(16, 14, 368, 44)
$statusText.TextAlign = 'MiddleCenter'
$statusText.Font = New-Object System.Drawing.Font('Segoe UI', 15, [System.Drawing.FontStyle]::Bold)
$statusText.ForeColor = Color '#CBD5E1'
$statusText.Text = 'خاموش'
$statusPanel.Controls.Add($statusText)
$ipText = New-Object System.Windows.Forms.Label
$ipText.SetBounds(16, 65, 368, 32)
$ipText.TextAlign = 'MiddleCenter'
$ipText.Font = New-Object System.Drawing.Font('Segoe UI', 11)
$ipText.ForeColor = Color '#94A3B8'
$ipText.Text = 'IP: —'
$statusPanel.Controls.Add($ipText)

$button = New-Object System.Windows.Forms.Button
$button.SetBounds(27, 255, 400, 53)
$button.Text = 'اتصال'
$button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$button.FlatAppearance.BorderSize = 0
$button.BackColor = Color '#38BDF8'
$button.ForeColor = Color '#082F49'
$button.Font = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold)
$button.Cursor = [System.Windows.Forms.Cursors]::Hand
$form.Controls.Add($button)
$detailText = New-Text 'تونل TCP و DNS  •  ترافیک UDP پشتیبانی نمی‌شود' 325 29 9 '#94A3B8'
$errorText = New-Text '' 353 35 9 '#FCA5A5'

$script:pending = $false
$script:connected = $false
$script:quitting = $false
function Read-Status {
  try {
    if (-not (Test-Path -LiteralPath $lockPath)) {
      if (Test-Path -LiteralPath $statusPath) {
        $previous = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
        if ($previous.error) { return @{ state = 'disconnected'; error = $previous.error } }
      }
      return @{ state = 'disconnected' }
    }
    $lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
    if (-not (Get-Process -Id $lock.pid -ErrorAction SilentlyContinue)) { return @{ state = 'disconnected' } }
    if (-not (Test-Path -LiteralPath $statusPath)) { return @{ state = 'starting' } }
    return (Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json)
  } catch { return @{ state = 'starting' } }
}

function Refresh-Ui {
  $state = Read-Status
  $script:connected = $state.state -eq 'connected'
  if ($script:connected) {
    $statusText.Text = 'متصل'
    $statusText.ForeColor = Color '#4ADE80'
    $ipText.Text = 'IP: ' + $state.systemIp
    $button.Text = 'قطع اتصال'
    $button.BackColor = Color '#334155'
    $button.ForeColor = Color '#F8FAFC'
    $errorText.Text = ''
  } elseif ($state.state -in @('starting','checking','routing','stopping')) {
    $statusText.Text = 'در حال ' + $(switch ($state.state) {
      'starting' { 'راه‌اندازی' }
      'checking' { 'بررسی اتصال' }
      'routing' { 'برقراری تونل' }
      'stopping' { 'قطع اتصال' }
    })
    $statusText.ForeColor = Color '#FBBF24'
    $ipText.Text = 'IP: —'
    $button.Enabled = $false
    $errorText.Text = ''
  } else {
    $statusText.Text = 'خاموش'
    $statusText.ForeColor = Color '#CBD5E1'
    $ipText.Text = 'IP: —'
    $button.Text = 'اتصال'
    $button.BackColor = Color '#38BDF8'
    $button.ForeColor = Color '#082F49'
    $errorText.Text = if ($state.error) { [string]$state.error } else { '' }
  }
  if (-not $script:pending -and $state.state -notin @('starting','checking','routing','stopping')) { $button.Enabled = $true }
}

function Start-Vpn {
  if (-not (Test-Path -LiteralPath $runPath)) { New-Item -ItemType Directory -Path $runPath | Out-Null }
  if ((Read-Status).state -ne 'disconnected') { return }
  $script:pending = $true
  $button.Enabled = $false
  $statusText.Text = 'در حال راه‌اندازی'
  Start-Process -FilePath $node -ArgumentList 'src/controller.mjs start' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardError (Join-Path $runPath 'controller.err') -RedirectStandardOutput (Join-Path $runPath 'controller.out')
  $script:pending = $false
}

function Stop-Vpn {
  $button.Enabled = $false
  try {
    $process = Start-Process -FilePath $node -ArgumentList 'src/controller.mjs stop' -WorkingDirectory $root -WindowStyle Hidden -Wait -PassThru -RedirectStandardError (Join-Path $runPath 'stop.err') -RedirectStandardOutput (Join-Path $runPath 'stop.out')
    if ($process.ExitCode -ne 0) { throw 'خطا هنگام قطع اتصال؛ وضعیت مسیرهای شبکه را بررسی کنید.' }
  } catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Firefox VPN') | Out-Null }
}

$button.Add_Click({
  if ($script:connected) { Stop-Vpn } else { Start-Vpn }
  Refresh-Ui
})
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1400
$timer.Add_Tick({ Refresh-Ui })
$timer.Start()

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = [System.Drawing.SystemIcons]::Shield
$tray.Text = 'RelayRoute'
$tray.Visible = $true
$tray.Add_DoubleClick({ $form.Show(); $form.WindowState = 'Normal'; $form.Activate() })
$form.Add_Resize({
  if ($form.WindowState -eq 'Minimized') { $form.Hide() }
})
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$showItem = $menu.Items.Add('نمایش برنامه')
$showItem.Add_Click({ $form.Show(); $form.WindowState = 'Normal'; $form.Activate() })
$quitItem = $menu.Items.Add('خروج و قطع VPN')
$quitItem.Add_Click({ $form.Close() })
$tray.ContextMenuStrip = $menu
$form.Add_FormClosing({
  $timer.Stop()
  $state = Read-Status
  if ($state.state -ne 'disconnected') {
    Stop-Vpn
    $state = Read-Status
    if ($state.state -ne 'disconnected') {
      $_.Cancel = $true
      $timer.Start()
      return
    }
  }
  $tray.Visible = $false
  $tray.Dispose()
})
Refresh-Ui
[void]$form.ShowDialog()
