# Sealonote 桌面版

一个很薄的 Electron 外壳：主窗口打开的就是 https://www.sealonote.com，登录同一个账号就是同一份数据，
和网页版实时同步；网站更新以后桌面版自动用上新版本，不用重新安装。

额外多了一个**桌面便签**：无边框的小窗口，默认置顶，显示今天 / 明天的焦点（可以直接打勾、添加）
和今天接下来的时间块、检查点（点一下标「达成 / 没达成」）。

- 托盘图标：打开主窗口、显示 / 收起便签、便签置顶、开机启动（只开便签）、退出
- 关掉主窗口时便签还开着，程序就留在托盘里；macOS 上 ⌘⇧J 开关便签
- 网页版顶栏的图钉按钮会弹出一个同样的便签小窗口

## 下载

到仓库的 Releases 页面下载对应系统的安装包。安装包没有签名，第一次打开会有系统提示，处理办法写在 Release 说明里。

## 本地开发

```bash
cd desktop
npm install
npm start                                   # 打开线上网站
SEALONOTE_URL=http://localhost:8765 npm start  # 换成本地网站
npm run dist                                # 打当前系统的安装包到 dist/
```

## 发布

```bash
# 改 desktop/package.json 里的 version，然后
git tag desktop-v0.1.1 && git push origin desktop-v0.1.1
# 或者：GitHub → Actions → Desktop app → Run workflow（tag 自动用 package.json 的 version）
```

GitHub Actions（`.github/workflows/desktop.yml`）会在 Windows / macOS / Linux 上分别打包，发布到 Releases。
