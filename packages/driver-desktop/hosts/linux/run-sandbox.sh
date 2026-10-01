#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Rami Fara and GhostHand contributors
#
# Manual runner for the X11 sandbox container. GhostHand itself builds and starts the image as needed
# (`ghosthand run --surface x11 ...`); this script is for building by hand, debugging and watching.
#
#   run-sandbox.sh build              build ghosthand-x11:latest for the current user
#   run-sandbox.sh host [args]        the JSON-RPC host on stdio (what the driver talks to)
#   run-sandbox.sh watch [port]       the GTK testbed with a noVNC live view on 127.0.0.1:<port> (default 6080)
#
# Env: GHOSTHAND_CONTAINER_RUNTIME=docker|podman, GHOSTHAND_DEBIAN_MIRROR=http://<mirror>/debian,
#      GHOSTHAND_WORK=<folder shared as /work> (default: a new temp folder).
set -eu

here=$(cd "$(dirname "$0")" && pwd)
pkg=$(cd "$here/../.." && pwd)
image=ghosthand-x11:latest
rt=${GHOSTHAND_CONTAINER_RUNTIME:-}
if [ -z "$rt" ]; then
  if command -v docker >/dev/null 2>&1; then rt=docker; elif command -v podman >/dev/null 2>&1; then rt=podman; else
    echo "no docker or podman found" >&2
    exit 1
  fi
fi
userns=""
[ "$rt" = podman ] && userns="--userns keep-id"

work() {
  if [ -n "${GHOSTHAND_WORK:-}" ]; then echo "$GHOSTHAND_WORK"; else mktemp -d "${TMPDIR:-/tmp}/ghosthand-x11-XXXXXX"; fi
}

cmd=${1:-}
[ $# -gt 0 ] && shift
case "$cmd" in
  build)
    uid=$(id -u)
    gid=$(id -g)
    [ "$uid" = 0 ] && uid=1000 && gid=1000
    # shellcheck disable=SC2086
    exec "$rt" build -t "$image" \
      --build-arg GHOST_UID="$uid" --build-arg GHOST_GID="$gid" \
      ${GHOSTHAND_DEBIAN_MIRROR:+--build-arg DEBIAN_MIRROR="$GHOSTHAND_DEBIAN_MIRROR"} \
      -f "$here/Containerfile" "$pkg"
    ;;
  host)
    w=$(work)
    # shellcheck disable=SC2086
    exec "$rt" run --rm -i --init $userns --network none --cap-drop ALL --security-opt no-new-privileges \
      --shm-size 256m -v "$w:/work:rw" "$image" --display :1 "$@"
    ;;
  watch)
    port=${1:-6080}
    w=$(work)
    echo "live view: http://127.0.0.1:$port/vnc.html?autoconnect=1 (Ctrl-C to stop; state in $w)" >&2
    launch='{"jsonrpc":"2.0","id":1,"method":"launch","params":{"argv":["python3","/opt/ghosthand/testbed/desktop-testbed.py","--state","/work/state.json"]}}'
    # The host exits when its stdin closes; `cat` keeps it open until Ctrl-C.
    # shellcheck disable=SC2086
    { printf '%s\n' "$launch"; cat; } | "$rt" run --rm -i --init $userns --cap-drop ALL \
      --security-opt no-new-privileges --shm-size 256m -p "127.0.0.1:$port:$port" -e GHOSTHAND_VNC_LISTEN=0.0.0.0 \
      -v "$w:/work:rw" "$image" --display :1 --vnc-port "$port" >/dev/null
    ;;
  *)
    sed -n '5,13p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
