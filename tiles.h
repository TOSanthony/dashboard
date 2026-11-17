/* tiles.h -- at payload startup, set the visibility of a few home-screen
 * tiles directly in app.db (same technique/tables as TOSanthony/
 * ps5-unhide-debug-settings' dashboard.c + appdb.h). No ShellUI restart or
 * console reboot needed: the shell re-reads app.db on its own. */
#ifndef WH_TILES_H
#define WH_TILES_H

/* Writes the default tile visibility: Welcome Hub shown, PlayStation Store
 * and PlayStation Plus hidden. Backs up app.db once (first call only) before
 * making any change, and is idempotent -- a tile already at the wanted value
 * is left untouched. Safe to call even if app.db can't be opened (logs and
 * returns without side effects). */
void wh_apply_tile_visibility(void);

#endif /* WH_TILES_H */
