param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$PromoBackground = '',
  [string]$LargePromoBackground = ''
)

Add-Type -AssemblyName System.Drawing

$sourceLogo = Join-Path $ProjectRoot 'public\brand\pi_logo.png'
$teamLogo = Join-Path $ProjectRoot 'public\brand\team_logo.png'
$productScreenshot = Join-Path $ProjectRoot 'store-assets\screenshots\product-translation-1280x800.png'
$outputDirectory = Join-Path $ProjectRoot 'store-assets'
if ([string]::IsNullOrWhiteSpace($PromoBackground)) {
  $PromoBackground = Join-Path $ProjectRoot 'store-assets\source\small-promo-background-v2.png'
}
if ([string]::IsNullOrWhiteSpace($LargePromoBackground)) {
  $LargePromoBackground = Join-Path $ProjectRoot 'store-assets\source\large-promo-background-v2.png'
}
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
  $bitmap = [System.Drawing.Bitmap]::new(
    $Width,
    $Height,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $bitmap.SetResolution(96, 96)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  return @{ Bitmap = $bitmap; Graphics = $graphics }
}

function Save-Canvas {
  param($Canvas, [string]$Path)
  $Canvas.Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $Canvas.Graphics.Dispose()
  $Canvas.Bitmap.Dispose()
}

function Draw-RoundedImage {
  param(
    [System.Drawing.Graphics]$Graphics,
    [System.Drawing.Image]$Image,
    [System.Drawing.Rectangle]$Destination,
    [System.Drawing.Rectangle]$Source,
    [float]$Radius
  )
  $path = New-RoundedPath ([System.Drawing.RectangleF]::new(
    $Destination.X,
    $Destination.Y,
    $Destination.Width,
    $Destination.Height
  )) $Radius
  $state = $Graphics.Save()
  $Graphics.SetClip($path)
  $Graphics.DrawImage($Image, $Destination, $Source, [System.Drawing.GraphicsUnit]::Pixel)
  $Graphics.Restore($state)
  $path.Dispose()
}

function Draw-TintedImage {
  param(
    [System.Drawing.Graphics]$Graphics,
    [System.Drawing.Image]$Image,
    [System.Drawing.Rectangle]$Destination,
    [System.Drawing.Color]$Color
  )
  $matrix = [System.Drawing.Imaging.ColorMatrix]::new()
  $matrix.Matrix00 = 0
  $matrix.Matrix11 = 0
  $matrix.Matrix22 = 0
  $matrix.Matrix40 = $Color.R / 255
  $matrix.Matrix41 = $Color.G / 255
  $matrix.Matrix42 = $Color.B / 255
  $attributes = [System.Drawing.Imaging.ImageAttributes]::new()
  $attributes.SetColorMatrix($matrix)
  $Graphics.DrawImage(
    $Image,
    $Destination,
    0,
    0,
    $Image.Width,
    $Image.Height,
    [System.Drawing.GraphicsUnit]::Pixel,
    $attributes
  )
  $attributes.Dispose()
}

$pi = [System.Drawing.Image]::FromFile($sourceLogo)
$team = [System.Drawing.Image]::FromFile($teamLogo)
$background = [System.Drawing.Image]::FromFile($PromoBackground)
$largeBackground = [System.Drawing.Image]::FromFile($LargePromoBackground)
$product = [System.Drawing.Image]::FromFile($productScreenshot)

try {
  # The Edge store logo uses the original brand mark on a truly transparent canvas.
  $icon = New-Canvas 300 300
  $icon.Graphics.Clear([System.Drawing.Color]::Transparent)
  $icon.Graphics.DrawImage($pi, 55, 70, 190, 160)
  Save-Canvas $icon (Join-Path $outputDirectory 'logo-300.png')

  # Small promotional tile: generated backdrop plus exact brand text and a real product screenshot.
  $small = New-Canvas 440 280
  $small.Graphics.Clear([System.Drawing.Color]::FromArgb(248, 250, 253))
  $backgroundCropHeight = [int][Math]::Round($background.Width / (440 / 280))
  $backgroundCropHeight = [Math]::Min($background.Height, $backgroundCropHeight)
  $backgroundCropY = [int](($background.Height - $backgroundCropHeight) / 2)
  $small.Graphics.DrawImage(
    $background,
    [System.Drawing.Rectangle]::new(0, 0, 440, 280),
    [System.Drawing.Rectangle]::new(0, $backgroundCropY, $background.Width, $backgroundCropHeight),
    [System.Drawing.GraphicsUnit]::Pixel
  )

  $small.Graphics.DrawImage($pi, 24, 20, 32, 27)
  $titleFont = [System.Drawing.Font]::new('Segoe UI', 21.5, [System.Drawing.FontStyle]::Bold)
  $taglineFont = [System.Drawing.Font]::new('Microsoft YaHei', 17.5, [System.Drawing.FontStyle]::Bold)
  $metaFont = [System.Drawing.Font]::new('Microsoft YaHei', 9.8, [System.Drawing.FontStyle]::Regular)
  $ink = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(24, 35, 72))
  $muted = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(91, 102, 129))
  $smallTagline = -join [char[]](0x9009, 0x4E2D, 0x5373, 0x8BD1, 0xFF0C, 0x9605, 0x8BFB, 0x4E0D, 0x4E2D, 0x65AD)
  $separator = '  ' + [char]0x00B7 + '  '
  $webText = -join [char[]](0x7F51, 0x9875)
  $metaText = $webText + $separator + 'Overleaf' + $separator + 'PDF'
  $small.Graphics.DrawString('Pi Translator', $titleFont, $ink, 66, 14)
  Draw-TintedImage $small.Graphics $team ([System.Drawing.Rectangle]::new(318, 20, 98, 31)) ([System.Drawing.Color]::FromArgb(74, 103, 166))
  $dividerPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(150, 214, 221, 235), 1)
  $small.Graphics.DrawLine($dividerPen, 24, 61, 416, 61)
  $small.Graphics.DrawString($smallTagline, $taglineFont, $ink, 24, 72)
  $small.Graphics.DrawString($metaText, $metaFont, $muted, 24, 108)

  $shadowPath = New-RoundedPath ([System.Drawing.RectangleF]::new(28, 140, 392, 112)) 12
  $shadowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(32, 35, 48, 86))
  $small.Graphics.FillPath($shadowBrush, $shadowPath)
  $shotDestination = [System.Drawing.Rectangle]::new(24, 134, 392, 112)
  $shotSource = [System.Drawing.Rectangle]::new(10, 240, 1120, 320)
  Draw-RoundedImage $small.Graphics $product $shotDestination $shotSource 11
  $shotBorder = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(180, 215, 222, 238), 1)
  $shotBorderPath = New-RoundedPath ([System.Drawing.RectangleF]::new(24, 134, 392, 112)) 11
  $small.Graphics.DrawPath($shotBorder, $shotBorderPath)

  $titleFont.Dispose()
  $taglineFont.Dispose()
  $metaFont.Dispose()
  $ink.Dispose()
  $muted.Dispose()
  $dividerPen.Dispose()
  $shadowPath.Dispose()
  $shadowBrush.Dispose()
  $shotBorder.Dispose()
  $shotBorderPath.Dispose()
  Save-Canvas $small (Join-Path $outputDirectory 'small-promo-440x280.png')

  # Large promotional tile: concise value proposition with the complete real product view.
  $large = New-Canvas 1400 560
  $large.Graphics.Clear([System.Drawing.Color]::FromArgb(248, 250, 253))
  $largeCropWidth = [int][Math]::Round($largeBackground.Height * (1400 / 560))
  $largeCropWidth = [Math]::Min($largeBackground.Width, $largeCropWidth)
  $largeCropX = [int](($largeBackground.Width - $largeCropWidth) / 2)
  $large.Graphics.DrawImage(
    $largeBackground,
    [System.Drawing.Rectangle]::new(0, 0, 1400, 560),
    [System.Drawing.Rectangle]::new($largeCropX, 0, $largeCropWidth, $largeBackground.Height),
    [System.Drawing.GraphicsUnit]::Pixel
  )

  $large.Graphics.DrawImage($pi, 76, 72, 64, 54)
  $largeTitleFont = [System.Drawing.Font]::new('Segoe UI', 52, [System.Drawing.FontStyle]::Bold)
  $largeTaglineFont = [System.Drawing.Font]::new('Microsoft YaHei', 29, [System.Drawing.FontStyle]::Bold)
  $largeMetaFont = [System.Drawing.Font]::new('Microsoft YaHei', 17.5, [System.Drawing.FontStyle]::Regular)
  $largeBodyFont = [System.Drawing.Font]::new('Microsoft YaHei', 14.2, [System.Drawing.FontStyle]::Regular)
  $largeInk = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(24, 35, 72))
  $largeMuted = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(91, 102, 129))
  $largeAccent = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(91, 76, 232))
  $largeTagline = -join [char[]](0x5212, 0x8BCD, 0x5373, 0x8BD1, 0xFF0C, 0x9605, 0x8BFB, 0x4E0D, 0x4E2D, 0x65AD)
  $largeSubtitle = (-join [char[]](0x7F51, 0x9875, 0x3001)) + 'Overleaf ' + [char]0x4E0E + ' PDF ' + (-join [char[]](0x5212, 0x8BCD, 0x7FFB, 0x8BD1))
  $largeCapabilities = (-join [char[]](0x6D41, 0x5F0F, 0x4FA7, 0x680F)) + $separator + 'LaTeX ' + (-join [char[]](0x4FDD, 0x62A4)) + $separator + 'PDF ' + (-join [char[]](0x6846, 0x9009, 0x8BC6, 0x522B))
  $large.Graphics.DrawString('Pi Translator', $largeTitleFont, $largeInk, 166, 52)
  $large.Graphics.DrawString($largeTagline, $largeTaglineFont, $largeInk, 78, 168)
  $large.Graphics.DrawString($largeSubtitle, $largeMetaFont, $largeMuted, 80, 238)
  $large.Graphics.FillRectangle($largeAccent, 80, 292, 64, 4)
  $large.Graphics.DrawString($largeCapabilities, $largeBodyFont, $largeMuted, 80, 312)
  Draw-TintedImage $large.Graphics $team ([System.Drawing.Rectangle]::new(80, 423, 205, 65)) ([System.Drawing.Color]::FromArgb(74, 103, 166))

  $largeShadowPath = New-RoundedPath ([System.Drawing.RectangleF]::new(661, 72, 686, 430)) 20
  $largeShadowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(31, 35, 48, 86))
  $large.Graphics.FillPath($largeShadowBrush, $largeShadowPath)
  $largeShotDestination = [System.Drawing.Rectangle]::new(649, 60, 686, 429)
  $largeShotSource = [System.Drawing.Rectangle]::new(0, 0, $product.Width, $product.Height)
  Draw-RoundedImage $large.Graphics $product $largeShotDestination $largeShotSource 18
  $largeShotBorder = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(200, 213, 221, 237), 2)
  $largeShotBorderPath = New-RoundedPath ([System.Drawing.RectangleF]::new(649, 60, 686, 429)) 18
  $large.Graphics.DrawPath($largeShotBorder, $largeShotBorderPath)

  $largeTitleFont.Dispose()
  $largeTaglineFont.Dispose()
  $largeMetaFont.Dispose()
  $largeBodyFont.Dispose()
  $largeInk.Dispose()
  $largeMuted.Dispose()
  $largeAccent.Dispose()
  $largeShadowPath.Dispose()
  $largeShadowBrush.Dispose()
  $largeShotBorder.Dispose()
  $largeShotBorderPath.Dispose()
  Save-Canvas $large (Join-Path $outputDirectory 'large-promo-1400x560.png')
}
finally {
  $pi.Dispose()
  $team.Dispose()
  $background.Dispose()
  $largeBackground.Dispose()
  $product.Dispose()
}

Write-Output "Generated transparent logo and refreshed promotional tiles in $outputDirectory"
