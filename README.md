# secret-safe-env

讓 agent 把祕密（API key 等）寫進 `.env`，**全程看不到值**。agent 呼叫 `set_env_secret({ key })` 只傳 key 名稱；本機跳出一個原生遮罩對話框，由你貼上祕密，再由 PowerShell 小幫手直接寫入 `.env`。agent 只收到 `OK`／`CANCEL`／`ERR:<CODE>` 狀態，永遠拿不到值。

## 需求
- Windows + Windows PowerShell 5.1（以釘死路徑 `System32\WindowsPowerShell\v1.0` 啟動）
- Node 18+
- PowerShell 測試需要 Pester 5：`Install-Module Pester -MinimumVersion 5.0 -Scope CurrentUser`

## 建置與測試
```bash
npm install
npm run build
npm test          # Node 單元測試
npm run test:ps   # PowerShell upsert + 不洩漏測試（Pester）
npm run lint:ps   # value-path 靜態 lint
```

## 安裝（一次性 global install）
```bash
npm i -g github:irrenwill/secret-safe-env
```
在專案的 `.mcp.json` 加入（啟動瞬間、不依賴網路）：
```json
{ "mcpServers": { "secret-safe-env": { "command": "secret-safe-env" } } }
```
重載 Claude Code。提供兩個工具：`set_env_secret`（讓使用者在本機遮罩框輸入 secret 寫進 .env，agent 永不看到值）與 `env_key_exists`（只回 true/false 確認寫入，不回值）。

> 零安裝備援：`.mcp.json` 用 `{ "command": "npx", "args": ["-y", "github:irrenwill/secret-safe-env#<tag>"] }`（請釘 tag）。代價：每次 session 啟動會冷啟動，離線會啟動失敗。

> 值為單行；多行 PEM/JSON 請使用者自行編輯 .env。env_path 請傳專案根的絕對 .env 路徑。

## 範圍／保證
**保護範圍**：從你貼上、到值寫入 `.env` 落地這一段，沒有任何受稽核的 Windows／agent 通道會記錄到值（PSReadLine、4688/Sysmon、4103/4104、Transcription、AMSI、MCP/agent 上下文、OTEL、mcp-debug）。

**不在範圍**（由你自負）：值落地 `.env` 之後的處置——雲端同步／OneDrive、VSS／備份快照、防毒掃描、檔案 ACL、agent 事後讀取 `.env`。
