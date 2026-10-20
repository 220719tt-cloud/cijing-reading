# 词境阅读

在故事里，自然学英语。

面向手机与电脑的免费英语学习阅读器，React + TypeScript + Vite + Tailwind CSS，静态前端，无账号或公共书库数据库；可选Cloudflare Worker提供按免费额度运行的云翻译。小说与学习记录保存在访问者浏览器，云翻译仅在明确允许后发送所选章节。公开测试版地址：[打开词境阅读](https://220719tt-cloud.github.io/cijing-reading/#/books)。不安装 AI 模型，未配置 PWA。

## 当前功能

- TXT（UTF-8／GB18030／GBK）和 EPUB 2／3 本地导入、封面／目录、书架及删除。
- 当前章分页、点击／触摸／键盘翻页、覆盖／平移／滚动／无动画模式，字号 14–32px、六种背景与夜间模式。
- 按原文位置保存进度；字号、窗口及浓度变化后重新排版并尽量保持位置。
- 8,223 个查询词条（含 1,300 条短语）、相关短语推荐、词义卡、系统发音、收藏和已掌握标记。
- 六档浓度按转为英文的原文覆盖范围计算：0% 原文，20%／40%可结合本地精选表达和真实译句，60%／80%以真实译句混排，100%要求整章译文完整；所有非零档位共用已有译文及缓存。
- 新增 200 条常见完整句，20%／40% 精确匹配合适句子，支持整句查看中文原句与收藏；生词本可展开查询句型库。详见 [句型说明](docs/SENTENCES.md)。
- 完整 ZIP 备份与跨设备合并恢复：小说、插图、进度、收藏、掌握、设置和已保存译文；已有数据默认不覆盖。详见 [备份说明](docs/BACKUP.md)。
- 非零档位支持通过已配置的Worker翻译当前章、显示真实进度并缓存复用；须由读者明确允许。模型格式错误跳过保留中文，网络中断有限探测与恢复，超限暂停。见 [自动翻译配置](docs/AUTO-TRANSLATION.md)及[网络恢复边界](docs/TRANSLATION-NETWORK-RECOVERY.md)。
- 按章节独立缓存译文，支持原文模板／已存译文 JSON 导出、校验预览和导入。100% 必须本章译文完整，否则明确显示原文，不伪装翻译。

没有译文时可由已配置的Cloudflare服务生成真实英文；未配置或未允许时明确提示并保留原文，也可继续导入人工译文。真实模型的自然度和忠实性仍须实际验收，不承诺免费不限量。各浓度共用一份译文，切换无需翻译。英文默认无中文括注，原小说中的括号不会被删除。

公开测试版仍需真实手机持续验收；云翻译受网络、模型质量、限流和免费额度限制，不承诺所有句组成功。不同网址来源和浏览器的本地书库相互独立，从本机开发地址迁移到正式站请先导出完整备份，再到正式站安全合并恢复。

## 运行与验证

需要 Node.js 20.19+（20.x）或 22.12+，测试使用 Node 22.18+／24；pnpm 版本见 package.json。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

打开终端显示的 Local 地址。保持同一协议、主机和端口才能访问原有本地数据。

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm check:static
pnpm preview
```

`dist/` 可由普通静态服务器托管，支持根目录及 GitHub Pages 仓库子目录；hash 路由不需要服务器重写。`preview` 仅供本地检查。Pages workflow 仅手动触发，本轮不上传、不部署。

同一可信局域网的手机预览可用 `pnpm dev --host 0.0.0.0`，访问终端的 Network 地址；手机的 localhost 不是开发电脑。

## 译文使用

阅读页 → 英语 → 译文管理 → 导出原文模板 → **点击下载链接**。保留原文、编号、范围、哈希，填写英文 `targetText` 后导入，检查覆盖率，再保存到本机。

完整格式、分章更新规则、原文与显示位置、人工测试译文以及验收边界见 [双语说明](docs/BILINGUAL.md)。原创示例《月亮邮局》可导入 `tests/fixtures/translations/moon-en.json` 验收六档；它不是自动 AI 翻译，不会随生产网站自动导入。

## 目录职责

```text
src/
  app/                  应用组装与书架数据
  pages/                书架、阅读器、生词本、设置
  features/
    importing/          TXT／EPUB 统一导入接口
    reading/            示例书、分页、交互、设置及位置
    replacement/        独立精选替换规则与显示坐标
    vocabulary/         本地查询、短语与学习存储
    translation/        译文格式、缓存、交换、双语显示与自动任务
    backup/             完整ZIP备份、安全校验及合并恢复
    audio/              未来听书预留
  shared/               共享组件、类型与存储工具
worker/                 Cloudflare翻译入口与限流配置（单独手动发布）
  styles/               全局样式与 Tailwind 入口
```

## 数据与兼容性

原书存入 `cijing-reading` IndexedDB v1，词库／收藏／掌握存入 `cijing-vocabulary` v2，译文存入独立 `cijing-translations` v1；小型偏好和原文阅读位置沿用 localStorage。导入不上传，清理网站数据或系统回收可能导致丢失，请保留原书及完整 ZIP 备份。不同设备、来源或浏览器配置文件不自动同步；使用设置页导出并在另一端合并恢复。

面向 iPhone Safari／Chrome、Android Chrome／Edge、Mac／Windows 现代浏览器，通用 Web 标准优先。内置 Chromium 与响应式尺寸验收不代表所有真机均通过，系统语音及原生下载还需实测。没有 PWA，不能承诺断网首次访问或整站刷新。

进一步说明：

- [自动翻译实现、费用与配置步骤](docs/AUTO-TRANSLATION.md)
- [高浓度修复与自动翻译方案](docs/CONCENTRATION-FIX.md)
- [最后检查与真机清单](docs/FINAL-CHECK.md)、[完整备份与恢复](docs/BACKUP.md)
- [生词本、分类与句子收藏](docs/LEARNING-COLLECTIONS.md)
- [阅读交互与替换修复](docs/READING-EXPERIENCE.md)
- [兼容性标准](docs/COMPATIBILITY.md)
- [词库来源与许可](docs/VOCABULARY.md)、[短语报告](docs/PHRASES.md)
- [精选替换规则](docs/REPLACEMENT-V1.md)、[释义卡与学习记录](docs/WORD-CARDS.md)
- [EPUB 安全与限制](docs/EPUB.md)
- [静态部署说明](docs/DEPLOYMENT.md)

本轮自动测试 156 项通过。生产只发布 `dist/`，不发布测试文件、evidence、.env 或本机路径。后续每次只开发经用户确认的任务，测试后停止。
