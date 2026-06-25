# Webdav for TCloud

Mount your self-hosted [TCloud](https://github.com/denilson-polonio/tcloud) as a real
network drive on Windows, macOS, Linux, or your phone. Browse, open, copy, and save
files straight from your file manager — no separate desktop client.

This repository contains two pieces that work together:

1. **The extension** (`index.js`) — a sidebar page inside TCloud that explains the setup
   and gives you ready-to-copy commands for your operating system.
2. **The bridge** (`bridge/tcloud-webdav-bridge.js`) — a tiny, dependency-free Node.js
   program **you run yourself** (your Raspberry Pi is ideal). It speaks WebDAV to your OS
   and talks to TCloud's REST API on your behalf.

---

## How it works

A browser extension cannot open a network share: browsers can't listen on a socket and
there is no server-side code in an extension. So the drive is served by a small local
bridge instead. Your file manager talks WebDAV to the bridge; the bridge translates that
into ordinary TCloud REST calls.

```
┌──────────────────┐      WebDAV / HTTP      ┌────────────────────┐      REST / HTTP     ┌──────────────┐
│  OS file manager │  ────────────────────▶  │  tcloud-webdav-    │  ─────────────────▶  │    TCloud    │
│  (Explorer /     │                          │  bridge.js          │                      │   server     │
│   Finder /       │  ◀────────────────────  │  (runs on your Pi)  │  ◀─────────────────  │  (your data) │
│   davfs / rclone)│       files, folders     └────────────────────┘     JSON, streams    └──────────────┘
└──────────────────┘
```

The bridge holds your TCloud credentials and sees your **decrypted** files, so by default
it binds to `127.0.0.1` and is protected by HTTP Basic auth. Keep it on a machine and
network you trust.

---

## Why WebDAV and not SMB (Samba)?

SMB would require the full Samba protocol stack, a privileged port (445), and credential
handling that differs on every operating system. WebDAV is just HTTP: it maps cleanly onto
TCloud's existing file API, needs no privileged port, and Windows, macOS, Linux and mobile
file managers can all mount it out of the box.

---

## Repository layout

```
extension.json                   Extension manifest (id, version, entry)
index.js                         The extension itself (sidebar page + mount helper)
i18n/
  en.json                        English strings (primary)
  it.json                        Italian strings (extra)
bridge/
  tcloud-webdav-bridge.js        The WebDAV ↔ TCloud bridge (run this yourself)
LICENSE                          MIT
README.md                        This file
```

---

## 1 · Install the extension

Install it in TCloud the same way as any other community extension: point TCloud at this
repository (`denilson-polonio/tcloud-webdav-extension`). A **Network Drive** entry then appears
in the sidebar. Open it for live, copy-ready commands tailored to your host and port.

---

## 2 · Run the bridge

The bridge needs **Node.js 18 or newer** and **no external packages** (it uses only Node's
built-in `http`, `https`, `url`, and `crypto` modules).

Download `bridge/tcloud-webdav-bridge.js` (the extension page has a one-click download
button), copy it to the machine that should host the drive, and start it:

```bash
TCLOUD_URL="https://your-tcloud.example" \
TCLOUD_USER="your-username" TCLOUD_PASS="your-password" \
BRIDGE_USER="tcloud" BRIDGE_PASS="choose-a-strong-password" \
BRIDGE_HOST="127.0.0.1" BRIDGE_PORT="4819" \
node tcloud-webdav-bridge.js
```

On start it logs in to TCloud once and then listens for WebDAV connections.

### Environment variables

| Variable          | Required | Default                         | Purpose |
|-------------------|----------|---------------------------------|---------|
| `TCLOUD_URL`      | yes      | —                               | Base URL of your TCloud server (no trailing slash). |
| `TCLOUD_USER`     | yes\*    | —                               | TCloud username the bridge logs in with. |
| `TCLOUD_PASS`     | yes\*    | —                               | TCloud password for that user. |
| `TCLOUD_TOKEN`    | no       | —                               | A TCloud session token, if you prefer it over username/password. Sent as the `x-auth-token` header. |
| `BRIDGE_HOST`     | no       | `127.0.0.1`                     | Address the bridge binds to. Use `0.0.0.0` only on a trusted LAN. |
| `BRIDGE_PORT`     | no       | `4819`                          | Port the bridge listens on. |
| `BRIDGE_USER`     | no       | `TCLOUD_USER` or `tcloud`       | Username your OS uses to mount the drive. |
| `BRIDGE_PASS`     | no       | `TCLOUD_PASS`                   | Password your OS uses to mount the drive. |

\* Provide either `TCLOUD_USER` + `TCLOUD_PASS`, or `TCLOUD_TOKEN`.

The bridge logs in with `remember: true` so its session is long-lived, and it re-authenticates
automatically if the session ever expires. **Two-factor accounts:** the bridge cannot complete a
2FA challenge on its own. If the account has 2FA enabled, either use a dedicated account without
2FA for the bridge, or set `TCLOUD_TOKEN` to a session token copied from the TCloud web app (in
your browser's storage, the value TCloud sends as `x-auth-token`).

### Keep it running

On the Pi, run it under whatever you already use — a `systemd` service, `pm2`, or a
`screen`/`tmux` session — so it survives reboots.

---

## 3 · Mount the drive

Replace `HOST` and `PORT` with your bridge's address (defaults `127.0.0.1` and `4819`).
Log in with `BRIDGE_USER` / `BRIDGE_PASS`.

**Windows** (Command Prompt):

```bat
net use * "\\HOST@PORT\DavWWWRoot" /user:tcloud *
```

**macOS** — Finder → Go → Connect to Server (⌘K):

```
http://HOST:PORT/
```

**Linux** (davfs2):

```bash
sudo mount -t davfs http://HOST:PORT/ /mnt/tcloud
```

**rclone** (any OS):

```bash
rclone config create tcloud webdav url=http://HOST:PORT/ vendor=other user=tcloud
rclone mount tcloud: /mnt/tcloud --vfs-cache-mode writes
```

### Windows: allow Basic auth over HTTP (one-time)

Windows refuses Basic authentication over plain HTTP by default, so the mount fails until
you raise `BasicAuthLevel`. As Administrator:

```bat
reg add HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters /v BasicAuthLevel /t REG_DWORD /d 2 /f
net stop WebClient && net start WebClient
```

This is only needed if the bridge is reached over HTTP. If you put the bridge behind HTTPS
(for example via a reverse proxy), you can skip it.

---

## How the bridge talks to TCloud

The bridge's TCloud adapter is written and verified against **TCloud 3.2.1**'s REST API. You
don't need to configure anything here — it's documented so you can follow what happens and
adapt it if a future TCloud version changes the API. Authentication uses a session token
(obtained from `POST /api/auth/login`) sent on every request as the `x-auth-token` header.

| Action          | Method & path                        | Request                                              | Response |
|-----------------|--------------------------------------|------------------------------------------------------|----------|
| Login           | `POST /api/auth/login`               | `{ "username", "password", "remember": true }`       | `{ "token", "user" }` (or `{ "twoFactor": true }`). |
| List folder     | `GET /api/list?folder=ID`            | omit `folder` for the root                           | `{ "folders": [{ "id", "name", "created_at" }], "files": [{ "id", "name", "size", "mime", "created_at" }] }` |
| Download file   | `GET /api/download/ID`               | honours the `Range` header                           | File bytes (streamed, supports `206`). |
| Upload file     | `POST /api/upload`                   | `multipart/form-data`: field `files` + field `folder`| `{ "files": [...] }` |
| Create folder   | `POST /api/folders`                  | `{ "name", "parent" }` (omit `parent` for root)      | `{ "id", "name", ... }` |
| Delete file     | `DELETE /api/files/ID`               | —                                                    | `{ "ok": true }` |
| Delete folder   | `DELETE /api/folders/ID`             | —                                                    | `{ "ok": true }` |
| Move / rename file   | `PATCH /api/files/ID`           | `{ "name", "folder" }` (`folder: null` = root)       | updated file |
| Move / rename folder | `PATCH /api/folders/ID`         | `{ "name", "parent" }` (`parent: null` = root)       | updated folder |

The drive root maps to TCloud's top level (items with no parent folder); the bridge requests it
by omitting the `folder` parameter. File timestamps come from `created_at`.

### Mapped vs. partial WebDAV verbs

`PROPFIND`, `GET`, `HEAD`, `PUT`, `DELETE`, `MKCOL`, `MOVE`, and `OPTIONS` are fully wired.
`GET` forwards byte-range requests so media scrubbing and large-file reads work. `PUT` overwrites
an existing file in place (it uploads the new copy, then removes the old one, so editors that save
repeatedly don't pile up duplicates). `COPY` works for single files (server-side folder copy
returns `501`). `LOCK`/`UNLOCK` are acknowledged with a stub token so Office and Finder stay happy;
the bridge does not enforce real locks.

---

## Security

- The bridge can see your **decrypted** files. Treat it like a key to your storage.
- It binds to `127.0.0.1` by default. Only switch `BRIDGE_HOST` to `0.0.0.0` on a network
  you trust, and always set a strong `BRIDGE_PASS`.
- For access beyond your LAN, put the bridge behind a reverse proxy with HTTPS rather than
  exposing the port directly.
- `BRIDGE_USER`/`BRIDGE_PASS` are checked with a constant-time comparison.

---

## Publishing & auto-updates

This extension auto-updates through GitHub Releases. To ship a new version:

1. Bump `"version"` in `extension.json`.
2. Commit and push to the branch TCloud tracks.
3. Create a GitHub Release whose tag matches that version (for example `v1.0.1`).

TCloud loads `index.js` and the `i18n/*.json` files from the repo at the tracked ref, and
the extension page pulls `bridge/tcloud-webdav-bridge.js` from the same ref for its download
button — so keep the bridge file in the repo alongside each release.

---

## Internationalization

UI strings live in `i18n/`, keyed by their English text. English (`en.json`) is the primary
language and Italian (`it.json`) is included as an extra; both files must contain the exact
same set of keys. To add a language, copy `en.json` to `i18n/<lang>.json` and translate the
values, leaving the keys unchanged.

---

## License

MIT — see [LICENSE](LICENSE).
