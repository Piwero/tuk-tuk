# GitHub

⏱ 4 min read · Set up: Settings → GitHub

**Do this first:** create a fine-grained token on GitHub and paste it into
**Settings → GitHub**.

## What it's for

See open pull requests and issues from your repositories and your
organisations' repositories in one place. Tuk Tuk only **reads** GitHub. It
never comments, labels, merges or closes anything.

## Add a GitHub Token

Tuk Tuk uses GitHub's **fine-grained personal access tokens**. Each token
reads one owner: your own account or one organisation.

1. On GitHub, open **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens** and choose **Generate new token**.
2. Pick the **Resource owner**: yourself or an organisation.
3. Choose the repositories the token may read.
4. Under **Repository permissions**, set **Metadata**, **Issues** and
   **Pull requests** to **Read-only**. Leave everything else at
   **No access**.
5. Copy the token. It starts with `github_pat_`.
6. In Tuk Tuk, open **Settings → GitHub**, paste it into **GitHub Token**
   and choose **Add token**.

Tuk Tuk checks the token with GitHub before saving it. The token then
appears under the owner it reads, with its expiry date.

Add one token for your own repositories and one per organisation. You can
only have one token per owner.

## Pick Watched Repositories

Once you have a token, **Settings → GitHub** lists every repository your
tokens can read under **Watched Repositories**.

1. Type part of a repository's `owner/name` into **Search repositories** to
   narrow the list.
2. Tick a repository to watch it. Untick it to stop watching.

A repository that two of your tokens can read is listed once. Tuk Tuk reads
it through the token you picked it with.

## See your open pull requests

Choose **GitHub** in the sidebar. The **Pull Requests** tab lists the open
pull requests of every Watched Repository, in three groups:

1. **Review requested**: someone asked you to review it. This group comes
   first even if you wrote the pull request yourself.
2. **Mine**: you wrote it.
3. **Others**: everything else that is open.

Within each group, the most recently updated come first.

Each row shows the title, `owner/repo#number`, the author, how long ago it
was updated and its labels. It also shows a **Draft** badge for drafts, the
review decision (**Approved**, **Changes requested** or **Review pending**)
and the CI status (**CI passing**, **CI failing** or **CI pending**). A
repository without CI checks shows no CI status. Select a title to open the
pull request on GitHub.

Each repository shows at most 100 open pull requests: the most recently
updated ones. A repository with more gets an **N more on GitHub** link to the
rest.

If you aren't watching any repositories yet, the view links you to
**Settings → GitHub** to pick some.

## Good to know

- **The GitHub view reads GitHub each time you open it.** Nothing about your
  pull requests is stored in Tuk Tuk.
- **"Mine" means you wrote it**, as the GitHub account that created the
  token. This also applies to an organisation's token.
- **A review requested from one of your teams** doesn't count as
  **Review requested**. Only a request to you in person does.

- **Classic tokens are refused.** They can't be limited to read-only access.
- **An organisation may need to approve your token** before its repositories
  can be read. If GitHub lists no repositories for a token, Settings says so.
  Check the organisation's settings on GitHub to allow or approve
  fine-grained tokens.
- **Removing a token stops watching its repositories.** Any of them that
  another of your tokens can still read are listed again, ready to tick.
- **If GitHub can't be reached for one token,** Settings says so and still
  lists the other tokens' repositories.
- **If GitHub can't be reached** while you add a token, nothing is saved.
  Try again in a moment.
- **Remove a token** with **Remove** next to it. Tuk Tuk loses access to that
  owner straight away.
- Your tokens are stored encrypted and are never shown again, not even to
  you. Other people on your Tuk Tuk can't see them.
