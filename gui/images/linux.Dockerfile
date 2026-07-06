# inb4doc-gui linux builder
#
# Produces: /build/bin/inb4doc-gui  (Linux x86_64, Qt6 WebEngine backend)
#
# Usage:
#   docker build -t inb4doc-gui:linux -f images/linux.Dockerfile .
#   docker create --name tmp inb4doc-gui:linux
#   docker cp tmp:/build/bin/inb4doc-gui ./bin/
#   docker rm tmp

FROM debian:trixie-slim AS builder

ARG SAUCER_BUILD_TYPE=Release

# ── Layer 1: system dependencies (stable) ──────────────────────────────
RUN apt-get update && apt-get install -y \
    build-essential \
    ninja-build \
    git \
    pkg-config \
    wget \
    qt6-base-dev \
    qt6-webengine-dev \
    libgtk-4-dev \
    libadwaita-1-dev \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && ldconfig

# ── Layer 2: g++-15 from sid (stable compiler pin) ────────────────────
RUN echo "deb http://deb.debian.org/debian sid main" > /etc/apt/sources.list.d/sid.list \
    && printf 'Package: *\nPin: release a=sid\nPin-Priority: 100\n' > /etc/apt/preferences.d/sid.pref \
    && apt-get update \
    && apt-get install -y -t sid g++-15 \
    && rm -rf /var/lib/apt/lists/*

ENV CC=gcc-15 CXX=g++-15 \
    CXXFLAGS="-mno-direct-extern-access"

# ── Layer 3: CMake 4.4.0-rc1 (required by Saucer 8.2.0) ───────────────
RUN wget -qO- \
    "https://github.com/Kitware/CMake/releases/download/v4.4.0-rc1/cmake-4.4.0-rc1-linux-x86_64.tar.gz" \
    | tar xz --strip-components=1 -C /usr/local

# ── Layer 4: premake5 (not in trixie repos) ───────────────────────────
RUN wget -qO- \
    "https://github.com/premake/premake-core/releases/download/v5.0.0-beta8/premake-5.0.0-beta8-linux.tar.gz" \
    | tar xz -C /usr/local/bin premake5 \
    && chmod +x /usr/local/bin/premake5

# ── Layer 5: patches (busts on file changes) ──────────────────────────
COPY patches/ /build/patches/

# ── Layer 6: Saucer + dependencies (busts on commit change) ───────────
WORKDIR /build/vendor
RUN --mount=type=cache,target=/build/vendor/saucer/build \
    if [ ! -d saucer-src/.git ]; then \
    git clone https://github.com/saucer/saucer.git saucer-src; \
    fi && \
    cd saucer-src && \
    git fetch --depth 1 origin 811cd2f8ee7044d7143fc8d36b9ceaaef878de39 && \
    git checkout 811cd2f8ee7044d7143fc8d36b9ceaaef878de39 && \
    patch -p1 < /build/patches/000-saucer-build.diff && \
    patch -p1 < /build/patches/001-saucer-qtwebengine.diff && \
    cmake -B /build/vendor/saucer/build -G Ninja -S . \
    -DCMAKE_BUILD_TYPE=${SAUCER_BUILD_TYPE} \
    -DCMAKE_INSTALL_PREFIX=/build/vendor/saucer \
    -DCMAKE_CXX_FLAGS="-mno-direct-extern-access" \
    -DSAUCER_USE_QTWEBENGINE=ON \
    -Dsaucer_backend=Qt && \
    cmake --build /build/vendor/saucer/build -j"$(nproc)" && \
    mkdir -p /build/vendor/saucer/lib /build/vendor/saucer/include && \
    cp -v /build/vendor/saucer/build/libsaucer.a /build/vendor/saucer/lib/ && \
    cp -v /build/vendor/saucer/build/_deps/coco-build/libcoco.a /build/vendor/saucer/lib/ 2>/dev/null && \
    cp -r include/* /build/vendor/saucer/include/ && \
    for d in /build/vendor/saucer/build/_deps/*/include/; do \
    [ -d "$d" ] || continue; \
    cp -r "$d"/* /build/vendor/saucer/include/ 2>/dev/null; \
    done

# ── Layer 7: create build user (predep dislikes running as root) ──────
RUN groupadd -r builduser && useradd -r -g builduser builduser \
    && chown -R builduser:builduser /build

# ── Layer 8: predep (stage-resolver for vendor deps) ──────────────────
RUN curl -sL \
    https://github.com/10per5/predep/releases/download/v0.0.1/predep-linux-x86_64.tar.gz \
    -o /tmp/predep.tar.gz \
    && tar xzf /tmp/predep.tar.gz -C /usr/local/bin \
    && predep --help > /dev/null

# ── Layer 9: vendor deps (busts only on predep.toml changes) ──────────
WORKDIR /build
COPY predep.toml ./
USER builduser
RUN predep vendor

# ── Layer 10: inb4doc-gui binary (busts on premake5.lua or src/ changes) ──
COPY premake5.lua ./
COPY src/ src/
ENV CXXFLAGS="-std=c++23 -mno-direct-extern-access" \
    LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu
RUN premake5 gmake && make config=$(echo ${SAUCER_BUILD_TYPE} | tr '[:upper:]' '[:lower:]') -j"$(nproc)" CXX=g++-15

# ── Output stage ──────────────────────────────────────────────────────
FROM scratch
COPY --from=builder /build /build
CMD ["true"]
