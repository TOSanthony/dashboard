/* timesync.h -- restores the console's date/time via NTP when the RTC/CMOS
 * backup battery is dead or disconnected (clock resets to a stale date after
 * a full power-off). Ported to plain C from kerrdec97/ps5-date-time-sync
 * (same servers, same validation, same settimeofday()+verify sequence). */
#ifndef WH_TIMESYNC_H
#define WH_TIMESYNC_H

/* Queries NTP (Cloudflare's numeric addresses first, so this doesn't depend
 * on DNS, then pool.ntp.org / time.google.com by name), validates the
 * response, and calls settimeofday() if it looks sane -- then reads the
 * clock back to confirm the change took. Logs every step via LOG(). Returns
 * 0 on a verified update, 1 otherwise (never fatal to the rest of the
 * payload: the caller just logs and moves on either way). */
int wh_sync_time(void);

#endif /* WH_TIMESYNC_H */
