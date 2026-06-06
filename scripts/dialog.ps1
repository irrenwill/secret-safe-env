param(
    [Parameter(Mandatory = $true)][string]$Key,
    [Parameter(Mandatory = $true)][string]$EnvPath
)
$ErrorActionPreference   = 'Stop'
$VerbosePreference       = 'SilentlyContinue'
$DebugPreference         = 'SilentlyContinue'
$InformationPreference   = 'SilentlyContinue'

# Hide THIS helper's own PowerShell console window by its handle (the masked dialog below is a
# separate window and stays visible). Unlike Node's windowsHide -- which sets SW_HIDE on the process
# and would hide the dialog too -- this targets only the console window. stdout is a redirected pipe,
# unaffected by console visibility, so the OK/CANCEL/ERR token still reaches the parent.
try {
    Add-Type -Namespace EnvPass -Name Win -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern System.IntPtr GetConsoleWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int n);
'@
    $cw = [EnvPass.Win]::GetConsoleWindow()
    if ($cw -ne [System.IntPtr]::Zero) { [void][EnvPass.Win]::ShowWindow($cw, 0) }  # 0 = SW_HIDE
} catch { }

. "$PSScriptRoot/EnvUpsert.ps1"   # provides Emit, Invoke-EnvWrite, Write-EnvFile, Get-ErrorCode

if (-not [System.Environment]::UserInteractive) { Emit 'ERR:NO_SESSION'; exit 0 }

try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
} catch {
    Emit 'ERR:NO_DESKTOP'; exit 0
}

function Show-SecretDialog {
    param([string]$Key, [string]$EnvPath)
    # Returns $true and sets $script:SecretValue on confirm; $false on cancel/empty.
    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'secret-safe-env'     # app name; NEVER the value
    $form.TopMost = $true
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false; $form.MinimizeBox = $false
    $form.ClientSize = New-Object System.Drawing.Size(452, 170)

    $label = New-Object System.Windows.Forms.Label
    $label.Text = "請貼上 $Key 的祕密值（agent 看不到）`r`n寫入：$EnvPath"
    $label.SetBounds(12, 10, 428, 44)
    $form.Controls.Add($label)

    $txt = New-Object System.Windows.Forms.TextBox
    $txt.UseSystemPasswordChar = $true   # also sets the UIA "password" state, so screen readers announce "hidden"
    $txt.SetBounds(12, 58, 320, 24)
    $form.Controls.Add($txt)

    # Hold-to-reveal: owner-draw the plaintext as PIXELS only (no UIA-readable control Text).
    $revealPanel = New-Object System.Windows.Forms.Panel
    $revealPanel.SetBounds(12, 88, 428, 24)
    $revealPanel.AccessibleRole = [System.Windows.Forms.AccessibleRole]::None  # explicit: keep the reveal out of the UIA tree
    $script:Revealing = $false
    $revealPanel.Add_Paint({
        param($s, $e)
        if ($script:Revealing) {
            $e.Graphics.DrawString($txt.Text, $form.Font, [System.Drawing.Brushes]::Black, 0, 0)
        }
    })
    $form.Controls.Add($revealPanel)

    $eye = New-Object System.Windows.Forms.Button
    $eye.Text = '按住顯示'; $eye.SetBounds(338, 57, 102, 26); $eye.TabStop = $false
    $eye.Add_MouseDown({ $script:Revealing = $true;  $revealPanel.Invalidate() })
    $eye.Add_MouseUp(  { $script:Revealing = $false; $revealPanel.Invalidate() })
    $eye.Add_MouseLeave({ $script:Revealing = $false; $revealPanel.Invalidate() })  # re-mask if pointer leaves while held
    $form.Controls.Add($eye)

    $ok = New-Object System.Windows.Forms.Button
    $ok.Text = '確定'; $ok.SetBounds(254, 124, 86, 30)
    $ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.Controls.Add($ok); $form.AcceptButton = $ok

    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Text = '取消'; $cancel.SetBounds(346, 124, 86, 30)
    $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $form.Controls.Add($cancel); $form.CancelButton = $cancel

    $form.Add_Deactivate({ $script:Revealing = $false; $revealPanel.Invalidate() })  # auto re-mask on focus loss
    $form.Add_Shown({ $form.Activate(); $txt.Focus() })
    $result = $form.ShowDialog()

    # All-whitespace counts as empty -> CANCEL (spec §10); the full untrimmed value is still what gets stored,
    # so a real secret with leading/trailing spaces is preserved exactly.
    $confirmed = ($result -eq [System.Windows.Forms.DialogResult]::OK -and $txt.Text.Trim().Length -gt 0)
    if ($confirmed) { $script:SecretValue = $txt.Text }
    $txt.Text = ''            # shorten plaintext residency in the control
    $form.Dispose()
    return $confirmed
}

try {
    if (Show-SecretDialog -Key $Key -EnvPath $EnvPath) {
        Invoke-EnvWrite -EnvPath $EnvPath -Key $Key   # write + emit OK/ERR:<CODE> (unit-tested in EnvUpsert.Tests.ps1)
    } else {
        Emit 'CANCEL'
    }
} catch {
    Emit 'ERR:INTERNAL'
}
