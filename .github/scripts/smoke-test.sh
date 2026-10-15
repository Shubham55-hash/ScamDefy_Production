#!/usr/bin/env bash
# Usage: smoke-test.sh <image-ref>
# Starts the API image as container "scamdefy-ci" and checks / and /api/health.
# The caller is responsible for removing the container afterwards.
set -euo pipefail

IMAGE="$1"

docker run -d \
  --name scamdefy-ci \
  -p 8000:8000 \
  -e GEMINI_API_KEY=ci-placeholder \
  -e GOOGLE_SAFE_BROWSING_API_KEY=ci-placeholder \
  -e URLHAUS_API_KEY=ci-placeholder \
  "$IMAGE"

echo "Waiting for API to become ready..."
READY=0
for i in $(seq 1 30); do
  if ! docker ps -q --filter "name=scamdefy-ci" --filter "status=running" | grep -q .; then
    echo "ERROR: Container exited unexpectedly."
    docker logs scamdefy-ci
    exit 1
  fi

  if curl -sf http://localhost:8000/ > /dev/null 2>&1; then
    echo "API root is responding (attempt $i)!"
    READY=1
    break
  fi
  sleep 2
done

if [ "$READY" -ne 1 ]; then
  echo "ERROR: API did not become ready within timeout."
  docker logs scamdefy-ci
  exit 1
fi

echo "Verifying root endpoint..."
ROOT_RESP=$(curl -sf http://localhost:8000/)
echo "$ROOT_RESP" | python3 -c "import sys, json; d=json.load(sys.stdin); assert d['status']=='active', f'Unexpected status: {d}'"

echo "Verifying health endpoint..."
HEALTH_RESP=$(curl -sf http://localhost:8000/api/health)
echo "$HEALTH_RESP" | python3 -c "import sys, json; d=json.load(sys.stdin); assert d['status']=='ok', f'Health check failed: {d}'"

echo "Smoke test passed successfully!"
