$ErrorActionPreference = 'Stop'
$Server = 'http://185.206.93.224:3000'
$ClientPassword = 'admin'
$Root = Join-Path $env:USERPROFILE 'Desktop\received'
New-Item -ItemType Directory -Force -Path $Root | Out-Null
$State = Join-Path $env:LOCALAPPDATA 'KadadFileDownloader'
New-Item -ItemType Directory -Force -Path $State | Out-Null
$IdFile = Join-Path $State 'client-id.txt'
if (Test-Path $IdFile) { $ClientId = (Get-Content -Raw $IdFile).Trim() } else { $ClientId = [guid]::NewGuid().ToString(); Set-Content $IdFile $ClientId }
function Api($Method,$Url,$Data) {
  $args=@('-sS','-X',$Method,'-H',"x-client-password: $ClientPassword",'-H',"x-client-id: $ClientId")
  if($null -ne $Data){$args+=@('-H','Content-Type: application/json','--data-raw',($Data|ConvertTo-Json -Compress))}
  $out=& curl.exe @args $Url
  if($LASTEXITCODE -ne 0){throw 'connection failed'}
  if($out){return $out|ConvertFrom-Json}
}
Write-Host "Kadad File Downloader"
Write-Host "Server: $Server"
while($true){
  try{
    $folders=@(Get-ChildItem $Root -Directory -Recurse -ErrorAction SilentlyContinue | ForEach-Object {$_.FullName.Substring($Root.Length).TrimStart('\').Replace('\','/')})
    $hb=Api POST "$Server/api/v1/heartbeat" @{folders=$folders}
    $jobs=@(Api GET "$Server/api/v1")
    foreach($job in $jobs){
      $dest=$Root
      if($job.folder){foreach($p in ($job.folder -split '/'|Where-Object{$_ -and $_ -ne '..'}){$dest=Join-Path $dest $p}}
      New-Item -ItemType Directory -Force -Path $dest | Out-Null
      $name=($job.name -replace '[<>:"/\\|?*]','_')
      $file=Join-Path $dest $name
      if(Test-Path $file){Api POST "$Server/api/v1/progress" @{id=$job.id;progress=100;status='downloaded'}|Out-Null;continue}
      Api POST "$Server/api/v1/progress" @{id=$job.id;progress=0;status='downloading'}|Out-Null
      & curl.exe -L --fail --progress-bar --output $file $job.url
      if($LASTEXITCODE -eq 0){Api POST "$Server/api/v1/progress" @{id=$job.id;progress=100;status='downloaded'}|Out-Null}
    }
  }catch{Write-Host "[OFFLINE] $($_.Exception.Message)"}
  Start-Sleep 3
}