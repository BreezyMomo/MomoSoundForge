# 远程音库运行分发

当前音库使用 `momo.remote-sound-library/v1` 自描述目录。编辑器站点只发布框架、协议、渲染器和 AI 工具；官方与补充音库由独立仓库发布到 HTTPS 静态地址。

## 地址与职责

- 官方目录：`https://breezymomo.github.io/MomoSoundForge-assets/index.json`
- 补充目录：`https://breezymomo.github.io/MomoSoundForge-assets-vcsl-harp-sax/index.json`
- 主仓库通过 `VITE_SOUND_LIBRARY_URL` 和 `VITE_SOUND_LIBRARY_URLS` 配置目录地址。
- 目录的 `libraryId` 是音库身份；地址只是部署位置。每个目录携带完整定义、音频依赖、来源和许可。

## 发布顺序

1. 在资源仓库生成新目录，固定内容 ID、文件大小和 SHA-256。
2. 先发布不可变文件，再发布或更新 `index.json`。
3. 通过 HTTPS、公开 GET 和 CORS 验证目录、资源图、完整依赖和空缓存恢复。
4. 再更新主站的目录地址并执行 `npm test`、`npm run build` 和真实浏览器检查。

主仓库不生成音库目录，不保存采集清单、映射、资源锁或大型音频。用户下载的资源进入个人库；保存到工程或资源包时携带完整依赖，因此音库暂时不可用也不会破坏已保存内容。
