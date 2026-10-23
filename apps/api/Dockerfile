FROM mcr.microsoft.com/playwright:v1.61.1-jammy

# Security update (Oct 2026: eMudhra intermediate-certificate compromise and
# the Node.js security release, see Render's advisory). The pinned Playwright
# base image still ships an older Node (24.17.0) and a pre-disclosure
# ca-certificates, and its tag is fixed, so patch both here rather than wait
# for a rebuilt base image. Playwright itself stays pinned to 1.61.1 (it must
# match this image's bundled browsers; see packages/agent).
#
# Node: the official tarball, checksum-verified against nodejs.org's
# SHASUMS256.txt, installed over /usr/local so it shadows the base image's
# /usr/bin/node. Bump NODE_VERSION to a later 24.x as releases land.
ARG NODE_VERSION=24.22.1
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) node_arch=x64 ;; arm64) node_arch=arm64 ;; *) echo "unsupported arch: $arch" >&2; exit 1 ;; esac; \
    file="node-v${NODE_VERSION}-linux-${node_arch}.tar.gz"; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/${file}"; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"; \
    grep " ${file}\$" SHASUMS256.txt | sha256sum -c -; \
    tar -xzf "${file}" -C /usr/local --strip-components=1 --no-same-owner; \
    rm -f "${file}" SHASUMS256.txt; \
    node --version

# System certificate store (what curl and anything using the OS store trust).
# Node and Chromium carry their own root stores, covered by the Node upgrade
# above and by the Playwright pin respectively.
RUN apt-get update \
    && apt-get install -y --only-upgrade ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the whole workspace; npm workspaces needs every member's package.json
# present to resolve symlinks, and there's no build step to prune afterward.
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
COPY evals ./evals

RUN npm install

ENV PORT=3001
EXPOSE 3001

CMD ["npm", "run", "start", "-w", "@stock-indicator-dailies/api"]
