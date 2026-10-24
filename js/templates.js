// Page templates: a few block skeletons for the kinds of notes that benefit from structure.
import { block } from './blocks.js';

const h2 = (t) => block('h2', t);
const p = (t = '') => block('p', t);
const bullet = (t = '') => block('bullet', t);
const todo = (t = '') => block('todo', t);
const callout = (t) => block('callout', t);

export const TEMPLATES = [
  {
    k: 'concept', label: '概念卡 · 费曼', hint: '解释 · 类比 · 追问', icon: 'zap', review: 3, tags: ['概念'],
    make: () => [
      callout('💡 用自己的话讲给一个 12 岁的孩子听。讲不清楚的地方，就是还没真懂的地方。'),
      h2('一句话解释'), p(),
      h2('用自己的话讲（费曼）'), p(),
      h2('类比'), p(),
      h2('追问'), bullet('为什么会这样？'), bullet('它和 ____ 的区别是什么？'), bullet('什么情况下不成立？'),
      h2('还没想通的'), todo(),
    ],
  },
  {
    k: 'project', label: '项目卡', hint: '目标 · 阶段 · 下一步', icon: 'kanban', review: 7,
    make: () => [
      h2('目标'), p(),
      h2('阶段'), todo('启动：明确范围'), todo('推进：做出第一个版本'), todo('收尾：整理与交付'),
      h2('下一步'), todo(),
      h2('记录'), p(),
    ],
  },
  {
    k: 'review', label: '复盘', hint: '发生了什么 · 做得好 · 改进',
    icon: 'refresh',
    make: () => [
      h2('发生了什么'), p(),
      h2('做得好的'), bullet(),
      h2('可以更好的'), bullet(),
      h2('下次要做的'), todo(),
    ],
  },
];

export function templateBlocks(k) { const t = TEMPLATES.find((x) => x.k === k); return t ? t.make() : []; }
