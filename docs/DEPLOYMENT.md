# 公开静态部署准备与验收

更新：2026-10-16。产品定位：面向所有用户的免费在线英语学习阅读器。任何人可通过公开链接使用，不要求安装 App、注册本站账号或连接开发者的 Mac。本轮仅准备，尚未上传、发布或产生公开网址。

## 当前结论

具备现代浏览器公开试用的静态部署条件。本轮发现的根路径资源引用、主题保存失败静默、书库异常连接清理、可选容量估算异常和 EPUB 结构复杂度限制问题已修复。

这不表示已经完成所有设备验收：本机内置 Chromium 的实际浏览器检查与手机尺寸模拟已完成；真实 iPhone Safari／Chrome、Android Chrome／Edge、Mac Safari／Firefox、Windows Chrome／Edge 仍未逐一实测。完整质量承诺前需要在真实设备完成 TXT/EPUB 文件选择、触摸翻页、字号重排、释义卡、刷新恢复和存储受限检查。兼容基线仍为 Safari 16.4+、Chrome/Edge 111+、Firefox 128+；更老浏览器不承诺完整支持。

英语浓度六档现已接入本地译文：20% 保留规则替换，40% 可结合真实句组，60%／80%／100% 使用用户导入的对应英文；100% 缺失时明确回原文。本轮没有安装模型或实现自动翻译，详见 docs/BILINGUAL.md。当前也没有 PWA／Service Worker，不能承诺断网后首次打开或刷新整个网站一定成功；已经缓存的词库可离线查询。

## 发布文件与路径

`pnpm build` 输出 `dist/`，仅该目录是网站内容。生产浏览器不需要 Node、pnpm、Python、Vite 或 Mac 本地服务。它仍需通过普通 HTTP(S) 静态托管访问，不是双击 index.html 的 file:// 使用方式。

Vite `base: './'`、hash 路由、JSON 资源导入及许可链接共同支持根目录和仓库子目录：

- `https://<用户名>.github.io/<仓库名>/#/books`
- `https://<域名>/#/books`

不要把地址改成无 hash 的 `/read/...`，也不需要为现有路由配置服务器 rewrite。项目子目录网址应带结尾 `/`。

检查命令（推荐 Node 24、pnpm 11.19.0）：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm check:static
```

`check:static` 在本机临时监听回环地址，用普通 HTTP 同时验证根路径和 `/cijing-reading/` 下的全部构建文件、hash 路由、相对入口资源、许可文件、安全策略，以及构建中常见私钥／本机路径模式。它不是全功能浏览器测试，也不是完整的密钥检测或安全审计。

`pnpm preview` 仅供开发者检查构建，并不是对外长期运行的生产服务器。向其他设备分享 localhost 或 127.0.0.1 不会让它们访问这台电脑。

## 推荐平台：GitHub Pages

选择原因：现有项目完全静态，已有 hash 路由，不需要云函数或数据库；公开仓库可以使用免费 Pages。后续若迁移到其他静态平台，也只需托管同一份 dist。

已准备 `.github/workflows/pages.yml`，只接受 `workflow_dispatch` 手动运行，push 不会触发发布。它会安装锁定依赖、运行 TypeScript／测试／构建／静态检查，仅上传 dist，最后使用 GitHub 官方 Pages action 发布；无需在源码填写令牌或 API 密钥。本轮没有连接仓库或实际执行该 workflow，GitHub 环境中的首次运行仍待用户完成。

获得公开网址的步骤（仅在用户确认发布之后操作）：

1. 在 GitHub 创建公开仓库，例如 `cijing-reading`。把本项目目录中的源码、package.json、pnpm-lock.yaml、pnpm-workspace.yaml、public、tests、scripts、docs 和 `.github` 等放到仓库根目录。不要上传整个 Codex 工作目录、node_modules、evidence、.env 或私人文件。小说存在浏览器 IndexedDB，并不在源码或 dist 中。
2. 仓库 Settings → Pages → Build and deployment → Source，选择 **GitHub Actions**。
3. Actions → **Publish static website (manual)** → Run workflow，选择已上传代码的分支。上传源码不会自动执行这一步。
4. 等待 build 和 deploy 两个任务成功。Pages 设置或 github-pages 环境会给出真实网址，通常为 `https://<用户名>.github.io/cijing-reading/`，可分享其 `#/books` 地址。
5. 使用生成的 HTTPS 链接在另一台设备检查首页、词库、TXT、EPUB、分页和刷新恢复，再决定是否正式推广。首次网址、域名或协议变更不会自动迁移原先 localhost 的书库。

若失败，检查 workflow 日志和 Pages 权限／环境设置。不要把 GitHub token 或翻译密钥填进 VITE_* 环境变量，前端构建变量对访问者可见。

参考官方资料：
- https://vite.dev/guide/build#relative-base
- https://vite.dev/guide/static-deploy.html
- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages

## 本地数据与隐私

| 内容 | 当前存储位置 | 行为 |
| --- | --- | --- |
| TXT／EPUB 正文、目录和图片 | `cijing-reading` IndexedDB v1，books | 原文只保存在访问者浏览器，导入不上传 |
| 查询词库缓存 | `cijing-vocabulary` IndexedDB v2，assets | 首次从同一静态网站下载公开词库，缓存可离线查询 |
| 收藏／掌握 | 同上，favorites／mastery | 用户主动操作保存，不推定掌握 |
| 本地英文译文 | `cijing-translations` IndexedDB v1，chapters | 按章节单独保存，支持 JSON 导入／导出 |
| 阅读位置 | localStorage `cijing-position:<bookId>` | 原文 chapterId + paragraph + UTF-16 offset；可附当前显示指纹位置辅助恢复 |
| 字号、英语浓度、提示、背景与翻页 | localStorage 的字体与阅读偏好键 | 与小说原文分开保存 |
| 书架主题 | localStorage `cijing-theme` | 保存失败显示提示，当前切换仍可用 |

不同来源（协议／主机／端口）和浏览器配置文件各自保存，不自动同步。网址路径不是来源隔离边界；同一来源下本应用沿用已有 cijing-* 命名，部署时应避免同源的另一份应用混用同名数据库。同一个浏览器配置文件的使用者会共享本地书库，本项目没有账号级隔离。

当前源码中唯一主动 fetch 是从本网站下载公开词库 JSON，没有上传小说、分析统计、广告、云数据库、付费翻译或开发者 Mac 接口。系统发音使用浏览器语音能力，不承诺所有系统声音均离线。静态托管商仍可能记录正常的网站访问日志，但不会因此获得没有上传的小说正文。

书库与学习记录不在本轮迁移或清空。保存须等待 IndexedDB 事务完成；缺失 API、读写失败、容量不足、连接阻塞均报告失败。容量估算是可选预检，即使该 API 不可用，也以实际写入结果为准。错误不会伪装成服务器已备份。

浏览器手动清理、无痕会话结束或系统回收可能丢失数据。当前无法可靠判断“首次使用”与“已被浏览器清理”的区别，也无法从服务器恢复。书架、导入面板和设置页已明确说明，请保留原小说。2026-10-17 已增加完整 ZIP 备份与安全合并恢复，包含书库、插图、学习、进度、设置与译文；入口在设置页，操作与限制见 [BACKUP.md](BACKUP.md)。独立译文 JSON 导出仍保留。

存储策略参考：https://webkit.org/blog/14403/updates-to-storage-policy/

## EPUB 与生产安全

继续使用安全结构化内容渲染，不挂载书籍原始 HTML／CSS，也不使用 EPUB iframe。保留原有 DTD／实体、危险资源路径、重复路径、压缩大小、实际解压流和图片总量检查；本轮增加 XML 最多 60,000 个元素、深度 128 的限制，避免递归处理极端结构；SVG 排除 CSS 转义绕过及事件／脚本／外部资源。

生产 index.html 增加 CSP：脚本和网络请求仅允许同来源；图片允许同源、Blob 和 data；禁止 object、iframe 和表单提交；样式允许应用所需的行内样式。该策略仅用于生产构建，避免影响开发 HMR，是额外防线，不能替代 EPUB 清理。CSP 的 frame-ancestors 需要托管平台响应头，不宣称 meta 已提供反嵌入保护。

生产依赖审计 `pnpm audit --prod --json` 本轮报告 36 个生产依赖、0 个已知漏洞；这不是未来永远无漏洞或完整渗透测试的保证。公开许可证随 dist 发布，设置页可查看声明；原有词库与短语的来源、署名和许可保留。

## 双语译文与未来 AI

`src/features/translation/` 已实现版本化译文包、独立章节缓存、JSON 导入／导出和六档组合阅读。Provider 只有类型接口，没有自动推理或网络服务。完整说明、限制与本轮 103 项测试见 [双语说明](BILINGUAL.md)。继续保持静态架构，不把翻译密钥放入前端。

## 静态部署准备阶段测试记录（历史）

- 83 项自动测试通过，包含既有 TXT、EPUB、替换、学习记录、设置与进度；新增隔离／清理、同步写入失败、阻塞后迟到连接、配额错误兼容、估算异常、XML 复杂度和 SVG 转义检查。
- TypeScript 与生产构建通过；冻结 lockfile 离线安装检查通过。
- 全部生产文件在普通静态 HTTP 的根目录和模拟仓库子目录均可取得；入口不依赖本机地址／源码路径／开发服务器。
- 浏览器子路径实际完成词库查询、收藏和掌握刷新恢复、中文 EPUB 导入、两张本地插图、0→40% 混合显示、点词释义、20px 与浅绿色／无动画设置、键盘翻页以及第 2 页刷新恢复。
- TXT 实际完成 UTF-8 导入和完整尾句阅读；自动测试继续覆盖 GBK／GB18030。
- 360×800、390×844 视口下无整页横向溢出；桌面尺寸同一生产构建可使用。模拟视口不代表 Safari／Edge 或 iOS／Android 真机测试。
- 未上传 GitHub、未触发 GitHub Actions、未实际发布，暂无可对外分享的真实公开网址。
