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
  /* A fresh (non-reload) install only patches evaluateJavaScript for calls
   * still to come -- the Hub's own bundle was already evaluated once,
   * before our hook existed, so the widgets and the hub-signin-patch
   * (loader.js, applied automatically wherever the prelude runs in the
   * hub) don't actually take effect until something makes the Hub
   * re-evaluate its JS. That "something" used to be switching PS5 user
   * profiles by hand. Killing SceShellUI does the same job: the system
   * supervisor relaunches it immediately (same mechanism as the "ps" +
   * "kill <pid>" telnet trick, or Payload Manager's own process-restart
   * button), and the fresh process hits evaluateJavaScript for the first
   * time with our hook already installed. The old pid's hook dies with
   * it, so we must re-run the install into the *new* pid right away --
   * wh_watch_reinstall's periodic re-attach only fires on a widget-file
   * change, not simply because SceShellUI respawned, so without this
   * we'd silently lose the hook until the next edit. Skipped on a reload
   * (hook already live in the Hub that's currently running -- nothing
   * to force) and on a diagnostic dump run (no surprise reload wanted).
   */
  const char* rsum = "";
  if (rc == 0 && !reload && !want_dump) {
    wh_flog("installer", "restarting SceShellUI (pid %d) to apply the hook immediately", (int)pid);
    kill(pid, SIGKILL);
    pid_t newpid = -1;
    for (int tries = 0; tries < 40 && newpid < 0; tries++) {  /* ~4s budget */
      usleep(100000);
      newpid = find_pid("SceShellUI");
    }
    if (newpid < 0) {
      wh_flog("installer", "SceShellUI did not reappear after restart");
      rsum = "\nShellUI: restart failed (killed but did not come back)";
    } else {
      int reload2 = 0; uint64_t gen2 = 0;
      int rc2 = wh_install_once_g(newpid, want_dump, &reload2, &gen2);
      if (rc2 == 0) {
        pid = newpid; widgets_gen = gen2;
        wh_flog("installer", "re-attached to fresh SceShellUI (pid %d)", (int)newpid);
        rsum = "\nShellUI: restarted";
      } else {
        wh_flog("installer", "re-attach after restart failed (rc=%d)", rc2);
        rsum = "\nShellUI: restarted but re-attach failed";
        rc = rc2;
      }
    }
  }
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
    if (plain) notify("%s  v%s%s%s%s\nAsset server: running", hook, WH_VERSION, wsum, rsum, tsum);
    else notify("%s (rc=%d)  v%s%s%s\nAsset server: running", hook, rc, WH_VERSION, rsum, tsum);
    wh_asset_loop(as, gen, pid, widgets_gen); /* does not return */
  }
  if (plain) notify("%s  v%s%s%s%s\nAsset server: not running (%s)", hook, WH_VERSION, wsum, rsum, tsum, why);
  else notify("%s (rc=%d)  v%s%s%s\nAsset server: not running (%s)", hook, rc, WH_VERSION, rsum, tsum, why);
  return rc;
}
