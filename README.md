# Opening Book

> Censorship decides in the first five packets. So we made the opening the whole game.

**Opening Book** is an approach to internet censorship circumvention built on one fact: a modern
censor classifies each connection from the opening of the flow — the TLS ClientHello, the server
name, the JA3/JA4 fingerprint, the sizes and timing of the first few packets — then applies a policy
and largely stops looking.

So the leverage is entirely in the opening. Opening Book is an **evolving, portable repertoire of
opening moves** ("gambits"): shape the ClientHello, its record framing, and its segment/timing —
anchored at a genuine Chrome handshake, expressed as a signed parameter set that runs on two engines
(BoringSSL in Rust, uTLS in Go), and **discovered** against the live network with a server-side
fitness signal.

**The site** (a deep-dive into the approach): https://getlantern.github.io/opening-book/

This is a research direction from the team behind [Lantern](https://lantern.io), not a product spec.
Specific live strategies are deliberately omitted — the repertoire is meant to be polymorphic and
ever-changing; this describes the *approach*, not the moves currently on the board.

---

The site is a single self-contained `index.html` (no build step), served by GitHub Pages.
