# .env の値を GitHub のリポジトリの secrets に登録する（deploy.yml が使う）。
# 使い方（リポジトリ直下で）:  pwsh scripts/set-secrets.ps1        登録だけ
#                               pwsh scripts/set-secrets.ps1 -Deploy  登録のあと公開も起動する
# 値は標準入力で gh に渡す（コマンドの引数に載せないので、プロセスの一覧や履歴に残らない）。値は画面に出さない。
param([switch]$Deploy)
$ErrorActionPreference = 'Stop'
$repo = '4getkun/champions-meta'
$keys = @('CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID')
$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
if (-not (Test-Path $envFile)) { throw ".env がありません。.env.example を .env に写して値を書いてください" }

$vals = @{}
foreach ($line in Get-Content $envFile -Encoding utf8) {
    if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$') {
        $vals[$Matches[1]] = $Matches[2].Trim('"').Trim("'")
    }
}
foreach ($k in $keys) {
    if (-not $vals[$k]) { throw ".env の $k が空です" }
}
foreach ($k in $keys) {
    $vals[$k] | gh secret set $k -R $repo
    if ($LASTEXITCODE -ne 0) { throw "$k の登録に失敗しました" }
    Write-Host "登録しました: $k"
}
gh secret list -R $repo
if ($Deploy) {
    gh workflow run deploy.yml -R $repo
    Write-Host '公開を起動しました。進み具合: gh run list --workflow deploy.yml -R' $repo
}
