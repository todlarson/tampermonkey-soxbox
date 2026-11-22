# tampermonkey-soxbox

Tampermonkey userscripts for Sox Box (FoodBank Manager) at https://dsfp.soxbox.co/.

> **Team members:** install from **https://todlarson.github.io/tampermonkey-soxbox/**.
> This README is for maintaining the scripts.

Scripts add their pages under **Reports › 🐵 TamperMonkey »**. That submenu is shared:
a script finds `#tm-reports-menu` and appends its item, creating the submenu only if it's missing.

## Scripts

| Script | What it does |
|---|---|
| [`birthday-box.user.js`](birthday-box.user.js) | **Birthday Box**: children in each household with a birthday in the next N weeks. Replaces the Google Sites Birthday Box (upload "Guest Data" CSV) by pulling the Guest Data export directly from Sox Box. |
| [`team-zip-codes.user.js`](team-zip-codes.user.js) | **Team Zip Codes**: pie chart of how many team members live in each zip code, from the Team Export report. |

## Install page

[`docs/index.html`](docs/index.html) is the team-facing install page, published with GitHub Pages
(main branch, `/docs` folder) at https://todlarson.github.io/tampermonkey-soxbox/. It holds the
one-time browser setup, an Install button per script, and troubleshooting. Pushing to `main`
republishes it.

Install buttons link to each script's raw URL
(`https://raw.githubusercontent.com/todlarson/tampermonkey-soxbox/main/<name>.user.js`).
Tampermonkey checks that same URL for updates (`@updateURL` / `@downloadURL`) and installs new
versions automatically, as long as `@version` goes up.

## Contributing

This repo doesn't accept pull requests or issues; they're turned off. Changes are committed
directly to `main` by the maintainer. Bump `@version` on every change, or Tampermonkey won't
pick up the update.

## Birthday Box

- Open: Reports › TamperMonkey › Birthday Box (`/reports/guests/guests/#birthday-box`).
- Inputs: weeks ahead (default 3), earliest birth year (default current year − 12).
- Same rules as the original: skips guests *Blocked from Receiving Help*, lists
  "Guest Name (Relationship - age)" grouped by date, youngest first.
- Additions: child's name and "turning N", link to the guest profile, Print button,
  dates ordered correctly across New Year.

## Team Zip Codes

- Open: Reports › TamperMonkey › Team Zip Codes (`/reports/team/team-export/#team-zip-codes`).
  The report runs as soon as the page opens.
- Pie chart: the 7 largest zip codes each get a slice; all others fold into a gray "Other" slice.
  Hover a slice or legend row for its count and share.
- "All zip codes" lists every zip, ranked, with a bar for exact comparison.
- Zips are cleaned up before counting: ZIP+4 is cut to 5 digits, a 4-digit zip gets its dropped
  leading zero back, anything else counts as "(invalid zip)" or "(no zip)".
- **Exclude zip code** (default None): pick a zip from the dropdown, which lists every zip with
  its count, most team members first, then click **Re-run Report** to rebuild the chart without it.
- Every team member in Team Export is counted; the "Banned from Volunteering" flag is ignored.

## Privacy

Sox Box holds guest data. None of it may end up in this repo. Full rules are in [CLAUDE.md](CLAUDE.md).

- Scripts handle guest data in memory only: nothing is downloaded, logged, stored, or sent elsewhere.
- Never commit exports, saved pages, network captures or screenshots. `.gitignore` blocks the common types.
- `scripts/check-private-data.sh` blocks emails, phone numbers, IPs, tokens/keys and data files.
  It runs on every push in GitHub Actions (with a gitleaks secret scan). After cloning, enable it locally:

  ```powershell
  git config core.hooksPath .githooks
  ```
