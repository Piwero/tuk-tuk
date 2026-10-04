# tuk CLI

Terminal client for tuk-tuk. Logs in once with the account password, caches
the signed session cookie, and reads Tasks.

## Install

```bash
uv tool install --from ./cli/oci tuk
```

Nothing is published to a package index — install from this repository.

## Use

```bash
tuk login --base-url http://localhost:8900
tuk show 12
tuk show --json 12
```

Config (`config.json`) and session (`session.json`, owner-only) live under
the XDG config directory (`~/.config/tuk/`); `TUK_CONFIG_DIR` overrides it.
