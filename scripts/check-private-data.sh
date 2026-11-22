#!/usr/bin/env bash
# Blocks guest data, credentials and other private data from being committed.
#
#   scripts/check-private-data.sh            # check all tracked files
#   scripts/check-private-data.sh --staged   # check files staged for commit (pre-commit hook)
#   scripts/check-private-data.sh FILE...    # check specific files
#
# A line that is a known false positive can end with:  privacy-check: allow
set -u

cd "$(git rev-parse --show-toplevel)" || exit 2

if [ "${1:-}" = "--staged" ]; then
  mapfile -t files < <(git diff --cached --name-only --diff-filter=ACMR)
  read_file() { git show ":$1"; }
elif [ $# -gt 0 ]; then
  files=("$@")
  read_file() { cat -- "$1"; }
else
  mapfile -t files < <(git ls-files)
  read_file() { cat -- "$1"; }
fi

fail=0
report() { echo "  $1"; fail=1; }

# Files that should never be in this repo (data exports, saved pages, network captures, env files).
blocked_ext='\.(csv|tsv|xlsx|xls|xlsm|ods|har|sqlite|db|env|pem|key|p12|pfx)$'
blocked_name='(^|/)(\.env(\..*)?|cookies\.txt|.*[Gg]uest.*[Ee]xport.*)$'

# Content patterns. Each: label|extended regex
patterns=(
  'email address|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
  'JWT / session token|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
  'GitHub token|gh[pousr]_[A-Za-z0-9]{20,}'
  'AWS access key|(AKIA|ASIA)[0-9A-Z]{16}'
  'private key|-----BEGIN [A-Z ]*PRIVATE KEY-----'
  'password/secret assignment|(password|passwd|secret|api[_-]?key|auth[_-]?token)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"']{4,}'
  'phone number|(^|[^0-9])\(?[2-9][0-9]{2}\)?[-. ][0-9]{3}[-. ][0-9]{4}([^0-9]|$)'
  'IP address|(^|[^0-9.])([0-9]{1,3}\.){3}[0-9]{1,3}([^0-9.]|$)'
  'Windows user path|[A-Za-z]:\\\\Users\\\\'
)
# Emails that are fine to appear (placeholders and commit trailers).
allowed_email='@(example\.(com|org|net)|anthropic\.com|users\.noreply\.github\.com)'

for f in "${files[@]}"; do
  [ -n "$f" ] || continue
  if [[ "$f" =~ $blocked_ext ]] || [[ "$f" =~ $blocked_name ]]; then
    report "$f: file type not allowed (could contain guest data or credentials)"
    continue
  fi
  # Skip this checker itself (it contains the patterns) and binary files.
  [ "$f" = "scripts/check-private-data.sh" ] && continue
  content=$(read_file "$f" 2>/dev/null) || continue
  printf '%s' "$content" | grep -qI . || continue

  for p in "${patterns[@]}"; do
    label=${p%%|*}; regex=${p#*|}
    while IFS= read -r hit; do
      [ -n "$hit" ] || continue
      line=${hit#*:}
      [[ "$line" == *"privacy-check: allow"* ]] && continue
      if [ "$label" = "email address" ]; then
        others=$(printf '%s' "$line" | grep -oE "${regex}" | grep -vE "$allowed_email")
        [ -n "$others" ] || continue
      fi
      report "$f:${hit%%:*}: possible $label"
    done < <(printf '%s\n' "$content" | grep -nE -i -- "$regex")
  done
done

if [ $fail -ne 0 ]; then
  echo "Private-data check FAILED. Remove the data, or if it's a false positive add 'privacy-check: allow' to the line."
  exit 1
fi
echo "Private-data check passed (${#files[@]} files)."
