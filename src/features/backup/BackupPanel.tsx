import {useEffect,useRef,useState} from 'react'
import {sampleBooks} from '../reading/sampleBooks'
import type {BackupData} from './types'
import {createBackup,parseBackup} from './archive'
import {prepareRestore,restoreBackup} from './restore'
import type {RestorePlan} from './restore'
export function BackupPanel({onChanged}:{onChanged:()=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [download,setDownload]=useState<string|null>(null),[draft,setDraft]=useState<BackupData|null>(null),[plan,setPlan]=useState<RestorePlan|null>(null)
  const [restoreSettings,setRestoreSettings]=useState(false),[name,setName]=useState('')
  const token=useRef(0)
  useEffect(()=>()=>{token.current++},[])
  useEffect(()=>()=>{if(download)setTimeout(()=>URL.revokeObjectURL(download),30000)},[download])
  async function exportFile() {
    setBusy(true);setError('');setNotice('');setDownload(null);const generation=++token.current
    try {
      const blob=await createBackup(sampleBooks)
      if(generation===token.current){setDownload(URL.createObjectURL(blob));setName(`词境阅读-完整备份-${new Date().toISOString().slice(0,10)}.zip`);setNotice('完整备份文件已准备。请点击下载链接，确认文件保存在系统文件中。')}
    } catch(error){if(generation===token.current)setError(`完整备份未生成：${error instanceof Error?error.message:'本地存储读取失败。'} 请检查存储权限和可用空间后重试。`)}
    finally{if(generation===token.current)setBusy(false)}
  }
  async function choose(file:File|undefined) {
    setDraft(null);setPlan(null);setRestoreSettings(false);setError('');setNotice('');if(!file)return
    const generation=++token.current;setBusy(true)
    try {const backup=await parseBackup(file),plan=await prepareRestore(backup,sampleBooks);if(generation===token.current){setDraft(backup);setPlan(plan)}}
    catch(error){if(generation===token.current)setError(error instanceof Error?error.message:'无法读取备份。')}
    finally{if(generation===token.current)setBusy(false)}
  }
  async function restore() {
    if(!draft)return
    setBusy(true);setError('');setNotice('');const generation=++token.current
    try {
      const result=await restoreBackup(draft,sampleBooks,{restoreSettings})
      if(generation===token.current){setNotice(`恢复完成：新增 ${result.books} 本小说、${result.learning} 条收藏／掌握记录、${result.translations} 章译文、${result.positions} 项进度、${result.settings} 项设置；跳过 ${result.skipped} 项已有记录。`);setDraft(null);setPlan(null)}
    } catch(error){if(generation===token.current)setError(error instanceof Error?error.message:'恢复失败，请重新导入。')}
    finally{if(generation===token.current){setBusy(false);onChanged()}}
  }
  return <section className="backup-panel" aria-labelledby="backup-title"><h2 id="backup-title">完整备份与恢复</h2>
    <p>备份书架、小说正文、封面与插图、目录、阅读进度、收藏、掌握状态、阅读设置及已导入译文。文件仅在本机生成，不上传。</p>
    <button className="primary-button" disabled={busy} onClick={()=>void exportFile()}>导出完整备份</button>
    {download&&<p><a className="text-button translation-download" href={download} download={name}>下载备份 ZIP：{name}</a></p>}
    <label className="field-label">导入完整备份<input type="file" accept=".zip,application/zip" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';void choose(file)}}/></label>
    <p className="micro">最大128 MB，解压内容最多256 MB。先校验和预览再恢复。已有书籍和学习记录保留；相同内容合并，冲突书籍另存副本。较大书库需要较长处理时间，请保持页面打开，并关闭其他阅读标签页以避免并发修改。</p>
    {draft&&plan&&<div className="backup-preview"><h3>恢复预览</h3><p>{draft.createdAt} · 共 {draft.books.length} 本书（含示例小说），{draft.favorites.length} 项收藏，{draft.mastery.length} 项掌握记录，{draft.positions.length} 项进度。</p><p>预计新增 {plan.newBooks} 本书，合并 {plan.existingBooks} 本同内容书籍；新增 {plan.newFavorites} 项收藏、{plan.newMastery} 项掌握记录。{plan.conflicts} 项已有学习记录将保留当前版本。</p><p>已有进度和译文不会被替换；重复导入会跳过已恢复内容。</p><label className="backup-settings-choice"><input type="checkbox" checked={restoreSettings} disabled={busy} onChange={event=>setRestoreSettings(event.target.checked)}/>恢复并替换当前阅读设置（主题、字号、英语浓度等）</label><p className="micro">默认只补充缺少的设置；勾选后明确使用备份中的设置。</p><button className="primary-button" disabled={busy} onClick={()=>void restore()}>确认合并恢复</button></div>}
    {busy&&<p role="status">正在处理本地备份，请勿关闭页面…</p>}{notice&&<p className="english-notice" role="status">{notice}</p>}{error&&<p className="error-message" role="alert">{error}</p>}
    <p className="micro">备份包含你的小说和学习记录，请自行妥善保存和传递给另一台设备。没有服务器备份或自动同步。中途失败会报告已完成部分，可重新导入补齐；恢复完成后，请检查书架和学习记录。</p>
  </section>
}
