---
name: gradle-cn-mirror
description: "把 Android / Gradle 工程切换为国内镜像下载源。当新建、脚手架生成、导入或打开 Android 工程（含 build.gradle、settings.gradle、gradle.properties、gradlew 的目录）、或用户提到 Gradle 构建下载慢、distributionUrl、Gradle wrapper 下载超时、依赖仓库换国内源、阿里云镜像、腾讯云镜像时触发。执行两件事：把 gradle/wrapper/gradle-wrapper.properties 的 distributionUrl 改写到国内镜像（默认腾讯云，保留工程原有 Gradle 版本），以及确保全局依赖仓库镜像脚本 ~/.gradle/init.d/cn-mirror.gradle 存在。边界：只想改依赖版本或写业务代码、与 Gradle 下载源无关时不要触发。"
version: "1.1.0"
---

# Gradle 国内镜像切换

## Overview

Android / Gradle 工程有两条彼此独立的下载链路，本 skill 分别处理：

1. **Gradle 发行版本身** — 由 `gradle/wrapper/gradle-wrapper.properties` 的 `distributionUrl` 决定，默认 `services.gradle.org`。只能逐工程改写，Gradle 不提供全局开关。
2. **依赖与插件仓库** — 由 `google()` / `mavenCentral()` / `gradlePluginPortal()` 决定。通过一个全局 init 脚本统一改写为国内镜像，对所有工程生效。

## 关键约束：默认保留工程原有 Gradle 版本

**不要把 `distributionUrl` 硬编码成某个固定版本。** Android Gradle Plugin 与 Gradle 存在最低版本耦合，强行统一版本会让工程直接构建失败。脚本默认只替换域名与路径，保留原文件名（含 `-bin` / `-all` 形态）。确有需要时用 `--force-version` 显式承担风险。

## 执行步骤

### 1. 改写 wrapper 地址

脚本在本 skill 目录下的 `scripts/apply-cn-mirror.cjs`。用 skill 目录的绝对路径调用（工作目录通常是工程目录），skill 目录位置因安装方式而异：

```bash
node <skill-dir>/scripts/apply-cn-mirror.cjs <工程目录>
```

常用参数：

| 参数 | 作用 |
|---|---|
| `--dry-run` | 只报告将要发生的改动，不落盘 |
| `--mirror tencent\|huawei\|none` | 镜像预设，默认 `tencent`；`none` 表示只处理 init 脚本 |
| `--mirror-url <base>` | 自定义镜像基址，须以 `/` 结尾 |
| `--force-version <ver>` | 强制统一 Gradle 版本（默认关闭） |
| `--init-script` | 确保全局依赖镜像脚本存在 |
| `--init-overwrite` | 配合 `--init-script` 强制覆盖 |

脚本幂等：已是镜像则输出 `already-mirror`。输出为逐文件摘要：

```
CHANGED  gradle/wrapper/gradle-wrapper.properties
  before: https://services.gradle.org/distributions/gradle-8.13-bin.zip
  after : https://mirrors.cloud.tencent.com/gradle/gradle-8.13-bin.zip
```

只改 `distributionUrl` 一行，保留文件原有的换行风格（CRLF/LF）与 `https\:` 转义写法。遇到无法识别的文件名（如企业自建源）会跳过并报 `unrecognized-filename`，此时**不要**强行改写，向用户确认。

### 2. 确保全局依赖镜像存在

```bash
node <skill-dir>/scripts/apply-cn-mirror.cjs <工程目录> --init-script
```

`--init-script` 在 `~/.gradle/init.d/cn-mirror.gradle` 缺失时从 `assets/cn-mirror.gradle` 复制；已存在则只报 `present`，不覆盖用户可能做过的自定义修改（要覆盖需显式 `--init-overwrite`）。

该 init 脚本把国内镜像插到 `pluginManagement`、`dependencyResolutionManagement`、`buildscript`、项目级四类仓库列表**最前面**，原有仓库保留在后兜底；仓库容器不可写（`FAIL_ON_PROJECT_REPOS`）时静默跳过，不影响构建。

### 3. 验证（必做，不要只改不验）

按顺序执行，任一失败就停下来报告，不要宣称完成：

```bash
# a. 镜像确实提供该版本（地址需去掉 properties 里的反斜杠转义）
curl -sI -o /dev/null -w '%{http_code}\n' <改写后的 distributionUrl>

# b. 真实解析一次，确认下载域名落在镜像上
./gradlew --no-daemon --console=plain help --info 2>&1 \
  | grep -oE 'Downloading (https?://[^/]+)' | sort -u
```

期望：a 返回 200；b 只出现镜像域名，不出现 `services.gradle.org`、`dl.google.com`、`repo1.maven.org`、`plugins.gradle.org`。

## 能力边界：必须如实告知用户

本 skill 由 agent 在**参与该工程任务时**触发。如果用户完全在 Android Studio 界面里点 New Project 建工程、且没有让 agent 介入，没有任何机制会自动改写它。

因此新建工程后，需要用户把工程路径交给 agent 执行一次，或自行改 `distributionUrl` 的域名与路径部分。不要向用户承诺「以后全自动」。

## Resources

- `scripts/apply-cn-mirror.cjs` — 改写 wrapper 地址并可选安装全局依赖镜像脚本；无第三方依赖，Node.js >= 14
- `assets/cn-mirror.gradle` — 全局依赖仓库镜像 init 脚本，供 `--init-script` 复制
