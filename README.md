# gradle-cn-mirror

把 Android / Gradle 工程一键切换为国内镜像下载源，解决 `services.gradle.org` 与 `dl.google.com` 在国内下载超时、依赖拉取缓慢的问题。

两种用法：**作为 Qoder Skill**（agent 在帮你建工程时自动执行并验证），或**作为独立命令行工具**（不依赖任何 IDE/agent，任何机器可用）。

---

## 它解决什么

一个 Gradle 工程有两条彼此独立的下载链路：

| 链路 | 决定因素 | 默认地址 | 能否全局配置 |
|---|---|---|---|
| Gradle 发行版本身 | `gradle/wrapper/gradle-wrapper.properties` 的 `distributionUrl` | `services.gradle.org` | **不能**，只能逐工程改 |
| 依赖与插件仓库 | `google()` / `mavenCentral()` / `gradlePluginPortal()` | `dl.google.com`、`repo1.maven.org`、`plugins.gradle.org` | **能**，通过全局 init 脚本 |

本工具同时处理这两条：前者改写工程文件，后者安装一个全局 init 脚本。

## 安装

### 作为 Qoder Skill

克隆到 Qoder 的用户级技能目录即可：

```bash
git clone <本仓库地址> ~/.qoder-cn/skills/gradle-cn-mirror
```

然后重启会话或执行 `/skills reload`。之后当你让 agent 新建 / 导入 Android 工程，或提到 Gradle 下载慢、`distributionUrl`、换国内源时，它会自动触发。也可以手动调用：`/gradle-cn-mirror`

### 作为独立 CLI

只需要 `scripts/` 和 `assets/` 两个目录，无需任何 IDE 或 agent。要求 Node.js >= 14，零第三方依赖。

```bash
git clone <本仓库地址>
cd gradle-cn-mirror
node scripts/apply-cn-mirror.cjs /path/to/your/android-project
```

## 使用

### 改写 wrapper 地址

```bash
# 先看会改什么，不落盘（推荐第一次这么跑）
node scripts/apply-cn-mirror.cjs <工程目录> --dry-run

# 实际改写（默认腾讯云镜像）
node scripts/apply-cn-mirror.cjs <工程目录>

# 用华为云
node scripts/apply-cn-mirror.cjs <工程目录> --mirror huawei

# 用你自己的内网镜像（必须以 / 结尾）
node scripts/apply-cn-mirror.cjs <工程目录> --mirror-url https://mirrors.example.com/gradle/

# 只装全局依赖镜像脚本，不动 wrapper
node scripts/apply-cn-mirror.cjs <工程目录> --mirror none --init-script
```

### 参数一览

| 参数 | 说明 |
|---|---|
| `<工程目录>` | 默认当前目录；会递归查找所有 `gradle/wrapper/gradle-wrapper.properties`，支持多模块工程 |
| `--dry-run` | 只报告将要发生的改动，不写文件 |
| `--mirror <preset>` | `tencent`（默认）\| `huawei` \| `none` |
| `--mirror-url <base>` | 自定义镜像基址，须以 `/` 结尾，优先级高于 `--mirror` |
| `--force-version <ver>` | 强制统一 Gradle 版本，**默认关闭**，见下方警告 |
| `--init-script` | 确保 `~/.gradle/init.d/cn-mirror.gradle` 存在，缺失则安装 |
| `--init-overwrite` | 配合 `--init-script`，强制用模板覆盖已有文件 |
| `--help` | 显示用法 |

### 输出示例

```
== gradle 国内镜像改写 ==
root  : /home/you/work/MyApp
mirror: https://mirrors.cloud.tencent.com/gradle/
CHANGED  gradle/wrapper/gradle-wrapper.properties
  before: https://services.gradle.org/distributions/gradle-8.13-bin.zip
  after : https://mirrors.cloud.tencent.com/gradle/gradle-8.13-bin.zip
wrapper 文件 1 个，改动 1 个
验证    : curl -I <新地址> 应返回 200，然后在工程内跑一次 gradlew 任务确认。
```

## 为什么默认不改 Gradle 版本

**Android Gradle Plugin 与 Gradle 存在最低版本耦合。** 把新工程的版本强行压到某个固定值（比如一律 8.13）会让工程直接构建失败，等于把「换镜像」变成「换坏版本」。

因此脚本只替换域名与路径，保留工程自己的版本和 `-bin` / `-all` 形态。确实需要统一版本时用 `--force-version`，脚本会打印警告并要求你显式承担风险。

## 改了什么、没改什么

**只动 `distributionUrl` 一行**，并保留：
- 文件原有的换行风格（CRLF / LF）
- properties 的 `https\:` 转义写法
- 其余所有键（`distributionBase`、`networkTimeout`、`validateDistributionUrl` 等）

**不会碰**：
- 无法识别的文件名（例如企业自建源的 `custom-build-1.0.zip`），会跳过并报 `unrecognized-filename`
- 已存在的 `~/.gradle/init.d/cn-mirror.gradle`（除非显式 `--init-overwrite`），避免覆盖你自己的定制

脚本幂等，重复执行输出 `already-mirror`，改动 0 个。

## 全局依赖镜像脚本做了什么

`assets/cn-mirror.gradle` 复制到 `~/.gradle/init.d/` 后，对所有 Gradle 构建生效，把国内镜像插到四类仓库列表**最前面**：

- `settings.pluginManagement.repositories` — 插件门户
- `settings.dependencyResolutionManagement.repositories` — Android Studio 新工程的依赖仓库
- `buildscript.repositories` — 老工程里的 `classpath 'com.android.tools.build:gradle'`
- `project.repositories` — 老工程的项目级仓库

原有仓库保留在后面兜底（镜像缺构件时仍能解析）。仓库容器不可写时（如 `FAIL_ON_PROJECT_REPOS`）静默跳过，不影响构建。

## 验证

改完务必验证，别只看文件：

```bash
# 1. 镜像确实提供该版本（去掉 properties 里的反斜杠）
curl -sI -o /dev/null -w '%{http_code}\n' \
  https://mirrors.cloud.tencent.com/gradle/gradle-8.13-bin.zip

# 2. 真实解析一次，看下载域名落在哪
./gradlew --no-daemon --console=plain help --info 2>&1 \
  | grep -oE 'Downloading (https?://[^/]+)' | sort -u
```

期望第 2 步只出现镜像域名，不出现 `services.gradle.org`、`dl.google.com`、`repo1.maven.org`、`plugins.gradle.org`。

## 已知限制

1. **无法拦截 Android Studio 的 New Project 向导。** Gradle 不提供 `distributionUrl` 的全局开关，所以你在 IDE 里建完工程、没有让 agent 介入的话，不会有任何东西自动改写它。建完工程后跑一次本工具即可。
2. **已缓存版本不会重复下载。** Gradle 按发行版名与版本复用 wrapper 缓存目录，因此对本地已缓存的版本改镜像不会触发下载——这是好事，但也意味着验证下载链路要用一个本机没缓存过的版本。
3. **SDK 组件不在此范围内。** emulator、platform-tools、build-tools 走 Android SDK Manager 的 `dl.google.com`，不属于 Gradle 构建链路，需在 `Settings → Android SDK → SDK Update Sites` 里另行添加镜像站点。

## 实测记录

- 腾讯云镜像同时提供 `-bin.zip` 与 `-all.zip`，覆盖 8.13 / 8.14.3 / 9.0.0 / 9.8.2；`gradle-8.13-bin.zip` 的 `content-length` 为 136983045，与官方源下载到的字节数一致
- 在 `services.gradle.org` 下载会直接抛异常的机器上，改写为镜像后同一工程 `BUILD SUCCESSFUL`，Gradle 9.8.2 被真实下载并执行
- 依赖 init 脚本经两种工程结构实测：新式 `FAIL_ON_PROJECT_REPOS` 与老式 `buildscript` + 项目级仓库，下载请求 100% 命中镜像域名

## 许可

MIT
