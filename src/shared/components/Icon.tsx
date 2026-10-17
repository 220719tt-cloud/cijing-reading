export type IconName = 'book' | 'words' | 'settings' | 'sun' | 'moon' | 'back' | 'arrow'
const paths: Record<IconName, string> = {
  book: 'M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15',
  words: 'M5 3h14v18l-7-4-7 4V3Zm4 5h6m-6 4h4',
  settings: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  sun: 'M12 3V1m0 22v-2M3 12H1m22 0h-2M5.6 5.6 4.2 4.2m15.6 15.6-1.4-1.4m0-12.8 1.4-1.4M4.2 19.8l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  moon: 'M20 15.5A9 9 0 0 1 8.5 4 9 9 0 1 0 20 15.5Z',
  back: 'm14 5-7 7 7 7',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
}
export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>
}
