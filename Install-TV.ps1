[CmdletBinding()]
param(
    [string]$TvAddress,
    [string]$CertificateProfile,
    [string]$TizenStudio = 'C:\tizen-studio',
    [switch]$BuildOnly
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Builds/signs only this app. Does not alter certificates, firewall or TV firmware.
$Project = [IO.Path]::GetFullPath($PSScriptRoot)
$Tizen = Join-Path $TizenStudio 'tools\ide\bin\tizen.bat'
$Sdb = Join-Path $TizenStudio 'tools\sdb.exe'
$App = Join-Path $Project 'app'
$Build = Join-Path $App '.buildResult'
$Output = Join-Path $Project 'dist'
$AllowedFiles = @('app.js', 'config.xml', 'core.js', 'features.js', 'saved.js', 'services.js', 'home.js', 'preview.js', 'preview-service.js', 'qr.js', 'subtitles.js', 'japanese.woff2', 'han.woff2', 'font-license.txt', 'LICENSE', 'icon.png', 'index.html', 'player.js', 'styles.css')

function Assert-PlainTree {
    param([string]$Path)
    if (Test-Path -LiteralPath $Path) {
        $Item = Get-Item -LiteralPath $Path -Force
        if ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Refusing a symbolic link or junction: $($Item.FullName)"
        }
        if ($Item.PSIsContainer) {
            foreach ($Child in Get-ChildItem -LiteralPath $Path -Force) {
                Assert-PlainTree -Path $Child.FullName
            }
        }
    }
}
function Invoke-Tizen {
    param([string[]]$CliArgs)
    & $Tizen @CliArgs
    if ($LASTEXITCODE -ne 0) { throw "Tizen command failed ($LASTEXITCODE). Read the error above." }
}

# These values cross tizen.bat's cmd.exe boundary; reject shell metacharacters.
foreach ($Value in @($Project, $TizenStudio)) {
    if ($Value -match '[&|<>^%"!\r\n]') { throw 'Use a project and SDK path without shell metacharacters.' }
}
if (!(Test-Path -LiteralPath $Tizen -PathType Leaf)) { throw "Tizen CLI not found at $Tizen. Install Tizen Studio Web CLI or supply -TizenStudio." }
if (!$BuildOnly -and !(Test-Path -LiteralPath $Sdb -PathType Leaf)) { throw "SDB not found at $Sdb." }
if (!$CertificateProfile) { $CertificateProfile = Read-Host 'Samsung TV certificate profile name (not its password)' }
if ($CertificateProfile -notmatch '^[A-Za-z0-9][A-Za-z0-9 ._-]*$') { throw 'Use a profile name containing letters, numbers, spaces, dots, underscores or hyphens.' }

Assert-PlainTree -Path $App
Assert-PlainTree -Path $Output
foreach ($Name in $AllowedFiles) {
    if (!(Test-Path -LiteralPath (Join-Path $App $Name) -PathType Leaf)) { throw "Missing app file: $Name" }
}
foreach ($Item in Get-ChildItem -LiteralPath $App -Force) {
    if ($Item.Name -eq '.buildResult' -and $Item.PSIsContainer) { continue }
    if ($Item.PSIsContainer -or $Item.Name -cnotin $AllowedFiles) {
        throw "Unexpected app content: $($Item.Name). Keep secrets outside app; review new assets before adding them to AllowedFiles."
    }
}
$XmlSettings = New-Object System.Xml.XmlReaderSettings
$XmlSettings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
$XmlSettings.XmlResolver = $null
$Reader = [System.Xml.XmlReader]::Create((Join-Path $App 'config.xml'), $XmlSettings)
$Manifest = New-Object System.Xml.XmlDocument
try { $Manifest.Load($Reader) } finally { $Reader.Dispose() }
$Ns = New-Object System.Xml.XmlNamespaceManager($Manifest.NameTable)
$Ns.AddNamespace('t', 'http://tizen.org/ns/widgets')
$Application = $Manifest.SelectSingleNode('/*/t:application', $Ns)
if (!$Application) { throw 'Missing Tizen application manifest.' }
$AppId = $Application.GetAttribute('id')
$PackageId = $Application.GetAttribute('package')
if ($PackageId -notmatch '^[A-Za-z0-9]{10}$' -or $AppId -notmatch ('^' + [regex]::Escape($PackageId) + '\.[A-Za-z0-9_]+$')) { throw 'Invalid Tizen application/package ID.' }
if ($Application.GetAttribute('required_version') -ne '5.0') { throw 'The initial compatibility baseline must remain Tizen 5.0.' }

if (!$BuildOnly) {
    if (!$TvAddress) { $TvAddress = Read-Host 'TV IPv4 address (Network Status > IP Settings)' }
    $ParsedIp = $null
    if ($TvAddress -notmatch '^\d{1,3}(\.\d{1,3}){3}$' -or ![Net.IPAddress]::TryParse($TvAddress, [ref]$ParsedIp) -or $ParsedIp.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw 'Enter a dotted TV IPv4 address only, such as 192.168.1.40.' }
    $TvAddress = $ParsedIp.ToString()
    & $Sdb connect $TvAddress
    if ($LASTEXITCODE -ne 0) { throw 'Cannot connect to the TV. Check Developer Mode and the allowed PC address.' }
    $DeviceLines = & $Sdb devices
    if ($LASTEXITCODE -ne 0) { throw 'SDB could not list devices.' }
    $Serial = $null
    foreach ($Line in $DeviceLines) {
        if ($Line -match '^\s*(\S+)\s+device\s+' -and ($Matches[1] -eq $TvAddress -or $Matches[1] -eq ("{0}:26101" -f $TvAddress))) {
            $Serial = $Matches[1]
            break
        }
    }
    if (!$Serial) { throw 'Requested TV is not an authorized device. Check Developer Mode and Device Manager > Permit to install applications.' }
}

# Verify the resolved target and reject links before recursive removal.
$ExpectedBuild = [IO.Path]::GetFullPath((Join-Path $Project 'app\.buildResult'))
if ([IO.Path]::GetFullPath($Build) -ne $ExpectedBuild -or !$ExpectedBuild.StartsWith($Project + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe build cleanup path.' }
if (Test-Path -LiteralPath $Build) {
    if ((Resolve-Path -LiteralPath $Build).ProviderPath -ne $ExpectedBuild) { throw 'Unexpected resolved build path.' }
    Remove-Item -LiteralPath $Build -Recurse -Force
}
Invoke-Tizen -CliArgs @('build-web', '--', $App)
Assert-PlainTree -Path $Build
Invoke-Tizen -CliArgs @('package', '-t', 'wgt', '-s', $CertificateProfile, '--', $Build)
Assert-PlainTree -Path $Build
$Packages = @(Get-ChildItem -LiteralPath $Build -Filter '*.wgt' -File)
if ($Packages.Count -ne 1) { throw 'Expected exactly one freshly signed WGT in app\.buildResult.' }

# Inspect the actual archive, not just .gitignore: ignored secrets can still be packaged.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$Archive = [IO.Compression.ZipFile]::OpenRead($Packages[0].FullName)
try {
    $Names = @($Archive.Entries | ForEach-Object { $_.FullName })
    foreach ($Name in $Names) {
        if ($Name -cnotin ($AllowedFiles + @('author-signature.xml', 'signature1.xml'))) { throw "Unexpected package entry: $Name" }
    }
    foreach ($Name in ($AllowedFiles + @('author-signature.xml', 'signature1.xml'))) {
        if (@($Names | Where-Object { $_ -ceq $Name }).Count -ne 1) { throw "Missing or duplicate package entry: $Name" }
    }
} finally { $Archive.Dispose() }
New-Item -ItemType Directory -Path $Output -Force | Out-Null
$SignedPackage = Join-Path $Output 'TizenOSPlex.wgt'
Copy-Item -LiteralPath $Packages[0].FullName -Destination $SignedPackage -Force
Write-Host "Signed package: $SignedPackage"
Write-Host "SHA256: $((Get-FileHash -LiteralPath $SignedPackage -Algorithm SHA256).Hash)"
if (!$BuildOnly) {
    Invoke-Tizen -CliArgs @('install', '-s', $Serial, '--name', 'TizenOSPlex.wgt', '--', $Output)
    Invoke-Tizen -CliArgs @('run', '-s', $Serial, '-p', $AppId)
    Write-Host 'TizenOS Plex launched. Existing setup is retained on an in-place update; first-time users can link Plex on the TV.'
}
