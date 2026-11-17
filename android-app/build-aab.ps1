# Build file .aab (Android App Bundle) để tải lên Google Play. Cần khóa ký tạo bằng tao-khoa-ky.ps1 trước.
# Chạy: powershell -ExecutionPolicy Bypass -File build-aab.ps1
$ErrorActionPreference = 'Stop'
if (-not (Test-Path (Join-Path $PSScriptRoot 'khoa-ky\keystore.properties'))) {
  Write-Host 'Chưa có khóa ký. Chạy tao-khoa-ky.ps1 trước.' -ForegroundColor Yellow; exit 1
}
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
.\gradlew.bat bundleRelease --no-daemon "-Djava.io.tmpdir=D:\.cache\tmp"
if ($LASTEXITCODE -ne 0) { throw 'gradle build loi' }

$out = Join-Path $PSScriptRoot 'TC DWG.aab'
Copy-Item 'app\build\outputs\bundle\release\app-release.aab' $out -Force
Write-Output ("XONG: " + $out + " (" + [math]::Round((Get-Item $out).Length / 1MB, 2) + " MB)")
