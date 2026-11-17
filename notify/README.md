# 主动消息（GitHub Actions + ntfy）

让 AI 每天在你设定的时段里随机主动找你 5 次，并把消息加密存进仓库，
网页打开时会自动拉取并显示（带原始时间）。

## 文件放在哪

```
你的仓库/
├── index.html              ← 你原来的页面
├── outbox.enc              ← 自动生成（密文，第一次运行后才有）
├── notify/
│   ├── send.js
│   ├── config.json
│   └── README.md           ← 本文件
└── .github/
    └── workflows/
        └── notify.yml
```

`outbox.enc` 必须放在**仓库根目录**，因为网页是从同目录 `./outbox.enc` 读取的。

## 第一步：建 4 个 Secret

仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| 名字 | 值 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | `sk-...` | 你的 API Key |
| `NTFY_TOPIC` | 你的 ntfy 频道名 | 例如 `mychat_ddd_0212_xy` |
| `NOTIFY_PWD` | 你自己定的密码 | **网页设置里要填同一个** |
| `PROFILE_JSON` | 下面那段 JSON | 称呼、人设、城市、纪念日 |

`PROFILE_JSON` 示例：

```json
{
  "name": "小林",
  "persona": "温柔、简短、不肉麻，像熟人说话",
  "city": "杭州",
  "anniversaries": [
    { "md": "12-24", "title": "约定的平安夜" },
    { "md": "03-14", "title": "第一次一起看星星" }
  ]
}
```

`md` 是「月-日」，每年循环。

## 第二步：允许 Actions 写仓库

仓库 → **Settings** → **Actions** → **General** → 最下面 **Workflow permissions**

选 **Read and write permissions** → Save

（否则脚本无法把 `outbox.enc` 提交回仓库）

## 第三步：跑一次试试

仓库 → **Actions** → 左侧 `proactive-notify` → 右侧 **Run workflow**

跑完看日志：

- `未到时间，跳过` → 正常（说明时间没到）
- `已发送（greet）` → 成功，手机应该收到通知
- `outbox.enc 已更新` → 密文已写回仓库

想立刻看到效果，可以临时把 `config.json` 的 `windowStart` 改成当前时间前后，
或者本地跑：

```bash
NOTIFY_PWD=xxx NTFY_TOPIC=xxx DEEPSEEK_API_KEY=xxx PROFILE_JSON='{}' node notify/send.js
```

## 第四步：网页端填密码

打开网页 → ⚙️ → **主动消息**

- 解密密码：填 `NOTIFY_PWD` 同一个
- 城市：填城市名（天气用）
- 点【保存】，再点【立即拉取】验证

## 常见问题

**Q：日志里说 `outbox.enc 解密失败`**

密码对不上。要么改了 `NOTIFY_PWD` 但没改网页里的，要么文件被手动改坏了。

**Q：网页里点「立即拉取」报 `没找到 outbox.enc`**

还没成功跑过一次 Actions，或者 `outbox.enc` 不在仓库根目录。

**Q：会不会泄露隐私**

`outbox.enc` 是 AES-256-GCM 密文，密码只在 Secret 和你的浏览器里。
仓库里看到的只有一长串乱码。

**Q：Actions 会不会自己停**

public 仓库连续 60 天没有提交，定时任务会被自动禁用。
本工作流每次发送都会提交 `outbox.enc`，一般不会触发；真停了手动 Run 一次即可。

**Q：一天会发几条**

每天随机 0–5 条问候（条数是当天现抽的，平均约 2.4 条），外加 1 条纪念日提醒（纪念日优先，当天问候跳过）。
错过的时段超过 3 小时就不再补发，避免打开时一堆消息。

## 人设自动同步（可选）

如果不想每次改人设都来 GitHub 改 Secret，可以开启网页端的自动同步：

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → 生成
   - Repository access：只选这个仓库
   - Permissions → Contents：**Read and write**
   - 有效期选 90 天（到期重新生成）
2. 网页 → ⚙️ → 主动消息 → 填 Token、仓库（`用户名/仓库名`）、分支（main）
3. 点【保存】，再点【同步人设到云端】
4. 仓库里会出现 `profile.enc`（密文）
5. 之后 Actions 会**优先读 profile.enc**，读不到才用 Secret 里的 PROFILE_JSON

> 同步内容：称呼、选中对话的人设、城市、该对话记忆里的日期（作为纪念日）。
> 仓库里只有密文，密码仍是 `NOTIFY_PWD`。
