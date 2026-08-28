# 移动端 Android 脚手架

玄鉴移动端定位为 **SSH / 文件 / 笔记伴侣**（无 AI）。前端已用 `MobileShell` 实现，桌面调试加 `?mobile=1`。

## 本机前置

1. Android SDK（本机已检测到时可跳过）
2. **Android NDK**（`android init` 必需）
   - Android Studio → SDK Manager → SDK Tools → NDK
   - 或设置 `NDK_HOME`
3. Rust Android targets（`init` 可自动装，也可用 `--skip-targets-install` 稍后装）:
   ```bash
   rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
   ```

## 初始化工程

```bash
cd xuanjian
pnpm tauri android init --ci
```

生成目录：`src-tauri/gen/android/`。

## 开发 / 打包

```bash
# 开发（需模拟器或真机）
pnpm tauri android dev

# 打 APK
pnpm tauri android build --apk
```

`package.json` 脚本别名：

- `pnpm android:init`
- `pnpm android:dev`
- `pnpm android:build`

## 前端调试（无需 APK）

桌面 `pnpm tauri dev` 后打开：

```
http://localhost:1420/?mobile=1
```

会进入底栏壳：主机 · 终端 · 文件 · 笔记 · 更多。  
`?mobile=0` 可切回桌面壳（写入 localStorage）。

## 已实现

- `MobileShell` 底栏导航
- 主机列表 → SSH 连接
- 单屏终端（多标签保留）
- 远端文件浏览 / 新建 / 重命名 / 删除 / **文本编辑保存**（textarea，非 Monaco）
- 笔记轻编辑
- 主题切换；完整设置弹窗（不含移动端 AI 入口）

## 后续

- NDK 就绪后本地跑通 `android init` + 真机 SSH（亦可只靠 CI `android init`）
- 上传/下载走应用存储（替换桌面 dialog 插件路径）
- Cargo `mobile` feature 裁剪 PTY / WSL / 本机网络命令（可选）

## GitHub Release 自动打 APK

推送 `v*` tag 时，[`release.yml`](../.github/workflows/release.yml) 会：

1. 桌面四端安装包（原有 `tauri-action`）
2. **并行** `publish-android`：Ubuntu + JDK17 + NDK → `tauri android init`（若无 `gen/android`）→ `tauri android build --apk` → 上传到同一 Release

### 签名 Secrets（可选）

未配置时上传 **unsigned release APK**（可侧载测试）。正式签名请在仓库 Settings → Secrets 添加：

| Secret | 说明 |
|--------|------|
| `ANDROID_KEY_BASE64` | `.jks` / `.keystore` 文件的 base64 |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | store / key 密码（写入 `keystore.properties` 的 `password`） |

CI 会在 `tauri android init` 后写入 `keystore.properties`，并注入 `app/build.gradle.kts` 的 `signingConfigs`（若模板尚无）。

生成 keystore 示例：

```bash
keytool -genkey -v -keystore xuanjian.jks -keyalg RSA -keysize 2048 -validity 10000 -alias xuanjian
base64 -w0 xuanjian.jks > xuanjian.jks.b64
```

**务必备份** `.jks` 与密码；丢失后无法用同一签名更新应用。

产物命名示例：`xuanjian_1.3.1_android_universal.apk`。
