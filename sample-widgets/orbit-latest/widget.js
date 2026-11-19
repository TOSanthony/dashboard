// orbit-latest v4: "Orbit Store - Derniers ajouts", built to look and behave
// like a stock Welcome Hub widget.
//
// Follows the official SDK's own reference widgets (hello-wh, payload-monitor
// from github.com/geodox/ps5-wh-widgets) for the native look:
//   - wh.Title / wh.Label: the hub's own stock text components (no custom
//     font/colour -- that's what makes a custom widget look hand-rolled).
//   - the stock mat background (#17191Ef0) + lightMat sheen, 16px radius,
//     16px padding -- same shell every stock widget uses.
//   - wh.Focusable with a function child receiving `selected`, exactly like
//     hello-wh's Chip -- no manual useState(focused) per row.
//   - size-adaptive layout from props.width/height, exactly like
//     payload-monitor's COMPACT/maxRows logic -- DEFAULT (152 tall) shows a
//     dense text-only list, LARGE/FULL show cover art and more rows. This is
//     the SDK's built-in L1/R1 resize (DEFAULT -> LARGE -> FULL in edit mode).
//   - wh.logger, the SDK's own logging -- writes to the same /data/wh-widgets
//     /wh.log the dashboard's "Voir wh.log" button now reads, so there's a
//     single log to check instead of this project's earlier custom one.
//
// Behaviour notes learned on-console this session:
//   - fontSize must be one of wh.FontSizePS's values (15/18/21/24/27/30/36/
//     45/54/72) or RNPS throws -- wh.Label/wh.Title already respect this.
//   - A catalog entry's own titleId is NOT a locally-launchable PS5 app id;
//     passing it to psgm:play opens that title's PlayStation Store page
//     instead of launching anything. Only Orbit Store's own titleId
//     (PPSA99177) is a real registered app, so every press here launches
//     Orbit Store itself -- the user picks the specific game from there.
//   - A changed widget.js only takes effect in a NEW hub JS runtime: closing
//     and reopening the Hub is not enough, a full sign-out/sign-in is needed.
//   - Opening a specific game: Orbit Store's own backend (127.0.0.1:34177,
//     which keeps running even with the TV app closed) now exposes
//     POST/GET /api/v1/open-request. A press posts the catalog id there
//     first, then launches Orbit Store as before; the app itself picks the
//     request up on its next poll and opens straight to that game's page.
//   - Display modes (list/grid/cover) are now driven by the tile's own size
//     instead of a separate Options popup: resizing with L1/R1 in edit mode
//     (DEFAULT -> LARGE -> FULL) picks the mode directly, since that's what
//     people expected resizing to do. Thresholds (H<300 / H<450) are a
//     best guess at LARGE/FULL's real heights -- nothing in the SDK exposes
//     a named size, only width/height -- adjust if testing on console shows
//     the breakpoints landing on the wrong size.
//   - Cover mode has no wh.Focusable items (it's one big tile, not a list),
//     so it's never "entered"; L1/R1/Cross reach wh.onPressed directly
//     (confirmed in docs/sdk/input-and-focus.md). List/grid keep their rows
//     as wh.Focusable items, where L1/R1 already move the selection and
//     Cross already goes to the selected item -- our handlers below return
//     false for those so the hub's own behaviour is untouched.
(function (wh) {
  var React = wh.React;
  var View = wh.View;
  var Image = wh.Image;
  var Label = wh.Label;
  var Animated = wh.Animated;
  var ce = React.createElement;
  var F = wh.FontSizePS;
  var B = wh.Button;
  var log = wh.logger ? wh.logger('orbit-latest') : function () {};

  var ORBIT_STORE_TITLE_ID = 'PPSA99177';
  var CATALOG_URL = 'http://127.0.0.1:34177/api/v1/catalog';
  var OPEN_REQUEST_URL = 'http://127.0.0.1:34177/api/v1/open-request';
  // The dashboard payload's own server (always resident, separate from
  // Orbit Store's own backend) -- can hand Orbit's saved payload to the
  // console's ELF loader when nothing answers on 34177, without touching
  // the TV app/psgm:play at all.
  var ENSURE_RUNNING_URL = 'http://127.0.0.1:8096/api/orbit_ensure_running';
  // Nov 2026 visual refresh (design approved on a Claude Artifacts canvas
  // mockup, ported here): circular avatars everywhere (list-at-DEFAULT,
  // grid), a rounded-corner cover inset in jaquette mode, and a real empty
  // state for jaquette mode while the catalog hasn't loaded yet. The two
  // placeholder images are plain widget assets served the same way
  // __app_icon already serves cover art, just off this widget's own folder
  // via the generic /<widget>/<file> route in server.c's wh_asset_conn --
  // no new server-side plumbing needed.
  var EMPTY_FRAME_URI = 'http://127.0.0.1:8098/orbit-latest/empty-frame.png';
  var EMPTY_ICON_URI = 'http://127.0.0.1:8098/orbit-latest/empty-icon.png';
  // Selection ring around a circular avatar (grid + list trio). Both
  // GridCell and renderCompactTrio used to size the circle to fill its
  // whole cell/slot and only then add this ring on top -- the ring had no
  // room left and got clipped by the cell's own bounds, which is why the
  // white selected-ring was invisible on console. Both now reserve this
  // much space up front so the ring always fits inside the cell.
  var CIRCLE_RING = 16;
  // TEMP DEBUG (remove once the key-guide-bar investigation is done): posts
  // to the exact same /__log endpoint + widget tag wh-inspector v23-25 use,
  // so a GridCell/Row becoming `selected` interleaves, by timestamp, into
  // the SAME /data/wh-inspector.log -- no separate log to fetch or
  // cross-reference. The goal is to see whether moving the selection
  // WITHIN this widget's own grid/list ever produces a new
  // "2734tBS6.KeyGuidePS CALL ... targetComponent=<id>" entry in that same
  // file around the same second, which would mean the Hub's key-guide
  // system re-targets per internal Focusable item (not just per widget).
  var __lastSelLogged = null;
  function debugLogSelect(kind, id) {
    if (__lastSelLogged === kind + ':' + id) return;
    __lastSelLogged = kind + ':' + id;
    try {
      var url = 'http://127.0.0.1:8096/__log?w=77682d696e73706563746f72';
      var msg = 'ORBIT ' + kind + ' selected id=' + id;
      if (fetch) fetch(url, { method: 'POST', body: msg }).catch(function () {});
    } catch (e) {}
  }
  var MAT = '#17191ef0';

  var styles = wh.StyleSheet.create({
    card: { borderRadius: 16, overflow: 'hidden' },
    mat: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: MAT, borderRadius: 16 },
    body: { flex: 1, padding: 16 },
    row: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, paddingHorizontal: 8 },
    rowFocused: { backgroundColor: '#ffffff1f' },
    // overflow:'hidden' right here (not just borderRadius on the Image
    // itself) is what actually clips the cover art to rounded corners --
    // same finding as borderWidth/borderColor elsewhere in this widget:
    // a style applied directly to an Image isn't trustworthy on this
    // runtime, but a View wrapping it with overflow:hidden + matching
    // borderRadius reliably clips whatever's inside, image included.
    cover: { borderRadius: 6, marginRight: 10, backgroundColor: '#263a58', overflow: 'hidden' },
    coverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
    dim: { opacity: 0.6 },
    small: { fontSize: F.Size4XSmall },   // 15
    body18: { fontSize: F.Size3XSmall },  // 18
    gridRow: { flexDirection: 'row' },
    gridSlot: { alignItems: 'center', justifyContent: 'center' },
    // Circular avatar, shared by the grid and by the DEFAULT-size list's
    // row of 3 (the Nov 2026 refresh moved both off square tiles). The ring
    // is a slightly larger circle sat behind the avatar, not a border: a
    // border drawn via borderWidth/borderColor on this frame turned out not
    // to render in this runtime (it never showed up, regardless of paint
    // order or the gap left for it). backgroundColor is confirmed working
    // everywhere else in this widget (rowFocused, the mat, etc.), so the
    // "ring" here is really a solid white fill peeking out from behind the
    // smaller, centered image -- same visual result, through a style
    // property that's actually supported. White ring on selection, per the
    // approved design (earlier versions used the accent color here).
    circleFrame: { borderRadius: 999, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    circleFrameSelected: { backgroundColor: '#ffffff' },
    circleImg: { borderRadius: 999, backgroundColor: '#263a58', overflow: 'hidden' },
    // Cover mode: the image fills the whole card edge to edge (no gap from
    // the card's own padding), title/dots overlaid on a bottom strip.
    // Same clipping note as `cover` above: don't rely on the card's own
    // overflow:hidden several levels up (or on the Image's own borderRadius)
    // -- clip right here, at the View that directly wraps the full-bleed
    // cover Image, so the corners match the tile's 16px radius reliably.
    coverFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 16, overflow: 'hidden' },
    // Nov 2026 refresh: the dashed-frame placeholder art (same visual Sony
    // uses for an empty cover slot) sits full-bleed behind the tile, and the
    // actual jaquette is inset to land exactly inside its dashed square,
    // rounded 10px -- matches the approved canvas mockup. The frame image is
    // sized proportionally to whatever W/H the hub actually hands us rather
    // than hardcoded, since FULL-size tiles aren't guaranteed to be the
    // exact 504x504 square the reference asset was measured against.
    coverFrameBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    coverInset: { position: 'absolute', overflow: 'hidden', borderRadius: 10, backgroundColor: '#263a58' },
    // The empty-state icon (same glyph as inside the dashed frame, without
    // its own border) centered in the same slot while the catalog hasn't
    // loaded yet, plus a status line where the title/dots normally sit.
    coverEmptyIcon: { position: 'absolute' },
    coverEmptyStatus: { position: 'absolute', left: 16, right: 16, bottom: 18, textAlign: 'center' },
    // No backdrop here either (same choice as coverHeader below): just the
    // "i / n" progress counter floating over the jaquette, bottom-right.
    coverOverlay: { position: 'absolute', right: 0, bottom: 0,
                    paddingHorizontal: 16, paddingBottom: 8 },
    coverProgress: { color: '#ffffff', fontSize: F.Size3XSmall },
    // Logo + title strip, top-left, same as list/grid's wh.Title header --
    // cover mode is the one layout that skips the card's own padded body
    // (the image fills the tile edge to edge), so without this it had no
    // "Orbit Store" branding at all, unlike every stock Welcome Hub widget.
    // No backdrop here on purpose: just the logo+title floating over the
    // jaquette, like the top-left corner of the other sizes.
    // Same 16px on every side as the other widgets' own padded body (e.g.
    // horloge's styles.body), so the icon+title sits at the exact same
    // spot and size as every other stock widget's header.
    coverHeader: { position: 'absolute', left: 0, right: 0, top: 0, padding: 16 }
  });

  // A per-game catalog row: X (or press) launches Orbit Store. wh.Focusable
  // passes `selected` to a function child, same idiom as hello-wh's Chip.
  function Row(props) {
    var item = props.item;
    return ce(wh.Focusable, {
      onPress: props.onPress,
      style: [styles.row, { height: props.rowHeight }],
      focusedStyle: styles.rowFocused
    }, function (selected) {
      if (selected) debugLogSelect('Row', item.id || item.titleId || '?');
      var titleStyle = props.compact ? [styles.small, { flex: 1 }] : { flex: 1, fontSize: F.Size3XSmall };
      return ce(View, { style: { flexDirection: 'row', alignItems: 'center', flex: 1 } },
        !props.compact
          ? ce(View, { style: [styles.cover, styles.coverPlaceholder, { width: props.coverSize, height: props.coverSize }] },
              Image && item.cover
                ? ce(Image, { source: { uri: item.cover }, resizeMode: 'cover', style: { width: props.coverSize, height: props.coverSize, borderRadius: 6 } })
                : ce(Label, { style: [styles.small, styles.dim] }, '?'))
          : null,
        ce(Label, { style: titleStyle, numberOfLines: 1 }, String(item.title || item.titleId || '?'))
      );
    });
  }

  // A grid cell: circular avatar with the title centered below it (Nov 2026
  // refresh -- was a square tile with the title overlaid on a dark strip).
  // cellW/cellH is the whole slot the 3x3 layout gave this cell; the circle
  // is sized to fit inside it once a one-line label is reserved below.
  function GridCell(props) {
    var item = props.item, cellW = props.cellW, cellH = props.cellH;
    // No label under the avatar (dropped per on-console feedback) -- the
    // circle gets the whole cell instead of giving up room to a text line.
    var circle = Math.max(28, Math.min(cellW, cellH) - CIRCLE_RING);
    return ce(wh.Focusable, { onPress: props.onPress, style: { width: cellW, height: cellH, alignItems: 'center', justifyContent: 'center' } },
      function (selected) {
        if (selected) debugLogSelect('GridCell', item.id || item.titleId || '?');
        return ce(View, { style: [styles.circleFrame, selected ? styles.circleFrameSelected : null, { width: circle + CIRCLE_RING, height: circle + CIRCLE_RING }] },
          ce(View, { style: [styles.circleImg, { width: circle, height: circle }] },
            Image && item.cover
              ? ce(Image, { source: { uri: item.cover }, resizeMode: 'cover', style: { width: circle, height: circle, borderRadius: circle / 2 } })
              : null)
        );
      });
  }

  // Pagination counter under a full-tile cover, e.g. "1 / 201" -- no title,
  // no backdrop, just the current position in the catalog.
  function CoverProgress(props) {
    return ce(Label, { style: styles.coverProgress }, (props.index + 1) + ' / ' + props.total);
  }

  // Persistent Animated.Value across renders (same helper meteo's widget
  // uses for its spinning/falling icons) -- lets the jaquette carousel below
  // tween smoothly with Animated.timing instead of jumping between states.
  function useAnimVal(initial) {
    var ref = React.useRef(null);
    if (!ref.current) ref.current = new Animated.Value(initial || 0);
    return ref.current;
  }

  function OrbitLatest(props) {
    var dataState = React.useState({ loading: true, error: '', items: [] });
    var data = dataState[0], setData = dataState[1];
    var mounted = React.useRef(true);

    React.useEffect(function () {
      mounted.current = true;
      // Best-effort, fire-and-forget: ask the dashboard payload to start
      // Orbit Store's download service if it isn't already running, so the
      // widget's catalog comes back even on a cold boot -- never launches
      // the TV app itself, just the backend it would otherwise have to hand
      // to the ELF loader on its own next open.
      fetch(ENSURE_RUNNING_URL).catch(function (e) { log('ensure-running FAILED: ' + ((e && e.message) || e)); });
      function load() {
        fetch(CATALOG_URL, { headers: { Accept: 'application/json' } })
          .then(function (r) { return r.json(); })
          .then(function (list) {
            if (!mounted.current) return;
            var items = Array.isArray(list) ? list.slice() : [];
            items.sort(function (a, b) {
              var av = String((a && (a.addedAt || a.releaseDate)) || '');
              var bv = String((b && (b.addedAt || b.releaseDate)) || '');
              return av < bv ? 1 : (av > bv ? -1 : 0);
            });
            setData({ loading: false, error: '', items: items });
            log('catalog ok, ' + items.length + ' total, showing up to 8');
          })
          .catch(function (e) {
            if (!mounted.current) return;
            setData({ loading: false, error: String((e && e.message) || e), items: [] });
            log('catalog FAILED: ' + ((e && e.message) || e));
          });
      }
      load();
      var id = setInterval(load, 20000);
      return function () { mounted.current = false; clearInterval(id); };
    }, []);

    // Tile size comes from the grid (L1/R1 resize in edit mode): fill the
    // given box and adapt the layout, same idea as payload-monitor. The
    // display mode itself is now derived from the size (see the Nov 2026
    // note at the top of the file) rather than a separate Options popup.
    var W = (props && props.width) || 504;
    var H = (props && props.height) || 152;
    var compact = H < 300;              // DEFAULT (152)
    var mode = H < 300 ? 'list' : (H < 450 ? 'grid' : 'cover');
    var pad = 32, titleH = 40, gap = 8;
    var innerW = W - pad;
    // List mode (the 3-circle trio) drops the "Orbit Store" icon+title row
    // entirely -- per on-console feedback it was wasted space at this
    // size -- so it gets the full body height for the circles instead of
    // losing titleH+gap to a header that isn't drawn.
    var innerH = mode === 'list' ? H - pad : H - pad - titleH - gap;
    var cfg = (props && props.config) || {};

    var coverState = React.useState(0);
    var coverIndex = coverState[0], setCoverIndex = coverState[1];
    var total = data.items.length;
    if (coverIndex >= total && total > 0) coverIndex = 0; // the catalog shrank under us

    // Jaquette carousel (Nov 2026 refresh): a second cover peeks out tilted
    // behind the current one, and L1/R1 slide+tilt the stack across instead
    // of just swapping the image. animT runs 0->1 over one transition;
    // transRef snapshots which items are involved and which direction, so
    // the render stays stable even if the catalog refetches mid-animation.
    // runningRef blocks a second press from starting mid-tween.
    var animT = useAnimVal(0);
    var transRef = React.useRef(null);
    var runningRef = React.useRef(false);
    var forceState = React.useState(0);
    var forceRender = forceState[1];
    function startCoverTransition(dir) {
      if (runningRef.current || total < 2) return;
      runningRef.current = true;
      transRef.current = {
        dir: dir,
        cur: data.items[coverIndex],
        left: data.items[(coverIndex - 1 + total) % total],
        right: data.items[(coverIndex + 1) % total]
      };
      animT.setValue(0);
      forceRender(function (n) { return n + 1; }); // paint the first animated frame
      Animated.timing(animT, { toValue: 1, duration: 240, useNativeDriver: false }).start(function () {
        runningRef.current = false;
        transRef.current = null;
        setCoverIndex(function (i) { return dir === 'next' ? (i + 1) % total : (i - 1 + total) % total; });
      });
    }

    function openItem(item) {
      log('launch: ' + (item.title || item.titleId));
      requestOpenGame(item).then(launchOrbitStore);
    }

    // Cover mode has no wh.Focusable items, so these reach the tile directly
    // while it's focused (never "entered"). List/grid already own L1/R1/Cross
    // through their rows' wh.Focusable items, so returning false there leaves
    // the hub's normal resize/selection/entering behaviour alone.
    wh.onPressed(B.L1, function () {
      if (mode !== 'cover' || total < 2) return false;
      startCoverTransition('prev');
    });
    wh.onPressed(B.R1, function () {
      if (mode !== 'cover' || total < 2) return false;
      startCoverTransition('next');
    });
    wh.onPressed(B.Cross, function () {
      if (mode !== 'cover' || !total) return false;
      openItem(data.items[coverIndex]);
    });

    var pad = 32, titleH = 40, gap = 8;
    var innerW = W - pad, innerH = H - pad - titleH - gap;

    // Cover mode fills the whole tile edge to edge (no card padding, no
    // separate header row) in every state, not just once a cover is ready --
    // the Nov 2026 refresh added a proper empty state (dashed-frame art +
    // centered icon + status line) instead of falling through to the plain
    // list-style loading/error text below.
    if (mode === 'cover') {
      var statusLabel = data.loading ? 'Chargement du catalogue...'
        : data.error ? 'Erreur: ' + data.error
        : !total ? 'Aucun jeu dans le catalogue.'
        : null;
      return ce(View, { style: [styles.card, { width: W, height: H }] },
        statusLabel
          ? renderCoverEmpty(W, H, cfg, statusLabel)
          : renderCoverStack(data.items, coverIndex, W, H, cfg, animT, transRef.current));
    }

    var body;
    if (data.loading) {
      body = ce(Label, { style: styles.dim }, 'Chargement...');
    } else if (data.error) {
      body = ce(Label, { style: styles.dim, numberOfLines: 2 }, 'Erreur: ' + data.error);
    } else if (!total) {
      body = ce(Label, { style: styles.dim }, 'Aucun jeu dans le catalogue.');
    } else if (mode === 'grid') {
      body = renderGrid(data.items, innerW, innerH, openItem);
    } else if (compact) {
      body = renderCompactTrio(data.items, innerW, innerH, openItem);
    } else {
      body = renderList(data.items, compact, innerH, openItem);
    }

    var badge = data.loading ? null : (total ? total + ' jeu' + (total === 1 ? '' : 'x') : null);
    var header = mode === 'list' ? null
      : ce(wh.Title, { iconId: cfg.iconId || 'game', badge: badge, style: { marginBottom: 8 } }, cfg.title || 'Orbit Store');

    return ce(View, { style: [styles.card, { width: W, height: H }] },
      ce(View, { lightMat: 'auto', style: styles.mat }),
      ce(View, { style: styles.body }, header, body)
    );
  }

  // DEFAULT size (compact, 152 tall): a single row of up to 3 circular
  // avatars with the title below each, matching the approved mockup --
  // replaces the earlier dense text-only list at this size. circle is
  // sized to whatever vertical room is actually left after the header and
  // a one-line label, so it still adapts if the hub ever hands this widget
  // a slightly different DEFAULT height.
  function renderCompactTrio(allItems, innerW, innerH, openItem) {
    var items = allItems.slice(0, 3);
    // No label under the avatar (dropped per on-console feedback) -- the
    // circle gets the whole slot instead of giving up room to a text line.
    // 16px horizontal gutter between slots, plus CIRCLE_RING reserved on
    // every side so the selection ring has room and isn't clipped.
    var slotW = Math.floor(innerW / Math.max(1, items.length));
    var circle = Math.max(28, Math.min(innerH, slotW - 16) - CIRCLE_RING);
    var cells = items.map(function (item, i) {
      return ce(wh.Focusable, {
        key: item.id || item.titleId || i,
        onPress: function () { openItem(item); },
        style: { width: slotW, alignItems: 'center', justifyContent: 'center' }
      }, function (selected) {
        if (selected) debugLogSelect('Trio', item.id || item.titleId || '?');
        return ce(View, { style: [styles.circleFrame, selected ? styles.circleFrameSelected : null, { width: circle + CIRCLE_RING, height: circle + CIRCLE_RING }] },
          ce(View, { style: [styles.circleImg, { width: circle, height: circle }] },
            Image && item.cover
              ? ce(Image, { source: { uri: item.cover }, resizeMode: 'cover', style: { width: circle, height: circle, borderRadius: circle / 2 } })
              : null)
        );
      });
    });
    return ce(View, { style: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center' } }, cells);
  }

  // LARGE/FULL "list" mode: a dense text row per game, cover art once
  // there's room (same layout this widget always had -- untouched by the
  // Nov 2026 refresh, which only changed the DEFAULT-size trio above and
  // the grid/jaquette modes).
  function renderList(allItems, compact, innerH, openItem) {
    var rowH = compact ? 28 : 56;
    var coverSize = compact ? 0 : 40;
    var maxRows = Math.max(1, Math.floor(innerH / rowH));
    var items = allItems.slice(0, maxRows > 1 && allItems.length > maxRows ? maxRows - 1 : maxRows);
    var hidden = allItems.length - items.length;
    var rows = items.map(function (item, i) {
      return ce(Row, {
        key: item.id || item.titleId || i,
        item: item,
        compact: compact,
        rowHeight: rowH,
        coverSize: coverSize,
        onPress: function () { openItem(item); }
      });
    });
    if (hidden > 0) {
      rows.push(ce(View, { key: '__more', style: { height: rowH, justifyContent: 'center', paddingHorizontal: 8 } },
        ce(Label, { style: [styles.small, styles.dim] }, '+' + hidden + ' de plus')));
    }
    return ce(View, null, rows);
  }

  // Grid mode: always a fixed 3x3 -- 9 equal squares, never a different
  // count or size depending on how many games there are or how tall the
  // tile happens to be. Arrows/L1/R1 already move between cells by screen
  // position -- the SDK's own wh.Focusable behaviour.
  var GRID_COLUMNS = 3, GRID_ROWS = 3;
  function renderGrid(allItems, innerW, innerH, openItem) {
    var gap = 8;
    // cellW/cellH no longer need to match: a circle-with-label-below cell is
    // taller than it is wide for a given avatar size, unlike the old square
    // tile-with-overlay layout, so each dimension gets its own share of the
    // available box.
    var cellW = Math.floor((innerW - gap * (GRID_COLUMNS - 1)) / GRID_COLUMNS);
    var cellH = Math.floor((innerH - gap * (GRID_ROWS - 1)) / GRID_ROWS);
    var items = allItems.slice(0, GRID_COLUMNS * GRID_ROWS);
    var lines = [];
    for (var r = 0; r < GRID_ROWS; r++) {
      var cells = [];
      for (var col = 0; col < GRID_COLUMNS; col++) {
        var idx = r * GRID_COLUMNS + col;
        if (idx >= items.length) { cells.push(ce(View, { key: 'e' + idx, style: { width: cellW, height: cellH } })); }
        else {
          var item = items[idx];
          cells.push(ce(GridCell, {
            key: item.id || item.titleId || idx,
            item: item,
            cellW: cellW,
            cellH: cellH,
            onPress: (function (it) { return function () { openItem(it); }; })(item)
          }));
        }
        if (col < GRID_COLUMNS - 1) cells.push(ce(View, { key: 'g' + idx, style: { width: gap } }));
      }
      lines.push(ce(View, { key: 'row' + r, style: [styles.gridRow, r > 0 ? { marginTop: gap } : null] }, cells));
    }
    // The 3x3 block is usually smaller than the available box in one
    // dimension -- center it in both so the leftover space is split evenly
    // instead of all landing on one side.
    return ce(View, { style: { width: innerW, height: innerH, alignItems: 'center', justifyContent: 'center' } }, lines);
  }

  // Where the jaquette inset sits within a W x H tile, in the Nov 2026
  // refresh's frame-background layout. Proportional to whatever size the
  // hub actually hands this widget (FULL isn't guaranteed to be exactly the
  // 504x504 square the reference placeholder art was measured against):
  // a square sized to half the tile's shorter side, centered horizontally
  // and set slightly above vertical center to leave room for the title/dots
  // strip at the bottom -- matches the approved mockup's proportions.
  function coverInsetRect(W, H) {
    // Pinned to the user's own measurement on a 504x504 tile: 253x253 at
    // (126, 111). Kept proportional (0.502 of the shorter side, nudged up
    // 0.029*H from vertical center) so it still lands close to right on a
    // FULL size that isn't exactly 504x504.
    var size = Math.round(Math.min(W, H) * 0.502);
    var left = Math.round((W - size) / 2);
    var top = Math.round((H - size) / 2) - Math.round(H * 0.029);
    return { left: left, top: top, size: size };
  }

  // Fan geometry measured by the user in GIMP on the 504x504 reference tile:
  // all three jaquettes are the same 253x253 square sitting at the inset
  // rect's own position, and the left/right ones are just that square
  // rotated +-20deg around a shared pivot at (239.5, 397.5) -- below and
  // left-of-center, so rotating swings the tops of the cards apart into a
  // fan while their bottom corners stay close together. Expressed here as
  // ratios of the inset size so it scales for a FULL tile that isn't
  // exactly 504x504: pivot sits at r.left + 0.4486*r.size horizontally and
  // r.top + 1.1324*r.size vertically (i.e. below the square itself).
  var FAN_PIVOT_X_RATIO = 113.5 / 253, FAN_PIVOT_Y_RATIO = 286.5 / 253, FAN_DEG = 20;

  // One jaquette tile within the cover-mode fan. RN (this engine included)
  // only ever rotates a view around its own center, no transformOrigin --
  // so, same trick the clock widget uses for its hands: an invisible,
  // zero-size wrapper positioned exactly at the pivot is what gets rotated,
  // and the actual card sits inside it, offset so that at 0deg it lands
  // exactly on the inset rect. Rotating the wrapper then swings the card
  // around the pivot instead of around its own center. rot/op are either
  // plain numbers (steady state) or Animated/interpolated nodes (mid-
  // transition); Animated.View accepts both.
  function FanCard(props) {
    var r = props.r, item = props.item;
    // Every dimension fed to a rotated view gets rounded to a whole pixel
    // (same rule as the clock widget's hands) -- size is 253 (odd), so
    // size/2 lands on a half pixel, and left on that fractional a corner-
    // radius/overflow:hidden silently stops clipping on this runtime
    // (confirmed on-console: the rounded corners just didn't show).
    var size = Math.round(r.size);
    var pivotX = Math.round(r.left + FAN_PIVOT_X_RATIO * r.size);
    var pivotY = Math.round(r.top + FAN_PIVOT_Y_RATIO * r.size) + (props.pivotYAdjust || 0);
    // Card's center at rest (0deg), relative to the pivot.
    var offX = Math.round(r.left + r.size / 2 - pivotX);
    var offY = Math.round(r.top + r.size / 2 - pivotY);
    var left = Math.round(offX - size / 2), top = Math.round(offY - size / 2);
    return ce(Animated.View, { style: { position: 'absolute', left: pivotX, top: pivotY, width: 0, height: 0, transform: [{ rotate: props.rot }] } },
      ce(Animated.View, {
        style: [styles.coverInset, { left: left, top: top, width: size, height: size, opacity: props.op }]
      }, Image && item && item.cover
        ? ce(Image, { source: { uri: item.cover }, resizeMode: 'cover', style: { width: size, height: size, borderRadius: 10 } })
        : null)
    );
  }

  // The left (-20deg) card reads slightly high against the dashed frame
  // art -- it lines up with the left dashed edge but doesn't reach down to
  // the bottom one. Confirmed on-console; nudging its pivot down a few
  // pixels (a plain top-offset on the un-rotated wrapper, so it's a pure
  // screen-space shift that doesn't disturb the left alignment) fixes it
  // without touching the right side, which wasn't reported as off.
  var FAN_LEFT_PIVOT_Y_ADJUST = 10;

  // Cover mode, once a jaquette is available: three games fanned out from
  // the shared pivot above -- current flat and up front, the next game
  // peeking +20deg behind-right, the previous game -20deg behind-left. The
  // dashed-frame placeholder art is painted OVER the whole fan full-bleed --
  // it's a transparent PNG, so its dashed lines land on top as a decorative
  // border instead of being hidden underneath. L1/R1 (via
  // startCoverTransition in OrbitLatest) rotate the whole fan by one slot:
  // R1 swings the current cover back into the left slot while the right one
  // swings in to front; L1 is the exact mirror. animT/trans come from the
  // parent so the transition survives a re-render triggered by something
  // unrelated (a catalog refetch, for instance).
  function fanKey(item, fallback) {
    // Keyed by the game itself, not by its role in the fan (left/center/
    // right, or exit/toLeft/toCenter mid-transition). A role-based key
    // changes on every L1/R1 press, which forces React to unmount and
    // remount the Image -- it has to re-fetch from the local asset server,
    // and the plain backgroundColor of the frame (navy) shows through for
    // that split second, i.e. the "goes blue" flash. Keying by identity
    // keeps the same Image instance (and its already-loaded texture)
    // mounted straight through the animation; only its position/rotation
    // changes.
    return (item && (item.id || item.titleId)) || fallback;
  }

  function renderCoverStack(allItems, index, W, H, cfg, animT, trans) {
    var total = allItems.length;
    var r = coverInsetRect(W, H);
    var cards;
    if (!trans) {
      var curItem = allItems[index];
      var nextItem = total > 1 ? allItems[(index + 1) % total] : null;
      var prevItem = total > 1 ? allItems[(index - 1 + total) % total] : null;
      cards = [
        prevItem ? ce(FanCard, { key: fanKey(prevItem, 'l'), r: r, item: prevItem, rot: -FAN_DEG + 'deg', op: 0.9, pivotYAdjust: FAN_LEFT_PIVOT_Y_ADJUST }) : null,
        nextItem ? ce(FanCard, { key: fanKey(nextItem, 'r'), r: r, item: nextItem, rot: FAN_DEG + 'deg', op: 0.9 }) : null,
        ce(FanCard, { key: fanKey(curItem, 'c'), r: r, item: curItem, rot: '0deg', op: 1 })
      ];
    } else if (trans.dir === 'next') {
      cards = [
        trans.left ? ce(FanCard, {
          key: fanKey(trans.left, 'exit'), r: r, item: trans.left,
          rot: animT.interpolate({ inputRange: [0, 1], outputRange: [-FAN_DEG + 'deg', (-FAN_DEG - 15) + 'deg'] }),
          op: animT.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] })
        }) : null,
        ce(FanCard, {
          key: fanKey(trans.cur, 'toLeft'), r: r, item: trans.cur,
          rot: animT.interpolate({ inputRange: [0, 1], outputRange: ['0deg', -FAN_DEG + 'deg'] }),
          op: animT.interpolate({ inputRange: [0, 1], outputRange: [1, 0.9] })
        }),
        ce(FanCard, {
          key: fanKey(trans.right, 'toCenter'), r: r, item: trans.right,
          rot: animT.interpolate({ inputRange: [0, 1], outputRange: [FAN_DEG + 'deg', '0deg'] }),
          op: animT.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] })
        })
      ];
    } else { // 'prev' -- exact mirror of 'next'
      cards = [
        trans.right ? ce(FanCard, {
          key: fanKey(trans.right, 'exit'), r: r, item: trans.right,
          rot: animT.interpolate({ inputRange: [0, 1], outputRange: [FAN_DEG + 'deg', (FAN_DEG + 15) + 'deg'] }),
          op: animT.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] })
        }) : null,
        ce(FanCard, {
          key: fanKey(trans.cur, 'toRight'), r: r, item: trans.cur,
          rot: animT.interpolate({ inputRange: [0, 1], outputRange: ['0deg', FAN_DEG + 'deg'] }),
          op: animT.interpolate({ inputRange: [0, 1], outputRange: [1, 0.9] })
        }),
        ce(FanCard, {
          key: fanKey(trans.left, 'toCenter'), r: r, item: trans.left,
          rot: animT.interpolate({ inputRange: [0, 1], outputRange: [-FAN_DEG + 'deg', '0deg'] }),
          op: animT.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] })
        })
      ];
    }
    return ce(View, { style: styles.coverFill },
      cards,
      Image ? ce(Image, { source: { uri: EMPTY_FRAME_URI }, resizeMode: 'cover', style: [styles.coverFrameBg, { width: W, height: H }] }) : null,
      // Widget's own logo/title, top-left, same stock wh.Title the list/grid
      // header uses -- cover mode is otherwise the only layout with no
      // "Orbit Store" branding at all.
      ce(View, { style: styles.coverHeader },
        ce(wh.Title, { iconId: cfg.iconId || 'game' }, cfg.title || 'Orbit Store')
      ),
      total > 1
        ? ce(View, { style: styles.coverOverlay }, ce(CoverProgress, { index: index, total: total }))
        : null
    );
  }

  // Cover mode, nothing to show yet (loading, errored, or an empty catalog):
  // same dashed-frame background, but the bare "no image" glyph centered in
  // the same slot a real jaquette would occupy, and the status line where
  // the title/dots normally sit.
  function renderCoverEmpty(W, H, cfg, statusLabel) {
    var r = coverInsetRect(W, H);
    return ce(View, { style: styles.coverFill },
      Image ? ce(Image, { source: { uri: EMPTY_FRAME_URI }, resizeMode: 'cover', style: [styles.coverFrameBg, { width: W, height: H }] }) : null,
      Image ? ce(Image, { source: { uri: EMPTY_ICON_URI }, resizeMode: 'contain', style: [styles.coverEmptyIcon, { left: r.left, top: r.top, width: r.size, height: r.size }] }) : null,
      ce(View, { style: styles.coverHeader },
        ce(wh.Title, { iconId: cfg.iconId || 'game' }, cfg.title || 'Orbit Store')
      ),
      ce(Label, { style: [styles.coverEmptyStatus, styles.small, styles.dim], numberOfLines: 2 }, statusLabel)
    );
  }

  // Drops the catalog's *game* id at Orbit Store's own backend (best-effort:
  // a stale or old build without this route must not block the launch
  // below). item.id is the release's own id -- a game can have several
  // (different sources/qualities) -- while item.gameId is what groups them
  // into one Game, the id App::open_game()/state.game() actually resolve.
  // Sending item.id opens nothing and shows "this game is no longer
  // available" instead (confirmed on-console).
  function requestOpenGame(item) {
    var id = item && (item.gameId || item.id);
    if (!id) return Promise.resolve();
    return fetch(OPEN_REQUEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: id })
    }).catch(function (e) { log('open-request FAILED: ' + ((e && e.message) || e)); });
  }

  // A per-game catalog titleId isn't a real, locally-launchable PS5 app id --
  // confirmed on-console: pressing a row opened that title's PlayStation
  // Store page instead of launching anything. Only Orbit Store's own titleId
  // is a real registered app, so every press launches Orbit Store itself;
  // the open-request above is what gets it to the right game's page.
  function launchOrbitStore() {
    try {
      var base = globalThis.base_dll;
      if (typeof base !== 'function' || !base.c) { log('launch: base_dll missing'); return; }
      var ids = Object.getOwnPropertyNames(base.c), nm = null;
      for (var i = 0; i < ids.length && !nm; i++) {
        var ex; try { ex = base.c[ids[i]].exports; } catch (e) { continue; }
        if (ex && typeof ex === 'object' && ex.NativeModules) nm = ex.NativeModules;
      }
      if (!nm) { log('launch: NativeModules not found'); return; }
      var link = nm['VshNMApplicationLinkingPSModule'];
      if (!link) { log('launch: ApplicationLinkingPSModule missing'); return; }
      var target = 'psgm:play?id=' + ORBIT_STORE_TITLE_ID;
      Promise.resolve(link.CanOpenURL(target)).then(function (can) {
        if (!can) { log('launch: CanOpenURL false'); return; }
        return Promise.resolve(link.OpenURL(target)).then(function () { log('launch: OpenURL resolved'); });
      }).catch(function (e) { log('launch: EXCEPTION ' + ((e && e.message) || e)); });
    } catch (e) {
      log('launch: top-level EXCEPTION ' + ((e && e.message) || e));
    }
  }

  wh.register(OrbitLatest);
})(globalThis.__wh);

