/* Embeds two binary blobs into the payload:
 *  - bridge_hbc_start/end: the full bridge Hermes bytecode (bridge.hbc),
 *    swapped in for the hub on any firmware (see install.c).
 *  - wh_loader: the JS loader head (loader.js), NUL-terminated so it can be
 *    used as a C string (see prelude.c). */
.section .rodata
.align 16

.global bridge_hbc_start
.global bridge_hbc_end
bridge_hbc_start:
.incbin "bridge.hbc"
bridge_hbc_end:

.align 16
.global wh_loader
wh_loader:
.incbin "loader.js"
.byte 0
