param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repoRoot 'dist/skp-worker' }
$output = [IO.Path]::GetFullPath($OutputDirectory)
$staging = Join-Path ([IO.Path]::GetTempPath()) ('fds-skp-build-' + [Guid]::NewGuid().ToString('N'))
$payload = Join-Path $staging 'payload'
New-Item -ItemType Directory -Path $payload,$output -Force | Out-Null
Push-Location $repoRoot
try {
    & node (Join-Path $PSScriptRoot 'build.mjs') $payload
    if ($LASTEXITCODE -ne 0) { throw 'Worker bundle failed' }
    & node (Join-Path $PSScriptRoot 'test-bundle.mjs') $payload
    if ($LASTEXITCODE -ne 0) { throw 'Bundled Worker integration test failed' }
    $archive = Join-Path $staging 'payload.zip'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($payload, $archive, [IO.Compression.CompressionLevel]::Optimal, $false)
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    $exe = Join-Path $output 'FDS-SKP-Worker-Setup.exe'
    & $compiler /nologo /target:winexe /platform:x64 /optimize+ "/out:$exe" "/resource:$archive,payload.zip" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Security.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll /reference:Microsoft.CSharp.dll (Join-Path $PSScriptRoot 'WorkerSetup.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed' }
    $testOutput = Join-Path $staging 'self-test.txt'
    $testProcess = Start-Process -FilePath $exe -ArgumentList @('--self-test', ('"' + $testOutput + '"')) -WindowStyle Hidden -Wait -PassThru
    if (Test-Path -LiteralPath $testOutput) { Get-Content -LiteralPath $testOutput }
    if ($testProcess.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $testOutput)) { throw 'Installer self-test failed' }
    $hash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
    Set-Content -LiteralPath ($exe + '.sha256') -Value ($hash + '  FDS-SKP-Worker-Setup.exe') -Encoding ASCII
    Write-Output "Built: $exe"
    Write-Output "SHA256: $hash"
} finally {
    Pop-Location
    # Only remove the GUID directory created by this build, beneath the verified temp root.
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $resolvedStaging = [IO.Path]::GetFullPath($staging)
    if ($resolvedStaging.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolvedStaging -Leaf) -match '^fds-skp-build-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
    }
}
