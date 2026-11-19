# Give a User their own MCP server or voice agent

⏱ 15 min per request · For: the Admin · Needs: `kubectl` and Flux access to the cluster, the
1Password vault the charts read, the [LiveKit CLI](https://docs.livekit.io/reference/developer-tools/livekit-cli/) (`lk`)

**Do this first:** check the request comes from the User themselves. Each MCP server and each
voice agent serves **exactly one User** and acts only as them. Nothing here is created
automatically: you deploy one when a User asks
([ADR 0018](../adr/0018-multi-user-row-level-isolation.md#decision-mcp-pods-and-voice-workers-are-deployed-by-the-admin-on-request)).

Being Admin gives you no access to the User's data, and nothing below changes that. The MCP
server holds the User's own API token. The voice agent holds no Tuk Tuk credential at all.

In the commands below, `<user>` is a short name for the User: lowercase letters, digits and
dashes, for example `bea`. It ends up in Kubernetes names and the tailnet hostname.

## MCP server for a User

The first MCP server is [`mcp/chart`](../../mcp/chart/README.md) itself, named `mcp`. It also
owns the image automation, so keep it deployed. Every further User gets a copy of the same chart
with `-<user>` added to every name.

### What the User does

1. In Tuk Tuk, open **Settings → My account → API tokens** and create a token, named for example `MCP server`.
   It is shown once.
2. Send it to you the way you share passwords (a 1Password share link, for example). Never by
   chat or email.

### What you do

1. **Create the 1Password item** `tuk-tuk-mcp-<user>` in the vault `TUK_TUK_1PASSWORD_VAULT_ID`
   points at, with two fields:

   | Field              | Value                                                                    |
   | ------------------ | ------------------------------------------------------------------------ |
   | `TUK_API_TOKEN`    | The User's API token (`tuk_pat_...`)                                     |
   | `MCP_BEARER_TOKEN` | A new value from `openssl rand -hex 32`. Never reuse another server's.   |

2. **Add a Flux `Kustomization`** in your cluster-config repo. Copy the one that deploys
   `mcp/chart` (same `sourceRef`, `path` and `postBuild`), rename it `mcp-<user>`, and add
   `nameSuffix` and `patches`:

   ```yaml
   apiVersion: kustomize.toolkit.fluxcd.io/v1
   kind: Kustomization
   metadata:
     name: mcp-<user>
     namespace: flux-system
   spec:
     # ...sourceRef, path: ./mcp/chart, interval, prune and postBuild as in the mcp one...
     nameSuffix: -<user>
     patches:
       # The shared chart's `mcp` already runs the image automation.
       - target: { kind: ImageRepository }
         patch: |
           $patch: delete
           apiVersion: image.toolkit.fluxcd.io/v1
           kind: ImageRepository
           metadata:
             name: mcp
       - target: { kind: ImagePolicy }
         patch: |
           $patch: delete
           apiVersion: image.toolkit.fluxcd.io/v1
           kind: ImagePolicy
           metadata:
             name: mcp
       # Its own pod label, so the `mcp` Service never routes to this User's pod.
       - target: { kind: Deployment }
         patch: |
           - op: replace
             path: /spec/selector/matchLabels/app
             value: mcp-<user>
           - op: replace
             path: /spec/template/metadata/labels/app
             value: mcp-<user>
           - op: replace
             path: /spec/template/spec/containers/0/envFrom/1/secretRef/name
             value: tuk-tuk-mcp-<user>
       - target: { kind: Service }
         patch: |
           - op: replace
             path: /spec/selector/app
             value: mcp-<user>
       - target: { kind: OnePasswordItem }
         patch: |
           - op: replace
             path: /spec/itemPath
             value: vaults/${TUK_TUK_1PASSWORD_VAULT_ID}/items/tuk-tuk-mcp-<user>
       - target: { kind: Ingress }
         patch: |
           - op: replace
             path: /spec/tls/0/hosts/0
             value: tuk-tuk-mcp-<user>
   ```

   `nameSuffix` renames the Deployment, Service, ConfigMap, Ingress and 1Password item, and
   updates the references between them. The patches cover what it can't: the pod label, the
   Secret the 1Password operator creates, the item path and the tailnet hostname.

   To preview without Flux, put the same `nameSuffix` and `patches` in a `kustomization.yaml`
   next to your checkout, with `resources: [../tuk-tuk/mcp/chart]`, and run
   `kubectl kustomize` on that folder. Check that every name ends in `-<user>` and that no
   `ImageRepository` or `ImagePolicy` is left.

3. **Check it runs:**

   ```sh
   kubectl -n tuk-tuk rollout status deploy/mcp-<user>
   kubectl -n tuk-tuk logs deploy/mcp-<user>     # no token values
   ```

   From a tailnet device, `tools/list` with the new bearer token lists 14 tools:

   ```sh
   curl -s -X POST https://tuk-tuk-mcp-<user>.<tailnet>.ts.net/mcp \
     -H "Authorization: Bearer $MCP_BEARER_TOKEN" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```

   Don't call a data tool yourself: it would show you the User's tasks.

4. **Hand over** the URL `https://tuk-tuk-mcp-<user>.<tailnet>.ts.net/mcp` and the bearer token
   (again by 1Password share). The User registers it as in
   [Register a tailnet client](../../mcp/oci/README.md#register-a-tailnet-client). Their device
   must be on the tailnet.

### Later

- **New API token** (the User revoked or replaced it): update `TUK_API_TOKEN` in the item. The
  operator updates the Secret, but the pod reads it only at start:
  `kubectl -n tuk-tuk rollout restart deploy/mcp-<user>`.
- **New bearer token:** same steps with `MCP_BEARER_TOKEN`, then give the User the new value.
- **Changing the User's password** does not affect the server. Disabling the User stops it at
  once: every call answers that the account is disabled.
- **Remove it:** delete the `mcp-<user>` Flux Kustomization (with `prune: true`, Flux deletes
  everything it created), then the 1Password item. Ask the User to revoke the API token in
  **Settings → My account → API tokens**. That alone already cuts the server off.

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

→ [Security](security.md#remote-mcp-server) · [Set up the Voice Assistant](voice.md)
