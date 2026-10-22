# yunningtang OS

一个只给自己用的「个人操作系统」：待办、计划、阅读、收藏、笔记、愿景、足迹，全部放在一个页面里。
视觉延续了 portfolio 的玻璃质感：柔和的色彩光斑作底、磨砂浮层卡片、细微颗粒、Noto Serif SC 做标题与数字、正文用系统字体，浅/深色主题。

## 模块

| 路由 | 内容 |
|---|---|
| `#/home` | 总览：问候、时钟、今天的待办与时间线、本周焦点、本月目标进度、在读、最近笔记与收藏、每日轮换一条肯定句 |
| `#/todos` | 待办：优先级 P0–P3、日期、时间、领域、标签、备注；按逾期 / 今天 / 明天 / 本周分组；快速添加语法 `写论文 @明天 14:00 !1 #研究` |
| `#/plan/week` | 周计划：本周焦点三件事、七天看板（自动带入当天的待办）、周回顾 |
| `#/plan/day` | 每日时间线：06:00–24:00 时间块，按类型着色，点击空白小时新建，右侧显示当天待办和时间分配 |
| `#/plan/month` | 月度目标：目标 + 关键结果勾选自动算进度，可一键延续上月未完成 |
| `#/reading` | 阅读：书 / 论文 / 文章 / 课程，想读 / 在读 / 读完 / 搁置，页数进度、评分、笔记、封面 |
| `#/links` | 收藏：粘贴链接回车即存，标签、待读 / 最爱、按月分组 |
| `#/notes` | 笔记 / 知识库：Markdown，`[[标题]]` 双链（点不存在的会自动新建），置顶、标签、搜索 |
| `#/vision` | 愿景：显化肯定句、愿景板（图片或一句话）、生命之轮、长期目标 |
| `#/explore` | 探索：旅行 / 居住 / 想去的地点点亮在可拖动的星球上，含记录与照片 |
| `#/settings` | 个人资料、主题、GitHub 同步、导入 / 导出 JSON |

`⌘K` / `Ctrl K` 全局搜索。

## 数据在哪里

- 默认存在浏览器 `localStorage`（key `ytos.v1`），一份 JSON 文档，随时在设置里导出。
- **GitHub 同步**（可选）：设置里填仓库、分支、文件路径（默认 `data/os.json`）和一个只给该仓库 Contents 读写权限的 fine-grained token。每次同步就是一次提交，可以回滚。
  token 只保存在本机浏览器里。公开仓库里的数据文件也是公开的，私人内容请用私有仓库。
- 第一次打开会载入一份示例数据，设置里可以「清空全部」。

## 部署

纯静态，没有构建步骤。

- **GitHub Pages**：Settings → Pages → Source 选 `master` 根目录即可。
- **Vercel / Netlify**：直接导入仓库，框架选 Other。
- **本地**：`python3 -m http.server 8000` 然后打开 `http://localhost:8000`。

## 结构

```
index.html          入口
css/app.css         全部样式（设计 token 在最上面）
js/app.js           路由、侧边栏、主题
js/store.js         状态 + localStorage 持久化
js/views/*.js       每个模块一个文件
js/globe.js         Canvas 星球（d3-geo 正射投影）
js/sync.js          GitHub Contents API 同步
js/seed.js          示例数据
vendor/             preact + htm、marked、d3-geo + topojson、world-atlas 陆地数据（已打包，无 CDN 依赖）
```

唯一外部依赖是 Google Fonts 的 Noto Serif SC；断网时回退到系统宋体。
