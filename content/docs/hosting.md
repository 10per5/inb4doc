---
title: Hosting
weight: 30
---

# Hosting

The SSG build output (`ssg/build/`) is a plain static HTML/CSS/JS folder — deployable anywhere that serves flat files.

## GitHub Pages

Free for public repos. Push the `build/` folder to `gh-pages` branch or use GitHub Actions to deploy automatically.

| Pro                                                  | Con                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| Free, fast CDN, custom domain support                | No server-side logic; HTTPS can be fiddly with custom domains |
| Tight GitHub integration (Actions, deploy from repo) | Build step required per deploy                                |

## Cloudflare Pages

> [!tip] 
> **Free tier**: Unlimited bandwidth, unlimited requests, 500 builds/month, 1 build concurrency

[Cloudflare's static site hosting](https://pages.cloudflare.com) with global CDN (330+ cities). Supports Hugo natively — connect your Git repo and it builds and deploys automatically.

| Pro                                                | Con                                             |
| -------------------------------------------------- | ----------------------------------------------- |
| Generous free tier, global CDN, HTTP/3, Brotli     | Builds can be slow on free tier (1 concurrency) |
| Automatic HTTPS, custom domains, DDoS protection   | Tied to Cloudflare ecosystem                    |
| Direct upload (drag-and-drop via CLI or dashboard) | <br />                                          |

## Netlify Drop

[app.netlify.com/drop](https://app.netlify.com/drop) — drag your `build/` folder onto the browser and get a live URL in seconds. No Git repo, no CLI, no config.

| Pro                                     | Con                                                            |
| --------------------------------------- | -------------------------------------------------------------- |
| Fastest deploy: drag, drop, done        | No build step on their side — your folder must be pre-compiled |
| Free SSL, CDN, form handling, redirects | Tie to Netlify for updates (re-drag for each change)           |
| Instant rollback, branch deploys        | <br />                                                         |

Best for demos, one-off deployments, or when you want zero setup.

## Static.app

[static.app](https://static.app) — drag-and-drop a ZIP archive or folder to go live instantly. Free SSL, built-in code editor, form data collection, and privacy-friendly analytics.

| Pro                                               | Con                                     |
| ------------------------------------------------- | --------------------------------------- |
| Free tier (1 site, 50 MB storage, SSL, subdomain) | Free plan is limited to 1 site          |
| One-click deploy (drag ZIP, no CLI or Git needed) | Static host only — no server-side logic |
| Built-in editor, forms, analytics, media storage  | 50 MB max per file on free plan         |
| Paid plans from $6/mo (custom domains, API, MCP)  | <br />                                  |

Best for quick sites, landing pages, and when you want a built-in toolchain (editor, forms, analytics) out of the box.

## Firebase Hosting

Google's static + dynamic hosting. Integrates with Firebase Functions for server-side logic.

| Pro                                             | Con                                       |
| ----------------------------------------------- | ----------------------------------------- |
| Free tier (10 GB storage, 360 MB/day bandwidth) | Free tier bandwidth is low for production |
| One-command deploy via Firebase CLI             | Requires Google account and project setup |
| Cloud Functions integration for APIs            | Heavier tooling than alternatives         |

## Linode (Akamai)

Cloud VMs — not static hosting. You manage the server (nginx, Apache, etc.) to serve the `build/` folder.

| Pro                                                    | Con                                        |
| ------------------------------------------------------ | ------------------------------------------ |
| Full control over the stack (server, headers, caching) | Requires sysadmin knowledge                |
| Cheap entry ($5-10/month for a basic VM)               | You handle SSL, updates, uptime monitoring |
| Can host multiple sites on one box                     | Overkill for a static site alone           |

## Lightsail

AWS's simplified VPS. Same concept as Linode — a VM you configure to serve static files.

| Pro                                           | Con                                     |
| --------------------------------------------- | --------------------------------------- |
| Predictable pricing ($3.50-10/month)          | More complex than serverless hosting    |
| Integrated with AWS ecosystem (RDS, S3, etc.) | You still manage the web server and SSL |
| Fixed monthly cost, no surprise bills         | Overkill for static files only          |

## Quick Comparison

| Service          | Type               | Free Tier          | Best For                     |
| ---------------- | ------------------ | ------------------ | ---------------------------- |
| GitHub Pages     | Static hosting     | Yes (public repos) | Open-source projects, docs   |
| Cloudflare Pages | Static hosting     | Yes (generous)     | Most static sites            |
| Netlify Drop     | Static hosting     | Yes                | Quick demos, one-off deploys |
| Static.app       | Static hosting     | Yes (1 site, 50MB) | Quick sites, landing pages   |
| Firebase Hosting | Static + Functions | Yes (limited)      | Apps needing backend logic   |
| Linode           | VPS                | No ($5+/mo)        | Full server control          |
| Lightsail        | VPS                | No ($3.50+/mo)     | AWS integration              |
