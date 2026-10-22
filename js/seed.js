// Sample content so the OS doesn't open empty. Everything here can be cleared in Settings.
import { get, replace } from './store.js';
import { uid, todayStr, addDays, monthKey, weekKey, weekStart, weekDays } from './util.js';

export function seed() {
  const s = structuredClone(get());
  const t = todayStr();
  const ws = weekStart(t), wd = weekDays(ws), wk = weekKey(t), mk = monthKey();
  const now = new Date().toISOString();

  s.todos = [
    { id: uid(), title: '整理这周读的三篇论文笔记', done: false, priority: 1, due: t, time: '10:00', tags: ['研究'], area: '学习', note: '', created: t },
    { id: uid(), title: '跑步 5km', done: false, priority: 2, due: t, time: '18:30', tags: ['运动'], area: '健康', note: '', created: t },
    { id: uid(), title: '给 portfolio 加 writing 页面', done: false, priority: 1, due: addDays(t, 1), time: '', tags: ['portfolio'], area: '创作', note: '参考 writing/_template.html', created: t },
    { id: uid(), title: '回复导师邮件', done: false, priority: 0, due: t, time: '09:30', tags: [], area: '学习', note: '', created: t },
    { id: uid(), title: '买下个月的机票', done: false, priority: 2, due: addDays(t, 4), time: '', tags: ['旅行'], area: '探索', note: '', created: t },
    { id: uid(), title: '读完《纳瓦尔宝典》第三章', done: false, priority: 3, due: '', time: '', tags: ['阅读'], area: '学习', note: '', created: t },
    { id: uid(), title: '晨间冥想 10 分钟', done: true, priority: 2, due: t, time: '07:30', tags: ['习惯'], area: '健康', note: '', created: t, completedAt: t },
  ];

  s.blocks = [
    { id: uid(), date: t, start: '07:00', end: '08:00', title: '晨间：冥想 + 早餐 + 计划', kind: 'life', note: '' },
    { id: uid(), date: t, start: '09:00', end: '11:30', title: '深度工作：论文写作', kind: 'focus', note: '' },
    { id: uid(), date: t, start: '13:30', end: '15:00', title: '读文献', kind: 'study', note: '' },
    { id: uid(), date: t, start: '15:30', end: '17:30', title: 'portfolio 开发', kind: 'create', note: '' },
    { id: uid(), date: t, start: '18:30', end: '19:30', title: '跑步', kind: 'move', note: '' },
    { id: uid(), date: t, start: '21:00', end: '22:00', title: '阅读 + 复盘', kind: 'rest', note: '' },
  ];

  s.weeks[wk] = {
    focus: '1. 把论文的方法部分写完\n2. portfolio writing 页面上线\n3. 每天运动 30 分钟',
    items: { [wd[0]]: [{ id: uid(), text: '列出本周三件事', done: true }], [wd[2]]: [{ id: uid(), text: '组会', done: false }], [wd[5]]: [{ id: uid(), text: '周回顾 + 下周计划', done: false }] },
    review: '',
  };

  s.goals[mk] = [
    { id: uid(), title: '完成论文初稿', area: '学习', why: '这是今年最重要的一件事。', progress: 0, krs: [{ id: uid(), text: '方法部分', done: true }, { id: uid(), text: '实验与结果', done: false }, { id: uid(), text: '讨论与结论', done: false }] },
    { id: uid(), title: '读完 2 本书', area: '学习', why: '', progress: 0, krs: [{ id: uid(), text: '《纳瓦尔宝典》', done: false }, { id: uid(), text: '《设计心理学》', done: false }] },
    { id: uid(), title: '运动 12 次', area: '健康', why: '身体是一切的底座。', progress: 35, krs: [] },
  ];

  s.books = [
    { id: uid(), title: '纳瓦尔宝典', author: 'Eric Jorgenson', type: 'book', status: 'reading', progress: 86, total: 280, rating: 0, cover: '', link: '', note: '“具体的知识无法被培训，只能被发现。”', tags: ['思维'], color: '#18a8a2', started: addDays(t, -9), finished: '', created: addDays(t, -9) },
    { id: uid(), title: 'The Design of Everyday Things', author: 'Don Norman', type: 'book', status: 'reading', progress: 30, total: 0, rating: 0, cover: '', link: '', note: '', tags: ['设计'], color: '#f0a020', started: addDays(t, -20), finished: '', created: addDays(t, -20) },
    { id: uid(), title: 'Attention Is All You Need', author: 'Vaswani et al.', type: 'paper', status: 'done', progress: 100, total: 0, rating: 5, cover: '', link: 'https://arxiv.org/abs/1706.03762', note: '重读一遍，这次关注 positional encoding 的设计动机。', tags: ['ML'], color: '#2878e8', started: '', finished: addDays(t, -3), created: addDays(t, -5) },
    { id: uid(), title: '被讨厌的勇气', author: '岸见一郎', type: 'book', status: 'want', progress: 0, total: 0, rating: 0, cover: '', link: '', note: '', tags: ['心理'], color: '#e0609a', started: '', finished: '', created: addDays(t, -1) },
  ];

  s.links = [
    { id: uid(), url: 'https://amber.botao.hu/', host: 'amber.botao.hu', title: 'Amber · 一个人的数字花园', note: '记录生活与阅读的个人站点，排版很舒服。', tags: ['灵感', '个人网站'], fav: true, read: true, created: t },
    { id: uid(), url: 'https://paulgraham.com/greatwork.html', host: 'paulgraham.com', title: 'How to Do Great Work', note: '', tags: ['文章', '长期主义'], fav: false, read: false, created: addDays(t, -2) },
    { id: uid(), url: 'https://www.joshwcomeau.com/css/interactive-guide-to-grid/', host: 'joshwcomeau.com', title: 'An Interactive Guide to CSS Grid', note: '', tags: ['前端'], fav: false, read: false, created: addDays(t, -6) },
  ];

  s.notes = [
    { id: uid(), title: '个人 OS 的使用方式', body: '# 怎么用这个系统\n\n- **总览**：每天早上打开，看今天的待办与时间线。\n- **计划**：周日晚上写本周焦点；月初定三个月目标。\n- **阅读 / 收藏**：读到好东西先丢进来，周末统一消化。\n- **笔记**：知识库，支持 Markdown 和 `[[双链]]`，比如 [[阅读方法]]。\n- **愿景**：肯定句每天轮换一条显示在总览。\n- **探索**：去过的地方都点亮在星球上。\n\n> 数据在本机浏览器里。设置里可以同步到 GitHub 仓库，或导出 JSON 备份。', tags: ['meta'], pinned: true, created: t, updated: now },
    { id: uid(), title: '阅读方法', body: '## 三遍读法\n\n1. 第一遍：只看目录和每章第一段，判断值不值得读。\n2. 第二遍：正常读，划线。\n3. 第三遍：只看划线，写一段 100 字的总结到这里。\n\n- [ ] 给《纳瓦尔宝典》写总结\n- [x] 给 Attention 论文写总结', tags: ['方法'], pinned: false, created: addDays(t, -4), updated: now },
  ];

  s.vision = {
    statements: [
      { id: uid(), text: '我每天都在变得更专注、更自由。', created: t },
      { id: uid(), text: '我做的东西既好看又有用，而且能帮到真实的人。', created: t },
      { id: uid(), text: '我有足够的时间去读书、去旅行、去发呆。', created: t },
    ],
    board: [
      { id: uid(), img: '', caption: '', text: '一间有大窗户的工作室，窗外是山。' },
      { id: uid(), img: '', caption: '', text: '一年至少去一个没去过的国家。' },
      { id: uid(), img: '', caption: '', text: '写一本关于人与技术的小书。' },
    ],
    areas: [['学习成长', 8], ['事业', 6], ['创作', 7], ['健康', 5], ['关系', 7], ['财务', 5], ['玩乐', 4], ['精神', 6]].map(([name, score]) => ({ id: uid(), name, score })),
    longterm: [
      { id: uid(), title: '发表第一篇一作论文', by: '2027', area: '学习', done: false },
      { id: uid(), title: '做一个有 1000 个真实用户的产品', by: '2028', area: '创作', done: false },
    ],
  };

  s.trips = [
    { id: uid(), place: '多伦多', region: '安大略', country: '加拿大', lat: 43.6532, lng: -79.3832, date: '2024-09-01', end: '', note: '研究生生活开始的地方。', photos: [], rating: 4, tags: ['居住'], kind: 'live' },
    { id: uid(), place: '上海', region: '上海', country: '中国', lat: 31.2304, lng: 121.4737, date: '2024-07-10', end: '2024-07-20', note: '', photos: [], rating: 4, tags: [], kind: 'trip' },
    { id: uid(), place: '赛里木湖', region: '新疆', country: '中国', lat: 44.6, lng: 81.15, date: '2024-06-15', end: '2024-06-22', note: '从赛里木湖到独库公路，风穿过草原，雪山与漫长的盛夏。', photos: [], rating: 5, tags: ['公路'], kind: 'trip' },
    { id: uid(), place: '成都', region: '四川', country: '中国', lat: 30.5728, lng: 104.0668, date: '2024-03-02', end: '2024-03-06', note: '', photos: [], rating: 4, tags: ['美食'], kind: 'trip' },
    { id: uid(), place: '东京', region: '', country: '日本', lat: 35.6762, lng: 139.6503, date: '2027-04-01', end: '', note: '樱花季。', photos: [], rating: 0, tags: [], kind: 'wish' },
    { id: uid(), place: '雷克雅未克', region: '', country: '冰岛', lat: 64.1466, lng: -21.9426, date: '2028-01-01', end: '', note: '极光。', photos: [], rating: 0, tags: [], kind: 'wish' },
  ];

  s.settings.seeded = true;
  replace(s);
}

export function seedIfEmpty() {
  const s = get();
  const empty = !s.todos.length && !s.notes.length && !s.books.length && !s.links.length && !s.trips.length;
  if (empty && !s.settings.seeded) seed();
}
