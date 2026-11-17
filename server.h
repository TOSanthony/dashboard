/* server.h -- widget asset/log/settings HTTP server.
 *
 * The hub's Image component only loads http:// (data:/file: URIs fail), so the
 * installer stays resident and serves widget images to ShellUI over loopback.
 * Deliberately minimal and locked down:
 *   - binds 127.0.0.1 only (unreachable from the LAN); one request at a time
 *   - GET only; request line capped at 1 KB; 2 s read/write timeouts
 *   - path must be exactly /<dir>/<file>, each [A-Za-z0-9._-]{1,64}, no leading
 *     '.', no ".."; served from WH_WIDGETS_DIR only, O_NOFOLLOW, regular files
 *   - image types only (.png .jpg .jpeg), <= 1 MB; no listings, no other methods
 * Also exposes /__log (widget -> wh.log), /__wget and /__wset (per-widget
 * settings persistence) to the loader JS. */
#ifndef WH_SERVER_H
#define WH_SERVER_H

#include "common.h"

#define WH_ASSET_PORT 8098
#define WH_ASSET_MAX  (1024*1024)
#define WH_ASSET_URL  "http://127.0.0.1:8098/"
#define WH_GEN_FILE   WH_WIDGETS_DIR "/.wh_gen"

/* Binds the asset port and bumps the generation counter (telling any older
 * running server to retire). Returns the listening socket, or -1 with *why
 * set to a short reason. */
int wh_asset_open(unsigned* gen, const char** why);

/* Serves connections on `s` until a newer install bumps the generation past
 * `my`; never returns (exits the process on handover). */
void wh_asset_loop(int s, unsigned my);

#endif /* WH_SERVER_H */
