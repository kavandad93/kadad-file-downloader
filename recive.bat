@echo off
setlocal EnableExtensions
title Kadad File Downloader Client

REM ====== CHANGE THESE TWO VALUES ======
set "KADAD_SERVER=http://185.206.93.224:3000"
set "KADAD_CLIENT_PASSWORD=admin"
REM =====================================

set "ROOT=%USERPROFILE%\Desktop\received"
if not exist "%ROOT%" mkdir "%ROOT%"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=Get-Content -Raw '%~f0'; $m='# --- POWERSHELL CLIENT ---'; $s=$p.IndexOf($m); if($s -ge 0){iex $p.Substring($s+$m.Length)}"
exit /b

# --- POWERSHELL CLIENT ---
$ErrorActionPreference='Stop'
$server=$env:KADAD_SERVER
$pass=$env:KADAD_CLIENT_PASSWORD
if([string]::IsNullOrWhiteSpace($server)){ Write-Host 'KADAD_SERVER is empty.' -ForegroundColor Red; pause; exit }
$root=Join-Path $env:USERPROFILE 'Desktop\received'
New-Item -ItemType Directory -Force -Path $root | Out-Null
$idFile=Join-Path $PSScriptRoot 'client-id.txt'
$memFile=Join-Path $PSScriptRoot 'downloaded.json'
if(Test-Path $idFile){$clientId=(Get-Content $idFile -Raw).Trim()}else{$clientId=[guid]::NewGuid().ToString();Set-Content $idFile $clientId}
if(Test-Path $memFile){try{$mem=Get-Content $memFile -Raw|ConvertFrom-Json}catch{$mem=@{}}}else{$mem=@{}}
if($mem -isnot [pscustomobject]){$mem=[pscustomobject]@{}}
function Api($method,$url,$data=$null){
  $args=@('-sS','-X',$method,'-H',"x-client-password: $pass",'-H',"x-client-id: $clientId")
  if($null-ne$data){$json=$data|ConvertTo-Json -Compress -Depth 5;$args+=@('-H','Content-Type: application/json','--data-raw',$json)}
  $out=& curl.exe @args "$url"
  if($LASTEXITCODE-ne0){throw 'connection failed'}
  if([string]::IsNullOrWhiteSpace($out)){return $null}
  return $out|ConvertFrom-Json
}
function Folders{
  $list=@()
  Get-ChildItem -LiteralPath $root -Directory -Recurse -ErrorAction SilentlyContinue|ForEach-Object{
    $r=$_.FullName.Substring($root.Length).TrimStart('\').Replace('\','/')
    if($r){$list+=$r}
  }
  return $list
}
function SafeName($n){if([string]::IsNullOrWhiteSpace($n)){$n='download'};return ($n -replace '[<>:"/\\|?*]','_')}
function Download($x){
  $dest=$root
  if($x.folder){foreach($part in ($x.folder -split '/'|Where-Object{$_ -and $_ -ne '.' -and $_ -ne '..'}){$dest=Join-Path $dest $part}}
  New-Item -ItemType Directory -Force -Path $dest|Out-Null
  $file=Join-Path $dest (SafeName $x.name)
  if(Test-Path $file){Api POST "$server/api/v1/progress" @{id=$x.id;progress=100;status='downloaded'}|Out-Null;return}
  Api POST "$server/api/v1/progress" @{id=$x.id;progress=0;status='downloading'}|Out-Null
  try{
    & curl.exe -L --fail --silent --show-error --output "$file" "$($x.url)"
    if($LASTEXITCODE-ne0){throw 'curl download failed'}
    $mem|Add-Member -NotePropertyName $x.id -NotePropertyValue ([pscustomobject]@{url=$x.url;file=$file;time=(Get-Date).ToString('o')}) -Force
    $mem|ConvertTo-Json -Depth 5|Set-Content $memFile
    Api POST "$server/api/v1/progress" @{id=$x.id;progress=100;status='downloaded'}|Out-Null
    Write-Host "[DONE] $file" -ForegroundColor Green
  }catch{
    Remove-Item $file -Force -ErrorAction SilentlyContinue
    Api POST "$server/api/v1/progress" @{id=$x.id;progress=0;status='error';error=$_.Exception.Message}|Out-Null
    Write-Host "[ERROR] $($x.name): $($_.Exception.Message)" -ForegroundColor Red
  }
}
Write-Host 'Kadad File Downloader Client'
Write-Host "Server: $server"
Write-Host "Receive folder: $root"
while($true){
  try{
    $hb=Api POST "$server/api/v1/heartbeat" @{folders=@(Folders)}
    foreach($c in @($hb.commands)){
      try{
        if($c.type -eq 'mkdir'){
          $d=$root
          foreach($part in ($c.folder -split '/'|Where-Object{$_ -and $_ -ne '.' -and $_ -ne '..'}){$d=Join-Path $d $part}
          New-Item -ItemType Directory -Force -Path $d|Out-Null
        }elseif($c.type -eq 'rmdir' -and $c.folder){
          $d=$root
          foreach($part in ($c.folder -split '/'|Where-Object{$_ -and $_ -ne '.' -and $_ -ne '..'}){$d=Join-Path $d $part}
          if(Test-Path $d){Remove-Item $d -Recurse -Force}
        }
        Api POST "$server/api/v1/command-done" @{id=$c.id}|Out-Null
      }catch{}
    }
    $items=@(Api GET "$server/api/v1")
    foreach($x in $items){
      if($mem.PSObject.Properties.Name -contains $x.id){continue}
      Download $x
    }
  }catch{Write-Host '[OFFLINE] Server unavailable' -ForegroundColor DarkYellow}
  Start-Sleep -Seconds 3
}
