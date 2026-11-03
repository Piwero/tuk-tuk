# Terminal app (`tuk`)

⏱ 2 min read · For people comfortable in a terminal

**Do this first:** skip this page if you don't use a terminal. You don't need it.

## What it's for

Add and complete tasks, check today's agenda and tick habits without opening
a browser.

## Install (5 min)

Needs [uv](https://docs.astral.sh/uv/getting-started/installation/) and the
`tuk-tuk` folder you cloned during [Getting started](../getting-started.md).

1. From the `tuk-tuk` folder:
   ```sh
   uv tool install --from ./cli/oci tuk
   ```
2. Log in once with your app password:
   ```sh
   tuk login --base-url http://localhost:8080
   ```

## Everyday commands

| Command | Does |
| --- | --- |
| `tuk agenda` | Today's tasks, habits and calendar events |
| `tuk ls` | Today's tasks (`--week`, `--all`, `--search passport`) |
| `tuk done 12` | Complete task 12 |
| `tuk habits check 3` | Check in habit 3 for today |
| `tuk edit 12 --due tomorrow` | Reschedule |

Full reference: [`cli/oci/README.md`](../../../cli/oci/README.md).

## Good to know

- `tuk` uses flags (`--tag home`), not Quick-Add symbols (`#home`).
- It never creates a list or tag by accident. A typo gives an error.
- Add `--json` to any command to use its output in scripts.

## Next

→ [Glossary](../glossary.md)
