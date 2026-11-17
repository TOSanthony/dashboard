#!/bin/sh
# Build wh_bridge.elf from the split sources.
# Requires: PS5_PAYLOAD_SDK set to the root of the ps5-payload-sdk.
#
# Base: geodox/ps5-wh-widgets 26.11.13beta (full bridge HBC embedded directly,
# fixing the 26.11.12beta delta-reconstruction bug).
# Patches (both inside loader.js, see README.md):
#   1. hideKeyGuide: a widget's config.json can set "hideKeyGuide": true to
#      suppress the key-guide command bar.
#   2. Built-in PSN sign-in patch: the former standalone hub-signin-patch
#      widget's logic, now applied automatically by every payload install.
# Also at every startup:
#   - tiles.c: sets Welcome Hub/PlayStation Store/PlayStation Plus visibility
#     directly in app.db (ported from TOSanthony/ps5-unhide-debug-settings).
#   - timesync.c: restores the clock via NTP if the RTC/CMOS battery is dead
#     (ported from kerrdec97/ps5-date-time-sync).
set -e
cd "$(dirname "$0")"

if [ -z "$PS5_PAYLOAD_SDK" ]; then
  echo "PS5_PAYLOAD_SDK is not set (expected .../ps5-payload-sdk)" >&2
  exit 1
fi

CC="$PS5_PAYLOAD_SDK/bin/prospero-clang"

# sqlite3.c/h (the "amalgamation", public domain, from sqlite.org) must be
# present in this folder -- used by tiles.c to edit app.db directly.
if [ ! -f sqlite3.c ] || [ ! -f sqlite3.h ]; then
  echo "sqlite3.c / sqlite3.h missing (needed by tiles.c for app.db access)" >&2
  exit 1
fi
SQLITE_CFLAGS="-DSQLITE_THREADSAFE=0 -DSQLITE_OMIT_LOAD_EXTENSION -DSQLITE_OMIT_SHARED_CACHE -DSQLITE_TEMP_STORE=3"
"$CC" -O2 $SQLITE_CFLAGS -c sqlite3.c -o sqlite3.o

SRCS="util.c remote.c hookpoint.c prelude.c server.c tiles.c timesync.c install.c main.c"
OBJS="sqlite3.o"
for f in $SRCS; do
  o="${f%.c}.o"
  "$CC" -Wall -g $SQLITE_CFLAGS -c "$f" -o "$o"
  OBJS="$OBJS $o"
done

"$CC" -c embed.S -o embed.o
OBJS="$OBJS embed.o"

"$CC" -Wall -g -pie -o wh_bridge.elf $OBJS -lSceUserService -lSceNet

echo "built wh_bridge.elf"
