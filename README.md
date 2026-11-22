# tampermonkey-soxbox

Tampermonkey userscripts for Sox Box (FoodBank Manager) at https://dsfp.soxbox.co/.

Scripts add their pages under **Reports › TamperMonkey »**. That submenu is shared:
a script finds `#tm-reports-menu` and appends its item, creating the submenu only if it's missing.

## Scripts

| Script | What it does |
|---|---|
| [`birthday-box.user.js`](birthday-box.user.js) | **Birthday Box**: children in each household with a birthday in the next N weeks. Replaces the Google Sites Birthday Box (upload "Guest Data" CSV) by pulling the Guest Data export directly from Sox Box. |

## One-time browser setup

These scripts are userscripts: they run inside the [Tampermonkey](https://www.tampermonkey.net/)
extension. Do this once per browser; every script installed afterwards works without repeating it.

1. Install the Tampermonkey extension for your browser.
2. Allow it to run userscripts:
   - **Chrome:** go to `chrome://extensions`, click **Details** on Tampermonkey, and turn on
     **Allow User Scripts**. (Chrome versions before 138 have no such toggle: turn on
     **Developer mode** at the top right of `chrome://extensions` instead.)
   - **Edge:** go to `edge://extensions` and turn on **Developer mode**. Newer versions may also
     show **Allow User Scripts** under Tampermonkey's **Details**; turn that on too.
   - **Firefox:** nothing extra.

### Not showing up?

If **Reports › TamperMonkey** is missing on `dsfp.soxbox.co`, check:

- **Allow User Scripts** (or Developer mode) is on.
- The script is enabled in Tampermonkey's dashboard.
- Tampermonkey's toolbar icon shows a number badge on the Sox Box page. No badge means no scripts
  are running there.
- Reload the Sox Box page after installing or changing anything.

## Install / update

**[Install Birthday Box](https://raw.githubusercontent.com/todlarson/tampermonkey-soxbox/main/birthday-box.user.js)**
— with Tampermonkey installed, opening this link shows its install screen.

Tampermonkey then checks that same URL for updates (`@updateURL` / `@downloadURL`) and installs
new versions automatically, so team members only install once.

Manual: in Tampermonkey, **Create a new script**, paste the whole file, save.

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

## Privacy

Sox Box holds guest data. None of it may end up in this repo. Full rules are in [CLAUDE.md](CLAUDE.md).

- Scripts handle guest data in memory only: nothing is downloaded, logged, stored, or sent elsewhere.
- Never commit exports, saved pages, network captures or screenshots. `.gitignore` blocks the common types.
- `scripts/check-private-data.sh` blocks emails, phone numbers, IPs, tokens/keys and data files.
  It runs on every push in GitHub Actions (with a gitleaks secret scan). After cloning, enable it locally:

  ```powershell
  git config core.hooksPath .githooks
  ```
