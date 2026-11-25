param(
    [Parameter(Mandatory)][string] $Previous,
    [Parameter(Mandatory)][string] $Candidate,
    [Parameter(Mandatory)][string] $BuildTools
)
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$ErrorActionPreference = 'Stop'

function Read-ApkIdentity($Apk) {
    $metadata = & (Join-Path $BuildTools 'aapt.exe') dump badging $Apk
    if ($LASTEXITCODE -ne 0) { throw "Could not read APK metadata for $Apk." }
    if (($metadata -join "`n") -notmatch "package: name='([^']+)' versionCode='(\d+)'") {
        throw "Package name or version is missing from $Apk."
    }
    $packageName = $Matches[1]
    $versionCode = [long]$Matches[2]
    $certificates = & (Join-Path $BuildTools 'apksigner.bat') verify --print-certs $Apk
    if ($LASTEXITCODE -ne 0) { throw "APK signature did not verify for $Apk." }
    $digests = @($certificates | ForEach-Object {
        if ($_ -match '^Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]{64})$') { $Matches[1].ToLowerInvariant() }
    } | Sort-Object)
    if ($digests.Count -eq 0) { throw "No signing certificate found in $Apk." }
    [pscustomobject]@{ Package = $packageName; Version = $versionCode; Signers = $digests -join ',' }
}

function Export-TestAssets($Apk, $Destination) {
    $archive = [IO.Compression.ZipFile]::OpenRead($Apk)
    try {
        $origin = 'https://appassets.androidplatform.net/index.html'
        $hasOrigin = $false
        foreach ($entry in $archive.Entries) {
            if (-not $hasOrigin -and $entry.FullName -match '^classes\d*\.dex$') {
                $stream = $entry.Open()
                $buffer = [IO.MemoryStream]::new()
                try {
                    $stream.CopyTo($buffer)
                    $hasOrigin = [Text.Encoding]::ASCII.GetString($buffer.ToArray()).Contains($origin)
                } finally {
                    $buffer.Dispose()
                    $stream.Dispose()
                }
            }
            if ($entry.FullName -notmatch '^assets/(index\.html|manifest\.webmanifest|icon-\d+\.png|sparky\.glb|sparky-contact\.png|sparky-progress\.webp|sparky-view-(0|75|180)\.png|turtle-plush-[a-z]+(-\d+)?\.(webp|png)|assets/[A-Za-z0-9_.-]+\.(js|css|woff2))$') { continue }
            $relative = $entry.FullName.Substring('assets/'.Length)
            $target = Join-Path $Destination $relative
            New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $false)
        }
        if (-not $hasOrigin) { throw "The original Android storage origin is missing from $Apk." }
        if (-not (Test-Path -LiteralPath (Join-Path $Destination 'index.html'))) { throw "One Life assets are missing from $Apk." }
    } finally { $archive.Dispose() }
}

$previousApk = (Resolve-Path -LiteralPath $Previous).Path
$candidateApk = (Resolve-Path -LiteralPath $Candidate).Path
$old = Read-ApkIdentity $previousApk
$new = Read-ApkIdentity $candidateApk
if ($old.Package -cne $new.Package) { throw 'An update must keep the installed Android application ID.' }
if ($old.Signers -cne $new.Signers) { throw 'An update must keep the installed signing certificate.' }
if ($old.Version -ge $new.Version) { throw 'Increase the Android version code before publishing an update.' }
$permissions = & (Join-Path $BuildTools 'aapt.exe') dump permissions $candidateApk
if ($LASTEXITCODE -ne 0 -or ($permissions -join "`n") -notmatch "name='android\.permission\.PACKAGE_USAGE_STATS'") {
    throw 'The Android update is missing its screen time permission.'
}
Write-Output "Package and signing certificate match. Android version code increases from $($old.Version) to $($new.Version)."

$project = Split-Path -Parent $PSScriptRoot
$testRoot = (New-Item -ItemType Directory -Path (Join-Path $project 'test-results') -Force).FullName
$temporary = (New-Item -ItemType Directory -Path (Join-Path $testRoot ("upgrade-" + [guid]::NewGuid()))).FullName
try {
    $before = Join-Path $temporary 'before'
    $after = Join-Path $temporary 'after'
    Export-TestAssets $previousApk $before
    Export-TestAssets $candidateApk $after
    & node (Join-Path $project 'tests/upgrade-check.mjs') $before $after
    if ($LASTEXITCODE -ne 0) { throw 'The update did not pass the saved data check.' }
} finally {
    $resolved = (Resolve-Path -LiteralPath $temporary).Path
    if ([string]::Equals((Split-Path -Parent $resolved), $testRoot, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
