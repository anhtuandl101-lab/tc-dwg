# Build file APK cho app TC DWG. Moi cong cu va cache deu o o D.
# Chay: powershell -ExecutionPolicy Bypass -File build-apk.ps1
$ErrorActionPreference = 'Stop'
$env:JAVA_HOME = 'D:\.tools\jdk-21'
$env:ANDROID_HOME = 'D:\.tools\android-sdk'
$env:ANDROID_SDK_ROOT = 'D:\.tools\android-sdk'
$env:ANDROID_USER_HOME = 'D:\.cache\android'
$env:GRADLE_USER_HOME = 'D:\.cache\gradle'
$env:npm_config_cache = 'D:\.cache\npm'
$env:TEMP = 'D:\.cache\tmp'; $env:TMP = 'D:\.cache\tmp'
$env:Path = "D:\.tools\jdk-21\bin;$env:Path"
Set-Location $PSScriptRoot

node copy-web.js
npx cap sync android
if ($LASTEXITCODE -ne 0) { throw 'cap sync loi' }

Set-Location android
.\gradlew.bat assembleDebug --no-daemon "-Djava.io.tmpdir=D:\.cache\tmp"
if ($LASTEXITCODE -ne 0) { throw 'gradle build loi' }

$apk = 'app\build\outputs\apk\debug\app-debug.apk'
$out = Join-Path $PSScriptRoot 'TC DWG.apk'
Copy-Item $apk $out -Force
Write-Output ("XONG: " + $out + " (" + [math]::Round((Get-Item $out).Length / 1MB, 2) + " MB)")
