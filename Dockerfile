# syntax=docker/dockerfile:1.7

# Pin the multi-platform image index. Dependabot keeps the digest current.
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03

FROM ${NODE_IMAGE} AS dependencies

WORKDIR /opt/deepseek-harness

# Native npm dependencies have prebuilt Linux artifacts, while these packages
# keep a source-build fallback available when an upstream artifact changes.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      g++ \
      make \
      python3 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

ARG DSH_VERSION=0.1.0-rc.6
RUN test "$(node --print "require('./package.json').dependencies['@deepseek-ai/dsh']")" = "${DSH_VERSION}" \
    && npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

FROM ${NODE_IMAGE} AS runtime

ARG DSH_VERSION=0.1.0-rc.6
ARG VCS_REF=""
ARG BUILD_DATE=""

LABEL org.opencontainers.image.title="DeepSeek Harness" \
      org.opencontainers.image.description="Unofficial, production-oriented container image for DeepSeek Harness" \
      org.opencontainers.image.url="https://github.com/AlliotTech/deepseek-harness-docker" \
      org.opencontainers.image.documentation="https://github.com/AlliotTech/deepseek-harness-docker#readme" \
      org.opencontainers.image.source="https://github.com/AlliotTech/deepseek-harness-docker" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${DSH_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      io.deepseek-harness.upstream.source="https://github.com/deepseek-ai/deepseek-harness" \
      io.deepseek-harness.upstream.version="${DSH_VERSION}"

# Keep the runtime small but useful for the built-in coding-agent tools.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      bash \
      ca-certificates \
      git \
      openssh-client \
      ripgrep \
      tini \
    && rm -rf /var/lib/apt/lists/*

ENV DSH_HOME=/home/node/.dsh \
    DSH_PORT=3080 \
    DSH_INTERNAL_PORT=3081 \
    DSH_TELEMETRY_DISABLED=1 \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_CACHE=/home/node/.dsh/.npm-cache \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PNPM_HOME=/home/node/.dsh/.local/share/pnpm \
    PNPM_STORE_DIR=/home/node/.dsh/.local/share/pnpm/store \
    XDG_CACHE_HOME=/home/node/.dsh/.cache \
    PATH=/opt/deepseek-harness/node_modules/.bin:/home/node/.dsh/.local/share/pnpm:${PATH}

WORKDIR /workspace

COPY --from=dependencies --chown=node:node /opt/deepseek-harness /opt/deepseek-harness
COPY --chown=node:node docker-entrypoint.mjs /usr/local/bin/docker-entrypoint.mjs

RUN mkdir -p /home/node/.dsh /workspace \
    && chown -R node:node /home/node/.dsh /workspace

USER node

EXPOSE 3080

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD ["node", "-e", "const p=process.env.DSH_PORT||'3080';fetch('http://127.0.0.1:'+p+'/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["tini", "--", "node", "/usr/local/bin/docker-entrypoint.mjs"]
CMD ["web"]
