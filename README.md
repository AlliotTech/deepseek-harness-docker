# DeepSeek Harness Docker

[![Build and publish container image](https://github.com/AlliotTech/deepseek-harness-docker/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/AlliotTech/deepseek-harness-docker/actions/workflows/docker-publish.yml)
[![Docker Pulls](https://img.shields.io/docker/pulls/alliot/deepseek-harness?logo=docker)](https://hub.docker.com/r/alliot/deepseek-harness)

本仓库为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供非官方 Docker 镜像和 GHCR、Docker Hub 双仓库发布流水线。项目源码位于 [AlliotTech/deepseek-harness-docker](https://github.com/AlliotTech/deepseek-harness-docker)。

## 镜像地址

| Registry | 镜像 | 页面 |
|---|---|---|
| GitHub Container Registry | `ghcr.io/alliottech/deepseek-harness` | [GitHub Packages](https://github.com/AlliotTech/deepseek-harness-docker/pkgs/container/deepseek-harness) |
| Docker Hub | `alliot/deepseek-harness` | [Docker Hub](https://hub.docker.com/r/alliot/deepseek-harness) |

两个 Registry 发布相同的 `linux/amd64`、`linux/arm64` OCI manifest。推荐固定容器发行版标签部署：

```bash
docker pull ghcr.io/alliottech/deepseek-harness:0.1.0-rc.6.2
# 或
docker pull alliot/deepseek-harness:0.1.0-rc.6.2
```

可用标签：

- `0.1.0-rc.6.2`：容器发行版；使用上游 DeepSeek Harness `0.1.0-rc.6`，包含 Web 启动修复和受控的远程提供方配置支持，推荐部署使用。
- `dsh-0.1.0-rc.6`：使用该上游版本的最新容器构建；包装层修复发布时会更新，是可变标签。
- `master`：本仓库默认分支的最新构建，是可变标签。
- `sha-<commit>`：对应本仓库具体 Git commit，例如包含 Web 启动修复的 `sha-6ed1d92`。
- `latest`：最新 `v*` 容器发行版；方便试用，但严格固定部署应使用完整发行版标签或 digest。

> [!IMPORTANT]
> 早期的 `0.1.0-rc.6` 容器发行版存在 Web 子进程缺少 `--expose-internals` 的启动缺陷；`0.1.0-rc.6.1` 在反向代理下仍沿用上游的 loopback-only 配置面，提供方目录会在 `settings.describe` 返回 HTTP 403。请改用 `0.1.0-rc.6.2`。如果此前拉取过同名的 `dsh-0.1.0-rc.6` 或 `master` 可变标签，需要重新执行 `docker pull` 并重建容器，Docker 不会自动替换本地旧镜像。

## 可部署性结论

可以容器化部署。截至 2026-08-14，上游默认分支提交 `47f943859bef60e4160492346772ded9b24f765a` 提供 npm 包和源码运行方式，但仓库中没有 Dockerfile、Compose 文件，也未发现官方 GHCR/Docker Hub 镜像。上游要求 Node.js `^22.19.0 || >=24.0.0`，Web UI、配置和会话数据都能放入标准 Linux 容器；其 Linux 原生组件支持 `amd64` 与 `arm64`。

本镜像直接安装上游发布的 `@deepseek-ai/dsh` npm 包，而不是复制上游源码构建链。依赖由 `package-lock.json` 固定，基础镜像按 digest 固定，运行时使用 Node.js 24、非 root 用户、Tini、健康检查，并在发布时生成多架构镜像、SBOM 和 provenance。

> [!WARNING]
> DeepSeek Harness 可以在工作区执行命令，并且当前 Web 服务没有身份认证。上游因此明确拒绝直接绑定 `0.0.0.0`。本镜像让 dsh 继续监听容器内的 `127.0.0.1`，再通过透明 TCP bridge 暴露容器端口。请始终把 Docker 宿主机端口绑定到 `127.0.0.1`，不要直接暴露到公网或不受信任的局域网。

## 快速启动

使用 Docker Hub 镜像和 Compose：

```bash
git clone https://github.com/AlliotTech/deepseek-harness-docker.git
cd deepseek-harness-docker
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY；也可以启动后在本地 Web UI 中配置。
docker compose pull
docker compose up -d
docker compose logs -f
```

浏览器访问 <http://127.0.0.1:3080>。

直接运行 Docker Hub 镜像：

```bash
docker run --rm -it \
  --name deepseek-harness \
  --security-opt no-new-privileges=true \
  --cap-drop ALL \
  -p 127.0.0.1:3080:3080 \
  -e DEEPSEEK_API_KEY \
  -v deepseek-harness-home:/home/node/.dsh \
  -v "$PWD:/workspace" \
  alliot/deepseek-harness:0.1.0-rc.6.2
```

`/home/node/.dsh` 保存配置、凭据、插件和会话；`/workspace` 是 Agent 默认操作的项目目录。只挂载你允许 Agent 读取和修改的目录。

升级已有 Compose 部署：

```bash
docker compose pull
docker compose up -d --force-recreate
docker compose ps
```

如果使用 `docker run`，先重新拉取所用标签，再删除并按原参数重建容器。可通过日志确认旧启动缺陷：

```text
--expose-internals is required for HMR service
```

如需本地构建当前仓库代码：

```bash
docker build -t deepseek-harness:local .
DEEPSEEK_HARNESS_IMAGE=deepseek-harness:local docker compose up --build -d
```

## Secret 文件

除了 `DEEPSEEK_API_KEY`，入口还支持 `DEEPSEEK_API_KEY_FILE`，便于 Docker/Kubernetes Secret 以文件形式挂载：

```bash
docker run --rm -it \
  -p 127.0.0.1:3080:3080 \
  -e DEEPSEEK_API_KEY_FILE=/run/secrets/deepseek_api_key \
  --mount type=bind,src="$PWD/deepseek_api_key",dst=/run/secrets/deepseek_api_key,readonly \
  -v deepseek-harness-home:/home/node/.dsh \
  -v "$PWD:/workspace" \
  alliot/deepseek-harness:0.1.0-rc.6.2
```

## 其他运行模式

查看版本或帮助：

```bash
docker run --rm alliot/deepseek-harness:0.1.0-rc.6.2 --version
docker run --rm alliot/deepseek-harness:0.1.0-rc.6.2 --help
docker run --rm alliot/deepseek-harness:0.1.0-rc.6.2 web --help
```

运行一次 headless 任务：

```bash
docker run --rm -it \
  -e DEEPSEEK_API_KEY \
  -v deepseek-harness-home:/home/node/.dsh \
  -v "$PWD:/workspace" \
  alliot/deepseek-harness:0.1.0-rc.6.2 \
  --profile headless "分析当前项目并运行测试"
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
| `DSH_ALLOW_REMOTE_CONFIGURATION` | `0` | 是否允许 `DSH_TRUSTED_HOSTS` 访问提供方配置接口；仅应在带认证和 HTTPS 的反向代理后设为 `1`。 |
| `DSH_TELEMETRY_DISABLED` | `1` | 镜像默认关闭遥测；设为空值才允许使用上游遥测配置。 |
| `DSH_TOOLS_MODE` | `native` | 上游支持 `native`、`code` 或 `both`。 |

Web 模式的 `--host` 和 `--port` 由容器入口管理，不能直接传入。宿主机端口通过 `docker run -p` 或 Compose 的 `DSH_HOST_PORT` 调整。

## 远程访问

首选 SSH 本地转发：让容器仍只发布在服务器的回环地址，然后从客户端执行：

```bash
ssh -L 3080:127.0.0.1:3080 deploy@dsh.example.com
```

上述命令中的 `deploy@dsh.example.com` 仅表示实际服务器的 SSH 用户与地址。

如果必须使用反向代理，代理必须提供可靠的身份认证、HTTPS 并正确支持 WebSocket。还需要把浏览器访问时的 authority 显式加入信任列表，否则首页可能正常打开，但 `/api/*` 会返回 HTTP 403：

```bash
# .env（Compose）
DSH_TRUSTED_HOSTS=dsh.example.com
DSH_ALLOW_REMOTE_CONFIGURATION=1

# 或 docker run
docker run --rm -it \
  -p 127.0.0.1:3080:3080 \
  -e DSH_TRUSTED_HOSTS=dsh.example.com \
  -e DSH_ALLOW_REMOTE_CONFIGURATION=1 \
  -v deepseek-harness-home:/home/node/.dsh \
  -v "$PWD:/workspace" \
  alliot/deepseek-harness:0.1.0-rc.6.2
```

值只能是逗号分隔的 `host` 或 `host:port`，不要填写 `https://`、路径或通配符。无端口的 hostname 可匹配该主机的任意端口；例如 `DSH_TRUSTED_HOSTS=dsh.example.com,192.168.1.20`。反向代理应保留原始 `Host`，例如 Nginx 使用 `proxy_set_header Host $host;`。

`DSH_TRUSTED_HOSTS` 是防 DNS rebinding 的允许列表，不是身份认证机制。默认情况下，上游仍把设置、凭据和模型发现接口限制为 loopback；因此只设置 `DSH_TRUSTED_HOSTS` 时，远程“模型”页面会显示 `transport failure for /api/settings.describe: HTTP 403`。

`DSH_ALLOW_REMOTE_CONFIGURATION=1` 是本镜像提供的显式兼容开关。它只把 `settings.describe/update/replace/mutate`、`credentials.describe/set/unset` 和 `llm.discoverModels` 开放给受信 Host；配置文件打开、宿主机路径打开和目录选择等原生操作仍保持 loopback-only。入口会拒绝“已开启该开关但没有配置任何受信 Host”的组合。

开启后，反向代理必须先完成用户认证；否则能访问该域名的人可以读取或修改 Harness 配置、写入凭据，并让宿主机执行模型发现请求。即使部署在容器中，Agent 仍能完全访问挂载的工作区和容器允许的网络资源。

## 发布到 GHCR 和 Docker Hub

工作流位于 [`.github/workflows/docker-publish.yml`](https://github.com/AlliotTech/deepseek-harness-docker/blob/master/.github/workflows/docker-publish.yml)，行为如下：

- Pull Request：构建 `linux/amd64` 镜像，验证 CLI 版本和 Web 健康状态；确认远程配置默认返回 403、显式开启后 `settings.describe` 返回 200、未受信 Host 仍返回 403、原生宿主机操作仍不可远程调用，并持续执行真实 HTTP 请求；随后验证 `linux/amd64` 和 `linux/arm64` 构建，不推送。
- `main`/`master` 分支推送：完成验证后推送分支标签、上游版本标签和 commit SHA 标签。
- `v*` Git tag：额外生成 SemVer 标签和 `latest`。
- 手动运行：只有把 `publish` 设为 `true` 才推送。
- GHCR 始终发布；Docker Hub 凭据齐全时，同一份 manifest 同步发布到 Docker Hub。缺少 Docker Hub 凭据不会阻断 GHCR 构建发布。

在 GitHub 仓库中配置：

| 类型 | 名称 | 用途 |
|---|---|---|
| Secret | `DOCKERHUB_USERNAME` | Docker Hub 用户名，本仓库配置为 `alliot`。 |
| Secret | `DOCKERHUB_TOKEN` | Docker Hub access token，不要使用账户密码。 |
| Variable（可选） | `DOCKERHUB_REPOSITORY` | Docker Hub 仓库名，默认 `deepseek-harness`。 |

本仓库发布到：

- GHCR：`ghcr.io/alliottech/deepseek-harness`
- Docker Hub：`alliot/deepseek-harness`

GHCR 使用 GitHub 自动提供的 `GITHUB_TOKEN`，工作流已经声明 `packages: write`。首次发布后，可在 [GitHub Package 设置](https://github.com/AlliotTech/deepseek-harness-docker/pkgs/container/deepseek-harness/settings)中把包可见性改为 Public，并把包关联到本仓库。Docker Hub token 需要拥有 `alliot/deepseek-harness` 的 Read & Write 权限。

容器发行版使用 SemVer。上游预发布版本保持在前缀中，最后一位表示本仓库的容器包装修订，例如：

```bash
git tag -a v0.1.0-rc.6.2 -m "DeepSeek Harness 0.1.0-rc.6 container revision 2"
git push origin v0.1.0-rc.6.2
```

更新上游版本时，同时修改 `package.json`、`package-lock.json` 和 Dockerfile 中的 `DSH_VERSION` 默认值，然后完成本地镜像健康检查。Dependabot 已配置为跟踪 npm、基础镜像和 GitHub Actions 更新。

## 定制工具链

默认镜像只附带 DeepSeek Harness 所需的 Node.js，以及 `bash`、Git、OpenSSH client 和 ripgrep。按项目需要派生镜像：

```dockerfile
FROM ghcr.io/alliottech/deepseek-harness:0.1.0-rc.6.2

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*
USER node
```

## 许可证与归属

本仓库的容器包装代码采用 MIT License。DeepSeek Harness 本身由 DeepSeek AI 开发并采用 MIT License；本项目不是 DeepSeek AI 的官方 Docker 发行版。
