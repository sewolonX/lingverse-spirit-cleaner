# 神识清理 (LingVerse Spirit Cleaner) — Project Rules

## 提交前强制检查

每次 `git commit` 前必须确认以下全部完成：

1. **版本号三处同步**：
   - `// @version` (第4行)
   - `SCRIPT_VERSION` (var SCRIPT_VERSION)
   - `release.json` 的 `version` 和 `downloadUrl`

2. **更新公告同步**：
   - `BUILTIN_CHANGELOG` 新增条目（脚本内）
   - `release.json` 的 `notes` 和 `changelog`

3. **更新 README**：
   - 功能列表、配置说明如有变化，同步更新 `README.md`

4. **推送两个仓库**：
   - `git push origin main` (GitHub)
   - `git push gitee main` (Gitee)

## 仓库文件限制

- **此仓库只放**：`lingverse-spirit-cleaner.user.js`, `README.md`, `release.json`, `versions/`
- **服务器部署** → `SuRanHF/lingverse-server-deploy`
- **发布工具** → 本地，不上传

## 技术要点

- 游戏页面：`ling.muge.info/game.html`
- 游戏 JS 源码可下载到 `/tmp/g.js` 分析
- 脚本架构：外层 IIFE（Tampermonkey 沙箱）→ `String.raw` 内层注入页面
- 铭文 API：`/api/game/inscription/draw-ten` / `draw-hundred`，返回 `{ inscriptions: [...], info: {...} }`
- 品质等级：凡纹(1) 灵纹(2) 宝纹(3) 仙纹(4) 神纹(5) 圣纹(6) 天纹(7)
- 天纹 stat 映射：锋→攻击 御→防御 命→气血 灵→神识，值÷10=百分比
- 反验证：游戏 `api.request` 透明处理 429，脚本拿不到 code
