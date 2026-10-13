# Powerline style configuration

Edit `~/.pi/agent/powerline-style.json`, then run `/reload` in Pi.
Optional project overrides: `<project>/.pi/powerline-style.json`.
Only the keys you override are needed in a project file.

- `colors`: six-digit hex colors for border, model, thinking, folder, branch, context, tokens, status, session, pr, prDraft, prMerged, prStale, ciPass, ciFail, ciPending, ciUnknown. Context warning/error colors still follow the Pi theme at 70%/90%; PR status colors use these shared settings for GitHub and Forgejo.
- `icons`: model, folder, branch, context, cache, mcp, session, pr. Set an icon to an empty string to hide it. JSON Unicode escapes are supported.
- `show`: breadcrumbFolder, thinking, folder, branch, context, tokens, session, pr, prDetails.
- `hiddenStatuses`: case-insensitive fragments of extension status keys or prefixes of status text. An empty list shows LSP again.
- `separator`: separator between footer groups.
- `sessionPlacement`: `editor` puts the session name on the input top border at the right; `footer` keeps it in the bottom status row. Long names are shortened without adding rows.

Existing Powerline switches (footer, footer-mcp, header, breadcrumb, etc.) remain in settings.json. Footer group order and historical message padding are not configured by this file. Working rendering is unchanged.
Invalid values fall back to defaults; malformed files are ignored.

PR connection settings stay in `~/.pi/agent/extensions/pull-request.json`; presentation belongs here. `show.pr` hides PR status, and `icons.pr` applies to both providers. Links remain clickable. Refresh uses Git/Pi events and `/pr-refresh`; remote CI changes alone do not trigger polling. Network errors retain the last scoped state with `stale` and retry with exponential backoff (2 seconds to 60 seconds), stopping after recovery.

Set `show.prDetails` to `false` to show only the PR icon and linked `#number`, without PR/draft/CI/state text. A cached stale number uses `colors.prStale` until refresh succeeds; retry and provider behavior are unchanged.
