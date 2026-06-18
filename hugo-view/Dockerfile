# Usage:
#   docker build -t predoc-hugo-view -f hugo-view/Dockerfile .
#   docker create --name tmp predoc-hugo-view
#   docker cp tmp:/output/. ./hugo-view/build/
#   docker rm tmp

FROM debian:trixie-slim AS builder

RUN apt-get update && apt-get install -y \
    curl \
    unzip \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Hugo extended v0.158.0 (linux-amd64)
ADD https://github.com/gohugoio/hugo/releases/download/v0.158.0/hugo_extended_0.158.0_linux-amd64.tar.gz /tmp/hugo.tar.gz
RUN tar xzf /tmp/hugo.tar.gz -C /usr/local/bin/ hugo && \
    chmod +x /usr/local/bin/hugo && \
    rm /tmp/hugo.tar.gz

# hugo-book theme v0.14.0
ADD https://github.com/alex-shpak/hugo-book/archive/refs/tags/v0.14.0.zip /tmp/theme.zip
RUN mkdir -p /output/themes && \
    unzip /tmp/theme.zip -d /tmp/ && \
    mv /tmp/hugo-book-0.14.0 /output/themes/book && \
    rm /tmp/theme.zip

# Copy hugo config + layouts
COPY content/ /content/
COPY hugo-view/hugo.toml /output/
COPY hugo-view/layouts/ /output/layouts/

# Build the static site
RUN mkdir -p /output/build && \
    hugo --source /output \
    --contentDir /content \
    --themesDir /output/themes \
    --theme book \
    --destination /output/build

FROM debian:trixie-slim
COPY --from=builder /output/build/ /output/build/
COPY --from=builder /output/themes/ /output/themes/
