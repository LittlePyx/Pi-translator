param(
  [Parameter(Mandatory = $true)] [string] $Source
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $repo 'output/reference-ui-2026-11-10/candidate/.output/edge-mv3'
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$destinationPath = (Resolve-Path -LiteralPath $destination).Path
if ($sourcePath -eq $destinationPath) { throw 'Source and destination must differ.' }
foreach ($name in @('manifest.json', 'build-info.json', 'background.js')) {
  if (-not (Test-Path -LiteralPath (Join-Path $sourcePath $name) -PathType Leaf)) { throw "Missing source file: $name" }
}
$build = Get-Content -LiteralPath (Join-Path $sourcePath 'build-info.json') -Raw | ConvertFrom-Json
if (-not $build.buildId -or -not $build.version) { throw 'Invalid build information.' }

$backupRoot = Join-Path $repo 'output/dev-extension-backups'
$backup = Join-Path $backupRoot ((Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
& robocopy $destinationPath $backup /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Backup failed: $LASTEXITCODE" }

# Keep old hashed assets available to already-open extension pages; publish the
# manifest and build marker only after the remaining candidate files are copied.
& robocopy $sourcePath $destinationPath /E /COPY:DAT /R:1 /W:1 /XF manifest.json build-info.json /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copy failed: $LASTEXITCODE. Backup: $backup" }
foreach ($file in Get-ChildItem -LiteralPath $sourcePath -Recurse -File) {
  $relative = [System.IO.Path]::GetRelativePath($sourcePath, $file.FullName)
  if ($relative -in @('manifest.json', 'build-info.json')) { continue }
  $target = Join-Path $destinationPath $relative
  if (-not (Test-Path -LiteralPath $target -PathType Leaf) -or (Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath $target).Hash) { throw "Verification failed: $relative. Backup: $backup" }
}
Copy-Item -LiteralPath (Join-Path $sourcePath 'manifest.json') -Destination (Join-Path $destinationPath 'manifest.json') -Force
Copy-Item -LiteralPath (Join-Path $sourcePath 'build-info.json') -Destination (Join-Path $destinationPath 'build-info.json') -Force
foreach ($name in @('manifest.json', 'build-info.json')) {
  if ((Get-FileHash -LiteralPath (Join-Path $sourcePath $name)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $destinationPath $name)).Hash) { throw "Verification failed: $name. Backup: $backup" }
}
Write-Output "Updated $destinationPath"
Write-Output "Build $($build.buildId)"
Write-Output "Backup $backup"
