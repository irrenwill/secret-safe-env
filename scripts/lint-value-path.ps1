# Fails (exit 1) if the secret value path uses a forbidden construct (spec §9 B1/C1/D2/F2/F3).
# AST-based: matches REAL invocations regardless of formatting, ignores comments/strings, and uses
# EXACT command names (a Write-* wildcard would wrongly flag our own Write-EnvFile).
$ErrorActionPreference = 'Stop'
$targets = @("$PSScriptRoot/dialog.ps1", "$PSScriptRoot/EnvUpsert.ps1")

$forbiddenCmds = @(
    'Set-Content','Add-Content','Out-File','Tee-Object','Export-Csv','Export-Clixml',
    'Write-Host','Write-Output','Write-Error','Write-Verbose','Write-Debug','Write-Information',
    'ConvertTo-SecureString','Set-Clipboard','Invoke-Expression','iex'
)
# Members the value must never flow into ($txt.Text — the masked input — is intentionally allowed).
$forbiddenMembers = @('AccessibleName','AccessibleDescription','Tag','Create','SetText','Clipboard')
$violations = New-Object System.Collections.Generic.List[string]

foreach ($t in $targets) {
    $tk = $null; $er = $null
    $ast  = [System.Management.Automation.Language.Parser]::ParseFile($t, [ref]$tk, [ref]$er)
    $name = [System.IO.Path]::GetFileName($t)

    foreach ($c in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)) {
        $cmd = $c.GetCommandName()
        if ($cmd -and ($forbiddenCmds -contains $cmd)) { $violations.Add("${name}: forbidden command '$cmd'") }
        if ($c.InvocationOperator -eq 'Dot') {
            $first = $c.CommandElements[0]
            # Allow string-literal dot-sources, including expandable strings like ". `"$PSScriptRoot/EnvUpsert.ps1`"".
            # Only flag a genuinely dynamic source such as ". $var" / ". (expr)".
            $isLiteral = ($first -is [System.Management.Automation.Language.StringConstantExpressionAst]) -or ($first -is [System.Management.Automation.Language.ExpandableStringExpressionAst])
            if (-not $isLiteral) { $violations.Add("${name}: dynamic dot-source of a non-literal") }
        }
    }
    foreach ($m in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.MemberExpressionAst] }, $true)) {
        $member = "$($m.Member)"
        if ($forbiddenMembers -contains $member) { $violations.Add("${name}: forbidden member '$member'") }
    }
    foreach ($ty in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.TypeExpressionAst] }, $true)) {
        if ("$($ty.TypeName)" -match 'Clipboard') { $violations.Add("${name}: forbidden Clipboard type usage") }
    }
}

if ($violations.Count -gt 0) {
    ($violations | Select-Object -Unique) | ForEach-Object { [Console]::Error.WriteLine($_) }
    exit 1
}
[Console]::Out.WriteLine('lint-value-path: OK')
exit 0
