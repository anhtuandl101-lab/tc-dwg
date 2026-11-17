# Tạo khóa ký bản phát hành (upload key) cho TC DWG trên Google Play. CHỈ CHẠY MỘT LẦN.
# Anh tự chạy trong cửa sổ PowerShell và tự gõ mật khẩu; mật khẩu không hiện lên màn hình.
# Chạy: powershell -ExecutionPolicy Bypass -File tao-khoa-ky.ps1
$ErrorActionPreference = 'Stop'
$dir = Join-Path $PSScriptRoot 'khoa-ky'
$ks = Join-Path $dir 'tc-dwg-upload.jks'
if (Test-Path $ks) { Write-Host "Đã có khóa ở $ks. Không tạo lại để tránh mất khóa cũ." -ForegroundColor Yellow; exit 1 }
New-Item -ItemType Directory -Force $dir | Out-Null

function DocMatKhau($loiNhac) {
  $s = Read-Host $loiNhac -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
Write-Host 'Đặt mật khẩu cho khóa ký (ít nhất 8 ký tự, ghi lại cẩn thận, mất là phải xin Google cấp lại khóa).'
$p1 = DocMatKhau 'Mật khẩu'
$p2 = DocMatKhau 'Nhập lại mật khẩu'
if ($p1 -ne $p2) { throw 'Hai lần nhập không khớp.' }
if ($p1.Length -lt 8) { throw 'Mật khẩu cần ít nhất 8 ký tự.' }
if ($p1 -match '[\\"\r\n]') { throw 'Mật khẩu không được chứa dấu \ hoặc dấu ".' }

$ten = Read-Host 'Tên người/đơn vị đứng tên khóa (Enter để dùng "C.S.O")'
if (-not $ten) { $ten = 'C.S.O' }
$keytool = 'D:\.tools\jdk-21\bin\keytool.exe'
# Hiệu lực 30 năm (Google Play yêu cầu khóa còn hạn tới sau năm 2033)
& $keytool -genkeypair -v -keystore $ks -storetype PKCS12 -alias tcdwg -keyalg RSA -keysize 4096 -validity 10950 `
  -storepass $p1 -keypass $p1 -dname "CN=TC DWG, O=$ten, L=Da Nang, C=VN"
if ($LASTEXITCODE -ne 0) { throw 'keytool báo lỗi, chưa tạo được khóa.' }

@"
storeFile=tc-dwg-upload.jks
storePassword=$p1
keyAlias=tcdwg
keyPassword=$p1
"@ | Set-Content -LiteralPath (Join-Path $dir 'keystore.properties') -Encoding ascii
$p1 = $null; $p2 = $null

Write-Host ''
Write-Host "XONG. Khóa nằm ở: $dir" -ForegroundColor Green
Write-Host 'Hãy chép cả thư mục khoa-ky sang USB hoặc nơi an toàn. Không gửi thư mục này cho ai, không đưa lên mạng.' -ForegroundColor Yellow
