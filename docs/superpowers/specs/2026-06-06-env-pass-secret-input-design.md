# env-pass — Secret 安全輸入工具 設計文件

- **日期**: 2026-06-06
- **狀態**: 已核可(經對抗式安全審查強化),待寫實作計畫
- **作者**: kjyang3476@gmail.com + Claude

---

## 1. 目的與問題

需要把 API key 之類的 secret 寫進專案的 `.env` 時,希望由 agent 無縫觸發一個輸入互動,使用者貼上 secret,然後直接寫進 `.env`。

**關鍵限制(整個設計的由來)**:

- 一般「互動問答框」會把使用者回答當成 tool result **回傳給 agent**,即進入 model 上下文 → 送 Claude API、寫 transcript/log、可能被快取。因此「方便貼上」本身不保護 secret。
- agent 透過 Bash 工具跑的指令,其 stdin **不接到使用者**,所以「CLI 用 `read -s` 讀密碼」由 agent 觸發會卡住。

## 2. 威脅模型與保護邊界(已選定)

**secret 值完全不進 agent 上下文。** 使用者貼進去後,由 agent 看不到的本地管道直接寫入 `.env`,agent 只收到「已寫入 KEY(值已隱藏)」的確認。

**保護邊界(核心設計原則)**:本工具保證 **「使用者把 secret 交給對話框 → 值寫入 `.env` 落地」這一段不洩漏值到任何記錄/通道**。**值落地 `.env` 之後的一切不在本工具範圍**,由使用者自負,明確包含:雲端同步(OneDrive/Dropbox/Google Drive)上傳與版本歷史、VSS/File History/備份快照、防毒/EDR 雲端送樣、`.env` 檔案 ACL 與多使用者可讀性、agent 事後 `cat .env`。

**key 名稱不是 secret**:agent 必須知道要設哪個變數,故 key 名稱(與解析後的 `env_path`)依設計被記錄於多處(見 §4 表),屬可接受的中介資料。

## 3. 已選定方案

**方案 2:本地 MCP server + 原生遮罩對話框(Node / TypeScript),安全強化版。**

- agent 呼叫 MCP 工具,只傳 **key 名稱**(與選填路徑),不碰值。
- MCP server 以**釘死的絕對路徑**啟動 **Windows PowerShell 5.1** 子行程,跑遮罩對話框腳本。
- 對話框腳本自己用 .NET `[System.IO.File]::WriteAllText` **直接寫 `.env`**,只回 `OK` / `CANCEL` / `ERR:<CODE>`(固定枚舉)。secret 值**不跨行程、不進任何輸出流、不跨任何參數綁定邊界**。

被否決的替代方案:方案 1(手動 helper,agent 無法自動觸發)、方案 3(localhost 網頁,要管 port);以及 stdout 回傳值草案(stdout 會被 Transcription 擷取)。

## 4. 架構與資料流

對 agent 暴露單一工具:`set_env_secret({ key: string, env_path?: string })`

```
agent ── set_env_secret("OPENAI_API_KEY") ──▶ MCP server (Node, shell:false, arg 陣列)
                                                  │ 1. 驗證 key 名稱、env_path(拒絕開頭 '-')
                                                  │ 2. spawn  %SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe
                                                  │           -NoProfile -File dialog.ps1 -Key OPENAI_API_KEY -EnvPath <path>
                                                  │           (參數皆非 secret;值絕不在 argv)
   使用者 ──貼上 secret──▶ 遮罩對話框 (同一 powershell 行程, GUI textbox)
                                                  │ 3. 該行程用 [System.IO.File]::WriteAllText 行內寫 .env
                                                  │    (值只以 script 變數行內串接,不經 cmdlet/function 參數)
                                                  │ 4. stdout 只印 OK / CANCEL / ERR:<CODE>;stderr 被 Node 丟棄
                                                  ▼
agent ◀── { status:"ok", key, path } ────────── server   ← 回傳「不含值」
```

**secret 值一生只待在兩個地方:PowerShell 對話框行程(記憶體) → `.env` 檔案。** 送回 model 的結果只有 `key + path + status`,**值與任何預覽(含 last-4)都不回傳**。

### 各 Windows 稽核通道對「值」的擷取(經對抗審查 + 本機實測驗證)
| 稽核通道 | 擷取到值? | 前提 / 備註 |
|---|---|---|
| PSReadLine 命令歷史 | 否 | 非互動 `-File` 啟動無 console;值打進 GUI textbox 非命令列 |
| Process cmdline(4688 / Sysmon) | 否(記 key 名與路徑) | 值絕不當 argv(§9 E2) |
| Script Block Logging(4104) | 否 | 記腳本原始碼;值不進腳本文字(§9 D2) |
| Module Logging(4103 ParameterBinding) | 否 | 只用 `.NET WriteAllText`、值不跨參數綁定(§9 C1/C2) |
| Transcription(全機 GPO) | 否 | 值經 .NET 檔案 I/O 寫出,不經 console host;stdout 只印狀態碼(§9 A/B) |
| **AMSI .NET 方法引數記錄(pwsh ≥ 7.3)** | **否,前提:釘死 PS 5.1** | PS 7.3+ 會把 `WriteAllText` 引數送進 AMSI/EDR → **必須**釘死 5.1 絕對路徑、拒 pwsh(§9 E1) |
| 行程記憶體 → WER 傾印 / pagefile / hiberfil | 殘留面(OS 層) | 明文在 heap 的短暫視窗;以寫後清空變數縮短(§9 D3);無法完全消除 |

## 5. 元件

| 模組 | 職責 | 持有 secret? |
|---|---|---|
| `src/server.ts` | MCP 接線、key/path 驗證、釘死路徑 spawn、stdout 白名單驗證、丟棄 stderr | **否** |
| `scripts/dialog.ps1` | 遮罩對話框 GUI + 行內 upsert 寫 `.env` | 是(唯一,且僅此行程內) |

### 5.1 `src/server.ts`
- 註冊 `set_env_secret` 與其 JSON schema;驗證 `key` 符合 `^[A-Z_][A-Z0-9_]*$`,否則 spawn 前回 error。
- `env_path` 預設為 server cwd 下的 `.env`;可傳絕對路徑;**開頭為 `-` 一律拒絕**。
- `spawn(absPowershell, ['-NoProfile','-File','dialog.ps1','-Key',key,'-EnvPath',path], { shell:false, stdio:['ignore','pipe','ignore'] })`。
- 讀子行程 stdout,以 `^(OK|CANCEL|ERR:[A-Z_]+)$` **白名單**驗證後映射成 MCP 結果;不符回泛用 error,**不回吐**原始輸出。

### 5.2 `scripts/dialog.ps1`
- 起手式:`$ErrorActionPreference='Stop'`;`$VerbosePreference=$DebugPreference=$InformationPreference='SilentlyContinue'`。
- GUI(見 §6)取得使用者輸入後,**行內**完成 upsert:讀現有 `.env`、定位/取代/附加 `KEY=` 行、用 `[System.IO.File]::WriteAllText($path,$content,(New-Object System.Text.UTF8Encoding($false)))` 寫回。
- upsert 規則:檔案不存在→建立(ACL 採預設繼承,§2 範圍外不硬化);key 已存在(`^\s*(export\s+)?KEY\s*=`)→就地取代並保留其他行/註解/順序;不存在→附加;值含空白/`#`/引號→加雙引號並跳脫。
- 行為以 `OK` / `CANCEL` / `ERR:<CODE>` 印出;`<CODE>` ∈ 固定枚舉(見 §8)。
- **可測試性**:行轉換邏輯(定位/取代/附加/跳脫)抽成純函式以 Pester 測**非機密假值**;**但真實值不得以參數綁定傳入該函式**(§9 C2),production 路徑以 script 範圍變數行內注入。

## 6. 對話框 UX 細節

- 手刻 `System.Windows.Forms.Form`(**不用** `Microsoft.VisualBasic.Interaction.InputBox`,無法遮罩);`TopMost` 置頂。
- 標籤顯示 key 名稱 + 目標路徑(例:`貼上 OPENAI_API_KEY → ...\.env`)——使用者的**安全檢查點**,key 選錯可當場取消。
- 遮罩輸入(`UseSystemPasswordChar`),預設圓點。
- **眼睛切換(👁)**:**不**靠把活控制項的 `UseSystemPasswordChar` 切 false(會讓同會話 UI Automation 程式化讀到明文);改為把明文畫進**獨立、UIA 排除、唯讀**元件,失焦自動遮回,reveal 視窗短暫。明文僅當下顯示於螢幕(肩窺/螢幕分享屬使用者自負視覺風險)。
- 強制可及性 IsPassword 狀態,讓螢幕報讀器報「隱藏」而非念出字元。
- 值**絕不**指派給 Form.Title/Text、任何控制項 AccessibleName/Description/Tag、tooltip。
- `[ 確定 ] / [ 取消 ]`;取消或關窗 → `CANCEL`,不寫檔。啟動有約 0.5–1 秒延遲(載入 WinForms)。

## 7. 使用者體驗流程

1. **agent 先預告**(跳框前先講一句):「等下會跳輸入框,請貼上 KEY,我不會看到值。」
2. 原生小視窗置頂彈出,標籤標明哪把 key 與寫入路徑。
3. 使用者 Ctrl+V 貼上(可按 👁 核對)→ 按確定。
4. 視窗關閉,該行程行內把 `KEY=值` 寫進 `.env`。
5. agent 只收到 `OK`,回報「✓ 已寫入 .env,值我看不到」。
6. **多把 key**:agent 連續呼叫 → 一把一個框依序跳出,各框標籤標明哪把。

## 8. 狀態回傳協定

`dialog.ps1` 對 stdout **只**輸出下列字面之一(別無其他位元組):

- `OK` — 已寫入。
- `CANCEL` — 使用者取消/留空/關窗。
- `ERR:<CODE>` — `<CODE>` 來自**固定枚舉**:`BAD_KEY` `PATH_INVALID` `WRITE_DENIED` `IO` `NO_DESKTOP` `NO_SESSION` `INTERNAL`。

`<CODE>` 由例外**型別**對映,**絕不**取自 `$_`/`$_.Exception.Message`/`$_.ToString()`/`$_.InvocationInfo.*`/`$Value`。`server.ts` 以 `^(OK|CANCEL|ERR:[A-Z_]+)$` 白名單驗證。

## 9. 安全強制條款(MUST / MUST-NOT)— 來自對抗式審查,皆屬「接入 → .env」範圍內

**A. 狀態通道(stdout)**
- **A1 MUST** `ERR:<CODE>` 只用 §8 固定枚舉;catch 只對映例外型別,**絕不**引用例外物件/訊息/InvocationInfo/`$Value`。
- **A2 MUST** `server.ts` 白名單驗證子行程 stdout;不符回泛用 error 且不回吐。

**B. stderr 與其他輸出流**
- **B1 MUST** `dialog.ps1` 設 `$ErrorActionPreference='Stop'` 並靜音 Verbose/Debug/Information;**絕不**對 `$Value` 作用域內任何東西呼叫 `Write-Host/Verbose/Debug/Information/Error/Output`。所有碰值程式碼包 try/catch。
- **B2 MUST** `server.ts` 把子行程 stderr 導向丟棄(`stdio` stderr = `'ignore'`);**絕不**捕捉/記錄/轉發 stderr,或塞進任何錯誤/MCP 結果。

**C. 寫檔**
- **C1 MUST** 值只透過 `[System.IO.File]::WriteAllText(path, content, UTF8Encoding($false))` 寫入;**絕不**把值當引數傳給任何 cmdlet(`Set-Content/Add-Content/Out-File/Tee-Object/Export-*/Write-*/ConvertTo-SecureString`)→ 否則 4103 明文記錄。
- **C2 MUST** 值**不可跨任何 PowerShell 參數綁定邊界**(不經 cmdlet,也不經 advanced function `-Value` 參數)——只以 script 範圍變數行內字面串接。否則 Module Logging `*` 經 4103 ParameterBinding 記到。
- **C3 MUST-NOT** 不建立 `.env` 任何次要副本(`.bak`、`%TEMP%` `.tmp`+rename);要原子性就在**同目錄**寫暫存、成功即刪。

**D. 值的處理**
- **D1 MUST** 值是**不透明字面**——**絕不**當作/內插進 regex pattern(只 KEY 用 regex 比對);若用 `-replace`,值置於 replacement 側並中和 `$` 替換。
- **D2 MUST-NOT** 值**絕不**進入腳本文字——不 `Invoke-Expression`、不 `[ScriptBlock]::Create`、不 `. $string`、不動態組含值命令字串。值只以繫結變數流動。
- **D3 SHOULD** `WriteAllText` 後立即把 `$textbox.Text` 與值變數設 null,縮短明文記憶體殘留(降低 WER/pagefile 殘留;此面屬 OS 層、不強制 SecureString)。

**E. 直譯器與啟動**
- **E1 MUST** spawn 釘死絕對路徑 `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`(Windows PowerShell 5.1),**絕不**靠 PATH 解析;偵測到 `pwsh ≥ 7.3` 應拒跑(7.3+ 把 .NET 方法引數含值送 AMSI)。
- **E2 MUST** Node spawn `shell:false` + arg 陣列;值**絕不**進 argv/stdin/env;`env_path` 開頭 `-` 一律拒絕。

**F. 對話框 / reveal**
- **F1 MUST** 眼睛切換不切活控制項 `UseSystemPasswordChar`;明文畫進獨立、UIA 排除、唯讀元件,失焦自動遮回。
- **F2 MUST** 值絕不進 Form.Title/Text、AccessibleName/Description/Tag、tooltip;強制 IsPassword 可及性狀態。
- **F3 MUST-NOT** 工具本身絕不把值複製到剪貼簿。

## 10. 錯誤處理

原則:**回給 agent 的訊息永遠不含 secret。**

| 情況 | 回傳 |
|---|---|
| key 名稱不合法 / `env_path` 非法(開頭 `-`) | `ERR:BAD_KEY` / `ERR:PATH_INVALID`(spawn 前即擋,無 secret) |
| 使用者取消 / 留空 / 關窗 | `CANCEL` → `{ status:"cancelled", key }`,不寫檔 |
| 無桌面工作階段(SSH/容器/排程) | `ERR:NO_DESKTOP` / `ERR:NO_SESSION`;agent 改建議手動 |
| 偵測到 pwsh ≥ 7.3 / 找不到 5.1 | server 拒跑並回 error(無 secret) |
| 寫檔失敗(權限/IO) | `ERR:WRITE_DENIED` / `ERR:IO`,**不回值** |
| 任何其他例外 | `ERR:INTERNAL`,**不回值** |

## 11. 測試策略

- **Pester 防洩漏哨兵測試(核心)**:在 `Start-Transcript` 下執行 `dialog.ps1`,分別(a)強制寫檔失敗、(b)輸入含 regex 元字元 `( ) [ ] \ $ $1 " #` 的哨兵值;斷言哨兵值**不出現在** stdout、stderr、transcript;且 `.env` 位元組精確 round-trip。
- **Pester 行轉換**:新建 / 取代既有 key / 附加 / 保留註解與順序 / 特殊字元加引號跳脫 / 冪等 / UTF-8 無 BOM。
- **靜態 lint**:`dialog.ps1` 值路徑不得含任何 cmdlet 寫檔、`Invoke-Expression`、`[ScriptBlock]::Create`,且值不得當 regex pattern。
- **Node 測 `server.ts`**:key/path 驗證;stdout 白名單映射(`OK/CANCEL/ERR:<CODE>` → 正確 MCP 結果且不含值);非法 token 回泛用 error;`spawn` 以 arg 陣列且非 shell、stderr=`ignore`;`env_path` 開頭 `-` 被拒。
- **手動 e2e**:註冊 → agent 呼叫 → 跳框 → 貼上(試 👁)→ 驗證 `.env` 更新且 agent transcript 全程無值;另測取消、key 名稱錯、多把 key 連續、pwsh 拒跑。

## 12. 專案結構

```
env-pass/
  package.json  tsconfig.json
  src/
    server.ts                    # MCP 接線(不持有 secret)
  scripts/
    dialog.ps1                   # 遮罩對話框 + 行內 upsert
  test/
    server.test.ts               # Node 端狀態映射 / 驗證 / spawn 不變量
    EnvUpsert.Tests.ps1          # Pester:行轉換 + 防洩漏哨兵
    lint-value-path.ps1          # 靜態檢查值路徑無違規
  README.md                      # 含註冊到 Claude Code 的 .mcp.json 片段
```

## 13. 範圍外(使用者自負,非本工具保證)

值**落地 `.env` 之後**的處置一律在保護邊界之外(§2):

- 雲端同步(OneDrive/Dropbox/Google Drive)上傳明文與保留歷史版本——**本機已驗證 OneDrive 啟用中**,但屬使用者選擇 `.env` 位置的後果。
- VSS / System Restore / File History / 備份代理對 `.env` 的快照保留。
- 防毒/EDR 即時掃描與雲端送樣。
- `.env` 檔案 ACL 與多使用者可讀性(採預設繼承,不硬化)。
- agent 事後若有讀檔權限可 `cat .env`(可選在 Claude Code settings 加 deny 規則,屬使用者選配)。
- OS 剪貼簿 / Win+V 歷史保留使用者**自己貼上前複製**的值(上游於本工具;工具只保證自己不再複製值,§9 F3)。
- 行程記憶體經 WER/pagefile/hiberfil 的殘留(OS 層;以 §9 D3 縮短視窗,無法完全消除)。

## 14. 非目標(YAGNI)

- 不做跨平台 UI(只留介面,Windows 先行)。
- 不做多行 secret。
- 不做 secret 加密儲存 / vault 整合。
- 不回傳值預覽給 agent(含 last-4)。
- 不做 `.env` 落地後的縱深防禦(deny-read / DACL / 同步偵測)——明確屬 §13 範圍外。
