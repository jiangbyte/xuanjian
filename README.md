# 玄鉴 / Xuanjian

Agent 运维桌面端（Tauri 2 + React + TypeScript + Rust）。

> Author: Charlie

## 功能

- 无边框自定义标题栏
- 主机操作台（分组 / 标签 / 排序，SQLite 持久化）
- 本地 Shell 探测与启动（Windows / macOS / Linux）
- SSH 终端（xterm）+ SFTP 文件浏览
- 脚本包、笔记、会话日志
- 本机网络工具（连通性 / HTTP / 抓包摘要等）
- 主题 light / dark / system，i18n（zh-CN / en）

## 目录速览

| 路径 | 说明 |
|------|------|
| `src/features/` | 业务功能页 |
| `src/components/` | 共享 UI 壳 |
| `src/lib/` | DB / Tauri / 会话等服务层 |
| `src/stores/` | Zustand 状态 |
| `src-tauri/src/commands/` | Tauri 命令薄层 |
| `src-tauri/src/session/` | SSH / PTY / SFTP 实现 |
| `docs/工程规范.md` | 工程约定与注释规范 |

## 开发

```powershell
cd xuanjian
pnpm install
pnpm tauri dev
```

### 常用脚本

| 命令 | 说明 |
|------|------|
| `pnpm tauri dev` | 启动桌面端开发 |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm lint` | Biome 静态检查（不含格式化门禁） |
| `pnpm format` | Biome 格式化 |
| `pnpm build` | 前端生产构建 |
| `pnpm ci` | 本地等价 CI：typecheck + lint + build |
| `cargo check`（`src-tauri`） | Rust 编译检查 |

GitHub Actions：`.github/workflows/ci.yml`（push / PR 到 main）。

## 快捷键

- `Ctrl+J`：快速切换（本地 Shell / 主机 / 标签页）

## Identifier

`io.github.jiangbyte.xuanjian`
