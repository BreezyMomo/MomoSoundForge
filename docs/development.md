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

新增、替换或发布音源时，资源仓库负责生成并发布完整的 `momo.remote-sound-library/v1` 目录。主工程通过 `VITE_SOUND_LIBRARY_URL` 指定官方目录，通过 `VITE_SOUND_LIBRARY_URLS` 自动订阅补充目录。每个目录自带资源身份、定义、完整音频依赖、来源和授权信息。
When adding, replacing or publishing sounds, the asset repository builds and publishes a complete `momo.remote-sound-library/v1` directory. The app receives the official URL through `VITE_SOUND_LIBRARY_URL` and optional library URLs through `VITE_SOUND_LIBRARY_URLS`. Each directory carries its own identity, definitions, complete audio dependencies, provenance and licenses.

主工程不生成或提交 `samples/`、`sound-assets.lock.json`、`src/data/builtin-catalog.json` 或 `public/sound-library/`。用户可以把远程资源下载到自己的个人库，之后离线编辑和分享。
The app repository does not generate or commit `samples/`, `sound-assets.lock.json`, `src/data/builtin-catalog.json` or `public/sound-library/`. Users can download remote resources into their personal library for offline editing and sharing.

两个官方目录当前为：

- [MomoSoundForge-assets](https://breezymomo.github.io/MomoSoundForge-assets/)
- [MomoSoundForge-assets-vcsl-harp-sax](https://breezymomo.github.io/MomoSoundForge-assets-vcsl-harp-sax/)

The deployment workflow supplies these URLs through environment variables; URLs are configuration, while the package contents remain in the asset repositories.

## GitHub Pages

`.github/workflows/pages.yml` 只安装依赖、运行测试、构建并发布小型编辑器站点。它不会恢复本地音频包，也不会在主仓库生成音库目录。资源仓库独立发布音库 Pages，两个站点通过 CORS 协作。
The Pages workflow installs dependencies, tests, builds and publishes the small editor site. It does not restore local audio packs or generate a library directory in this repository. The asset repositories publish library Pages independently and the sites work together through CORS.
