# Usage:
#   docker build -t inb4doc-editor -f Dockerfile .
#   docker create --name tmp inb4doc-editor
#   docker cp tmp:/output/editor/dist ./dist/
#   docker rm tmp
#
# BUILD_MODE=gui-desktop is the thin-shell build (AppFunc.ThinShell is on for
# GuiDesktop): it writes the core boot set + updater to /src/dist/ — the
# read-only install payload (editor_root). The live editor is downloaded into
# the writable data dir on first run by the fetch updater.

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
RUN BUILD_MODE=gui-desktop bun run build

FROM scratch
COPY --from=builder /src/dist/ /output/editor/dist/
CMD ["true"]
