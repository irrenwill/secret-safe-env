BeforeAll {
    . "$PSScriptRoot/../scripts/EnvUpsert.ps1"
    $script:TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("envpass-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $script:TmpDir | Out-Null
}
AfterAll {
    Remove-Item -Recurse -Force $script:TmpDir
}

Describe 'Render-CurrentLine' {
    It 'renders a simple value unquoted' {
        $script:SecretValue = 'abc123'
        Render-CurrentLine -Key 'K' | Should -Be 'K=abc123'
    }
    It 'quotes and escapes values with space, hash, quote, backslash' {
        $script:SecretValue = 'a b"c\#d'
        Render-CurrentLine -Key 'K' | Should -Be 'K="a b\"c\\#d"'
    }
}

Describe 'Find-KeyLineIndex' {
    It 'finds an existing key, allowing optional export prefix' {
        Find-KeyLineIndex -Lines @('# c', 'A=1', 'export B=2') -Key 'B' | Should -Be 2
    }
    It 'returns -1 when the key is absent' {
        Find-KeyLineIndex -Lines @('A=1') -Key 'B' | Should -Be -1
    }
}

Describe 'Write-EnvFile' {
    It 'creates a new file containing the key' {
        $p = Join-Path $script:TmpDir 'new.env'
        $script:SecretValue = 'v1'
        Write-EnvFile -EnvPath $p -Key 'K'
        [System.IO.File]::ReadAllText($p) | Should -Be "K=v1`n"
    }
    It 'replaces an existing key, preserving other lines, comments and order' {
        $p = Join-Path $script:TmpDir 'rep.env'
        [System.IO.File]::WriteAllText($p, "# top`nA=1`nK=old`nB=2`n")
        $script:SecretValue = 'new'
        Write-EnvFile -EnvPath $p -Key 'K'
        [System.IO.File]::ReadAllText($p) | Should -Be "# top`nA=1`nK=new`nB=2`n"
    }
    It 'appends a new key to an existing file' {
        $p = Join-Path $script:TmpDir 'app.env'
        [System.IO.File]::WriteAllText($p, "A=1`n")
        $script:SecretValue = 'v'
        Write-EnvFile -EnvPath $p -Key 'K'
        [System.IO.File]::ReadAllText($p) | Should -Be "A=1`nK=v`n"
    }
    It 'writes UTF-8 with NO BOM' {
        $p = Join-Path $script:TmpDir 'bom.env'
        $script:SecretValue = 'v'
        Write-EnvFile -EnvPath $p -Key 'K'
        $bytes = [System.IO.File]::ReadAllBytes($p)
        $bytes[0] | Should -Be 0x4B  # 'K', not 0xEF (BOM)
    }
    It 'round-trips a value full of regex metacharacters without throwing' {
        $p = Join-Path $script:TmpDir 'meta.env'
        $script:SecretValue = 'a()[]$1\."#b'
        { Write-EnvFile -EnvPath $p -Key 'K' } | Should -Not -Throw
        [System.IO.File]::ReadAllText($p) | Should -BeLike 'K="*"*'
    }
    It 'creates no secondary files (.bak/.tmp)' {
        $dir = Join-Path $script:TmpDir 'nosec'
        New-Item -ItemType Directory -Path $dir | Out-Null
        $p = Join-Path $dir '.env'
        $script:SecretValue = 'v'
        Write-EnvFile -EnvPath $p -Key 'K'
        (Get-ChildItem -Force $dir).Count | Should -Be 1
    }
}

Describe 'Get-ErrorCode' {
    It 'maps UnauthorizedAccessException to WRITE_DENIED' {
        $rec = [System.Management.Automation.ErrorRecord]::new(
            [System.UnauthorizedAccessException]::new('x'), 'id', 'NotSpecified', $null)
        Get-ErrorCode -ErrRecord $rec | Should -Be 'WRITE_DENIED'
    }
    It 'maps an unknown exception to INTERNAL' {
        $rec = [System.Management.Automation.ErrorRecord]::new(
            [System.Exception]::new('x'), 'id', 'NotSpecified', $null)
        Get-ErrorCode -ErrRecord $rec | Should -Be 'INTERNAL'
    }
}

Describe 'No-leak: value never reaches stdout or the transcript' {
    It 'writes the value ONLY to the .env file, not to any output stream or transcript' {
        $sentinel = 'SENTINEL-NEVER-LOG-9f3c2a'
        $p  = Join-Path $script:TmpDir 'leak.env'
        $tr = Join-Path $script:TmpDir 'transcript.txt'
        $script:SecretValue = $sentinel          # set BEFORE transcript (literal not under test)
        Start-Transcript -Path $tr -Force | Out-Null
        $out = Write-EnvFile -EnvPath $p -Key 'K' *>&1   # merge ALL streams
        Stop-Transcript | Out-Null
        ($out | Out-String)                | Should -Not -Match $sentinel  # nothing on any stream
        [System.IO.File]::ReadAllText($tr) | Should -Not -Match $sentinel  # not transcribed
        [System.IO.File]::ReadAllText($p)  | Should -Match $sentinel       # but IS in the .env
    }
}

Describe 'Invoke-EnvWrite: fixed status token + no value on any stream' {
    BeforeEach {
        $script:OrigOut = [Console]::Out
        $script:Sw = New-Object System.IO.StringWriter
        [Console]::SetOut($script:Sw)
    }
    AfterEach { [Console]::SetOut($script:OrigOut) }

    It 'emits OK; value goes ONLY to the file, never to stdout or transcript' {
        $sentinel = 'SENTINEL-OK-9f3c2a'
        $p  = Join-Path $script:TmpDir 'iew-ok.env'
        $tr = Join-Path $script:TmpDir 'iew-ok-transcript.txt'
        $script:SecretValue = $sentinel                 # set BEFORE transcript
        Start-Transcript -Path $tr -Force | Out-Null
        Invoke-EnvWrite -EnvPath $p -Key 'K'
        Stop-Transcript | Out-Null
        # Robustly take last non-empty line to avoid transcript banner contamination
        $swLines = ($script:Sw.ToString() -split "`n") | Where-Object { $_.Trim() -ne '' }
        $lastLine = $swLines | Select-Object -Last 1
        $lastLine.Trim()                   | Should -Be 'OK'
        $script:Sw.ToString()              | Should -Not -Match $sentinel
        [System.IO.File]::ReadAllText($tr) | Should -Not -Match $sentinel
        [System.IO.File]::ReadAllText($p)  | Should -Match $sentinel
    }

    It 'on a write failure emits a fixed ERR:<CODE> and never the value' {
        $sentinel = 'SENTINEL-FAIL-7b1d'
        $p  = Join-Path $script:TmpDir 'no\such\dir\.env'
        $tr = Join-Path $script:TmpDir 'iew-fail-transcript.txt'
        $script:SecretValue = $sentinel
        Start-Transcript -Path $tr -Force | Out-Null
        Invoke-EnvWrite -EnvPath $p -Key 'K'
        Stop-Transcript | Out-Null
        # Robustly take last non-empty line to avoid transcript banner contamination
        $swLines = ($script:Sw.ToString() -split "`n") | Where-Object { $_.Trim() -ne '' }
        $lastLine = $swLines | Select-Object -Last 1
        $lastLine.Trim()                   | Should -Match '^ERR:(PATH_INVALID|IO|WRITE_DENIED|INTERNAL)$'
        $script:Sw.ToString()              | Should -Not -Match $sentinel
        [System.IO.File]::ReadAllText($tr) | Should -Not -Match $sentinel
    }
}
