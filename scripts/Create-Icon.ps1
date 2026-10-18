$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$assets = Join-Path $root 'assets'
New-Item -ItemType Directory -Force -Path $assets | Out-Null
$bmp = New-Object Drawing.Bitmap(256,256)
$graphics = [Drawing.Graphics]::FromImage($bmp)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([Drawing.Color]::Transparent)
$rect = New-Object Drawing.RectangleF(9,9,238,238)
$radius = 54
$path = New-Object Drawing.Drawing2D.GraphicsPath
$diam = [float]($radius * 2)
$path.AddArc($rect.Left,$rect.Top,$diam,$diam,180,90)
$path.AddArc(($rect.Right-$diam),$rect.Top,$diam,$diam,270,90)
$path.AddArc(($rect.Right-$diam),($rect.Bottom-$diam),$diam,$diam,0,90)
$path.AddArc($rect.Left,($rect.Bottom-$diam),$diam,$diam,90,90)
$path.CloseFigure()
$bg = New-Object Drawing.Drawing2D.LinearGradientBrush($rect,[Drawing.ColorTranslator]::FromHtml('#142D42'),[Drawing.ColorTranslator]::FromHtml('#08111E'),45)
$graphics.FillPath($bg,$path)
$border = New-Object Drawing.Pen([Drawing.ColorTranslator]::FromHtml('#36706D'),4)
$graphics.DrawPath($border,$path)
$line = New-Object Drawing.Pen([Drawing.ColorTranslator]::FromHtml('#69E8CD'),13)
$line.StartCap = [Drawing.Drawing2D.LineCap]::Round
$line.EndCap = [Drawing.Drawing2D.LineCap]::Round
$line.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
$points = [Drawing.PointF[]]@(
  (New-Object Drawing.PointF(46,134)),
  (New-Object Drawing.PointF(86,134)),
  (New-Object Drawing.PointF(109,81)),
  (New-Object Drawing.PointF(145,182)),
  (New-Object Drawing.PointF(169,134)),
  (New-Object Drawing.PointF(209,134))
)
$graphics.DrawLines($line,$points)
$graphics.Dispose();$line.Dispose();$border.Dispose();$bg.Dispose();$path.Dispose()
$png=Join-Path $assets 'relayroute.png'
$bmp.Save($png,[Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$bytes=[IO.File]::ReadAllBytes($png)
$ico=Join-Path $assets 'relayroute.ico'
$stream=New-Object IO.FileStream($ico,[IO.FileMode]::Create)
$writer=New-Object IO.BinaryWriter($stream)
$writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]1)
$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([byte]0)
$writer.Write([uint16]1);$writer.Write([uint16]32)
$writer.Write([uint32]$bytes.Length);$writer.Write([uint32]22)
$writer.Write($bytes);$writer.Dispose();$stream.Dispose()
Write-Output ('Created ' + $ico)
