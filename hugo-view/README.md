# inb4doc-hugo-view

Static site generator (SSG) using [Hugo](https://gohugo.io/) with the [hugo-book](https://github.com/alex-shpak/hugo-book) theme. Reads content from `../content/`.

## Commands

```bash
# Build directly with Hugo
hugo --source . --contentDir ../content --themesDir themes --theme book --destination build

# Dev server with live reload
hugo server --source . --contentDir ../content --themesDir themes --theme book

# Docker build
docker build -t inb4doc-hugo-view .
docker create --name tmp inb4doc-hugo-view
docker cp tmp:/output/. ./build/
docker rm tmp
```
