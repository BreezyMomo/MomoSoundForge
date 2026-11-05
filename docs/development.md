# 开发与部署 / Development and deployment

[简体中文首页](../README.md) · [English overview](../README.en.md)

## 本地运行 / Local development

需要 Node.js 22+，固定版本的 MomoWorkbench 已包含在 `vendor/`。
Requires Node.js 22+. The pinned workbench package is included in vendor/.

```sh
npm ci
npm run dev
```

开发默认端口 5180；`npm run preview` 在 4180 预览构建后的 `dist/`。
Development uses port 5180; production preview uses port 4180.

## 验证 / Validation

```sh
npm test
npm run build
node tools/check-static-site.mjs
```

修改交互后检查真实浏览器。静态产物检查覆盖音源文件的大小与 SHA-256、素材授权文件、音频 Worker、WASM 及网站总体积。
Verify interactions in a real browser. Static checks validate sound sizes and hashes, sample license files, the audio worker, WASM and site size.

音源电平报告：`node tools/audit-builtin-library.mjs` → `test-results/builtin-audit.json`。数值检查不能代替试听。
Run the library audit for a loudness report; numerical checks do not replace listening.

## 音源构建 / Library generation

`predev` 与 `prebuild` 从已入库的采样、示例和工具生成 `public/sound-library/`，更新 `src/data/builtin-catalog.json`；Vite 将资源复制到 `dist/sound-library/`。
The predev/prebuild hook generates the runtime library from versioned samples and examples; Vite copies it into the deployment.

- 原始资料 / Sources: `samples/` and versioned examples.
- 生成资源 / Generated library: `public/sound-library/` (Git ignored).
- 完整网站 / Website: `dist/` (Git ignored).

不要手动修改生成音源或提交部署副本。Do not edit generated sounds or commit deployment copies.

## GitHub Pages

仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。
Select GitHub Actions as the Pages publishing source.

[pages.yml](../.github/workflows/pages.yml) 在推送 main 或手动触发后安装依赖、测试、构建、检查并上传 dist，只有 main 可以发布。构建任务只读，发布任务使用 Pages 与 OIDC 权限。构建产物保留一天，不创建 gh-pages 分支。
The workflow installs, tests, builds, checks and uploads dist on pushes to main or manual dispatch. Only main deploys. Build permissions are read-only; deployment uses Pages and OIDC. Artifacts are retained for one day, with no gh-pages branch.

默认网址 / Default URL: <https://breezymomo.github.io/MomoSoundForge/>

Vite 相对路径支持仓库子目录。完整上传 dist，保持 assets 和 sound-library 结构；不要仅上传 index.html。音源和编码器从同源按需加载。
Relative paths support the repository subdirectory. Upload the complete dist folder, retaining assets and sound-library. Resources load on demand from the same origin.

Pages 网站大小上限为 1 GB，构建检查在达到上限时失败。首次部署后验证首页、内置声音试听、工程保存和音频导出；状态和日志在 **Actions → Deploy GitHub Pages** 查看。
Pages sites are limited to 1 GB. The build check fails at that limit. Verify the homepage, factory sounds, project saves and exports after deployment; inspect status and logs in Actions.

[官方流程 / Workflow reference](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) · [限制 / Limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)

## 数据与排障 / Data and troubleshooting

- 空白页面或音源加载失败：检查 assets、wasm 和 soundforge.bin 是否完整。不要为 soundforge.bin 自动设置 Content-Encoding: gzip，它由应用解压。
- Blank page or failed sounds: verify deployed resources. Do not serve soundforge.bin with automatic gzip content encoding; the app decompresses it.
- 本地与线上使用独立浏览器存储；保存 soundforge 工程后在另一地址打开即可迁移。
- Local and online origins have separate storage. Transfer work using downloaded project files.
- 压缩音频导出首次按需加载约 32 MB 编码器；WAV 不需要额外编码器。生成速度取决于用户设备。
- Compressed export downloads an approximately 32 MB encoder on first use. WAV needs no extra encoder. Rendering speed depends on the user's device.
