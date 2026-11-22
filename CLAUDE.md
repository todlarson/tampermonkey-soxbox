# tampermonkey-soxbox

Tampermonkey userscripts used by our team on Sox Box (FoodBank Manager) at https://dsfp.soxbox.co/.

The repo is **public**. Pull requests, issues, projects, wiki and discussions are turned off,
and interactions are limited to collaborators. Commit directly to `main`; never open PRs.

## Privacy rules (most important)

Sox Box holds guest data: names, birth dates, addresses, phone numbers, household members.
None of it may enter this repo, its commit messages, issues or PRs.

- Never commit exports, saved pages, HAR/network captures, screenshots of guest records, or
  test data copied from Sox Box. Test data must be invented (e.g. "Test Alpha").
- Never hard-code guest names, IDs, staff names, emails, phone numbers, IP addresses,
  session tokens or cookies in scripts or comments. Sox Box pages put a `userToken` JWT in
  `localStorage`; never copy it anywhere.
- Scripts must only read data in memory: no `localStorage`/`GM_setValue` for guest data,
  no sending data to any host other than the Sox Box site itself, no `console.log` of records.
  Saving UI settings (e.g. a remembered number of weeks) is fine.
- `scripts/check-private-data.sh` runs as a pre-commit hook (`git config core.hooksPath .githooks`)
  and in GitHub Actions with gitleaks. Don't bypass it with `--no-verify`.
- When inspecting live data while developing, report only shapes and counts, not values.

## Script conventions

- One file per script: `<name>.user.js` in the repo root, listed in the README table with an
  install link (`https://raw.githubusercontent.com/todlarson/tampermonkey-soxbox/main/<name>.user.js`).
- Header: `@match https://dsfp.soxbox.co/*`, `@grant none`, `@run-at document-idle`,
  `@namespace https://dsfp.soxbox.co/`, `@homepageURL` (the repo), and `@updateURL` +
  `@downloadURL` set to the raw URL above. Bump `@version` on every change: Tampermonkey
  only auto-updates when the version increases.
- Wrap everything in an IIFE. With `@grant none`, page globals (`jQuery`) are on `window`.
- Menu: put new pages under **Reports › 🐵 TamperMonkey »**. Whichever script runs first creates
  the menu, so keep the label identical: a 16px 🐵 (`'🐵'`) span, since smaller or
  darker emoji like 🐒 disappear on the dark gray (#444) menu, then " TamperMonkey". Copy `getTamperMonkeyMenu()` from
  `birthday-box.user.js`; it finds `#tm-reports-menu` or creates it by cloning the
  Reports › Guest » submenu with `jQuery(...).clone(true)` so Superfish hover keeps working.
  Append your item by cloning `submenu.tmItemTemplate || submenu.querySelector('li')`.
- New pages: use a hash route on an existing Sox Box page (e.g. `/reports/guests/guests/#birthday-box`),
  hide `#page > .wrapper` children, and render into a new `<section class="column width8 first">`.
- Fetching data: reuse Sox Box's own report exports with the signed-in session
  (`fetch(..., { credentials: 'same-origin' })`), e.g. Guest Data =
  `POST /reports/guests/guests/export/` with `exportCols[]` values from that page's column list.
  Exported text is HTML-encoded (`&amp;`); decode before display and build DOM with `textContent`.
- Guest profile links: `/manage/guest/view/<Guest ID>/`.
