# Usage:
#   docker build -t inb4doc-editor -f Dockerfile .
#   docker create --name tmp inb4doc-editor
#   docker cp tmp:/output/editor/public/. ./public/
#   docker rm tmp

FROM oven/bun:1 AS builder

USER root
RUN apt-get update && apt-get install -y curl unzip && rm -rf /var/lib/apt/lists/*


WORKDIR /src

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY src/ src/
COPY lib/ lib/
COPY static/ static/
COPY *.ts ./
COPY tsconfig.json ./
RUN bun run build

FROM scratch
COPY --from=builder /src/public/ /output/editor/public/
CMD ["true"]
