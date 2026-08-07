# Usage:
#   docker build -t inb4doc-editor -f Dockerfile .
#   docker create --name tmp inb4doc-editor
#   docker cp tmp:/output/editor/dist ./dist/
#   docker rm tmp
#
# BUILD_MODE=gui-desktop FULL_BUNDLE=1 writes the COMPLETE public/ bundle to
# /src/dist/ — the read-only install payload (editor_root). FULL_BUNDLE forces
# the thin-shell flag off and empties update-base, so the APK/install carries
# every chunk and the fetch updater never runs (nothing is fetched remotely).
# The gui/src/scheme.cpp app:// handler serves these chunks from editor_root
# (data dir first, install fallback).

FROM oven/bun:1 AS builder

USER root
RUN apt-get update && apt-get install -y curl unzip && rm -rf /var/lib/apt/lists/*


WORKDIR /src

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY src/ src/
COPY lib/ lib/
COPY static/ static/
COPY templates/ templates/
COPY *.ts ./
COPY tsconfig.json ./
RUN FULL_BUNDLE=1 BUILD_MODE=gui-desktop bun run build

FROM scratch
COPY --from=builder /src/dist/ /output/editor/dist/
CMD ["true"]
