# 玄鉴 / Xuanjian

Agent 运维桌面端（Tauri 2 + React + TypeScript + Rust）。

## 功能

- 无边框自定义标题栏
- 主机操作台（分组 / 标签 / 排序，SQLite 持久化）
- 本地 Shell 探测与启动（Windows / macOS / Linux）
- SSH 终端（xterm）+ SFTP 文件浏览
- 主题 light / dark / system，i18n（zh-CN / en）

## 开发

```powershell
cd xuanjian
pnpm install
pnpm tauri dev
```

## 快捷键

- `Ctrl+J`：快速切换（本地 Shell / 主机 / 标签页）

## Identifier

`io.github.jiangbyte.xuanjian`
