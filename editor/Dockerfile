# Usage:
#   docker build -t predoc-editor -f Dockerfile .
#   docker create --name tmp predoc-editor
#   docker cp tmp:/output/editor/public/. ./public/
#   docker rm tmp

FROM debian:trixie-slim AS builder

RUN apt-get update && apt-get install -y curl unzip && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

WORKDIR /src

COPY package.json ./
RUN bun install

COPY src/ src/
COPY static/ public/
RUN bun run build

FROM debian:trixie-slim
COPY --from=builder /src/public/ /output/editor/public/
