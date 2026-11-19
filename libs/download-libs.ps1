# Download Prism (core + language components) into E:\dshproject\libs
# Usage: powershell -ExecutionPolicy Bypass -File "E:\dshproject\libs\download-libs.ps1"
# Note: ASCII-only on purpose, so Windows PowerShell 5.1 can parse it safely.

$dir = 'E:\dshproject\libs'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$base = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/'
$files = @(
    'prism.min.js',
    'components/prism-python.min.js',
    'components/prism-typescript.min.js',
    'components/prism-json.min.js',
    'components/prism-bash.min.js',
    'components/prism-sql.min.js',
    'components/prism-yaml.min.js',
    'components/prism-go.min.js',
    'components/prism-rust.min.js'
)

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$ok = 0
foreach ($f in $files) {
    $name = Split-Path $f -Leaf
    $out  = Join-Path $dir $name
    try {
        Invoke-WebRequest -Uri ($base + $f) -OutFile $out -UseBasicParsing -TimeoutSec 40
        $size = [math]::Round((Get-Item $out).Length / 1KB, 1)
        Write-Host ("OK   " + $name + "  (" + $size + " KB)") -ForegroundColor Green
        $ok++
    } catch {
        Write-Host ("FAIL " + $name + "  -> " + $_.Exception.Message) -ForegroundColor Red
    }
}

Write-Host ""
Write-Host ("Done: " + $ok + " / " + $files.Count + " files") -ForegroundColor Cyan
Get-ChildItem $dir -Filter *.js | Select-Object Name, Length
