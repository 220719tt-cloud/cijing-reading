import type { Book } from '../../shared/types/book'
export interface SampleBook {
  id: string
  title: string
  author: string
  genre: string
  description: string
  progress: number
  chapter: string
  palette: string
  paragraphs: string[]
}

const samples: SampleBook[] = [
  {
    id: 'mist', title: '雾海来信', author: '林间', genre: '奇幻 · 远行', progress: 32,
    description: '一封没有寄件人的信，通往地图之外的海。',
    chapter: '第一章 · 潮声里的信', palette: 'mist',
    paragraphs: [
      '雾是在凌晨来到小镇的。它越过码头，沿着石阶缓缓爬上来，直到每一扇窗都像浮在海面上。',
      '许迟推开书店的门时，在门缝里发现了一封信。信封是淡蓝色的，没有邮票，边缘却沾着几粒细白的盐。',
      '“请在下一次退潮时，到旧灯塔来。”信上只有这一句话。落款的位置，画着一只没有翅膀的鸟。',
      '他认得那只鸟。小时候，母亲总把它画在故事的最后一页。她说，所有暂时到不了的地方，都可以先让一只鸟替你去看看。',
      '街对面的早餐铺亮起了灯。老板娘撑开雨棚，向他招手，像往常一样问他要不要一碗热粥。许迟把信折好，放进胸前的口袋。',
      '“今天要出门？”她问。',
      '“去海边走走。”他说。说完，他自己也有些惊讶。自从母亲离开小镇，他已经很久没有走过通往灯塔的路了。',
      '雾中传来第一声船笛。那些熟悉的屋顶、招牌和晾衣绳，在声音里轻轻晃动。他忽然觉得，小镇也许是一艘停泊了太久的船。',
      '而今天，终于有人送来了起航的消息。',
    ],
  },
  {
    id: 'moon', title: '月亮邮局', author: '南枝', genre: '治愈 · 日常', progress: 16,
    description: '把来不及说的话，寄给夜空中的那个人。',
    chapter: '第一章 · 午夜的营业时间', palette: 'moon',
    paragraphs: [
      '巷子尽头的邮局只在月亮升起后营业。白天，那是一间门窗紧闭的旧屋，门口的花盆里种着一棵始终不开花的栀子。',
      '周宁搬来第三天，才发现门上的营业时间没有写数字，而是一小片银色的月牙。',
      '那晚她加班回来，看见屋里透出暖黄的光。一个戴圆框眼镜的老人坐在柜台后面，正在给一叠信封盖章。每盖一下，屋顶就落下一声很轻的响，像有人拨动了风铃。',
      '“这里能寄信吗？”她站在门口问。',
      '老人抬起头：“当然。只要你知道想寄给谁。”',
      '“不知道地址也可以？”',
      '“有些人的地址，不在地图上。”他从抽屉里取出一张信纸，推到柜台边缘，“坐下来慢慢写。”',
      '周宁在窗边坐下。她原本没有要写信的打算，可笔尖碰到纸面的瞬间，一个许久没喊出口的称呼，忽然清清楚楚地浮了上来。',
      '窗外，栀子花开了第一朵。',
    ],
  },
  {
    id: 'forest', title: '山野有回声', author: '远川', genre: '文学 · 成长', progress: 0,
    description: '沿着一条旧山路，找回自己的生活节奏。',
    chapter: '第一章 · 回山的人', palette: 'forest',
    paragraphs: [
      '大巴在山脚停下时，雨刚好停了。陈禾背着包站在路边，看着云从山腰慢慢撤开，露出一排深绿色的树。',
      '来接她的是外公。他骑着一辆旧三轮车，车斗里铺了干净的竹席，还放着两只刚摘下来的梨。',
      '“路上累不累？”他问。',
      '陈禾摇摇头，坐上车。她本想解释自己为什么突然回来，为什么辞去了那份大家都觉得不错的工作，可外公并没有问。',
      '山路窄，一边是溪水，一边是新长出来的蕨菜。三轮车慢得像一只散步的甲虫，但每转过一个弯，眼前就多出一点她小时候熟悉的东西。',
      '石桥还在。桥边那棵树也还在，只是树下卖凉粉的人换成了年轻面孔。',
      '“今年雨水好。”外公说，“后山的竹笋长得快，明早带你去看看。”',
      '她咬了一口梨。汁水很甜，顺着手指落到竹席上。她忽然发现，自己已经很久没有认真尝过一只梨的味道。',
      '远处有人喊了一声，山谷把那声音轻轻送了回来。陈禾抬起头，第一次没有急着去看手机里的时间。',
    ],
  },
]

export const sampleBooks: Book[] = samples.map(book => ({
  schemaVersion: 1, id: book.id, title: book.title, author: book.author,
  source: 'sample', importedAt: '', palette: book.palette as Book['palette'], genre: book.genre,
  demoProgress: book.progress,
  chapters: [{ id: 'chapter-1', title: book.chapter, order: 0, paragraphs: book.paragraphs }],
}))
