# DeepSeek Harness Docker

本仓库为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供非官方 Docker 镜像和双仓库发布流水线。

## 可部署性结论

可以容器化部署。截至 2026-08-14，上游默认分支提交 `47f943859bef60e4160492346772ded9b24f765a` 提供 npm 包和源码运行方式，但仓库中没有 Dockerfile、Compose 文件，也未发现官方 GHCR/Docker Hub 镜像。上游要求 Node.js `^22.19.0 || >=24.0.0`，Web UI、配置和会话数据都能放入标准 Linux 容器；其 Linux 原生组件支持 `amd64` 与 `arm64`。

本镜像直接安装上游发布的 `@deepseek-ai/dsh` npm 包，而不是复制上游源码构建链。依赖由 `package-lock.json` 固定，基础镜像按 digest 固定，运行时使用 Node.js 24、非 root 用户、Tini、健康检查，并在发布时生成多架构镜像、SBOM 和 provenance。

> [!WARNING]
> DeepSeek Harness 可以在工作区执行命令，并且当前 Web 服务没有身份认证。上游因此明确拒绝直接绑定 `0.0.0.0`。本镜像让 dsh 继续监听容器内的 `127.0.0.1`，再通过透明 TCP bridge 暴露容器端口。请始终把 Docker 宿主机端口绑定到 `127.0.0.1`，不要直接暴露到公网或不受信任的局域网。

## 快速启动

本地构建并使用 Compose：

```bash
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY；也可以启动后在本地 Web UI 中配置。
docker compose up --build -d
docker compose logs -f
```

浏览器访问 <http://127.0.0.1:3080>。

直接运行镜像：

```bash
docker build -t deepseek-harness:local .

docker run --rm -it \
  --name deepseek-harness \
  --security-opt no-new-privileges=true \
  --cap-drop ALL \
  -p 127.0.0.1:3080:3080 \
  -e DEEPSEEK_API_KEY \
  -v deepseek-harness-home:/home/node/.dsh \
  -v "$PWD:/workspace" \
  deepseek-harness:local
```

`/home/node/.dsh` 保存配置、凭据、插件和会话；`/workspace` 是 Agent 默认操作的项目目录。只挂载你允许 Agent 读取和修改的目录。

## Secret 文件

除了 `DEEPSEEK_API_KEY`，入口还支持 `DEEPSEEK_API_KEY_FILE`，便于 Docker/Kubernetes Secret 以文件形式挂载：

```bash
docker run --rm -it \
  -p 127.0.0.1:3080:3080 \
  -e DEEPSEEK_API_KEY_FILE=/run/secrets/deepseek_api_key \
  --mount type=bind,src="$PWD/deepseek_api_key",dst=/run/secrets/deepseek_api_key,readonly \
  -v deepseek-harness-home:/home/node/.dsh \
  -v "$PWD:/workspace" \
  deepseek-harness:local
```

## 其他运行模式

查看版本或帮助：

```bash
docker run --rm deepseek-harness:local --version
docker run --rm deepseek-harness:local --help
docker run --rm deepseek-harness:local web --help
```

运行一次 headless 任务：

```bash
docker run --rm -it \
  -e DEEPSEEK_API_KEY \
  -v deepseek-harness-home:/home/node/.dsh \
  -v "$PWD:/workspace" \
  deepseek-harness:local --profile headless "分析当前项目并运行测试"
```

入口规则如下：`web` 或 `dsh web` 使用容器 Web bridge；以 `-` 开头的参数交给 `dsh`；其他命令按原样执行，因此也可以运行 `bash`。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---:|---|
| `DEEPSEEK_API_KEY` | 空 | DeepSeek API Key。 |
| `DEEPSEEK_API_KEY_FILE` | 空 | 包含 API Key 的 Secret 文件；仅在未设置 `DEEPSEEK_API_KEY` 时读取。 |
| `DEEPSEEK_BASE_URL` | 上游默认值 | 可选的兼容 API 地址。 |
| `DSH_PORT` | `3080` | 容器 TCP bridge 的监听端口。 |
| `DSH_INTERNAL_PORT` | `3081` | dsh 在容器回环地址上的内部端口，必须与 `DSH_PORT` 不同。 |
| `DSH_TRUSTED_HOSTS` | 空 | 逗号分隔的额外 `host[:port]`；仅用于受认证反向代理等高级部署。它不是认证机制。 |
| `DSH_TELEMETRY_DISABLED` | `1` | 镜像默认关闭遥测；设为空值才允许使用上游遥测配置。 |
| `DSH_TOOLS_MODE` | `native` | 上游支持 `native`、`code` 或 `both`。 |

Web 模式的 `--host` 和 `--port` 由容器入口管理，不能直接传入。宿主机端口通过 `docker run -p` 或 Compose 的 `DSH_HOST_PORT` 调整。

## 远程访问

首选 SSH 本地转发：让容器仍只发布在服务器的回环地址，然后从客户端执行：

```bash
ssh -L 3080:127.0.0.1:3080 user@server
```

如果必须使用反向代理，代理必须提供可靠的身份认证、正确支持 WebSocket，并通过 `DSH_TRUSTED_HOSTS=your.host.example` 声明浏览器实际使用的 authority。`trustedHosts` 只是防 DNS rebinding 的允许列表，不能替代认证。即使部署在容器中，Agent 仍能完全访问挂载的工作区和容器允许的网络资源。

## 发布到 GHCR 和 Docker Hub

工作流位于 [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)，行为如下：

- Pull Request：构建 `linux/amd64` 镜像、运行 CLI/Web 健康检查，再验证 `linux/amd64` 和 `linux/arm64` 构建，不推送。
- `main`/`master` 分支推送：完成验证后推送分支标签、上游版本标签和 commit SHA 标签。
- `v*` Git tag：额外生成 SemVer 标签和 `latest`。
- 手动运行：只有把 `publish` 设为 `true` 才推送。
- GHCR 始终发布；Docker Hub 凭据齐全时，同一份 manifest 同步发布到 Docker Hub。缺少 Docker Hub 凭据不会阻断 GHCR 构建发布。

在 GitHub 仓库中配置：

| 类型 | 名称 | 用途 |
|---|---|---|
| Secret | `DOCKERHUB_USERNAME` | Docker Hub 用户名。 |
| Secret | `DOCKERHUB_TOKEN` | Docker Hub access token，不要使用账户密码。 |
| Variable（可选） | `DOCKERHUB_REPOSITORY` | Docker Hub 仓库名，默认 `deepseek-harness`。 |

GHCR 使用 GitHub 自动提供的 `GITHUB_TOKEN`，工作流已经声明 `packages: write`。首次发布后，可在 GitHub Package 设置中把包可见性改为 Public，并把包关联到本仓库。Docker Hub 仓库需要提前创建，并授予 token Read & Write 权限。

推荐用与上游版本对应的 Git tag 发布，例如：

```bash
git tag v0.1.0-rc.6
git push origin v0.1.0-rc.6
```

更新上游版本时，同时修改 `package.json`、`package-lock.json` 和 Dockerfile 中的 `DSH_VERSION` 默认值，然后完成本地镜像健康检查。Dependabot 已配置为跟踪 npm、基础镜像和 GitHub Actions 更新。

## 定制工具链

默认镜像只附带 DeepSeek Harness 所需的 Node.js，以及 `bash`、Git、OpenSSH client 和 ripgrep。按项目需要派生镜像：

```dockerfile
FROM ghcr.io/your-org/deepseek-harness:latest

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*
USER node
```

## 许可证与归属

本仓库的容器包装代码采用 MIT License。DeepSeek Harness 本身由 DeepSeek AI 开发并采用 MIT License；本项目不是 DeepSeek AI 的官方 Docker 发行版。
