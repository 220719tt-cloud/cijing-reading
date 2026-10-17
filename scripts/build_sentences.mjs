import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {gzipSync} from 'node:zlib'
const root=new URL('../',import.meta.url)
const source=await readFile(new URL('src/features/sentences/data/editorial.tsv',root),'utf8')
const counts={},seen=new Set()
const entries=source.split('\n').filter(line=>line&&!line.startsWith('#')).map((line,index)=>{
 const [category,chinese,english,...extra]=line.split('|')
 if(extra.length||!['conversation','thought','action','emotion','setting'].includes(category)||!/[。？！]$/.test(chinese)||!/[.!?]$/.test(english)||seen.has(chinese))throw Error(`Invalid editorial row ${index+1}`)
 seen.add(chinese);counts[category]=(counts[category]??0)+1
 return {id:`sentence:${String(index+1).padStart(3,'0')}`,category,chinese,english,source:'cijing-original-2026-10-17'}
})
if(entries.length!==200)throw Error(`Expected 200 authored entries, got ${entries.length}`)
const data=JSON.stringify(entries)+'\n'
await writeFile(new URL('src/features/sentences/data/sentences.json',root),data)
const manifest={version:1,source:'cijing-original-2026-10-17',description:'本项目原创编辑双语例句；非外部词典摘录；未声称语料频次或母语审校。',license:'CC0-1.0',count:entries.length,categories:counts,bytes:Buffer.byteLength(data),gzipBytes:gzipSync(data).length,sha256:createHash('sha256').update(data).digest('hex'),sourceSha256:createHash('sha256').update(source).digest('hex')}
await writeFile(new URL('src/features/sentences/data/manifest.json',root),JSON.stringify(manifest,null,2)+'\n')
console.log(manifest)
