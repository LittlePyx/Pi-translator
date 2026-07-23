param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

Add-Type -AssemblyName System.Drawing

$sourceLogo = Join-Path $ProjectRoot 'public\brand\pi_logo.png'
$teamLogo = Join-Path $ProjectRoot 'public\brand\team_logo.png'
$outputDirectory = Join-Path $ProjectRoot 'store-assets'
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null

function New-RoundedPath {
  param(
    [System.Drawing.RectangleF]$Rectangle,
    [float]$Radius
  )
  $diameter = $Radius * 2
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddArc($Rectangle.X, $Rectangle.Y, $diameter, $diameter, 180, 90)
  $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Y, $diameter, $diameter, 270, 90)
  $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($Rectangle.X, $Rectangle.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-Canvas {
  param([int]$Width, [int]$Height)
  $bitmap = [System.Drawing.Bitmap]::new($Width, $Height)
  $bitmap.SetResolution(144, 144)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  return @{ Bitmap = $bitmap; Graphics = $graphics }
}

function Save-Canvas {
  param($Canvas, [string]$Path)
  $Canvas.Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $Canvas.Graphics.Dispose()
  $Canvas.Bitmap.Dispose()
}

$pi = [System.Drawing.Image]::FromFile($sourceLogo)
$team = [System.Drawing.Image]::FromFile($teamLogo)

try {
  $icon = New-Canvas 300 300
  $icon.Graphics.Clear([System.Drawing.Color]::FromArgb(245, 247, 255))
  $iconBackground = New-RoundedPath ([System.Drawing.RectangleF]::new(18, 18, 264, 264)) 54
  $iconBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.Point]::new(18, 18),
    [System.Drawing.Point]::new(282, 282),
    [System.Drawing.Color]::White,
    [System.Drawing.Color]::FromArgb(224, 231, 255)
  )
  $icon.Graphics.FillPath($iconBrush, $iconBackground)
  $icon.Graphics.DrawImage($pi, 55, 67, 190, 161)
  $iconBrush.Dispose()
  $iconBackground.Dispose()
  Save-Canvas $icon (Join-Path $outputDirectory 'logo-300.png')

  foreach ($spec in @(
    @{ Width = 440; Height = 280; Name = 'small-promo-440x280.png'; Title = 20; Subtitle = 11 },
    @{ Width = 1400; Height = 560; Name = 'large-promo-1400x560.png'; Title = 68; Subtitle = 17 }
  )) {
    $canvas = New-Canvas $spec.Width $spec.Height
    $gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
      [System.Drawing.Point]::new(0, 0),
      [System.Drawing.Point]::new($spec.Width, $spec.Height),
      [System.Drawing.Color]::FromArgb(30, 27, 75),
      [System.Drawing.Color]::FromArgb(91, 33, 182)
    )
    $canvas.Graphics.FillRectangle($gradient, 0, 0, $spec.Width, $spec.Height)

    $scale = $spec.Height / 280
    $tileRect = [System.Drawing.RectangleF]::new(28 * $scale, 42 * $scale, 138 * $scale, 138 * $scale)
    $tilePath = New-RoundedPath $tileRect (28 * $scale)
    $tileBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(238, 242, 255))
    $canvas.Graphics.FillPath($tileBrush, $tilePath)
    $canvas.Graphics.DrawImage(
      $pi,
      [float](48 * $scale),
      [float](67 * $scale),
      [float](98 * $scale),
      [float](83 * $scale)
    )

    $titleFont = [System.Drawing.Font]::new('Segoe UI', $spec.Title, [System.Drawing.FontStyle]::Bold)
    $subtitleFont = [System.Drawing.Font]::new('Segoe UI', $spec.Subtitle, [System.Drawing.FontStyle]::Regular)
    $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
    $soft = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(219, 234, 254))
    $canvas.Graphics.DrawString('Pi Translator', $titleFont, $white, [float](184 * $scale), [float](52 * $scale))
    if ($spec.Width -eq 440) {
      $canvas.Graphics.DrawString(
        "Academic translation`nOverleaf  |  LaTeX  |  Web",
        $subtitleFont,
        $soft,
        [float](186 * $scale),
        [float](105 * $scale)
      )
    }
    else {
      $canvas.Graphics.DrawString(
        'Academic translation for Overleaf, LaTeX, and the web',
        $subtitleFont,
        $soft,
        [float](186 * $scale),
        [float](144 * $scale)
      )
    }
    $teamY = if ($spec.Width -eq 440) { 161 } else { 184 }
    $canvas.Graphics.DrawImage(
      $team,
      [float](190 * $scale),
      [float]($teamY * $scale),
      [float](144 * $scale),
      [float](46 * $scale)
    )

    $gradient.Dispose()
    $tilePath.Dispose()
    $tileBrush.Dispose()
    $titleFont.Dispose()
    $subtitleFont.Dispose()
    $white.Dispose()
    $soft.Dispose()
    Save-Canvas $canvas (Join-Path $outputDirectory $spec.Name)
  }
}
finally {
  $pi.Dispose()
  $team.Dispose()
}

Write-Output "Generated Edge store assets in $outputDirectory"
