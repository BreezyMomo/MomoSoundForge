# 内置资源维护流程

音库现在由资源仓库独立维护。主仓库只提供编辑器框架、通用资源协议、加载与校验逻辑，以及自动订阅官方目录的部署配置。

整理或替换乐器时，先读 [乐器整理与替换规则](instrument-library-rules.md)；完整乐器组织、VCSL 对应项核查、旧条目移除、多语言和音符边界验收均以该规则为准。当前发布结果见 [管弦乐器交接](handoff-orchestra-complete.md)。

## 仓库职责

- [BreezyMomo/MomoSoundForge](https://github.com/BreezyMomo/MomoSoundForge)：编辑器代码、资源协议、工程格式、用户个人库和远程目录加载器。
- [BreezyMomo/MomoSoundForge-assets](https://github.com/BreezyMomo/MomoSoundForge-assets)：官方音库的完整自描述目录、资源图、音频依赖、来源与授权。
- [BreezyMomo/MomoSoundForge-assets-vcsl-harp-sax](https://github.com/BreezyMomo/MomoSoundForge-assets-vcsl-harp-sax)：补充音库的完整自描述目录、资源图、音频依赖、来源与授权。

资源包使用 `momo.remote-sound-library/v1`。目录中的 `libraryId` 是身份，`entries` 描述可用资源，`audio` 列出每个完整音频依赖及校验值。URL 只是部署地址，不是资源身份；每个音库都可以独立迁移、缓存、停用和更新。

主仓库不保存 `samples/`、`sound-assets.lock.json`、`src/data/builtin-catalog.json`、资源映射或生成音频。用户在应用中下载资源后，个人库会保存完整依赖，工程分享仍然可离线打开。

## 新增或替换音源

1. 在资源仓库选择并核实来源、授权、映射和转换参数。
2. 生成一个新的自描述音库目录，给资源和音频固定内容 ID、大小与 SHA-256；不要覆盖已发布附件，不使用 `latest`。
3. 在资源仓库的隔离环境运行资源协议、完整依赖、空缓存恢复和浏览器试听验证。
4. 发布新的版本目录到资源仓库 Pages，并确认目录和所有依赖可通过 HTTPS/CORS 读取。
5. 如需让主站自动订阅补充音库，只在主仓库部署配置中加入该目录 URL；主仓库不复制 manifest、映射或音频。
6. 发布后检查真实站点的目录加载、资源试听、下载到个人库、工程保存、重开和导出。

代码修改未改变音频内容时，不需要重新发布音库。音频或映射变化时必须先发布并验证新音库，再修改部署 URL。

## 本地验证

```sh
npm test
npm run build
```

随后使用真实浏览器打开构建站点，确认远程音库按需加载。禁用音库服务后，已下载到个人库的资源和已保存工程应仍可离线使用。

不要自动提交、推送或发布。提交前检查 `git status --short` 和暂存区，确保没有重新产生 `samples/`、资源锁文件、manifest 副本或大型音频。
