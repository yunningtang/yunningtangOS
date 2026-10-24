# yunningtang OS

一个只给自己用的「个人操作系统」：待办、计划、阅读、收藏、笔记、愿景、足迹，全部放在一个页面里。
界面是纸张感：线性图标、无 emoji；标题用衬线，正文用系统字体；选中与悬停态是一枚会「流」过去的高亮（侧栏、分段控件、标签页、页面树、块编辑器都有）；浅色纸 / 深色墨两套主题。

## 模块

| 路由 | 内容 |
|---|---|
| `#/home` | 总览：问候、时钟、今天的待办与时间线、本周焦点、本月目标进度、在读、最近笔记与收藏、每日轮换一条肯定句 |
| `#/todos` | 待办：优先级 P0–P3、日期、时间、领域、标签、备注；列表视图按逾期 / 今天 / 明天 / 本周分组，看板视图按优先级分列；快速添加语法 `写论文 @明天 14:00 !1 #研究` |
| `#/plan/week` | 周计划：本周焦点三件事、七天看板（自动带入当天的待办）、周回顾 |
| `#/plan/weektl` | 周时间线：一周七天并排的时间块日历，点空白新建，拖动调整，点日期进当天 |
| `#/plan/day` | 每日时间线：06:00–24:00 时间块，按类型着色，点击空白小时新建，右侧显示当天待办和时间分配 |
| `#/plan/month` | 月度目标：目标 + 关键结果勾选自动算进度，可一键延续上月未完成 |
| `#/focus` | 专注：番茄钟（25/45/50/90 分预设），可关联待办，运行时侧栏和总览显示倒计时，完成自动记为时间线上的专注块 |
| `#/reading` | 阅读：书 / 论文 / 文章 / 课程，想读 / 在读 / 读完 / 搁置，评分、笔记、封面。进度用滑杆 / 数字 / ±按钮随时加减，每天记一条，详情里显示最近 14 天的阅读量、读速和预计读完日 |
| `#/links` | 收藏：粘贴链接回车即存，标签、待读 / 最爱、按月分组 |
| `#/notes` | 笔记：按「本子」组织，删除进「最近删除」保留 30 天可恢复（删除即时可撤销）（本子列表 → 本子内页面列表带摘要与排序 → 页面，三栏可分别收起），页面可嵌套子页、移动、换本子、封面、收藏、字体与宽度选项，页面属性（标签 / 位置 / 时间）。正文是块编辑器：回车分块、退格合并、Tab 缩进、拖动手柄排序、`/` 转换块类型（标题、列表、待办、折叠、引用、标注、代码、分割线、图片、原始 Markdown、日期、子页面）、Markdown 快捷键（`# ` `- ` `1. ` `[] ` `> ` `---` 等）、⌘B/I/U/E/K 行内格式、`[[` 页面补全可直接新建、`@` 引用待办 / 书 / 足迹 / 目标 / 收藏（点击跳转）、选中文字出现浮动工具栏（粗体、斜体、下划线、删除线、代码、荧光标记、链接）、粘贴 Markdown 自动拆块。书、足迹、待办都能一键生成关联的笔记页（页面上有「来自书 / 足迹 / 待办」可跳回）。页面底部显示「链接到」「反向链接」「未链接的提及」，图谱视图显示整张知识网。侧栏「笔记」下面有两个一级入口，本子栏底部还有三个辅助视图：**卡片**（给页面加领域 / 主题 / 状态 / 复习日期四个属性后，在一张表格或看板里一起看，复习按 1·3·7·14·30 天间隔推进）、**画布**（无限白板：页面拖上去、写字、画笔、箭头连线）、图谱、标签、附件。新页面可以套模板（概念卡 · 费曼 / 项目卡 / 复盘，`/模板` 也能插入），页面或选中的块可以导出成 PNG 学习小卡或复制 Markdown |
| `#/vision` | 愿景：显化肯定句、愿景板（图片或一句话）、生命之轮、长期目标 |
| `#/explore` | 探索：旅行 / 居住 / 想去的地点点亮在可拖动的星球上，含记录与照片 |
| `#/settings` | 个人资料、主题（浅 / 深）、风格（玻璃 / Notion / Claude / Steam / Windows XP）、GitHub 同步、导入 / 导出 JSON |

`⌘K` / `Ctrl K` 全局搜索。左侧栏会展开笔记的页面树，顶栏显示面包屑。

**汤圆（海豹助手）**：角落里有一只可以拖动的 3D 小海豹（松手吸到最近的屏幕边，会转头看鼠标）。点开说一句话，比如「明天下午两点开组会，会后把纪要整理到研究本子」，汤圆会拆成一条时间块、一条待办和一页笔记，先给预览，勾选确认后才写入。随手记（`⌘⇧K`）里也有「问汤圆」按钮。接入 AI 需要在 Vercel 配置 `ANTHROPIC_API_KEY` 并登录；没有 AI 时按随手记的本地语法理解。可在设置里隐藏。

## 数据在哪里

- 默认存在浏览器 `localStorage`（key `ytos.v1`），一份 JSON 文档，随时在设置里导出。
- 同步到 GitHub 仓库里的一个文件（默认 `data/os.json`），每次同步是一次提交，可回滚。两种方式：
  - **登录即同步（推荐，需要 Vercel）**：设置页点「用 GitHub 登录」，之后打开页面自动拉取、编辑后几秒自动推送。token 存在加密的 httpOnly cookie 里，浏览器脚本拿不到。
  - **token 方式（纯静态托管）**：设置页填仓库、分支、路径和一个只给该仓库 Contents 读写权限的 fine-grained token。
- 第一次打开会载入一份示例数据，设置里可以「清空全部」。
- 公开仓库里的数据文件也是公开的，私人内容请指向一个私有仓库（`DATA_REPO` 可以是另一个仓库）。

## 附件（PDF 等）

把 PDF 或其他文件拖进任何笔记页（或输入 `/文件`）就会插入一个附件块，PDF 可以直接在页内预览、打开、下载。文件本体存在浏览器的 IndexedDB 里，不进 `os.json`；配置了同步后，附件会随同步上传到数据仓库的 `data/assets/<id>`，换设备第一次打开时自动取回。`笔记 → 附件` 列出所有文件。

## 部署

### 方式一：Vercel（有登录同步）

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fyunningtang%2FyunningtangOS&env=GITHUB_CLIENT_ID,GITHUB_CLIENT_SECRET,SESSION_SECRET,DATA_REPO,DATA_BRANCH,ALLOWED_USER&envDescription=GitHub%20OAuth%20App%20%2B%20%E6%95%B0%E6%8D%AE%E4%BB%93%E5%BA%93%E9%85%8D%E7%BD%AE%EF%BC%8C%E8%A7%81%20README&project-name=yunningtang-os)

点上面的按钮会直接在 Vercel 里导入仓库并弹出环境变量填写框。

1. 在 GitHub 新建一个 OAuth App：Settings → Developer settings → OAuth Apps → New。
   Homepage 填你的站点地址，Authorization callback URL 填 `https://<你的域名>/api/auth/callback`。
2. Vercel 导入这个仓库（框架选 Other，无需构建命令），在 Environment Variables 里填：

   | 变量 | 说明 |
   |---|---|
   | `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | OAuth App 的 ID 和 Secret |
   | `SESSION_SECRET` | 随便一串长随机字符，用来加密 cookie |
   | `DATA_REPO` | 存数据的仓库，如 `yunningtang/yunningtangOS` 或一个私有仓库 |
   | `DATA_BRANCH` | 可选，默认 `main`（本仓库是 `master`） |
   | `DATA_PATH` | 可选，默认 `data/os.json` |
   | `ALLOWED_USER` | 你的 GitHub 用户名，只有这个账号能登录同步 |
   | `ANTHROPIC_API_KEY` | 可选。配置后汤圆助手用 Claude 拆解自然语言；只有登录用户能调用 `/api/agent`。密钥只放这里，不要写进代码或对话 |
   | `AGENT_MODEL` | 可选，默认 `claude-opus-5-5`；每次拆解约几百 token，个人使用一个月不到一美元 |

3. 部署后打开站点 → 设置 → 「用 GitHub 登录」。

### 方式二：GitHub Pages（纯静态，token 同步）

仓库里已有 `.github/workflows/pages.yml`。在 GitHub 的 Settings → Pages 把 Source 选为 **GitHub Actions**，之后每次推送 master 自动部署到 `https://yunningtang.github.io/yunningtangOS/`。

### 本地

`python3 -m http.server 8000` 然后打开 `http://localhost:8000`。

## 结构

```
index.html          入口
css/app.css         全部样式（设计 token 在最上面）
js/app.js           路由、侧边栏、主题
js/store.js         状态 + localStorage 持久化
js/views/*.js       每个模块一个文件
js/editor.js        块编辑器（contenteditable 块、菜单、拖拽）
js/blocks.js        块模型、HTML 白名单、Markdown 互转
js/graph.js         笔记关系图
js/card.js          PNG 学习小卡渲染（Canvas）
js/templates.js     页面模板
js/views/cards.js   卡片表格 / 看板与属性菜单
js/views/ntasks.js  页面待办汇总
js/views/canvas.js  画布（节点、连线、笔迹）
js/globe.js         Canvas 星球（d3-geo 正射投影）
js/sync.js          同步（登录模式走 /api，静态模式直连 GitHub API）
api/                Vercel serverless：GitHub OAuth 登录、加密会话、读写数据文件、/api/agent 调 Claude 拆解（结构化输出）
js/seal.js          汤圆：three.js 3D 海豹、拖动吸边、对话面板、拆解预览与写入
js/capture.js       随手记（本地语法解析，也供汤圆兜底）
js/seed.js          示例数据
vendor/             preact + htm、marked、d3-geo + topojson、world-atlas 陆地数据、three.js r128（已打包，无 CDN 依赖）
```

唯一外部依赖是 Google Fonts 的 Noto Serif SC（页面「衬线」字体选项用）；断网时回退到系统宋体。笔记同时保存块结构和一份 Markdown 镜像，导出的 JSON 里两者都有。
