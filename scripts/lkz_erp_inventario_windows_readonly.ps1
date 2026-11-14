# LKZ ERP — inventário SOMENTE LEITURA (Windows PowerShell 5.1+).
# Não lê banco, arquivos de cliente, CSC, certificado A1, segredo ou credencial.
# Não cria arquivos, não envia dados à internet e não altera a instalação.
# Execute no mesmo usuário Windows que instalou o ERP, com autorização.
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') {
    throw 'Este diagnóstico requer Windows.'
}
if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw 'Variável LOCALAPPDATA indisponível.'
}
$root = Join-Path -Path $env:LOCALAPPDATA -ChildPath 'Lacrose Tecnologia\LKZ ERP'
$versions = Join-Path -Path $root -ChildPath 'versions'
$found = Test-Path -LiteralPath $versions -PathType Container
$results = New-Object 'System.Collections.Generic.List[object]'
$versionNames = New-Object 'System.Collections.Generic.List[string]'

if ($found) {
    $dirs = @(Get-ChildItem -LiteralPath $versions -Directory -Force -ErrorAction Stop |
        Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0 } |
        Sort-Object Name | Select-Object -First 100)
    foreach ($dir in $dirs) {
        $versionNames.Add($dir.Name)
        $executables = @(Get-ChildItem -LiteralPath $dir.FullName -File -Filter '*.exe' -ErrorAction Stop |
            Where-Object { $_.Name -like 'LKZ-ERP*.exe' } |
            Sort-Object Name | Select-Object -First 10)
        foreach ($exe in $executables) {
            try {
                $hash = (Get-FileHash -LiteralPath $exe.FullName -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
                $signature = Get-AuthenticodeSignature -LiteralPath $exe.FullName -ErrorAction Stop
                $results.Add([pscustomobject]@{
                    versionDirectory = $dir.Name
                    executable = $exe.Name
                    bytes = $exe.Length
                    sha256 = $hash
                    productVersion = $exe.VersionInfo.ProductVersion
                    fileVersion = $exe.VersionInfo.FileVersion
                    signatureStatus = [string]$signature.Status
                })
            } catch {
                $results.Add([pscustomobject]@{
                    versionDirectory = $dir.Name
                    executable = $exe.Name
                    inspectionError = 'Não foi possível inspecionar o arquivo.'
                })
            }
        }
    }
}
[pscustomobject]@{
    report = 'LKZ ERP — inventário de binários (somente leitura)'
    scannedLocation = 'LOCALAPPDATA\Lacrose Tecnologia\LKZ ERP\versions'
    installationVersionsFound = $found
    versionDirectories = @($versionNames.ToArray())
    executables = @($results.ToArray())
    includesPersonalData = $false
    includesSecrets = $false
    note = 'Não comprova que o ERP fiscal está pronto nem substitui backup, restauração e homologação.'
} | ConvertTo-Json -Depth 5
