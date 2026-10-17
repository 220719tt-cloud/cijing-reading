import type { Book } from '../../shared/types/book'
import type { ReadingPosition } from '../reading/readingPosition'
import type { FavoriteRecord, MasteryRecord } from '../vocabulary/types'
import type { TranslationPackage } from '../translation/types'
export interface BackupData {
  format:'cijing-backup'
  schemaVersion:1
  createdAt:string
  books:Book[]
  favorites:FavoriteRecord[]
  mastery:MasteryRecord[]
  positions:{bookId:string;position:ReadingPosition}[]
  settings:Record<string,string>
  translations:{bookId:string;data:TranslationPackage}[]
}
export const BACKUP_LIMITS={file:128*1024*1024,expanded:256*1024*1024,entry:24*1024*1024,image:8*1024*1024,files:12000,books:500,records:100000}
export const SETTING_KEYS=['cijing-theme','cijing-font-size','cijing-reader-preferences'] as const
