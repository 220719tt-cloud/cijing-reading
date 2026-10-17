/** Add-only merge. Every decision and insert occurs in the same transaction. */
export function addMissing(db:IDBDatabase,batches:{store:string;records:{key:IDBValidKey;value:unknown}[]}[]):Promise<{added:number;skipped:number}> {
  return new Promise((resolve,reject)=>{
    let tx:IDBTransaction;let added=0,skipped=0;let failure:unknown
    try {
      tx=db.transaction(batches.map(batch=>batch.store),'readwrite')
      for(const batch of batches) for(const item of batch.records) {
        const store=tx.objectStore(batch.store),request=store.get(item.key)
        request.onsuccess=()=>{try{if(request.result===undefined){store.add(item.value);added++}else skipped++}catch(error){failure=error;tx.abort()}}
      }
    } catch(error){try{tx!.abort()}catch{/* No transaction. */}db.close();reject(error);return}
    tx.oncomplete=()=>{db.close();resolve({added,skipped})}
    tx.onabort=()=>{db.close();reject(failure??tx.error??new Error('合并事务失败，本批数据没有保存。'))}
  })
}
