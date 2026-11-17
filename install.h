/* install.h -- one install into SceShellUI: attach, build the code cave,
 * write it, and point the JSI vtable slot at the detour. */
#ifndef WH_INSTALL_H
#define WH_INSTALL_H

#include "common.h"

/* Attaches to `pid`, discovers the hook point, builds the cave (prelude +
 * bridge), writes it in and re-points evaluateJavaScript's vtable slot at it.
 * `want_dump` enables the opt-in HBC dump diagnostics (WH_DUMP_FLAG present).
 * Always detaches before returning. Sets *reload_out to 1 if this replaced an
 * existing hook of ours (vs. a clean first install). Returns 0 (WH_OK) on
 * success, or a small positive rc -- see main.c's "why" table for what each
 * one means. */
int wh_install_once(pid_t pid, int want_dump, int* reload_out);

#endif /* WH_INSTALL_H */
