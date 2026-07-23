# inb4doc android builder
#
# Produces: /output/apk/app-debug.apk
#
# Usage (from editor/):
#   docker build -t inb4doc-android -f images/android.Dockerfile .
#   docker create --name tmp inb4doc-android
#   docker cp tmp:/output/apk/app-debug.apk ./android/bin/
#   docker rm tmp

FROM oven/bun:1 AS editor-build

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
RUN BUILD_MODE=gui-mobile bun run build

# ── Android APK ────────────────────────────────────────────────────────
FROM eclipse-temurin:21-jdk AS apk-build

ENV ANDROID_HOME=/opt/android-sdk
ENV PATH="${PATH}:${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools"

RUN apt-get update && apt-get install -y unzip wget && rm -rf /var/lib/apt/lists/* \
    && wget -qO /tmp/cmdtools.zip \
    https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip \
    && mkdir -p ${ANDROID_HOME}/cmdline-tools \
    && unzip -q /tmp/cmdtools.zip -d ${ANDROID_HOME}/cmdline-tools \
    && mv ${ANDROID_HOME}/cmdline-tools/cmdline-tools ${ANDROID_HOME}/cmdline-tools/latest \
    && rm /tmp/cmdtools.zip

RUN --mount=type=cache,target=/root/.cache/sdkman \
    yes | sdkmanager --licenses > /dev/null 2>&1 \
    && sdkmanager "platforms;android-35" "build-tools;35.0.0" "platform-tools"

RUN wget -qO /tmp/gradle.zip https://services.gradle.org/distributions/gradle-8.11.1-bin.zip \
    && unzip -q /tmp/gradle.zip -d /opt \
    && rm /tmp/gradle.zip
ENV PATH="${PATH}:/opt/gradle-8.11.1/bin"

WORKDIR /build

# Editor static assets (from editor-build stage)
COPY --from=editor-build /src/public/ editor-public/

# Android project source
COPY android/build.gradle.kts android/settings.gradle.kts android/gradle.properties ./
COPY android/gradle/ gradle/
COPY android/app/ app/

# Inject editor assets into Android assets directory
RUN mkdir -p app/src/main/assets/editor \
    && cp -r editor-public/* app/src/main/assets/editor/ \
    && rm -rf editor-public

RUN echo "sdk.dir=${ANDROID_HOME}" > local.properties

RUN --mount=type=cache,target=/root/.gradle \
    gradle --no-daemon assembleDebug

# ── Output ─────────────────────────────────────────────────────────────
FROM scratch
COPY --from=apk-build /build/app/build/outputs/apk/debug/app-debug.apk /output/apk/app-debug.apk
CMD ["true"]
