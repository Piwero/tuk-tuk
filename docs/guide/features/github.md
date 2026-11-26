# GitHub

⏱ 6 min read · Set up: Settings → GitHub

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

## See your open GitHub issues

In the GitHub view, choose the **Issues** tab. It lists the open GitHub
issues of every Watched Repository, most recently updated first. Pull
requests never appear here, even though GitHub itself counts them as issues.
Choose **Pull Requests** to switch back.

Each row shows the title, `owner/repo#number`, the author, who it is
assigned to, how long ago it was updated, how many comments it has and its
labels. Select a title to open the GitHub issue on GitHub.

Each repository shows at most 100 open GitHub issues: the most recently
updated ones. A repository with more gets an **N more on GitHub** link to the
rest.

## Narrow the list

Above each tab's list, pick what to show:

- **Author**: only items written by one person.
- **Label**: only items carrying one label.
- **Assignee** (Issues tab only): only GitHub issues assigned to one person.
  Pick yourself and a label such as `ready-for-agent` to see what is waiting
  on you.
- **Hide drafts** (Pull Requests tab only): leave out draft pull requests.
- **Hide bots**: leave out items written by bots such as dependabot.

Each menu offers only the authors, labels and assignees in what you are
looking at. Your choices apply to both tabs. Narrowing happens in your
browser, so it is instant and never asks GitHub again.

On the Pull Requests tab the groups keep their order, and each heading shows
how many pull requests it still lists. A group your choices empty stays,
saying that nothing there matches.

Your choices are not saved. Leave the GitHub view and come back, and it shows
everything again. To keep them, use a Repository View.

## Save Repository Views

A **Repository View** shows some of your Watched Repositories, for example
"Work repos" or "Side projects". Your Repository Views are listed under
**GitHub** in the sidebar. The **GitHub** entry itself always shows every
Watched Repository.

To make one:

1. Under **GitHub** in the sidebar, choose **New view**.
2. Type a **View name** and choose **Create**. The new view opens.
3. Choose **Choose repositories**, tick the repositories it should show, and
   choose **Save**.

A Repository View remembers what you pick above its lists (author, label,
assignee, **Hide drafts**, **Hide bots**) and which tab you were on. Open it
again and it is exactly as you left it. **Reset** clears all of that.

Choose **Edit view** to rename it, change its repositories, **Move up** or
**Move down** the sidebar, or **Delete view**. Deleting a view doesn't stop
watching its repositories.

If you stop watching a repository, or remove its token, it leaves every
Repository View too. A view left with no repositories stays in the sidebar.
It offers **Choose repositories** and a link to Settings, where you can watch
more.

Other people on your Tuk Tuk can't see your Repository Views.

## Keep your tokens working

Fine-grained tokens expire, and you can revoke them on GitHub at any time.
Tuk Tuk tells you when a token needs attention.

- **Expiry:** **Settings → GitHub** shows each token's expiry date, or
  **No expiry**. From 7 days before a token expires, a banner in Settings
  and in the GitHub view names it and its expiry date.
- **Rejected token:** if GitHub stops accepting a token, for example
  because it expired or you revoked it, both tabs of the GitHub view show a
  banner naming that token's owner. The other tokens' repositories still
  show.
  Settings marks the token as needing reconnection.
- **GitHub unreachable:** if GitHub can't be reached for one token, the
  GitHub view says so for that token and shows the rest. This never marks
  the token as needing reconnection. Try again in a moment.

To reconnect a token:

1. Create a new fine-grained token on GitHub for the **same** owner, with
   the same read-only permissions.
2. In **Settings → GitHub**, choose **Reconnect** next to the token.
3. Paste the new token into **Replacement token** and choose **Reconnect**.

Tuk Tuk checks the new token with GitHub first. A token for a different
owner is refused: add that one as a new token instead. Your Watched
Repositories stay as they were.

You can use **Reconnect** at any time, for example to swap in a new token
before the old one expires.

## Good to know

- **The GitHub view reads GitHub each time you open it.** Nothing about your
  pull requests or GitHub issues is stored in Tuk Tuk.
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
