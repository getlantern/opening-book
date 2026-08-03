# spark-site

The public site for **Spark** — a from-scratch, multi-protocol VPN tunnel in Rust.

**https://spark.lantern.io**

## What's here

A static site: no build step, no framework. Six pages sharing one stylesheet.

| Page | |
|---|---|
| `index.html` | The Spark landing page — the problem, the discovery loop, the data path, the nine transports, the privacy posture, the platforms, and a status list |
| `book.html` | **Opening Book** — why a censor's verdict lands in the opening of a flow, and what follows from treating a handshake as a repertoire |
| `architecture.html` | **The spine** — the six stages between a raw IP packet and a shaped handshake |
| `dns.html` | **Five kinds of DNS** — the five separate roles DNS plays inside the client |
| `ipc.html` | **The control plane** — what crosses the privilege boundary, and what never does |
| `modules.html` | **Write a module** — the WebAssembly guest ABI, for contributors |

## Editing

Every page is written against a shared class contract (`.spread` / `.rail` / `.body` / `.rise` /
`.subnav` / `table.abi` / `.note`) defined in `assets/site.css`. Re-theming the site means editing
that one file; no page needs to be touched. Keep it that way.

Three typefaces, each with one job: **Bricolage Grotesque** for display and UI, **Fraunces** for
long-form chapter prose only, **JetBrains Mono** for anything mechanical. Colour carries meaning
rather than decoration — ember for accent, teal for *built*, violet reserved for the adaptive
thread, dim for *planned*.

Three conventions that are easy to break by accident:

- **No inline `<script>`.** The CSP in `_headers` sets `script-src 'self'` with no
  `'unsafe-inline'`, which is why page behaviour lives in `assets/site.js`. Adding an inline script
  silently disables it in production.
- **Status chips are not optional.** Spark is under active development. Every capability claim
  carries `built` / `in progress` / `planned`, so a reader can tell what runs today from what is
  merely designed. Describing unbuilt work in the present tense is the one thing this site must not
  do.
- **Size anything repeated in `em`, against a single `clamp()`.** A row of fixed-width cells sets
  the min-content width of its whole column and will quietly push the page wider than a 320px
  phone, where `overflow-x: hidden` then crops it with no scrollbar to reveal the damage. This has
  been the cause of every layout bug the site has had.

## Deploying

```sh
./deploy.sh          # builds dist/ and publishes to Cloudflare Pages
```

`build.sh` assembles `dist/` from an **explicit file list**, so nothing in the repo is uploaded by
accident — and so any new top-level file has to be added there or it silently never ships. It fails
the build if a page references an asset that did not make it in.

`deploy.sh` pins the Cloudflare account, because this login can see more than one and a
non-interactive deploy cannot choose between them.

## On the name

This repo was `opening-book` until the site grew from a single essay into the whole Spark site.
GitHub redirects the old path. Opening Book itself lives on, at `/book`.
