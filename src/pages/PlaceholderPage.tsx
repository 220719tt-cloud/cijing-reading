import {lazy,Suspense} from 'react'
const BackupPanel=lazy(()=>import('../features/backup/BackupPanel').then(module=>({default:module.BackupPanel})))
import { Icon } from '../shared/components/Icon'

export function PlaceholderPage({ page,onRestored }: { page: 'words' | 'settings';onRestored:()=>void }) {
  const words = page === 'words'
  return <section className={`placeholder-page${words ? '' : ' local-settings-page'}`}><div className="placeholder-icon"><Icon name={words ? 'words' : 'settings'} size={34} /></div><p className="eyebrow">{words ? '留住每一次遇见' : '找到舒服的阅读方式'}</p><h1>{words ? '生词本' : '设置'}</h1><p className="muted">{words ? '未来，在故事中遇见的词语将在这里相聚。' : '阅读偏好可在阅读器中调整；以下说明适用于当前浏览器中的本地数据。'}</p>{words && <span className="placeholder-badge">即将慢慢完善</span>}{!words && <p className="theme-hint">现在可以用右上角按钮切换浅色与深色。</p>}{!words && <section className="local-data-notice" aria-label="本地数据与隐私"><h2>你的书，只在你的浏览器里</h2><p>小说、阅读进度、收藏、掌握记录和阅读设置保存在当前浏览器，不会上传到公共书库。没有账号，也不会在设备间自动同步。</p><p>清理网站数据、使用无痕模式或浏览器自动回收空间，可能导致本地数据丢失，网站无法从服务器恢复。请保留 TXT／EPUB 原文件。</p><p>更换设备、浏览器、域名或访问端口会使用独立的数据。请使用下方完整备份导出文件，在其他设备导入恢复；不要把浏览器当作唯一备份。</p><p>遇到容量不足或存储被禁用时，保存会报错；未提示成功的操作不代表已经保存。请使用浏览器直接打开本站，避免在聊天软件内置页面长期保存小说。</p><a className="text-button" href={`${import.meta.env.BASE_URL}licenses/NOTICE.txt`} target="_blank" rel="noreferrer">查看开源与数据许可</a></section>}{!words&&<Suspense fallback={<p role="status">正在准备备份工具…</p>}><BackupPanel onChanged={onRestored}/></Suspense>}</section>
}
