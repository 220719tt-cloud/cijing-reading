# 长期设备与浏览器兼容标准

更新：2026-10-16。目标是用户获得网站链接即可用浏览器访问；安装 App 或添加主屏幕均不是使用前提。

## 支持范围

- iPhone：Safari、Chrome。
- Android 手机／平板：Chrome、Edge 等主流浏览器。
- Mac：Safari、Chrome、Edge、Firefox；Windows：Chrome、Edge、Firefox。
- 优先验证当前稳定版，采用响应式布局，覆盖小屏、横屏、平板与桌面窗口；不依赖设备品牌或 User-Agent 分支。
- 当前技术基线：Safari 16.4+、Chrome/Chromium Edge 111+、Firefox 128+。这是依赖兼容基线，不是这些版本全部已实测的声明。更老或内嵌浏览器只尽力降级，不承诺完整样式与功能。
- 当前 Tailwind CSS 4 对现代 CSS 有要求，不能仅通过降低 JS 构建目标支持任意旧浏览器。参考 [Tailwind 官方兼容说明](https://tailwindcss.com/docs/compatibility)。

## 架构与数据

1. 保持纯前端；未来通过 GitHub Pages 提供公开链接，不引入账号或服务器数据库。
2. 小说及未来学习记录保存在每个用户当前浏览器的 IndexedDB。显示偏好和现有原文位置可继续保留 localStorage，避免不必要的数据迁移。
3. 同一公开链接不意味着共享书库：不同设备、浏览器配置文件、来源（域名／协议／端口）各自独立，不自动同步。网站公开不会把本地小说公开。
4. IndexedDB 被禁用、配额不足、隐私模式限制或数据被清理时，明确显示限制；不静默改成临时内存存储并宣称已保存。
5. TXT 与 EPUB 共用 Book/Chapter 与 BookImporter。通过原生 input[type=file] 调用各系统文件选择器，不读取或猜测系统路径；accept 只辅助筛选，解析器仍需验证格式。
6. UTF-8 优先，GB18030/GBK 使用标准 TextDecoder；不支持相应编码时提示改选编码或转换为 UTF-8。EPUB 使用独立解析器输出相同的 Book/Chapter，支持边界与实测范围见 EPUB.md。
7. 未来词库查询、英文替换与现有英语浓度使用通用 JS/Web 标准；未实现的能力清楚标示。
8. 未来听书必须分别测试 iOS 与 Android 的声音列表、语言切换、播放手势、暂停继续、后台与锁屏限制；不可将一端结果推广到另一端。

## 本次代码审查与处理

| 位置／能力 | 审查结论 | 本次处理或后续约束 |
| --- | --- | --- |
| -webkit-font-smoothing、tap-highlight-color、text-size-adjust、user-select | 平台样式增强，无 Safari 专属业务逻辑 | 保留增强，并保留／补充标准属性、系统字体回退；不支持时可忽略 |
| env(safe-area-inset-*)、svh/dvh | 通用 CSS 标准，不是 Safari 专属接口 | 阅读器和底部面板补 vh 回退；安全区在普通屏幕为零 |
| Vite build.target | 原先只明确列出 Safari 与 ES 版本 | 明确列出 Chrome、Edge、Firefox、Safari 基线；不增加部署配置 |
| Element.animate | 标准接口，原先未检测支持或异常 | 缺失、抛错或偏好减少动画时即时翻页；覆盖层及时移除，不阻断阅读 |
| ResizeObserver | 标准接口，原先直接依赖 | 初次立即测量；同时监听 window/visualViewport resize，无 ResizeObserver 时仍可重排；卸载清理监听 |
| matchMedia | 标准接口，原先直接调用 | 缺失或调用失败时采用默认主题／动画偏好 |
| Pointer Events / setPointerCapture | 跨鼠标、触摸和笔的标准接口 | 捕获指针做检测与异常处理，保留按钮／键盘翻页；支持基线内有 Pointer Events |
| IndexedDB | 通用标准，并非 Safari 专属 | 无 API 时给出中文说明；保留事务完成后才确认保存、配额错误提示 |
| File / arrayBuffer / TextDecoder / crypto.getRandomValues | 通用标准，在目标现代浏览器可用 | 维持原生文件选择及现有解析错误提示；不引入专属文件系统接口 |
| dialog.showModal | 通用标准，在目标现代浏览器可用 | 保留原生焦点与弹层行为；不为低于支持基线的旧浏览器自制不完整弹层替代 |
| CSS 多栏＋Range 分页 | 通用标准，不同字体和引擎的换行会不同 | 不要求各设备页码一致；以原文位置恢复。真实排版仍需各引擎验收 |

## 后续每项功能的验收矩阵

至少在以下环境记录通过／失败／未测，不把响应式模拟当作真机：

- iOS Safari 与 Chrome：文件选择、点按／滑动、横竖屏、工具栏和面板、安全区。
- Android Chrome 与 Edge：同项测试，另检查系统文件提供器的扩展名／MIME 差异。
- Mac 与 Windows：书架、导入、分页、滚动、键盘、窗口缩放、各浏览器存储恢复。
- 全端：英语浓度和阅读偏好保存、IndexedDB 小说刷新恢复、存储不可用提示、减少动画偏好。
- EPUB 的文件与图片、重排验收见 EPUB.md；未来听书按任务增加声音测试。

本次完成源代码审查、降级逻辑自动测试与项目测试／构建；尚未完成所有设备和浏览器的真机验收。


## 公开部署准备验收（2026-10-16）

相对资源路径、静态生产服务、CSP、本地存储异常与 EPUB 复杂度检查见 DEPLOYMENT.md。维持现有浏览器基线，不以单一 Chromium 或模拟视口冒充所有设备通过。TXT／EPUB 均使用原生文件选择器；不要求安装 App。未来 AI 译文接口只预留类型，不依赖设备端模型或 Mac 本地服务。
