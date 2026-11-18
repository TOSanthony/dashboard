/* applist.h -- lists installed games (titleId + display name) for the
 * "jeux-favoris" quick-launch widget, and locates each one's icon0.png.
 *
 * Two pieces of on-disk data, neither of which this project had touched
 * before now:
 *   - which titleIds are installed, non-system "games" -- from app.db
 *     (tbl_iconinfo*, dispLocation=138), same tables tiles.c already reads.
 *   - each title's display name + cover art -- from its own on-console
 *     content folder, /system_ex/app/<titleId>/sce_sys/{param.json,icon0.png}.
 *     These two paths (plus /user/app/<titleId>/mount.lnk as the "is this
 *     title actually installed/mounted right now" check) are NOT something
 *     this repo had verified itself -- they come from SvenGDK/PS-Multi-Tools
 *     (an open-source PS5 backup manager), which checks the exact same two
 *     paths before treating a title as installed, and reads icon0.png/
 *     param.json from the exact same sce_sys subfolder once it does. That's
 *     a real tool doing the same thing against real consoles, which is the
 *     best confirmation available without a console of our own to test on
 *     -- but it's still unverified BY THIS PROJECT. If the favoris widget
 *     comes up empty on real hardware, this is the first place to check. */
#ifndef WH_APPLIST_H
#define WH_APPLIST_H

#include "common.h"

/* Builds the JSON array served at GET /__apps: every installed, non-system
 * game, most-recently-played first, e.g.
 *   [{"id":"PPSA01234","title":"Elden Ring","icon":true}, ...]
 * "icon" is true only if that title's icon0.png was actually found on disk
 * (the widget falls back to a placeholder otherwise). Returns 0 on success
 * (caller frees *out with free()), -1 on failure (app.db unreadable). */
int wh_apps_json(char** out, size_t* outlen);

/* Validates title_id (same charset as wh_name_ok) and, if its icon0.png
 * exists on disk, writes the path into out (cap bytes) and returns 1.
 * Returns 0 if the id is invalid or the file isn't there. */
int wh_app_icon_path(const char* title_id, char* out, size_t cap);

#endif /* WH_APPLIST_H */
