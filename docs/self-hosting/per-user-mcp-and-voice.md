# Give a User their own voice agent

⏱ 15 min per request · For: the Admin · Needs: the [LiveKit CLI](https://docs.livekit.io/reference/developer-tools/livekit-cli/) (`lk`)

**Do this first:** check the request comes from the User themselves. Each voice agent serves
**exactly one User** and acts only as them. Nothing here is created automatically: you deploy one
when a User asks
([ADR 0018](../adr/0018-multi-user-row-level-isolation.md#decision-mcp-pods-and-voice-workers-are-deployed-by-the-admin-on-request)).

Being Admin gives you no access to the User's data, and nothing below changes that. The voice
agent holds no Tuk Tuk credential at all.

In the commands below, `<user>` is a short name for the User: lowercase letters, digits and
dashes, for example `bea`.

## MCP server

Users no longer get their own MCP server. One shared deployment serves every User, each with
their own MCP token: see [Run one MCP server for every User](shared-mcp-server.md), which also
covers migrating from the per-user pods this page used to describe.

## Voice agent for a User

Voice uses the User's **own** LiveKit project and free allowance, so one User's talking never
spends another's minutes ([ADR 0015's amendment](../adr/0015-voice-assistant-cloud-agent-browser-relayed-writes.md#amendment-per-user-livekit-adr-0018-issue-405)).
The agent never holds a Tuk Tuk credential. Its tools run in the User's own browser tab, under
their own login, so it can only ever reach their data.

### What the User does

1. Follow [Set up the Voice Assistant](voice.md) steps 1, 2 and 4 in their own LiveKit
   account: create the project, turn observability off, and save its URL, API key and secret in
   their own **Settings → AI helpers → Voice**. Voice stays hidden for them until all three are
   saved, and other Users never see it.
2. In the LiveKit project, create a **second** API key for you (**Settings → Keys**), so they
   can revoke yours without touching theirs. Share its URL, key and secret with you by
   1Password.

### What you do

1. **Keep the key** in your vault as `tuk-tuk-voice-<user>`. You need it again after every
   upgrade.
2. **Add the project** to the LiveKit CLI and deploy the agent into it, from the `tuk-tuk`
   folder:

   ```sh
   lk project add tuktuk-<user> --url <url> --api-key <key> --api-secret <secret>
   cd voice-agent
   lk agent create --project tuktuk-<user>     # first time only
   ```

3. **Keep that User's `livekit.toml`.** `lk agent create` writes `voice-agent/livekit.toml`,
   which names one project and agent. Several Users means several files, so move it out:

   ```sh
   mkdir -p ~/.config/tuk-tuk-voice/<user>
   mv livekit.toml ~/.config/tuk-tuk-voice/<user>/livekit.toml
   ```

4. **Check it runs:** `lk agent status --project tuktuk-<user>` shows the agent. The User opens
   Assistant → Voice and asks "what's on today?". Their sessions show up in their project as
   rooms named `tuktuk-<user id>-...`.

### After every upgrade

Redeploy every User's agent, as in [After you upgrade Tuk Tuk](voice.md#after-you-upgrade-tuk-tuk):

```sh
cd voice-agent
for dir in ~/.config/tuk-tuk-voice/*/; do
  user=$(basename "$dir")
  cp "$dir/livekit.toml" livekit.toml
  lk agent deploy --project "tuktuk-$user"
done
rm livekit.toml
```

### Remove it

Run `lk agent delete --project tuktuk-<user>` with that User's `livekit.toml` in place, then
delete the folder, the `lk` project entry (`lk project remove tuktuk-<user>`) and the vault
item. Ask the User to revoke your API key. The User can also turn voice off alone by clearing
their credentials in **Settings**.

## Next

→ [Run one MCP server for every User](shared-mcp-server.md) · [Set up the Voice Assistant](voice.md)
