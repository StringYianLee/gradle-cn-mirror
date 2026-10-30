#!/usr/bin/env node
/*
 * gradle-cn-mirror — 把 Gradle / Android 工程切换为国内镜像下载源
 *
 *   node apply-cn-mirror.cjs [projectDir] [options]
 *
 *   --dry-run              只报告将要发生的改动，不落盘
 *   --mirror <preset>      wrapper 发行版镜像预设：tencent(默认) | huawei | none
 *   --mirror-url <base>    自定义镜像基址，需以 / 结尾，例：
 *                          --mirror-url https://mirrors.example.com/gradle/
 *   --force-version <ver>  强制统一 Gradle 版本（默认关闭：会破坏 AGP 与 Gradle 的版本耦合）
 *   --init-script          确保全局依赖仓库镜像脚本存在（~/.gradle/init.d/cn-mirror.gradle）
 *   --init-overwrite       配合 --init-script，强制用模板覆盖已有文件
 *   --help                 显示用法
 *
 * 无第三方依赖，需 Node.js >= 14。Windows / macOS / Linux 通用。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const PRESETS = {
  tencent: 'https://mirrors.cloud.tencent.com/gradle/',
  huawei: 'https://mirrors.huaweicloud.com/gradle/',
  none: null,
};

const INIT_TARGET = path.join(os.homedir(), '.gradle', 'init.d', 'cn-mirror.gradle');
const INIT_ASSET = path.join(__dirname, '..', 'assets', 'cn-mirror.gradle');
const MAX_DEPTH = 6;
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'build', '.gradle', '.idea', 'out', 'dist', 'caches', 'tmp', '.cxx',
]);
const FILENAME_RE = /^gradle-[0-9][0-9A-Za-z.\-]*-(bin|all)\.zip$/;

function usage() {
  const src = fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 18).join('\n');
  console.log(src.replace(/^ ?\* ?/gm, ''));
}

function parseArgs(argv) {
  const opts = { dir: null, dryRun: false, mirror: 'tencent', mirrorUrl: null, forceVersion: null, initScript: false, initOverwrite: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--init-script') opts.initScript = true;
    else if (a === '--init-overwrite') opts.initOverwrite = true;
    else if (a === '--mirror') opts.mirror = argv[++i];
    else if (a === '--mirror-url') opts.mirrorUrl = argv[++i];
    else if (a === '--force-version') opts.forceVersion = argv[++i];
    else if (a.startsWith('-')) { console.log('ERROR: 未知选项 ' + a); process.exit(1); }
    else rest.push(a);
  }
  opts.dir = path.resolve(rest[0] || process.cwd());
  return opts;
}

function resolveBase(opts) {
  if (opts.mirrorUrl) {
    if (!/^https?:\/\/.*\/$/.test(opts.mirrorUrl)) {
      console.log('ERROR: --mirror-url 必须是 http(s) 地址且以 / 结尾');
      process.exit(1);
    }
    return opts.mirrorUrl;
  }
  if (!(opts.mirror in PRESETS)) {
    console.log('ERROR: --mirror 只支持 ' + Object.keys(PRESETS).join(' | ') + '，或用 --mirror-url');
    process.exit(1);
  }
  return PRESETS[opts.mirror];
}

function findWrapperProps(dir, depth, acc) {
  if (depth > MAX_DEPTH) return acc;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return acc; }
  for (const e of entries) {
    if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.name === 'wrapper') {
      const cand = path.join(full, 'gradle-wrapper.properties');
      if (fs.existsSync(cand)) acc.push(cand);
    }
    findWrapperProps(full, depth + 1, acc);
  }
  return acc;
}

function rewriteLine(rawLine, base, forceVersion) {
  const m = rawLine.match(/^(\s*distributionUrl\s*=\s*)(.*?)(\s*)$/);
  if (!m) return { line: rawLine, changed: false, reason: 'no-distributionUrl' };
  const [, head, url, tail] = m;
  const escaped = url.includes('\\:');
  const plain = url.replace(/\\:/g, ':');

  let seg = plain.split('/').filter(Boolean).pop() || '';
  if (forceVersion) {
    const kind = seg.endsWith('-all.zip') ? 'all' : 'bin';
    seg = 'gradle-' + forceVersion + '-' + kind + '.zip';
  }
  if (!FILENAME_RE.test(seg)) {
    return { line: rawLine, changed: false, reason: 'unrecognized-filename:' + seg, from: plain };
  }

  let want = base + seg;
  if (plain === want) return { line: rawLine, changed: false, reason: 'already-mirror', from: plain };

  const newUrl = escaped ? want.replace(/:/g, '\\:') : want;
  return { line: head + newUrl + tail, changed: true, from: plain, to: want };
}

function processFile(file, root, base, forceVersion, dryRun) {
  const rel = path.relative(root, file) || path.basename(file);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return { rel, status: 'READ-ERROR' }; }

  const lines = text.split(/\r?\n/);
  let target = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*distributionUrl\s*=/.test(lines[i])) { target = i; break; }
  }
  if (target === -1) return { rel, status: 'SKIP', why: 'no distributionUrl key' };

  const res = rewriteLine(lines[target], base, forceVersion);
  if (!res.changed) return { rel, status: 'OK', why: res.reason, url: res.from };

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  lines[target] = res.line;
  if (!dryRun) fs.writeFileSync(file, lines.join(eol), 'utf8');
  return { rel, status: 'CHANGED', from: res.from, to: res.to };
}

function handleInit(opts) {
  if (!opts.initScript) return null;
  const exists = fs.existsSync(INIT_TARGET);
  if (exists && !opts.initOverwrite) return { status: 'present', file: INIT_TARGET };
  if (!fs.existsSync(INIT_ASSET)) return { status: 'asset-missing', file: INIT_ASSET };
  if (opts.dryRun) return { status: exists ? 'would-overwrite' : 'would-install', file: INIT_TARGET };
  fs.mkdirSync(path.dirname(INIT_TARGET), { recursive: true });
  fs.copyFileSync(INIT_ASSET, INIT_TARGET);
  return { status: exists ? 'overwritten' : 'installed', file: INIT_TARGET };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const base = resolveBase(opts);

  console.log('== gradle 国内镜像改写 ==');
  console.log('root  : ' + opts.dir + (opts.dryRun ? '  [dry-run]' : ''));
  console.log('mirror: ' + (base || '(不改写 distributionUrl，仅处理 init 脚本)'));
  if (opts.forceVersion) console.log('版本  : 强制统一为 ' + opts.forceVersion + '  ⚠ 可能破坏 AGP 兼容性');

  const init = handleInit(opts);
  if (init) console.log('init  : ' + init.status + '  ' + init.file);

  if (!fs.existsSync(opts.dir)) {
    console.log('NO-DIR: 目录不存在 ' + opts.dir);
    if (init) { console.log('全局 init 脚本已处理完毕。'); process.exit(0); }
    process.exit(1);
  }

  if (!base) {
    console.log('SKIP-WRAPPER: --mirror none，未改写 distributionUrl。');
    process.exit(0);
  }

  const files = findWrapperProps(opts.dir, 0, []);
  if (!files.length) {
    console.log('NO-WRAPPER: 未找到 gradle/wrapper/gradle-wrapper.properties');
    console.log('该目录可能不是 Gradle 工程，或尚未生成 wrapper（可在工程内执行 gradle wrapper 生成）。');
  } else {
    let changed = 0;
    for (const f of files) {
      const r = processFile(f, opts.dir, base, opts.forceVersion, opts.dryRun);
      if (r.status === 'CHANGED') {
        changed++;
        console.log('CHANGED  ' + r.rel);
        console.log('  before: ' + r.from);
        console.log('  after : ' + r.to);
      } else if (r.status === 'OK') {
        console.log('OK       ' + r.rel + '  (' + r.why + (r.url ? ' ' + r.url : '') + ')');
      } else {
        console.log(r.status + ' ' + r.rel);
      }
    }
    console.log('wrapper 文件 ' + files.length + ' 个，改动 ' + changed + ' 个' + (opts.dryRun ? '（dry-run 未落盘）' : ''));
  }

  console.log('验证    : curl -I <新地址> 应返回 200，然后在工程内跑一次 gradlew 任务确认。');
  process.exit(0);
}

main();
