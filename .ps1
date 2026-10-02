$ErrorActionPreference = 'Stop'

$Server = 'http://185.206.93.224:3000'
$Password = 'gmilanaskateg'
$Root = Join-Path $env:USERPROFILE 'Desktop\received'

$StateDir = Join-Path $env:LOCALAPPDATA 'KadadFileDownloader'
$IdFile = Join-Path $StateDir 'client-id.txt'
$DoneFile = Join-Path $StateDir 'downloaded.json'

New-Item -ItemType Directory -Force -Path $Root | Out-Null
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

if (Test-Path -LiteralPath $IdFile) {
    $ClientId = (Get-Content -LiteralPath $IdFile -Raw).Trim()
}
else {
    $ClientId = [guid]::NewGuid().ToString()
    Set-Content -LiteralPath $IdFile -Value $ClientId -Encoding UTF8
}

if (Test-Path -LiteralPath $DoneFile) {
    try {
        $Done = Get-Content -LiteralPath $DoneFile -Raw | ConvertFrom-Json
    }
    catch {
        $Done = [pscustomobject]@{}
    }
}
else {
    $Done = [pscustomobject]@{}
}

function Invoke-Api {
    param(
        [string]$Method,
        [string]$Url,
        [object]$Data = $null
    )

    $Args = @(
        '-sS',
        '-X', $Method,
        '-H', "x-client-password: $Password",
        '-H', "x-client-id: $ClientId"
    )

    if ($null -ne $Data) {
        $Json = $Data | ConvertTo-Json -Compress -Depth 10

        $Args += @(
            '-H', 'Content-Type: application/json',
            '--data-raw', $Json
        )
    }

    $Result = & curl.exe @Args $Url

    if ($LASTEXITCODE -ne 0) {
        throw 'Server unavailable'
    }

    if ([string]::IsNullOrWhiteSpace($Result)) {
        return $null
    }

    return $Result | ConvertFrom-Json
}

function Send-Progress {
    param(
        [string]$Id,
        [string]$Status,
        [int]$Progress,
        [string]$ErrorMessage = ''
    )

    $Data = @{
        id       = $Id
        status   = $Status
        progress = $Progress
    }

    if ($ErrorMessage) {
        $Data.error = $ErrorMessage
    }

    try {
        Invoke-Api `
            -Method 'POST' `
            -Url "$Server/api/v1/progress" `
            -Data $Data | Out-Null
    }
    catch {}
}

function Get-LocalFolders {
    $Folders = @()

    $Directories = Get-ChildItem `
        -LiteralPath $Root `
        -Directory `
        -Recurse `
        -ErrorAction SilentlyContinue

    foreach ($Directory in $Directories) {
        $Relative = $Directory.FullName.Substring($Root.Length)
        $Relative = $Relative.TrimStart('\')
        $Relative = $Relative.Replace('\', '/')

        if ($Relative) {
            $Folders += $Relative
        }
    }

    return $Folders
}

function Get-SafeFileName {
    param([string]$Name)

    if ([string]::IsNullOrWhiteSpace($Name)) {
        return 'download'
    }

    return ($Name -replace '[<>:"/\\|?*]', '_')
}

function Save-Done {
    param(
        [string]$Id,
        [string]$Url,
        [string]$File
    )

    if ($null -eq $Done) {
        $Done = [pscustomobject]@{}
    }

    $Done | Add-Member `
        -NotePropertyName $Id `
        -NotePropertyValue ([pscustomobject]@{
            url  = $Url
            file = $File
        }) `
        -Force

    $Done |
        ConvertTo-Json -Depth 10 |
        Set-Content -LiteralPath $DoneFile -Encoding UTF8
}

function Download-Job {
    param([object]$Job)

    $Destination = $Root

    if ($Job.folder) {
        foreach ($Part in ($Job.folder -split '/')) {
            if ($Part -and $Part -ne '.' -and $Part -ne '..') {
                $Destination = Join-Path $Destination $Part
            }
        }
    }

    New-Item `
        -ItemType Directory `
        -Force `
        -Path $Destination | Out-Null

    $FileName = Get-SafeFileName $Job.name
    $FilePath = Join-Path $Destination $FileName

    if (Test-Path -LiteralPath $FilePath) {
        Save-Done `
            -Id $Job.id `
            -Url $Job.url `
            -File $FilePath

        Send-Progress `
            -Id $Job.id `
            -Status 'downloaded' `
            -Progress 100

        return
    }

    Write-Host ''
    Write-Host "[DOWNLOADING] $($Job.name)" -ForegroundColor Cyan

    Send-Progress `
        -Id $Job.id `
        -Status 'downloading' `
        -Progress 0

    try {
        & curl.exe `
            -L `
            --fail `
            --progress-bar `
            --output $FilePath `
            $Job.url

        if ($LASTEXITCODE -ne 0) {
            throw 'curl download failed'
        }

        Save-Done `
            -Id $Job.id `
            -Url $Job.url `
            -File $FilePath

        Send-Progress `
            -Id $Job.id `
            -Status 'downloaded' `
            -Progress 100

        Write-Host "[DONE] $FilePath" -ForegroundColor Green
    }
    catch {
        Remove-Item `
            -LiteralPath $FilePath `
            -Force `
            -ErrorAction SilentlyContinue

        Send-Progress `
            -Id $Job.id `
            -Status 'error' `
            -Progress 0 `
            -ErrorMessage $_.Exception.Message

        Write-Host `
            "[ERROR] $($Job.name): $($_.Exception.Message)" `
            -ForegroundColor Red
    }
}

Write-Host ''
Write-Host '========================================'
Write-Host '       Kadad File Downloader'
Write-Host '========================================'
Write-Host "Server : $Server"
Write-Host "Folder : $Root"
Write-Host "Client : $ClientId"
Write-Host ''

while ($true) {
    try {
        $LocalFolders = @(Get-LocalFolders)

        $Heartbeat = Invoke-Api `
            -Method 'POST' `
            -Url "$Server/api/v1/heartbeat" `
            -Data @{
                folders = $LocalFolders
            }

        foreach ($Command in @($Heartbeat.commands)) {
            try {
                $Target = $Root

                if ($Command.folder) {
                    foreach ($Part in ($Command.folder -split '/')) {
                        if ($Part -and $Part -ne '.' -and $Part -ne '..') {
                            $Target = Join-Path $Target $Part
                        }
                    }
                }

                if ($Command.type -eq 'mkdir') {
                    New-Item `
                        -ItemType Directory `
                        -Force `
                        -Path $Target | Out-Null
                }
                elseif ($Command.type -eq 'rmdir') {
                    if (Test-Path -LiteralPath $Target) {
                        Remove-Item `
                            -LiteralPath $Target `
                            -Recurse `
                            -Force
                    }
                }

                Invoke-Api `
                    -Method 'POST' `
                    -Url "$Server/api/v1/command-done" `
                    -Data @{
                        id = $Command.id
                    } | Out-Null
            }
            catch {}
        }

        $Jobs = @(Invoke-Api `
            -Method 'GET' `
            -Url "$Server/api/v1")

        foreach ($Job in $Jobs) {
            if (
                $Done.PSObject.Properties.Name `
                -contains $Job.id
            ) {
                continue
            }

            Download-Job -Job $Job
        }
    }
    catch {
        Write-Host `
            "[OFFLINE] $($_.Exception.Message)" `
            -ForegroundColor Yellow
    }

    Start-Sleep -Seconds 3
}
