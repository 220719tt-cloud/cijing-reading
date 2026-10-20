# GitHub Pages 发布检查

更新：2026-10-19。本地新版已通过静态部署检查，可作为公开试用版准备发布；真实长章云翻译的网络稳定性及真机验收尚未完成，不应描述为全部核心功能稳定的正式版。本轮不提交、不推送、不触发发布，也不更新 Worker。当前公开网址为 https://220719tt-cloud.github.io/cijing-reading/ ，线上仍是较早的手动译文版本，不能把本地功能当作已经上线。详细验收记录见 [本轮检查](RELEASE-CHECK-2026-10-19.md)。

## 构建与发布

在项目根目录，使用 Node 24、pnpm 11.19.0：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm check:static
```

只托管 `dist/`，不上传工作目录、node_modules、私人小说、备份、.env、Wrangler 登录文件。Vite `base: './'`，使用 `#/books`／`#/read/...` 路由，支持根路径和 `/cijing-reading/` 子路径。子路径网址应以 `/` 结尾，不需要服务端 rewrite；不是双击 file:// 运行。

`.github/workflows/pages.yml` 仅接受手动 workflow_dispatch，push 不会发布。build 安装冻结依赖、检查类型、运行全部测试、构建并检查静态文件；deploy 只接收 dist，使用 GitHub 官方 Pages Actions、github-pages 环境、pages:write 和 id-token:write。Action 固定提交已核验可访问。

用户确认发布后：上传本项目源码 → 仓库 Settings → Pages → Source 选择 GitHub Actions → Actions → Publish static website (manual) → Run workflow。确认 build/deploy 都成功，再访问 HTTPS 正式链接检查。不要现在执行。

## 翻译连接与安全

默认公开接口为 `https://cijing-translation.220719tt.workers.dev/translate`。构建变量 `VITE_TRANSLATION_API_URL` 可留空，留空采用同一默认值；若仓库有旧覆盖值，发布前应核对。它只能保存公开服务地址，不能放密钥。生产 CSP 允许同源和这个确切 Worker HTTPS 来源，不开放通配符。

正式请求由访问者浏览器直接 POST Worker，包含 version:1、segments、context、glossary。Worker 的允许来源必须包含 `https://220719tt-cloud.github.io`（来源不含仓库路径）；现有 AI、PER_IP、GLOBAL、来源白名单、开关和限流保持不变。当前可从正式来源预检并取得真实翻译响应，详见本轮记录；这不等于旧线上前端已经接入。

开发回环转发只存在于 Vite serve 模式，编译后不存在 `/__dev/translate` 或 localhost 依赖。生产浏览器不需要开发者 Mac、Node、Vite 或本地模型。不要为了本地测试把 localhost 加到公共白名单、关闭 CORS 或取消限流。

所有非零浓度共用既有真实译文缓存与原文范围预算，0% 显示原文。经读者明确同意，自动翻译才发送所选章节及必要上下文到 Cloudflare。普通失败直接跳过并保留中文，不保证 100% 成功，也不保证所有人无限量免费翻译；鉴权、额度、网络和存储故障安全停止。现有约80%覆盖可继续阅读，不会自动补翻已跳过内容。完整机制见 [自动翻译](AUTO-TRANSLATION.md)、[六档浓度](CONCENTRATION-SYSTEM.md)、[失败跳过](TRANSLATION-SKIP-PASS.md)。

`worker/wrangler.jsonc` 是初始化模板，不能直接部署覆盖现有云端配置。阅读网站发布与 Worker 发布分别授权，本轮均不执行。

## 本地数据

- 小说、目录、封面与插图：IndexedDB `cijing-reading` v1。
- 词库缓存、收藏、掌握：IndexedDB `cijing-vocabulary` v2。
- 章节译文及失败范围：IndexedDB `cijing-translations` v1。
- 进度：localStorage `cijing-position:<bookId>`，记录原文章节／段落／偏移。
- 字号、浓度、提示、背景、翻页、主题：localStorage；云翻译许可不会随备份转移。

刷新不会主动清理上述数据。不同浏览器、主机、协议、端口各有自己的存储，localhost 的小说不会自动出现在正式网址；完整 ZIP 备份与安全合并恢复入口位于设置页，见 [BACKUP.md](BACKUP.md)。恢复默认不覆盖已有小说、译文、进度和学习记录。清理浏览器数据、无痕会话结束或系统存储回收仍可能丢失本地内容，请保留备份。容量和存储失败会报告，不能宣称存在云备份。

TXT/EPUB 导入本身只在本地解析保存；仅允许云翻译后才发送必要正文，不上传整本书到 GitHub Pages。书籍原始 HTML/CSS/脚本不直接挂载，EPUB 使用结构化内容、资源路径/解压大小限制和 SVG 清理。CSP 是额外防线，不能替代解析校验。

## 兼容性边界

构建基线：Safari 16.4+、Chrome/Edge 111+、Firefox 128+。采用标准文件选择、IndexedDB、响应式布局、Pointer/Touch 和系统语音降级；文件导入不依赖 Safari 专属 API。

手机尺寸模拟不等于真机：正式试用前仍需 iPhone Safari/Chrome、Android Chrome/Edge 的文件选择、真实触摸、地址栏伸缩、旋转、后台恢复和存储受限测试；Mac/Windows 的完整浏览器组合也应抽查。当前没有 PWA/Service Worker，不承诺断网首次加载或刷新整站成功；已保存的译文和词库无需再次翻译/下载，但前提是页面已可打开。

参考： [Vite 静态部署](https://vite.dev/guide/static-deploy.html)、[GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
