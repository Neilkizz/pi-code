# CI/CD 发布流程

> 适用于 Pi Code VS Code 扩展的持续集成与持续交付流程。

---

## 1. 构建步骤 (Build Steps)

扩展包含两个独立 Webpack 构建产物：

| 产物 | 命令 | 说明 |
| --- | --- | --- |
| Extension Bundle | `npm run build:extension` | VS Code Extension Host 端代码，入口 `dist/extension.js` |
| Webview Bundle | `npm run build:webview` | React 聊天界面，输出 `webview/out/` |
| 全量构建 | `npm run build` | 先 clean，再依次构建 extension 和 webview |

```bash
# 清理构建产物
npm run clean          # rimraf dist/ webview/out/

# 构建 Extension（Webpack, production mode）
npm run build:extension

# 构建 Webview（Webpack, production mode）
npm run build:webview

# 或一步完成
npm run build
```

### 构建产物大小（production, minified）

| 产物 | 大小 |
| --- | --- |
| Extension Bundle (`dist/extension.js`) | 39.4 KiB |
| Webview Bundle (`webview/out/*`) | 188 KiB |

### 本地开发构建

```bash
# 带 watch 模式的开发构建
npm run watch:extension   # Extension 热更新
npm run watch:webview     # Webview 热更新
```

---

## 2. 测试步骤 (Test Steps)

```bash
# TypeScript 类型检查（不产生输出文件）
npm run compile            # tsc -p tsconfig.json --noEmit

# Mocha 单元测试
npm run test:unit          # 31 个测试用例全部通过

# RPC 冒烟测试（需要 pi CLI 可用）
npm run smoke:rpc          # ts-node test/smoke/rpc-smoke.ts
```

### 测试套件明细

| 套件 | 文件 | 用例数 | 类型 |
| --- | --- | --- | --- |
| JsonlLineReader | `test/unit/lineReader.test.ts` | 12 | 单元测试 |
| reduceMessages | `test/unit/reduceMessages.test.ts` | 16 | 单元测试 |
| RequestQueue | `test/unit/requestQueue.test.ts` | 3 | 单元测试 |

---

## 3. VSIX 打包 (Packaging)

```bash
# 使用 vsce 生成 VSIX 安装包
npx vsce package

# 输出: pi-code-<version>.vsix
# 例如: pi-code-0.1.0.vsix
```

`vsce` 会根据 `package.json` 中的 `version` 字段和 `.vscodeignore` 过滤规则自动打包。打包产物可直接在 VS Code 中通过 "Install from VSIX..." 安装。

### 前置条件

- `package.json` 中 `publisher` 字段已设置
- `README.md`、`LICENSE`、`CHANGELOG.md` 等必要文件存在
- 已构建好 `dist/` 和 `webview/out/` 产物

---

## 4. GitHub Actions CI 工作流

> 文件：`.github/workflows/ci.yml`

**触发条件**：对 `main` 分支的 `push` 和 `pull_request`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    strategy:
      matrix:
        node-version: [18, 20]
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm
      - run: npm ci
      - run: npm run compile
      - run: npm run test:unit
      - run: npm run build
      - name: RPC smoke test
        if: runner.os == 'ubuntu-latest'
        run: npm run smoke:rpc
        continue-on-error: true
```

### CI 流程说明

1. **Checkout** — 拉取仓库代码
2. **Setup Node** — 安装指定 Node 版本（18、20），启用 npm 缓存
3. **npm ci** — 基于 `package-lock.json` 的确定性安装
4. **Type Check** — `npm run compile` TypeScript 类型检查
5. **Unit Tests** — `npm run test:unit` Mocha 单元测试
6. **Build** — `npm run build` 全量构建
7. **RPC Smoke** — 仅在 Linux 上运行，失败不阻断流程

---

## 5. GitHub Actions Release 工作流

> 文件：`.github/workflows/release.yml`

**触发条件**：推送符合语义化版本格式的 tag（如 `v0.1.0`、`v1.2.3`）

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run compile
      - run: npm run test:unit
      - run: npm run build
      - name: Package VSIX
        run: npx --yes @vscode/vsce package
      - name: Upload VSIX Artifact
        uses: actions/upload-artifact@v4
        with:
          name: pi-code-${{ github.ref_name }}.vsix
          path: pi-code-*.vsix
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: pi-code-*.vsix
          generate_release_notes: true
      - name: Publish to Marketplace
        if: env.MARKETPLACE_TOKEN != ''
        env:
          MARKETPLACE_TOKEN: ${{ secrets.MARKETPLACE_TOKEN }}
        run: npx --yes @vscode/vsce publish --pat "$MARKETPLACE_TOKEN"
```

### Release 流程说明

1. **Checkout & Setup** — 拉取代码，配置 Node 20
2. **Build & Test** — 类型检查、单元测试、全量构建
3. **Package VSIX** — 生成 `.vsix` 安装包
4. **Upload Artifact** — VSIX 作为构建产物上传，可在 Actions 页面下载
5. **Create Release** — 在 GitHub 上创建 Release，附加 VSIX 文件和自动生成的 Release Notes
6. **Marketplace Publish** — 如果设置了 `MARKETPLACE_TOKEN` 密钥，自动发布到 VS Code Marketplace

### Marketplace 发布认证

发布到 VS Code Marketplace 需要：

1. 在 [Azure DevOps](https://dev.azure.com) 生成 Personal Access Token
2. 在 GitHub 仓库设置中添加 `MARKETPLACE_TOKEN` 密钥
3. Token 需要 `Marketplace (Publish)` 权限范围

---

## 6. 版本号管理

### 语义化版本 (Semantic Versioning)

本项目遵循 [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html)：

| 版本段 | 含义 | 示例 |
| --- | --- | --- |
| `MAJOR` | 不兼容的 API 变更 | `1.0.0` → `2.0.0` |
| `MINOR` | 向下兼容的新功能 | `0.1.0` → `0.2.0` |
| `PATCH` | 向下兼容的缺陷修复 | `0.1.0` → `0.1.1` |

### CHANGELOG 同步

每次版本发布前，必须在 `CHANGELOG.md` 中：

1. 将 `[Unreleased]` 段落更新为对应版本号和发布日期
2. 按 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) 格式分类记录变更
3. 创建新的 `[Unreleased]` 段落用于下一个版本的记录

### 版本发布流程

```
1. 更新 CHANGELOG.md
2. 更新 package.json 中的 version 字段
3. git commit -m "chore(release): v{version}"
4. git tag v{version}
5. git push && git push --tags
6. GitHub Actions Release 工作流自动执行
```

---

## 7. 完整发布检查清单

- [ ] 所有单元测试通过 (`npm run test:unit`)
- [ ] TypeScript 类型检查通过 (`npm run compile`)
- [ ] 构建成功 (`npm run build`)
- [ ] CHANGELOG.md 已更新
- [ ] package.json 版本号已更新
- [ ] tag 已创建并推送
- [ ] VSIX 已构建并可安装
- [ ] VS Code 兼容性已验证（^1.85.0）
- [ ] （可选）已发布到 VS Code Marketplace

---

*最后更新：2026-07-27*
