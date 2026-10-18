[CmdletBinding()]
param(
    [string] $PythonExe,
    [ValidateRange(1, 1500)][int] $MaxReplays = 1500,
    [switch] $SkipFetch,
    [switch] $SkipDeploy
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$env:PYTHONIOENCODING = 'utf-8'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$logRoot = Join-Path $repoRoot 'logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$logPath = Join-Path $logRoot "update-$stamp.log"

function Write-RunLog([string] $Message) {
    $line = '{0} {1}' -f [DateTime]::UtcNow.ToString('o'), $Message
    Add-Content -LiteralPath $logPath -Value $line -Encoding utf8
}

function Invoke-Logged([string] $FilePath, [string[]] $ArgumentList, [string] $Label, [string] $Secret = '') {
    Write-RunLog "開始: $Label"
    & $FilePath @ArgumentList 2>&1 | ForEach-Object {
        $line = $_.ToString()
        if ($Secret) { $line = $line.Replace($Secret, '[REDACTED]') }
        Add-Content -LiteralPath $logPath -Value $line -Encoding utf8
    }
    $exitCode = $LASTEXITCODE
    Write-RunLog "終了: $Label (exit=$exitCode)"
    if ($exitCode -ne 0) { throw "$Label failed with exit code $exitCode" }
}

$mutex = $null
$hasMutex = $false
try {
    $mutex = [Threading.Mutex]::new($false, 'Global\ChampionsMeta-Update')
    try { $hasMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $hasMutex = $true }
    if (-not $hasMutex) {
        Write-RunLog '既に別の更新が実行中のため終了します。'
        exit 0
    }

    Set-Location -LiteralPath $repoRoot
    $env:PYTHONPATH = Join-Path $repoRoot 'src'
    if (-not $PythonExe) {
        $pyLauncher = Get-Command py.exe -ErrorAction SilentlyContinue
        if (-not $pyLauncher) { throw 'Python 実行ファイルを -PythonExe で指定してください。' }
        $PythonExe = (& $pyLauncher.Source -3 -c 'import sys; print(sys.executable)').Trim()
    }
    if (-not (Test-Path -LiteralPath $PythonExe -PathType Leaf)) { throw "Python 実行ファイルがありません: $PythonExe" }
    $node = (Get-Command node.exe -ErrorAction Stop).Source

    Invoke-Logged $PythonExe @('-m', 'pytest', '-q') 'pytest'
    Invoke-Logged $node @('--check', (Join-Path $repoRoot 'site/app.js')) 'Node.js 構文確認'

    if (-not $SkipFetch) {
        Invoke-Logged $PythonExe @('-u', 'scripts/collect.py', '--max', [string]$MaxReplays) 'データ取得と集計'
    } else {
        Write-RunLog 'SkipFetch が指定されたため取得と集計を省略します。'
    }

    Invoke-Logged $node @('--test', 'tests/ui_async_race.mjs', 'tests/ui_prediction.mjs', 'tests/ui_speed.mjs') '画面と予測の回帰確認'
    Invoke-Logged $PythonExe @('-m', 'cmeta', 'dist') '公開ファイル作成'
    if (-not $SkipDeploy) {
        $wrangler = 'C:\Github\fourgetkun-hub\node_modules\.bin\wrangler.cmd'
        if (-not (Test-Path -LiteralPath $wrangler -PathType Leaf)) { throw "Wrangler がありません: $wrangler" }
        $oldToken = [Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN', 'Process')
        try {
            [Environment]::SetEnvironmentVariable('CLOUDFLARE_API_TOKEN', $null, 'Process')
            Invoke-Logged $wrangler @('pages', 'deploy', (Join-Path $repoRoot 'dist'), '--project-name=champions-meta', '--branch=main', '--commit-dirty=true') 'Cloudflare Pages デプロイ' $oldToken
        } finally {
            [Environment]::SetEnvironmentVariable('CLOUDFLARE_API_TOKEN', $oldToken, 'Process')
        }
    } else {
        Write-RunLog 'SkipDeploy が指定されたためデプロイを省略します。'
    }
    Write-RunLog '更新処理が正常終了しました。'
    exit 0
} catch {
    Write-RunLog "失敗: $($_.Exception.Message)"
    exit 1
} finally {
    if ($hasMutex -and $mutex) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
}
