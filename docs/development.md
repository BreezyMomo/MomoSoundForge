# 开发与部署 / Development and deployment

[简体中文首页](../README.md) · [English overview](../README.en.md)

## 本地运行 / Local development

需要 Node.js 22+，固定版本的 MomoWorkbench 已包含在 `vendor/`。
Requires Node.js 22+. The pinned workbench package is included in vendor/.

```sh
npm ci
npm run assets:sync
npm run dev
```

开发默认端口 5180；`npm run preview` 在 4180 预览构建后的 `dist/`。
Development uses port 5180; production preview uses port 4180.

## 验证 / Validation

```sh
npm test
npm run test:assets
npm run build
node tools/check-static-site.mjs
```

修改交互后检查真实浏览器。静态产物检查覆盖音源文件的大小与 SHA-256、素材授权文件、音频 Worker、WASM 及网站总体积。
Verify interactions in a real browser. Static checks validate sound sizes and hashes, sample license files, the audio worker, WASM and site size.

音源电平报告：`node tools/audit-builtin-library.mjs` → `test-results/builtin-audit.json`。数值检查不能代替试听。
Run the library audit for a loudness report; numerical checks do not replace listening.

## 音源构建 / Library generation

新增、替换或发布内置音源前，先读 [内置资源维护流程](builtin-resource-maintenance.md)：主仓库维护代码和清单，独立资源仓库的 Releases 保存大型资源；不要把新增音频提交回 Git。
Before adding, replacing or publishing built-in sounds, read the [resource maintenance workflow](builtin-resource-maintenance.md). Code and manifests belong in the app repository; large assets belong in the asset repository's Releases, not Git history.

`predev` 与 `prebuild` 从已校验的本地资源缓存生成 `public/sound-library/`，更新 `src/data/builtin-catalog.json`。构建不联网；需先显式执行 `assets:sync`。资源锁定版本、大小与 SHA-256，缓存命中也检查生成文件内容。Vite 将完整资源复制到 `dist/sound-library/`。
The predev/prebuild hooks consume verified local asset packs, without network access. Sync assets explicitly first. Cache hits verify generated content hashes. Vite copies the complete library into the deployment.

资源包已发布到 [MomoSoundForge-assets Releases](https://github.com/BreezyMomo/MomoSoundForge-assets/releases/tag/2026.11.07-1)，同步使用锁文件中的固定地址。离线可用 `npm run assets:sync -- --from <PACKAGE_DIRECTORY>`。详细流程见 [资源迁移交接](asset-storage-implementation.md)。
Packages are published as versioned release attachments. Sync uses pinned URLs and hashes; an explicit local package directory also works offline.

`npm test` 为离线普通测试，不生成音库。`npm run test:assets` 验证构建包并测试完整音库。`npm run test:provenance` 还需 `assets:sync -- --profile audit`，校验原录音、工作副本与来源记录。测试不会根据文件是否存在而跳过。
Unit tests run without large assets. The asset suite requires the build profile; provenance tests require the audit profile. Missing assets fail explicitly.

- 元数据、映射与授权 / Metadata, mappings and notices: `samples/`.
- 大型构建输入与原始资料 / Large build inputs and originals: `sound-assets.lock.json` → `.cache/sound-assets/` (or `SOUNDFORGE_ASSET_CACHE`).
- 生成资源 / Generated library: `public/sound-library/` (Git ignored).
- 完整网站 / Website: `dist/` (Git ignored).

不要手动修改生成音源或提交部署副本。Do not edit generated sounds or commit deployment copies.

## GitHub Pages

仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。
Select GitHub Actions as the Pages publishing source.

[pages.yml](../.github/workflows/pages.yml) 在推送 main 或手动触发后安装依赖、测试、构建、检查并上传 dist，只有 main 可以发布。构建任务只读，发布任务使用 Pages 与 OIDC 权限。构建产物保留一天，不创建 gh-pages 分支。
The workflow installs, runs unit tests, explicitly syncs locked assets, runs library tests, builds, checks and uploads dist on pushes to main or manual dispatch. Only main deploys. Build permissions are read-only; deployment uses Pages and OIDC. Artifacts are retained for one day, with no gh-pages branch.

默认网址 / Default URL: <https://breezymomo.github.io/MomoSoundForge/>

Vite 相对路径支持仓库子目录。完整上传 dist，保持 assets 和 sound-library 结构；不要仅上传 index.html。音源和编码器从同源按需加载。
Relative paths support the repository subdirectory. Upload the complete dist folder, retaining assets and sound-library. Resources load on demand from the same origin.

Pages 网站大小上限为 1 GB，构建检查在达到上限时失败。首次部署后验证首页、内置声音试听、工程保存和音频导出；状态和日志在 **Actions → Deploy GitHub Pages** 查看。
Pages sites are limited to 1 GB. The build check fails at that limit. Verify the homepage, factory sounds, project saves and exports after deployment; inspect status and logs in Actions.

[官方流程 / Workflow reference](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) · [限制 / Limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)

## 数据与排障 / Data and troubleshooting

- 空白页面或音源加载失败：检查 assets、wasm 和音源 bin 文件是否完整。文件自身的 gzip 由应用解压，不应直接标记成 HTTP Content-Encoding；CDN 在文件外额外执行的 HTTP 压缩则由浏览器自动解码。加载器校验解码后的文件大小与哈希，不把此时的 Content-Length 当作文件大小。
- Blank page or failed sounds: verify deployed resources. The app decompresses the asset's own gzip format; do not label those bytes as HTTP Content-Encoding. Additional HTTP compression by a CDN is supported: Fetch decodes it, and the loader verifies the resulting asset size and hash rather than its encoded Content-Length.
- 不同地址使用独立草稿与文件夹连接；重新打开同一本地库文件夹可读取相同资源，作品通过 soundforge 文件转移。
- Origins have separate drafts and folder connections. Reopen the same local library folder to read its resources; transfer works using project files.
- 压缩音频导出首次按需加载约 32 MB 编码器；WAV 不需要额外编码器。生成速度取决于用户设备。
- Compressed export downloads an approximately 32 MB encoder on first use. WAV needs no extra encoder. Rendering speed depends on the user's device.
