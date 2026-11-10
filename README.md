<div align="center">

<img src="docs/logo.png" width="112" alt="SealoNote" />

# SealoNote

**一只小海豹陪你过好每一天。**<br/>
待办、计划、笔记、阅读、愿景，放在同一个安静的地方；有事跟汤圆说一句就好。

[在线使用](https://www.sealonote.com) · [下载桌面版](../../releases/latest) · [更新记录](../../releases)

</div>

<br/>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/home-dark.jpg" />
  <img src="docs/screenshots/home.jpg" alt="SealoNote 总览" />
</picture>

<br/>

## 下载

|  | 安装包 | 第一次打开 |
|---|---|---|
| **Windows** | [SealoNote-win-x64.exe](../../releases/latest/download/SealoNote-win-x64.exe) | 提示「Windows 已保护你的电脑」时，点「更多信息 → 仍要运行」 |
| **macOS** | [SealoNote-mac-universal.dmg](../../releases/latest/download/SealoNote-mac-universal.dmg) | 拖进「应用程序」；提示「已损坏」时在终端运行 `xattr -cr /Applications/Sealonote.app`，再右键 → 打开 |
| **Linux** | [SealoNote-linux-x86_64.AppImage](../../releases/latest/download/SealoNote-linux-x86_64.AppImage) | `chmod +x` 之后双击 |

桌面版打开的就是 [sealonote.com](https://www.sealonote.com)：登录同一个账号，就是同一份数据，网页上更新了，桌面版刷新一下就用上。只有窗口本身的功能（便签、独立的汤圆窗口、托盘）需要装新版本。

<br/>

## 它能做什么

**每一天**

- **待办**：四级优先级、日期时间、子步骤；到点没做会提醒「已过」，一键推迟。
- **今天**：一条从早到晚的时间线。时间块按类型着色，「检查点」是线上的一个点，到点问你做到了没有。
- **今日焦点**：每天最重要的一到三件事，第一件就是「最重要的一件」。
- **专注**：照 Time Timer 做的番茄钟。同一件事接着计时，不会重开；一轮结束问一句「做到哪了、下一步是什么」。
- **便签**：彩色便利贴。每一张都是一页笔记，可以放进任何本子，也可以单独贴到桌面上。
- **倒计时**：倒数到 deadline，或者正着数在一起多久了。可以分类、换背景、配图。
- **钱包**：资产、订阅、记账，扣费前会提醒你。

**输入与输出**

- **笔记**：块编辑器，按本子整理，支持页面嵌套、双向链接、评论线程、历史版本、PDF 附件。
- **画布**：无限白板，卡片、分区、连线，PDF 可以缩放。
- **阅读 / 收藏**：书和论文的进度、读速、笔记；链接一贴就存。

**远方**

- **愿景**：肯定句、愿景板、长期目标。
- **探索**：在一颗可以拖动的星球上点亮去过和想去的地方。

<table>
<tr>
<td width="62%"><img src="docs/screenshots/countdown.jpg" alt="倒计时" /></td>
<td width="38%"><img src="docs/screenshots/stickies.jpg" alt="便利贴" /></td>
</tr>
</table>

<br/>

## 汤圆

右下角那只 3D 小海豹就是汤圆。跟它说一句话，它会帮你拆成待办、时间块、笔记或目标，先给你看一眼，确认了才写进去，写错了可以一键撤销。

- 「明天下午两点开组会，会后把纪要整理到研究本子」→ 一个时间块，加一页笔记
- 「把今天到期还没排的事排进剩下的空档」→ 直接挂到原来那几件待办上，待办、总览、时间线一起更新
- 「把论文初稿拆成这周能做的几步」→ 每一步一件待办，附带时长

可以接自己的 DeepSeek 或 Claude 密钥（只存在本机），也可以不用 AI。不用 AI 的时候，平常的写法也认得：

| 打字 | 变成 |
|---|---|
| `明天下午3点到4点 写周报` | 明天 15:00–16:00 的时间块 |
| `周五晚上8点半 跑步 !1` | 周五 20:30 的待办，重要 |
| `下周一 9:00-10:30 组会` | 下周一的时间块 |
| `11月20号 交报告 #学习` | 11 月 20 日的待办，带标签 |

带时间的待办会自动排进那天的时间线，按你写的时间放。

<br/>

## 桌面版

<table>
<tr>
<td width="34%"><img src="docs/screenshots/sticky.jpg" alt="桌面便签" /></td>
<td>

- **桌面便签**：一个小窗口，可以置顶、调透明度。分「今天」和「便利贴」两页：「今天」有焦点、到期的待办、接下来的安排；正在计时的那一轮显示在最上面，不用切走。
- **单张便利贴**：拖到窗口外面，就是一张独立的便利贴。每张各自记住位置、大小、置顶和透明度，开机自动回到原位。`Ctrl+N` 新的一张，`Ctrl+V` 把剪贴板贴成一张。
- **汤圆单独一个窗口**：对话不再盖住主界面。
- **托盘**：开关便签和汤圆窗口，设置开机只启动便签。
- 没有系统标题栏，窗口按钮跟着主题走。

</td>
</tr>
</table>

<br/>

## 数据

- 每个人的数据是一份文档，先存在本机，再同步到云端（Supabase）。离线也能用，联网后自动合并；几台设备、几个窗口同时改也不会互相覆盖。
- 云端每隔一段时间留一份旧版本，在设置里可以看到并恢复。一次同步里数据突然少了很多时，会先停下来问你。
- AI 密钥只存在你自己的浏览器里，不进同步数据。

<br/>

## 自己部署

前端是不需要构建的静态页面（Preact + htm），后端是几个 Vercel 函数。

1. 在 Supabase 新建项目，在 SQL Editor 里依次运行 [`supabase/schema.sql`](supabase/schema.sql) 和 [`supabase/history-and-guard.sql`](supabase/history-and-guard.sql)。
2. 把这个仓库导入 Vercel（框架选 Other，不需要构建命令），填好环境变量：

   | 变量 | 说明 |
   |---|---|
   | `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Supabase 项目地址和 anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | 服务端用，只放在 Vercel 里 |
   | `SESSION_SECRET` | 随便一串足够长的随机字符 |
   | `DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY` | 可选，汤圆用的 AI |

3. 桌面版在 [`desktop/`](desktop) 目录里，是一个很薄的 Electron 外壳。改 `desktop/package.json` 里的版本号后，在 Actions 里运行 **Desktop app**，就会打出三个系统的安装包并发布到 Releases。

```bash
# 本地预览
python3 -m http.server 8000      # 打开 http://localhost:8000
cd desktop && npm install && SEALONOTE_URL=http://localhost:8000 npm start
```

<br/>

<div align="center">
<sub>Made with care by Riley · 汤圆是 Riley 和 Juniper 的小海豹</sub>
</div>
