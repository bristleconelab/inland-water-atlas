#!/usr/bin/env bash
# Tell IndexNow search engines (Bing, Yandex, Seznam, Naver, Yep) that sitemap URLs changed.
# The key file is public/54dde7b1fa193d2cfc1980ce4293b4b7.txt (served at the site root).
#
# usage:
#   scripts/indexnow.sh                     every URL of the live sitemap (by hand, after a deploy that changed pages)
#   scripts/indexnow.sh --since YYYY-MM-DD  only URLs of the local dist/sitemap.xml whose <lastmod> is on or after the
#                                           date (the deploy workflow passes today's date after a Cloudflare deploy);
#                                           nothing to send -> exit 0
# DRY_RUN=1 prints the URL list instead of sending it.
# The sitemap lists the home page only: lakes and rivers open from hash links, which search engines do not index.
set -euo pipefail
KEY=54dde7b1fa193d2cfc1980ce4293b4b7
HOST=inlandwater.bristleconelab.org
cd "$(dirname "$0")/.."

if [ "${1:-}" = "--since" ]; then
  SINCE=${2:?--since needs a date YYYY-MM-DD}
  [[ "$SINCE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "bad date: $SINCE" >&2; exit 2; }
  URLS=$(python3 -I - "$SINCE" dist/sitemap.xml <<'PY'
import json, re, sys
since, path = sys.argv[1], sys.argv[2]
xml = open(path, encoding="utf-8").read()
pairs = re.findall(r"<loc>([^<]+)</loc>\s*<lastmod>([^<]+)</lastmod>", xml)
print(json.dumps([loc for loc, mod in pairs if mod[:10] >= since]))
PY
)
  if [ "$URLS" = "[]" ]; then echo "IndexNow: no sitemap URL with lastmod >= $SINCE; nothing sent"; exit 0; fi
else
  URLS=$(curl -s "https://$HOST/sitemap.xml" | grep -o '<loc>[^<]*' | sed 's/<loc>//' | python3 -c 'import json,sys;print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')
  [ "$URLS" != "[]" ] || { echo "sitemap not live yet"; exit 1; }
fi

echo "IndexNow: $(python3 -c 'import json,sys;print(len(json.loads(sys.argv[1])))' "$URLS") URL(s)"
if [ -n "${DRY_RUN:-}" ]; then echo "$URLS"; exit 0; fi   # DRY_RUN=1: print the list, send nothing
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H 'Content-Type: application/json; charset=utf-8' \
  -d "{\"host\":\"$HOST\",\"key\":\"$KEY\",\"keyLocation\":\"https://$HOST/$KEY.txt\",\"urlList\":$URLS}" \
  https://api.indexnow.org/indexnow)
echo "IndexNow HTTP $CODE"
# 200 OK, 202 Accepted (key validation pending); anything else is a failure
[ "$CODE" = 200 ] || [ "$CODE" = 202 ]
