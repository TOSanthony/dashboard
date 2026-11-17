/* Ported to plain C from kerrdec97/ps5-date-time-sync's main.cpp: one NTP
 * round-trip, half-RTT correction, settimeofday() + read-back verification.
 * Same server list, same validation, same constants. Uses this payload's own
 * LOG() instead of its own notification (main.c folds the outcome into the
 * startup notification line). */
#include "timesync.h"
#include "common.h"
#include "util.h"
#include <arpa/inet.h>
#include <netdb.h>
#include <netinet/in.h>

extern int sceNetInit(void);
extern int sceNetPoolCreate(const char*, int, int);
extern int sceNetPoolDestroy(int);

#define WH_NTP_PORT 123
#define WH_NTP_PACKET_SIZE 48
#define WH_NTP_MAX_RESPONSE 512
#define WH_NTP_ORIGINATE_OFF 24
#define WH_NTP_TRANSMIT_OFF 40
#define WH_NTP_TS_SIZE 8
#define WH_NTP_VERSION 4
#define WH_NTP_CLIENT_MODE 3
#define WH_NTP_SERVER_MODE 4
#define WH_NTP_CLIENT_FLAGS ((WH_NTP_VERSION << 3) | WH_NTP_CLIENT_MODE)
#define WH_NET_POOL_SIZE (64*1024)
#define WH_SOCK_TIMEOUT_S 3
#define WH_ATTEMPTS_PER_SERVER 2
#define WH_RETRY_DELAY_S 1
#define WH_MAX_VERIFY_DELTA_US (2*1000000LL)

#define WH_NTP_TO_UNIX_EPOCH 2208988800U
#define WH_MIN_UNIX_TIME 946684800LL    /* 2000-01-01 */
#define WH_MAX_UNIX_TIME 4102444800LL   /* 2100-01-01 */

static const char* const WH_NTP_SERVERS[] = {
  /* Cloudflare's anycast addresses, numeric so this doesn't depend on DNS,
   * then hostname-based fallbacks. */
  "162.159.200.1",
  "162.159.200.123",
  "time.cloudflare.com",
  "pool.ntp.org",
  "time.google.com",
};
#define WH_N_NTP_SERVERS (sizeof WH_NTP_SERVERS / sizeof WH_NTP_SERVERS[0])

static int wh_monotonic_us(int64_t* out){
  struct timespec v;
  if (clock_gettime(CLOCK_MONOTONIC, &v)) return 0;
  *out = (int64_t)v.tv_sec * 1000000LL + (int64_t)(v.tv_nsec / 1000);
  return 1;
}
static uint32_t wh_rd_be32(const uint8_t* b){ return ((uint32_t)b[0]<<24)|((uint32_t)b[1]<<16)|((uint32_t)b[2]<<8)|(uint32_t)b[3]; }
static void wh_wr_be32(uint8_t* b, uint32_t v){ b[0]=(uint8_t)(v>>24); b[1]=(uint8_t)(v>>16); b[2]=(uint8_t)(v>>8); b[3]=(uint8_t)v; }

static int wh_write_client_ts(uint8_t* packet){
  struct timeval now;
  if (gettimeofday(&now, 0)) { LOG("timesync: gettimeofday (request) failed: errno=%d\n", errno); return 0; }
  if (now.tv_usec < 0 || now.tv_usec >= 1000000) return 0;
  int64_t unix_s = (int64_t)now.tv_sec;
  if (unix_s < -(int64_t)WH_NTP_TO_UNIX_EPOCH) { LOG("timesync: system clock predates the NTP epoch\n"); return 0; }
  uint64_t full_s = (uint64_t)(unix_s + (int64_t)WH_NTP_TO_UNIX_EPOCH);
  uint32_t wire_s = (uint32_t)full_s;
  uint32_t wire_f = (uint32_t)(((uint64_t)now.tv_usec << 32) / 1000000ULL);
  if (!wire_s && !wire_f) wire_f = 1;   /* keep it nonzero so the server echoes a usable originate ts */
  wh_wr_be32(packet + WH_NTP_TRANSMIT_OFF, wire_s);
  wh_wr_be32(packet + WH_NTP_TRANSMIT_OFF + 4, wire_f);
  return 1;
}
static int wh_sock_timeouts(int fd){
  struct timeval tv = { WH_SOCK_TIMEOUT_S, 0 };
  if (setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv)) return 0;
  if (setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof tv)) return 0;
  return 1;
}
static int wh_resolve(const char* host, struct sockaddr_in* addr){
  memset(addr, 0, sizeof *addr);
  int numeric = inet_pton(AF_INET, host, &addr->sin_addr);
  if (numeric == 1) { addr->sin_family = AF_INET; addr->sin_port = htons(WH_NTP_PORT); return 1; }
  struct addrinfo hints; memset(&hints, 0, sizeof hints);
  hints.ai_family = AF_INET; hints.ai_socktype = SOCK_DGRAM; hints.ai_protocol = IPPROTO_UDP;
  struct addrinfo* res = 0;
  if (getaddrinfo(host, 0, &hints, &res)) { LOG("timesync: DNS lookup failed for %s\n", host); return 0; }
  int ok = 0;
  for (struct addrinfo* c = res; c; c = c->ai_next){
    if (!c->ai_addr || c->ai_addrlen < (socklen_t)sizeof(struct sockaddr_in)) continue;
    memcpy(addr, c->ai_addr, sizeof(struct sockaddr_in));
    addr->sin_port = htons(WH_NTP_PORT);
    ok = 1; break;
  }
  freeaddrinfo(res);
  return ok;
}
static int wh_request_time(const struct sockaddr_in* server, struct timeval* out){
  int fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
  if (fd < 0) { LOG("timesync: socket() failed: errno=%d\n", errno); return 0; }
  if (!wh_sock_timeouts(fd)) { close(fd); return 0; }
  uint8_t req[WH_NTP_PACKET_SIZE]; memset(req, 0, sizeof req);
  req[0] = WH_NTP_CLIENT_FLAGS;
  if (!wh_write_client_ts(req)) { close(fd); return 0; }
  int64_t t0 = 0, t1 = 0; int have_t0 = wh_monotonic_us(&t0);
  ssize_t sent = sendto(fd, req, sizeof req, 0, (const struct sockaddr*)server, sizeof *server);
  if (sent != (ssize_t)sizeof req) { LOG("timesync: sendto failed: errno=%d\n", errno); close(fd); return 0; }
  uint8_t resp[WH_NTP_MAX_RESPONSE]; struct sockaddr_in src; socklen_t srclen = sizeof src;
  ssize_t got = recvfrom(fd, resp, sizeof resp, 0, (struct sockaddr*)&src, &srclen);
  int rcv_errno = errno; int have_t1 = wh_monotonic_us(&t1);
  close(fd);
  if (got < 0) { LOG("timesync: recvfrom failed: errno=%d\n", rcv_errno); return 0; }
  if (got < (ssize_t)WH_NTP_PACKET_SIZE) { LOG("timesync: short NTP response (%zd bytes)\n", got); return 0; }
  if (srclen < sizeof src || src.sin_family != AF_INET || src.sin_port != server->sin_port
      || src.sin_addr.s_addr != server->sin_addr.s_addr) { LOG("timesync: response from unexpected endpoint\n"); return 0; }
  if (memcmp(resp + WH_NTP_ORIGINATE_OFF, req + WH_NTP_TRANSMIT_OFF, WH_NTP_TS_SIZE)) { LOG("timesync: response does not match the request\n"); return 0; }
  uint8_t flags = resp[0];
  uint8_t li = flags >> 6, ver = (flags >> 3) & 7, mode = flags & 7, stratum = resp[1];
  if (li == 3 || mode != WH_NTP_SERVER_MODE || ver != WH_NTP_VERSION || stratum == 0 || stratum >= 16) {
    LOG("timesync: invalid response LI=%u ver=%u mode=%u stratum=%u\n", li, ver, mode, stratum); return 0;
  }
  uint32_t ntp_s = wh_rd_be32(resp + 40), ntp_f = wh_rd_be32(resp + 44);
  if (!ntp_s && !ntp_f) { LOG("timesync: empty transmit timestamp\n"); return 0; }
  uint64_t full_s = ntp_s;
  if (full_s < WH_NTP_TO_UNIX_EPOCH) full_s += (1ULL << 32);   /* NTP era wrap (2036) */
  int64_t unix_s = (int64_t)(full_s - (uint64_t)WH_NTP_TO_UNIX_EPOCH);
  if (unix_s < WH_MIN_UNIX_TIME || unix_s > WH_MAX_UNIX_TIME) { LOG("timesync: response outside accepted range (%lld)\n", (long long)unix_s); return 0; }
  int64_t us = (int64_t)(((uint64_t)ntp_f * 1000000ULL) >> 32);
  if (have_t0 && have_t1 && t1 > t0) us += (t1 - t0) / 2;   /* half-RTT correction */
  int64_t total_us = unix_s * 1000000LL + us;
  out->tv_sec = (time_t)(total_us / 1000000LL);
  out->tv_usec = (suseconds_t)(total_us % 1000000LL);
  return 1;
}
static int wh_set_system_time(const struct timeval* v){
  struct timeval cand = *v;
  if (settimeofday(&cand, 0)) { LOG("timesync: settimeofday failed: errno=%d\n", errno); return 0; }
  struct timeval verif;
  if (gettimeofday(&verif, 0)) { LOG("timesync: gettimeofday (verify) failed: errno=%d\n", errno); return 0; }
  int64_t delta = (int64_t)(verif.tv_sec - cand.tv_sec) * 1000000LL + (int64_t)verif.tv_usec - (int64_t)cand.tv_usec;
  if (delta < 0) delta = -delta;
  if (delta > WH_MAX_VERIFY_DELTA_US) { LOG("timesync: verification delta too large (%lld us)\n", (long long)delta); return 0; }
  return 1;
}

int wh_sync_time(void){
  if (sceNetInit()) { LOG("timesync: sceNetInit failed (non-fatal)\n"); return 1; }
  int pool = sceNetPoolCreate("wh-timesync", WH_NET_POOL_SIZE, 0);
  if (pool < 0) { LOG("timesync: sceNetPoolCreate failed: rc=%d\n", pool); return 1; }

  struct timeval net_time; int ok = 0;
  for (size_t i = 0; i < WH_N_NTP_SERVERS && !ok; i++){
    struct sockaddr_in server;
    if (!wh_resolve(WH_NTP_SERVERS[i], &server)) continue;
    for (int attempt = 0; attempt < WH_ATTEMPTS_PER_SERVER; attempt++){
      if (wh_request_time(&server, &net_time)) { ok = 1; break; }
      if (attempt + 1 < WH_ATTEMPTS_PER_SERVER) sleep(WH_RETRY_DELAY_S);
    }
  }
  sceNetPoolDestroy(pool);
  if (!ok) { LOG("timesync: no valid NTP response\n"); return 1; }

  time_t secs = net_time.tv_sec; struct tm tmv;
  if (gmtime_r(&secs, &tmv)) { char buf[64]; if (strftime(buf, sizeof buf, "%Y-%m-%d %H:%M:%S UTC", &tmv)) LOG("timesync: NTP time %s\n", buf); }

  if (!wh_set_system_time(&net_time)) return 1;
  LOG("timesync: clock synchronized\n");
  return 0;
}
