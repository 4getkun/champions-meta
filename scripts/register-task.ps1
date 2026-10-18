[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string] $TaskName = 'ChampionsMeta-Update',
    [string] $PythonExe
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runner = Join-Path $PSScriptRoot 'run-update.ps1'
$pwsh = (Get-Command pwsh.exe -ErrorAction Stop).Source

if (-not $PythonExe) {
    $pyLauncher = Get-Command py.exe -ErrorAction Stop
    $PythonExe = (& $pyLauncher.Source -3 -c 'import sys; print(sys.executable)').Trim()
}
if (-not (Test-Path -LiteralPath $PythonExe -PathType Leaf)) { throw "Python 実行ファイルがありません: $PythonExe" }

$tokyo = [TimeZoneInfo]::FindSystemTimeZoneById('Tokyo Standard Time')
$tomorrow = [TimeZoneInfo]::ConvertTime([DateTimeOffset]::Now, $tokyo).Date.AddDays(1)
$dailyStart = [DateTimeOffset]::new($tomorrow.AddHours(4), $tokyo.GetUtcOffset($tomorrow))
$monthlyStart = [DateTimeOffset]::new($tomorrow.AddHours(5).AddMinutes(30), $tokyo.GetUtcOffset($tomorrow))
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name

function XmlEscape([string] $Value) { [Security.SecurityElement]::Escape($Value) }
$quotedPython = '"' + $PythonExe.Replace('"', '\"') + '"'
$quotedRunner = '"' + $runner.Replace('"', '\"') + '"'
$arguments = "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -File $quotedRunner -PythonExe $quotedPython"
$argumentsXml = XmlEscape $arguments
$pwshXml = XmlEscape $pwsh
$rootXml = XmlEscape $repoRoot
$identityXml = XmlEscape $identity
$dailyBoundary = $dailyStart.ToString('yyyy-MM-ddTHH:mm:sszzz')
$monthlyBoundary = $monthlyStart.ToString('yyyy-MM-ddTHH:mm:sszzz')

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>champions-meta のデータ更新、集計、Cloudflare Pages 公開</Description></RegistrationInfo>
  <Triggers>
    <CalendarTrigger><StartBoundary>$dailyBoundary</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>3</DaysInterval></ScheduleByDay></CalendarTrigger>
    <CalendarTrigger><StartBoundary>$monthlyBoundary</StartBoundary><Enabled>true</Enabled><ScheduleByMonth><DaysOfMonth><Day>3</Day></DaysOfMonth><Months><January/><February/><March/><April/><May/><June/><July/><August/><September/><October/><November/><December/></Months></ScheduleByMonth></CalendarTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>$identityXml</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT3H</ExecutionTimeLimit><Enabled>true</Enabled></Settings>
  <Actions Context="Author"><Exec><Command>$pwshXml</Command><Arguments>$argumentsXml</Arguments><WorkingDirectory>$rootXml</WorkingDirectory></Exec></Actions>
</Task>
"@

# XML の構造と 2 つのトリガーを登録前に検証する。
[xml] $parsed = $xml
if ($parsed.Task.Triggers.CalendarTrigger.Count -ne 2) { throw 'タスク XML に2つのカレンダートリガーがありません。' }
if ($parsed.OuterXml -notmatch '<DaysInterval>3</DaysInterval>' -or $parsed.OuterXml -notmatch '<Day>3</Day>') { throw 'タスク周期を確認できません。' }

if ($PSCmdlet.ShouldProcess($TaskName, 'Windows タスクスケジューラへ登録')) {
    Register-ScheduledTask -TaskName $TaskName -Xml $xml -Force | Out-Null
    Write-Output "登録しました: $TaskName (JST 04:00 3日間隔、毎月3日 05:30)"
} else {
    Write-Output "登録内容を検証しました: $TaskName (JST 04:00 3日間隔、毎月3日 05:30)"
}
