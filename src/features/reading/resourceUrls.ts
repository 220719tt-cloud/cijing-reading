import { useEffect, useState } from 'react'
import type { BookResource } from '../../shared/types/book'
export function useResourceUrls(resources: BookResource[] | undefined) {
  const [urls,setUrls]=useState<Record<string,string>>({})
  useEffect(()=>{
    const next:Record<string,string>={}
    for(const resource of resources??[]) next[resource.id]=URL.createObjectURL(resource.blob)
    setUrls(next)
    return ()=>{Object.values(next).forEach(url=>URL.revokeObjectURL(url))}
  },[resources])
  return urls
}
