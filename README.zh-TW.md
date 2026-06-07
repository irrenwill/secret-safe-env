# secret-safe-env

[![npm version](https://img.shields.io/npm/v/secret-safe-env.svg)](https://www.npmjs.com/package/secret-safe-env)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-listed-blue)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.irrenwill/secret-safe-env)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows%20only-0078D6.svg)](#平台支援)

一個 [Model Context Protocol](https://modelcontextprotocol.io) server，讓 AI agent 把祕密（API key、token、密碼、連線字串）寫進專案的 `.env`，**全程看不到值**。

agent 只傳**變數名稱**;本機跳出一個原生遮罩對話框,由**你**輸入值,再由本機 PowerShell 小幫手直接寫進 `.env`。agent 只收到狀態 token（`OK`／`CANCEL`／`ERR:<CODE>`）—— 永遠拿不到祕密。

> English: see [README.md](./README.md).

---

## 為什麼

當你叫 agent「把我的 OpenAI key 加進 `.env`」,一般做法都會洩漏:貼進聊天會進模型上下文與紀錄;讓 agent 自己寫值代表 agent 碰過它;`cat .env` 去「確認」又再次曝光。`secret-safe-env` 把祕密從這些通道全部移除 —— 值的路徑是 **使用者 → 遮罩對話框 → PowerShell → `.env`**,永不進入 agent／模型上下文。

```
agent: set_env_secret({ key: "OPENAI_API_KEY" })
          │  (只有名稱,沒有值)
          ▼
   ┌──────────────────────────┐     你在這裡輸入值
   │  原生遮罩對話框            │ ◄── (agent 看不到)
   └──────────────────────────┘
          │  $script:SecretValue (從不當參數,從不進 stdout)
          ▼
   PowerShell 用 [System.IO.File] 寫入 .env
          │
          ▼
agent 收到:  "OK"   ← 只有狀態 token
```

## 平台支援

本工具**刻意只支援 Windows** —— 信任基礎是由 Windows PowerShell 驅動的原生 WinForms 遮罩對話框。

| 需求 | 支援 | 說明 |
|---|---|---|
| **Windows 10 / 11** | ✅ 必要 | 唯一支援的作業系統。 |
| **Linux / macOS** | ❌ 不支援 | 工具會回 `UNSUPPORTED_PLATFORM` 並拒絕執行,並告知 agent 此機器不支援。(npm 套件在任何 OS 都裝得起來,只是不會運作。) |
| **Windows PowerShell 5.1** | ✅ 必要 | 以**釘死路徑** `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` 啟動。 |
| **PowerShell 7+ (`pwsh`)** | ❌ 不使用 | 刻意不從 `PATH` 解析,避免 `PATH` 上的 `pwsh` 改變執行／記錄面。 |
| **Node.js** | ✅ 18+ | 跑 MCP server(只負責 spawn PowerShell,從不碰值)。 |

## 安裝

### Claude Code

```bash
claude mcp add secret-safe-env -- npx -y secret-safe-env
```

想要最穩(避開 `npx` 快取問題),裝全域 bin 再指向它:

```bash
npm i -g secret-safe-env
claude mcp add secret-safe-env -- secret-safe-env
```

> 更新:`npm i -g secret-safe-env@latest`。用不鎖版本的 `npx` 時,清快取(`npx clear-npx-cache`)或鎖版本(`npx -y secret-safe-env@<版本>`),以免跑到舊的快取版本。

### 其他 MCP 客戶端(`.mcp.json`)

```jsonc
{
  "mcpServers": {
    "secret-safe-env": { "command": "secret-safe-env" }        // 需先 `npm i -g secret-safe-env`
    // 零安裝替代(請鎖版本):
    // "secret-safe-env": { "command": "npx", "args": ["-y", "secret-safe-env@<版本>"] }
  }
}
```

重載客戶端以載入 server。若 Windows 上 `npx` 啟動的 stdio server 出現在清單卻連不上,把指令包成 `cmd /c npx -y secret-safe-env`。

## 工具

### `set_env_secret({ key, env_path? }) → 狀態文字`

為 `key` 跳出遮罩框;使用者輸入值;小幫手把 `key=value` 寫進 `.env`。回傳給 agent 的是可讀文字 + 錯誤旗標,**從不**含值。`key` 必須是 `UPPER_SNAKE_CASE`（`^[A-Z_][A-Z0-9_]*$`）。值為**單行**(多行 PEM／JSON 請使用者自行編輯 `.env`)。`destructiveHint: true`(就地 upsert)。

### `env_key_exists({ key, env_path? }) → { exists: boolean }`

只回 `key` 是否存在於 `.env` —— 不回值。用它確認寫入,**取代讀取／`cat` `.env`**。`readOnlyHint: true`。

> `env_path` 是專案 `.env` 的絕對路徑。**請務必明確傳入** —— runner 啟動的 MCP server 工作目錄是 runner 沙箱,不是你的 workspace。省略時預設為 `<CLAUDE_PROJECT_DIR 或 cwd>/.env`。

## 給 AI agent

**只要任務需要把 secret／API key／token／密碼／憑證寫進專案 `.env`**(例如「加我的 OpenAI key」「設 `DATABASE_URL`」「設定我的 `.env`」)就用 `set_env_secret`。規則:

- ✅ 只傳**變數名稱**;值由使用者在本機對話框輸入。
- ✅ 用 `env_key_exists` 確認寫入(回 `true`／`false`,不回值)。
- ❌ **絕不**叫使用者把祕密貼進聊天。
- ❌ **絕不**自己寫值或 placeholder。
- ❌ **絕不** `cat`／讀 `.env` 驗證 —— 那會再次曝光。

這些規則也透過 server 的 `instructions` 與每個工具的 `description` 傳給 agent,因此零先備知識的「冷 agent」也能正確使用。

## 安全範圍

**保護範圍** —— 從你輸入值到它落地 `.env` 這一段,沒有任何受稽核的 Windows／agent 通道會記錄到值:PSReadLine、4688/Sysmon、4103 Module Logging、4104 Script Block Logging、Transcription、AMSI、MCP/agent 上下文、OTEL、`mcp-debug`。值從不跨越 PowerShell 參數邊界,且只用 `[System.IO.File]` 寫入(從不經 cmdlet)。靜態 AST lint（`npm run lint:ps`）與 Pester transcript 測試會強制這點。

**不在範圍**(值落地 `.env` 後由你自負）—— 雲端同步／OneDrive、VSS／備份快照、防毒掃描、檔案 ACL,以及 agent 事後讀取 `.env`。

完整威脅模型與保證見 [docs/SPEC.md](./docs/SPEC.md)。

## 開發

```bash
npm install
npm run build       # tsc -> dist/
npm test            # Node 單元測試（vitest）
npm run test:ps     # PowerShell upsert + 不洩漏測試（Pester 5）
npm run lint:ps     # 靜態 value-path AST lint
```

PowerShell 測試需 Pester 5:`Install-Module Pester -MinimumVersion 5.0 -Scope CurrentUser`。

發版全自動:push 一個 `vX.Y.Z` tag,GitHub Actions 就發佈到 npm（Trusted Publishing／OIDC）與 MCP Registry —— 免 token。見 [docs/DECISIONS.md](./docs/DECISIONS.md)。

## 文件

- [docs/SPEC.md](./docs/SPEC.md) —— 目的、保證、威脅模型、範圍與非目標。
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) —— 模組與資料流。
- [docs/DECISIONS.md](./docs/DECISIONS.md) —— 設計決策與理由。

## 授權

[MIT](./LICENSE)
