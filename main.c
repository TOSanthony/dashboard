/* Welcome Hub custom-widget payload (wh_bridge.elf).
 *
 * Hooks evaluateJavaScript in SceShellUI with a detour that runs the widget
 * prelude in every runtime, and swaps the hub's own bytecode for our embedded
 * bridge HBC. Stays resident as the widget asset server (images, settings,
 * log lines).
 *
 * Sources:
 *   util.c       log file, notifications, process lookup, byte/JSON helpers
 *   remote.c     attach/read/write/map another process's memory (ptrace)
 *   hookpoint.c  find evaluateJavaScript + its JSI vtable slot in libhermes
 *   prelude.c    loader head (loader.js) + one section per widget folder
 *   install.c    build the code cave, write it, point the vtable slot at it
 *   server.c     HTTP asset/log/settings server
 *   main.c       this file: startup and the user-facing summary */
#include "common.h"
#include "cave.h"   /* WH_DUMP_FLAG */
#include "install.h"
#include "prelude.h"
#include "server.h"
#include "tiles.h"
#include "timesync.h"
#include "util.h"

int main(void){
  wh_flog("installer", "---- WHBridge %s start ----", WH_VERSION);
  /* Default tile visibility: Welcome Hub shown, PlayStation Store and
   * PlayStation Plus hidden. Writes app.db directly; no ShellUI restart or
   * console reboot needed, the shell re-reads it on its own. */
  wh_apply_tile_visibility();
  /* Pins Orbit Store into the system row and locks its position there, so it
   * never drifts out of place. Silent: wh.log only, no on-screen notification. */
  wh_apply_orbit_pin();
  /* Restores the clock via NTP if the RTC/CMOS battery is dead or
   * disconnected (console boots with a stale date). Non-fatal either way. */
  int tsync_rc = wh_sync_time();
  const char* tsum = tsync_rc == 0 ? "\nClock: synced via NTP" : "";
  pid_t pid = find_pid("SceShellUI");
  if (pid < 0) { notify("WHBridge failed: ShellUI not found"); return 1; }
  int want_dump = (access(WH_DUMP_FLAG, F_OK) == 0);   /* opt-in HBC dump diagnostics; WH_DUMP_FLAG from cave.h via install.h */
  int reload = 0;
  uint64_t widgets_gen = 0;
  int rc = wh_install_once_g(pid, want_dump, &reload, &widgets_gen);
  const char* hook = rc == 0 ? (reload ? "WHBridge reloaded" : "WHBridge loaded")
                  : rc == 15 ? "WHBridge failed: hook owned by something else" : "WHBridge failed";
  int plain = (rc == 0 || rc == 15);         /* message already says it all */
  char wsum[300] = "";
  if (rc == 0) {
    if (g_wbad) snprintf(wsum, sizeof wsum, "\nWidgets: %d loaded, %d failed (%s%s)", g_wok, g_wbad, g_wfail, g_wmore ? ", ..." : "");
    else snprintf(wsum, sizeof wsum, "\nWidgets: %d loaded", g_wok);
  }
  /* Stay resident as the widget asset server (the hub's Image only loads http://). */
  unsigned gen = 0; const char* why = "";
  int as = wh_asset_open(&gen, &why);
  if (as >= 0) {
    if (plain) notify("%s  v%s%s%s\nAsset server: running", hook, WH_VERSION, wsum, tsum);
    else notify("%s (rc=%d)  v%s%s\nAsset server: running", hook, rc, WH_VERSION, tsum);
    wh_asset_loop(as, gen, pid, widgets_gen); /* does not return */
  }
  if (plain) notify("%s  v%s%s%s\nAsset server: not running (%s)", hook, WH_VERSION, wsum, tsum, why);
  else notify("%s (rc=%d)  v%s%s\nAsset server: not running (%s)", hook, rc, WH_VERSION, tsum, why);
  return rc;
}
