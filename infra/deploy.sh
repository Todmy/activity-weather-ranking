#!/usr/bin/env bash
# Deploys whatever is on origin/main. The box pulls from the public repository
# rather than receiving an rsync of someone's working tree, so what runs in
# production is exactly what a reviewer can read.
set -euo pipefail

HOST="${1:-collinson-box}"
REPO="https://github.com/Todmy/activity-weather-ranking.git"
DIR="/srv/activity-weather-ranking"

ssh "$HOST" bash -euo pipefail -s <<EOF
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --quiet origin main
  git -C "$DIR" reset --hard --quiet origin/main
else
  rm -rf "$DIR"
  git clone --quiet "$REPO" "$DIR"
fi

cd "$DIR"
echo "deploying \$(git rev-parse --short HEAD)"
docker compose up -d --build
docker image prune -f >/dev/null
EOF

echo "waiting for health"
for _ in $(seq 1 30); do
  if curl -sf "http://$(ssh "$HOST" 'curl -s -4 ifconfig.me'):4000/graphql?query=%7Bhealth%7D" >/dev/null; then
    echo "healthy"
    exit 0
  fi
  ssh "$HOST" 'sleep 2' >/dev/null 2>&1
done

echo "health check did not pass; container logs:" >&2
ssh "$HOST" "cd $DIR && docker compose logs --tail 40 api" >&2
exit 1
