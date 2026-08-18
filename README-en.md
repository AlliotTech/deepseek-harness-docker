# DeepSeek Harness Docker

> [**中文文档**](README.md)

[![Build and publish container image](https://github.com/AlliotTech/deepseek-harness-docker/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/AlliotTech/deepseek-harness-docker/actions/workflows/docker-publish.yml)
[![Docker Pulls](https://img.shields.io/docker/pulls/alliot/deepseek-harness?logo=docker)](https://hub.docker.com/r/alliot/deepseek-harness)

This repository provides an unofficial Docker image for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), along with a publishing pipeline for both GHCR and Docker Hub. The source code lives in [AlliotTech/deepseek-harness-docker](https://github.com/AlliotTech/deepseek-harness-docker).

## Image Registries

| Registry | Image | Page |
|---|---|---|
| GitHub Container Registry | `ghcr.io/alliottech/deepseek-harness` | [GitHub Packages](https://github.com/AlliotTech/deepseek-harness-docker/pkgs/container/deepseek-harness) |
| Docker Hub | `alliot/deepseek-harness` | [Docker Hub](https://hub.docker.com/r/alliot/deepseek-harness) |

Both registries publish identical `linux/amd64` and `linux/arm64` OCI manifests. We recommend pinning a container release tag for deployment:

```bash
docker pull ghcr.io/alliottech/deepseek-harness:0.1.0-rc.6.2
# or
docker pull alliot/deepseek-harness:0.1.0-rc.6.2
```

Available tags:

- `0.1.0-rc.6.2`: Container release; uses upstream DeepSeek Harness `0.1.0-rc.6` with the web startup fix and opt-in remote provider configuration support. Recommended for deployment.
- `dsh-0.1.0-rc.6`: Latest container build for that upstream version; updated when wrapping-layer fixes are released. Mutable tag.
- `master`: Latest build of this repository's default branch. Mutable tag.
- `sha-<commit>`: A specific Git commit of this repository, e.g. `sha-6ed1d92` (contains the web startup fix).
- `latest`: Latest `v*` container release; convenient for trying things out, but use a full release tag or digest for strict pinning.

> [!IMPORTANT]
> The early `0.1.0-rc.6` container release had a startup defect where the web subprocess was missing `--expose-internals`; `0.1.0-rc.6.1` still used the upstream loopback-only configuration surface behind a reverse proxy, so the provider directory returned HTTP 403 from `settings.describe`. Use `0.1.0-rc.6.2` instead. If you previously pulled the same-named `dsh-0.1.0-rc.6` or `master` mutable tags, re-run `docker pull` and recreate the container — Docker will not automatically replace old local images.

## Deployability Assessment

Containerized deployment is feasible. As of 2026-08-14, upstream default branch commit `47f943859bef60e4160492346772ded9b24f765a` provides npm package and source-based run modes, but the repository has no Dockerfile or Compose file, and no official GHCR/Docker Hub image was found. Upstream requires Node.js `^22.19.0 || >=24.0.0`; the web UI, configuration, and session data all fit in a standard Linux container, and its Linux native components support `amd64` and `arm64`.

This image installs the published `@deepseek-ai/dsh` npm package directly rather than replicating the upstream build chain. Dependencies are pinned via `package-lock.json`, the base image is pinned by digest, and the runtime uses Node.js 24, a non-root user, Tini, and a health check. Multi-arch images, SBOMs, and provenance are generated at release time.

> [!WARNING]
> DeepSeek Harness can execute commands in the workspace, and the current web service has no authentication. Upstream therefore explicitly refuses to bind `0.0.0.0`. This image keeps dsh listening on `127.0.0.1` inside the container and exposes the container port through a transparent TCP bridge. Always bind the Docker host port to `127.0.0.1`; do not expose it to the public internet or an untrusted LAN.

## Quick Start

Using the Docker Hub image and Compose:

```bash
git clone https://github.com/AlliotTech/deepseek-harness-docker.git
cd deepseek-harness-docker
cp .env.example .env
# Edit .env and fill in DEEPSEEK_API_KEY; you can also configure it in the local web UI after startup.
docker compose pull
docker compose up -d
docker compose logs -f
```

Open <http://127.0.0.1:3080> in your browser.

Running the Docker Hub image directly:

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

`/home/node/.dsh` stores configuration, credentials, plugins, and sessions; `/workspace` is the project directory the Agent operates on by default. Only mount directories you are willing to let the Agent read and modify.

Upgrading an existing Compose deployment:

```bash
docker compose pull
docker compose up -d --force-recreate
docker compose ps
```

If you use `docker run`, re-pull the tag you use, then remove and recreate the container with the same arguments. You can confirm the old startup defect in the logs:

```text
--expose-internals is required for HMR service
```

To build the current repository code locally:

```bash
docker build -t deepseek-harness:local .
DEEPSEEK_HARNESS_IMAGE=deepseek-harness:local docker compose up --build -d
```

## Secret Files

In addition to `DEEPSEEK_API_KEY`, the entrypoint supports `DEEPSEEK_API_KEY_FILE` for mounting Docker/Kubernetes secrets as files:

```bash
docker run --rm -it \
  -p 127.0.0.1:3080:3080 \
  -e DEEPSEEK_API_KEY_FILE=/run/secrets/deepseek_api_key \
  --mount type=bind,src="$PWD/deepseek_api_key",dst=/run/secrets/deepseek_api_key,readonly \
  -v deepseek-harness-home:/home/node/.dsh \
  -v "$PWD:/workspace" \
  alliot/deepseek-harness:0.1.0-rc.6.2
```

## Other Run Modes

Show the version or help:

```bash
docker run --rm alliot/deepseek-harness:0.1.0-rc.6.2 --version
docker run --rm alliot/deepseek-harness:0.1.0-rc.6.2 --help
docker run --rm alliot/deepseek-harness:0.1.0-rc.6.2 web --help
```

Run a one-off headless task:

```bash
docker run --rm -it \
  -e DEEPSEEK_API_KEY \
  -v deepseek-harness-home:/home/node/.dsh \
  -v "$PWD:/workspace" \
  alliot/deepseek-harness:0.1.0-rc.6.2 \
  --profile headless "Analyze the current project and run the tests"
```

Entrypoint rules: `web` or `dsh web` uses the container web bridge; arguments starting with `-` are passed to `dsh`; any other command is executed as-is, so `bash` also works.

## Environment Variables

| Variable | Default | Description |
|---|---:|---|
| `DEEPSEEK_API_KEY` | empty | DeepSeek API key. |
| `DEEPSEEK_API_KEY_FILE` | empty | Secret file containing the API key; only read when `DEEPSEEK_API_KEY` is not set. |
| `DEEPSEEK_BASE_URL` | upstream default | Optional API-compatible base URL. |
| `DSH_PORT` | `3080` | Listen port of the container TCP bridge. |
| `DSH_INTERNAL_PORT` | `3081` | Internal port of dsh on the container loopback address; must differ from `DSH_PORT`. |
| `DSH_TRUSTED_HOSTS` | empty | Comma-separated additional `host[:port]` values; only for advanced deployments such as authenticated reverse proxies. It is not an authentication mechanism. |
| `DSH_ALLOW_REMOTE_CONFIGURATION` | `0` | Whether to let `DSH_TRUSTED_HOSTS` access the provider configuration API; only set to `1` behind an authenticated, HTTPS reverse proxy. |
| `DSH_TELEMETRY_DISABLED` | `1` | Telemetry is disabled by default in this image; set to an empty value to allow the upstream telemetry configuration. |
| `DSH_TOOLS_MODE` | `native` | Upstream supports `native`, `code`, or `both`. |

The `--host` and `--port` of web mode are managed by the container entrypoint and cannot be passed directly. Adjust the host port via `docker run -p` or the `DSH_HOST_PORT` Compose variable.

## Remote Access

Prefer SSH local forwarding: keep the container published only on the server's loopback address, then run from the client:

```bash
ssh -L 3080:127.0.0.1:3080 deploy@dsh.example.com
```

`deploy@dsh.example.com` above just represents the actual SSH user and address of your server.

If you must use a reverse proxy, it must provide reliable authentication, HTTPS, and proper WebSocket support. You also need to explicitly add the authority your browser uses to the trust list; otherwise the home page may open fine but `/api/*` returns HTTP 403:

```bash
# .env (Compose)
DSH_TRUSTED_HOSTS=dsh.example.com
DSH_ALLOW_REMOTE_CONFIGURATION=1

# or docker run
docker run --rm -it \
  -p 127.0.0.1:3080:3080 \
  -e DSH_TRUSTED_HOSTS=dsh.example.com \
  -e DSH_ALLOW_REMOTE_CONFIGURATION=1 \
  -v deepseek-harness-home:/home/node/.dsh \
  -v "$PWD:/workspace" \
  alliot/deepseek-harness:0.1.0-rc.6.2
```

Values must be comma-separated `host` or `host:port` entries — no `https://` scheme, paths, or wildcards. A hostname without a port matches any port on that host; for example `DSH_TRUSTED_HOSTS=dsh.example.com,192.168.1.20`. The reverse proxy should preserve the original `Host` header, e.g. Nginx uses `proxy_set_header Host $host;`.

`DSH_TRUSTED_HOSTS` is a DNS rebinding allowlist, not an authentication mechanism. By default, upstream still restricts settings, credentials, and model discovery endpoints to loopback; therefore with only `DSH_TRUSTED_HOSTS` set, the remote "Models" page shows `transport failure for /api/settings.describe: HTTP 403`.

`DSH_ALLOW_REMOTE_CONFIGURATION=1` is an explicit compatibility switch provided by this image. It only opens `settings.describe/update/replace/mutate`, `credentials.describe/set/unset`, and `llm.discoverModels` to trusted hosts; native operations such as opening config files, opening host paths, and directory selection remain loopback-only. The entrypoint rejects the combination of enabling the switch without any trusted hosts configured.

Once enabled, the reverse proxy must authenticate users first; otherwise anyone who can reach the domain can read or modify the Harness configuration, write credentials, and have the host issue model discovery requests. Even when deployed in a container, the Agent still has full access to the mounted workspace and any network resources the container can reach.

## Publishing to GHCR and Docker Hub

The workflow is in [`.github/workflows/docker-publish.yml`](https://github.com/AlliotTech/deepseek-harness-docker/blob/master/.github/workflows/docker-publish.yml) and behaves as follows:

- Pull Request: builds the `linux/amd64` image, verifies the CLI version and web health; confirms remote configuration returns 403 by default, `settings.describe` returns 200 after explicit opt-in, untrusted hosts still return 403, and native host operations are still not remotely callable; keeps issuing real HTTP requests; then verifies `linux/amd64` and `linux/arm64` builds without pushing.
- Push to `main`/`master`: after verification, pushes the branch tag, upstream version tag, and commit SHA tag.
- `v*` Git tag: additionally generates SemVer tags and `latest`.
- Manual run: pushes only when `publish` is set to `true`.
- GHCR is always published; when Docker Hub credentials are present, the same manifest is published to Docker Hub. Missing Docker Hub credentials do not block GHCR builds and publishing.

Configure in the GitHub repository:

| Type | Name | Purpose |
|---|---|---|
| Secret | `DOCKERHUB_USERNAME` | Docker Hub username; set to `alliot` in this repository. |
| Secret | `DOCKERHUB_TOKEN` | Docker Hub access token — do not use your account password. |
| Variable (optional) | `DOCKERHUB_REPOSITORY` | Docker Hub repository name; defaults to `deepseek-harness`. |

This repository publishes to:

- GHCR: `ghcr.io/alliottech/deepseek-harness`
- Docker Hub: `alliot/deepseek-harness`

GHCR uses the `GITHUB_TOKEN` GitHub provides automatically, and the workflow already declares `packages: write`. After the first release, you can set the package visibility to Public and link the package to this repository in the [GitHub Package settings](https://github.com/AlliotTech/deepseek-harness-docker/pkgs/container/deepseek-harness/settings). The Docker Hub token needs Read & Write permission on `alliot/deepseek-harness`.

Container releases use SemVer. The upstream pre-release version stays in the prefix and the last digit represents this repository's container wrapping revision, for example:

```bash
git tag -a v0.1.0-rc.6.2 -m "DeepSeek Harness 0.1.0-rc.6 container revision 2"
git push origin v0.1.0-rc.6.2
```

When updating the upstream version, update `package.json`, `package-lock.json`, and the `DSH_VERSION` default in the Dockerfile at the same time, then complete the local image health check. Dependabot is configured to track npm, base image, and GitHub Actions updates.

## Customizing the Toolchain

The default image ships only the Node.js required by DeepSeek Harness, plus `bash`, Git, OpenSSH client, and ripgrep. Derive your own image as your project requires:

```dockerfile
FROM ghcr.io/alliottech/deepseek-harness:0.1.0-rc.6.2

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*
USER node
```

## License and Attribution

The container wrapping code in this repository is licensed under the MIT License. DeepSeek Harness itself is developed by DeepSeek AI and licensed under the MIT License; this project is not an official Docker distribution by DeepSeek AI.
