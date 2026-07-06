# inb4doc-gui darwin cross-builder
#
# Produces: /build/bin/inb4doc-gui  (macOS x86_64, WKWebView backend)
#
# Uses osxcross to provide a macOS cross-toolchain on Linux.  The macOS
# SDK is sourced from https://github.com/joseluisq/macosx-sdks — check
# the Xcode license terms before use.
#
# Usage:
#   docker build --build-arg PRIVILEGE_SHA=$(sha256sum gui/predep.toml | cut -d' ' -f1) \
#       -t inb4doc-gui:darwin -f images/darwin.Dockerfile .
#   docker create --name tmp inb4doc-gui:darwin
#   docker cp tmp:/build/bin/inb4doc-gui ./bin/
#   docker rm tmp

# ═══════════════════════════════════════════════════════════════════════
# Stage 1: osxcross toolchain
# ═══════════════════════════════════════════════════════════════════════
FROM debian:trixie-slim AS toolchain

RUN apt-get update && apt-get install -y \
    clang \
    cmake \
    ninja-build \
    make \
    git \
    patch \
    python3 \
    libssl-dev \
    liblzma-dev \
    libxml2-dev \
    xz-utils \
    bzip2 \
    cpio \
    zlib1g-dev \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Build osxcross — slow, caches in its own layer
RUN git clone --depth 1 https://github.com/tpoechtrager/osxcross.git /osxcross

# Download macOS SDK (joseluisq/macosx-sdks provides pre-packaged tarballs)
RUN wget -q \
    "https://github.com/joseluisq/macosx-sdks/releases/download/14.5/MacOSX14.5.sdk.tar.xz" \
    -O /osxcross/tarballs/MacOSX14.5.sdk.tar.xz

RUN cd /osxcross \
    && UNATTENDED=yes OSX_VERSION_MIN=14.0 TARGET_DIR=/usr/local/osxcross ./build.sh \
    && rm -rf /osxcross

ENV PATH=/usr/local/osxcross/bin:$PATH

# ═══════════════════════════════════════════════════════════════════════
# Stage 2: Saucer for macOS (WebKit backend)
# ═══════════════════════════════════════════════════════════════════════
FROM toolchain AS saucer-builder

# premake5
RUN wget -qO- \
    "https://github.com/premake/premake-core/releases/download/v5.0.0-beta8/premake-5.0.0-beta8-linux.tar.gz" \
    | tar xz -C /usr/local/bin premake5 \
    && chmod +x /usr/local/bin/premake5

WORKDIR /build/vendor
RUN git clone https://github.com/saucer/saucer.git saucer-src && \
    cd saucer-src && \
    git checkout 811cd2f8ee7044d7143fc8d36b9ceaaef878de39 && \
    sed -i 's|return from({std::from_range, data()});|return from(vec(data().begin(), data().end()));|' src/stash.cpp && \
    cmake -B /build/vendor/saucer-build -G Ninja -S . \
    -DCMAKE_TOOLCHAIN_FILE=/usr/local/osxcross/tools/osxcross.toolchain.cmake \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX=/build/vendor/saucer \
    -Dsaucer_backend=WebKit \
    -Dsaucer_no_compiler_version_check=ON \
    -Dsaucer_prefer_remote=ON \
    && cmake --build /build/vendor/saucer-build -j"$(nproc)" \
    && mkdir -p /build/vendor/saucer/lib /build/vendor/saucer/include \
    && cp -v /build/vendor/saucer-build/libsaucer.a /build/vendor/saucer/lib/ \
    && cp -v /build/vendor/saucer-build/_deps/coco-build/libcoco.a /build/vendor/saucer/lib/ 2>/dev/null \
    && cp -r include/* /build/vendor/saucer/include/ \
    && for d in /build/vendor/saucer-build/_deps/*/include/; do \
    [ -d "$d" ] || continue; \
    cp -r "$d"/* /build/vendor/saucer/include/ 2>/dev/null; \
    done

# ═══════════════════════════════════════════════════════════════════════
# Stage 3: inb4doc-gui for macOS
# ═══════════════════════════════════════════════════════════════════════
FROM toolchain AS builder

COPY --from=saucer-builder /build /build

# premake5 (for the build stage)
RUN wget -qO- \
    "https://github.com/premake/premake-core/releases/download/v5.0.0-beta8/premake-5.0.0-beta8-linux.tar.gz" \
    | tar xz -C /usr/local/bin premake5 \
    && chmod +x /usr/local/bin/premake5

# predep
RUN curl -sL \
    https://github.com/10per5/predep/releases/download/v0.0.1/predep-linux-x86_64.tar.gz \
    -o /tmp/predep.tar.gz \
    && tar xzf /tmp/predep.tar.gz -C /usr/local/bin \
    && predep --help > /dev/null

WORKDIR /build
COPY predep.toml ./
ARG PRIVILEGE_SHA
RUN predep vendor --privileged $PRIVILEGE_SHA

COPY premake5.lua ./
COPY src/ src/

# macOS backend uses WebKit (Objective-C++) — no Qt libs needed.
# The Saucer static lib carries transitive framework dependencies
# (Cocoa, WebKit, CoreImage) brought in by the osxcross CMake build.
RUN premake5 gmake --os=macosx \
    && make config=redist -j"$(nproc)" \
    CC=o64-clang CXX=o64-clang++ \
    CXXFLAGS="-std=c++23 -I/build/vendor/saucer/include -target x86_64-apple-macos14.0" \
    LDFLAGS="-L/build/vendor/saucer/lib -framework Cocoa -framework WebKit -framework CoreImage" \
    LIBS="-lsaucer -lcoco"

# ═══════════════════════════════════════════════════════════════════════
# Output stage
# ═══════════════════════════════════════════════════════════════════════
FROM scratch
COPY --from=builder /build /build
CMD ["true"]
