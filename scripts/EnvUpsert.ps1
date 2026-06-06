# EnvUpsert.ps1 — pure .env transform + status emission. SECURITY: the secret value flows ONLY
# through $script:SecretValue (NEVER a parameter), so it never crosses a PowerShell parameter-binding
# boundary that Module Logging (4103) would record. It is written ONLY via [System.IO.File] (never a
# cmdlet), and is never used as a regex PATTERN or written to any output stream.

$script:SecretValue = $null

function Find-KeyLineIndex {
    param([string[]]$Lines, [string]$Key)
    $pattern = '^\s*(export\s+)?' + [regex]::Escape($Key) + '\s*='
    for ($i = 0; $i -lt $Lines.Count; $i++) {
        if ($Lines[$i] -match $pattern) { return $i }
    }
    return -1
}

function Render-CurrentLine {
    param([string]$Key)
    # $v is the INPUT (left) of -match against a LITERAL pattern; the value is never the pattern.
    # Quoting uses .NET String.Replace (literal, no regex, no parameter binding).
    $v = $script:SecretValue
    if ($v -match '[\s#"'']') {
        $escaped = $v.Replace('\', '\\').Replace('"', '\"')
        return "$Key=`"$escaped`""
    }
    return "$Key=$v"
}

function Write-EnvFile {
    param([string]$EnvPath, [string]$Key)
    $existing = ''
    if (Test-Path -LiteralPath $EnvPath) {
        $existing = [System.IO.File]::ReadAllText($EnvPath)
    }
    $newline = if ($existing -match "`r`n") { "`r`n" } else { "`n" }

    $lines = New-Object System.Collections.ArrayList
    if ($existing.Length -gt 0) { foreach ($ln in ($existing -split "`r?`n")) { [void]$lines.Add($ln) } }
    if ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -eq '') { $lines.RemoveAt($lines.Count - 1) }

    $linesArr = if ($lines.Count -gt 0) { $lines.ToArray([string]) } else { [string[]]@() }
    # NOTE: $linesArr holds EXISTING .env lines (which may include a PRIOR value) — passed by parameter
    # here. The NEW value being entered never crosses a parameter boundary (it stays in
    # $script:SecretValue). A prior value already on disk is out of scope (spec §13), and a [string[]]
    # argument is recorded by TYPE, not expanded by element, in ParameterBinding/4103. Acceptable.
    $idx = Find-KeyLineIndex -Lines $linesArr -Key $Key
    $rendered = Render-CurrentLine -Key $Key   # value injected internally via $script:SecretValue
    if ($idx -ge 0) { $lines[$idx] = $rendered } else { [void]$lines.Add($rendered) }

    $outArr = if ($lines.Count -gt 0) { $lines.ToArray([string]) } else { [string[]]@() }
    $content = ($outArr -join $newline) + $newline
    $enc = New-Object System.Text.UTF8Encoding($false)   # UTF-8, no BOM
    [System.IO.File]::WriteAllText($EnvPath, $content, $enc)
}

function Get-ErrorCode {
    param([System.Management.Automation.ErrorRecord]$ErrRecord)
    $ex = $ErrRecord.Exception
    if ($ex -is [System.UnauthorizedAccessException])  { return 'WRITE_DENIED' }
    if ($ex -is [System.IO.DirectoryNotFoundException]) { return 'PATH_INVALID' }
    if ($ex -is [System.IO.IOException])               { return 'IO' }
    return 'INTERNAL'
}

# Status emission lives here (not in dialog.ps1) so it can be unit-tested without the GUI.
# Emit uses [Console]::Out (a .NET call, not Write-Output/Write-Host) — the value path stays clean.
function Emit { param([string]$Token) [Console]::Out.WriteLine($Token) }

function Invoke-EnvWrite {
    # Writes $script:SecretValue to .env and emits EXACTLY ONE fixed status token. The catch maps the
    # exception TYPE to a fixed code (audit A1) and NEVER references the exception message or the value
    # (audit B1); the value is never written to any output stream.
    param([string]$EnvPath, [string]$Key)
    try {
        Write-EnvFile -EnvPath $EnvPath -Key $Key
        $script:SecretValue = $null
        Emit 'OK'
    } catch {
        $code = Get-ErrorCode -ErrRecord $_
        $script:SecretValue = $null
        Emit "ERR:$code"
    }
}
