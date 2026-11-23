[简体中文首页](../README.md) · [English overview](../README.en.md)

## 本地运行 / Local development

需要 Node.js 22+，固定版本的 MomoWorkbench 已包含在 `vendor/`。主工程只包含编辑器框架、声音协议和工程逻辑；音库从远程自描述目录按需加载。
Requires Node.js 22+. The pinned MomoWorkbench is included in `vendor/`. The app repository contains the editor framework, sound protocol and project logic; libraries load on demand from self-describing remote indexes.

```sh
npm ci
npm run dev
```

开发默认端口 5180；`npm run preview` 在 4180 预览构建后的 `dist/`。
Development uses port 5180; `npm run preview` serves the built `dist/` on port 4180.

## 验证 / Validation

```sh
npm test
npm run build
```

修改交互后检查真实浏览器。构建验证编辑器、音频 Worker、WASM 和网站自身；远程音库在运行时校验目录、资源图和音频依赖。
Verify interactions in a real browser. The build validates the editor, audio worker, WASM and the site itself; remote libraries validate their index, resource graphs and audio dependencies at runtime.

## 音源分发 / Library distribution

音库独立生成完整的 `momo.remote-sound-library/v1` 目录，发布到 `audio.breezymomo.com`。每个目录包含资源身份、定义、完整音频依赖、来源和授权信息。
Libraries are built independently and published to `audio.breezymomo.com` as complete `momo.remote-sound-library/v1` catalogs. Each catalog carries its own identity, definitions, complete audio dependencies, provenance and licenses.

主工程不生成或提交 `samples/`、`sound-assets.lock.json`、`src/data/builtin-catalog.json` 或 `public/sound-library/`。用户可以把远程资源下载到自己的个人库，之后离线编辑和分享。
The app repository does not generate or commit `samples/`, `sound-assets.lock.json`, `src/data/builtin-catalog.json` or `public/sound-library/`. Users can download remote resources into their personal library for offline editing and sharing.

默认订阅[主音库](https://audio.breezymomo.com/index.json)和同域名下的 12 个补充音库。可以通过 `VITE_SOUND_LIBRARY_URL` 和 `VITE_SOUND_LIBRARY_URLS` 覆盖这些默认地址。
The app subscribes to the [main library](https://audio.breezymomo.com/index.json) and 12 supplemental libraries on the same host by default. Override their URLs with `VITE_SOUND_LIBRARY_URL` and `VITE_SOUND_LIBRARY_URLS`.

## GitHub Pages

`.github/workflows/pages.yml` 安装依赖、运行测试、构建并发布编辑器。GitHub Pages 和正式站都通过 CORS 访问 `audio.breezymomo.com`。
The Pages workflow installs dependencies, tests, builds and publishes the editor. Both GitHub Pages and the production site load the libraries from `audio.breezymomo.com` via CORS.
