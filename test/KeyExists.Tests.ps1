BeforeAll {
    $script:Dir = Join-Path ([System.IO.Path]::GetTempPath()) ("ssenv-ke-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $script:Dir | Out-Null
    $script:Ke = "$PSScriptRoot/../scripts/KeyExists.ps1"
    $script:Ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    function RunKe([string]$EnvPath, [string]$Key) {
        & $script:Ps -NoProfile -ExecutionPolicy Bypass -File $script:Ke -Key $Key -EnvPath $EnvPath
    }
}
AfterAll { Remove-Item -Recurse -Force $script:Dir }

Describe 'KeyExists.ps1' {
    It 'EXISTS when the key is present' {
        $p = Join-Path $script:Dir 'a.env'; [System.IO.File]::WriteAllText($p, "A=1`nK=val`n")
        (RunKe $p 'K').Trim() | Should -Be 'EXISTS'
    }
    It 'ABSENT when the key is missing' {
        $p = Join-Path $script:Dir 'b.env'; [System.IO.File]::WriteAllText($p, "A=1`n")
        (RunKe $p 'K').Trim() | Should -Be 'ABSENT'
    }
    It 'EXISTS for an empty value (KEY=)' {
        $p = Join-Path $script:Dir 'c.env'; [System.IO.File]::WriteAllText($p, "K=`n")
        (RunKe $p 'K').Trim() | Should -Be 'EXISTS'
    }
    It 'matches with an export prefix' {
        $p = Join-Path $script:Dir 'e.env'; [System.IO.File]::WriteAllText($p, "export K=v`n")
        (RunKe $p 'K').Trim() | Should -Be 'EXISTS'
    }
    It 'ABSENT when the file does not exist' {
        (RunKe (Join-Path $script:Dir 'nope.env') 'K').Trim() | Should -Be 'ABSENT'
    }
    It 'never leaks the value (sentinel)' {
        $p = Join-Path $script:Dir 'leak.env'; [System.IO.File]::WriteAllText($p, "K=SENTINEL-KE-9z`n")
        $out = (RunKe $p 'K' 2>&1 | Out-String)
        $out | Should -Not -Match 'SENTINEL-KE-9z'
        $out.Trim() | Should -Be 'EXISTS'
    }
}
