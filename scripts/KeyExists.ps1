# KeyExists.ps1 — thin wrapper: emits ONLY a fixed token (EXISTS/ABSENT/ERR:<CODE>). The existence check
# (and the .env read) lives in Test-KeyExists in EnvUpsert.ps1; values never cross to Node.
param(
    [Parameter(Mandatory = $true)][string]$Key,
    [Parameter(Mandatory = $true)][string]$EnvPath
)
$ErrorActionPreference = 'Stop'
$VerbosePreference = 'SilentlyContinue'

. "$PSScriptRoot/EnvUpsert.ps1"   # provides Emit, Find-KeyLineIndex, Test-KeyExists

try {
    if (Test-KeyExists -EnvPath $EnvPath -Key $Key) { Emit 'EXISTS' } else { Emit 'ABSENT' }
} catch {
    Emit 'ERR:IO'   # never include the exception or any file content
}
