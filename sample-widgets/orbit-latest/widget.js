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
  // no new server-side plumbing needed. empty-frame.png is only ever drawn
  // for the "Orbit Store isn't running" state (the catalog fetch itself
  // failing) -- loading and a genuinely empty catalog don't use it, see
  // the cover-mode branch in OrbitLatest below.
  var EMPTY_FRAME_URI = 'http://127.0.0.1:8098/orbit-latest/empty-frame.png';
  var EMPTY_ICON_URI = 'http://127.0.0.1:8098/orbit-latest/empty-icon.png';
  // Patches the one thing this engine's rotation genuinely can't do: round
  // a corner. Confirmed (3 different techniques, all square on both
  // rotated sides, at rest -- only the never-rotated center card ever
  // comes out rounded) that no runtime clip/borderRadius combination
  // survives a real rotation here, on a View or on the Image itself. So
  // this doesn't clip anything at runtime -- it's a tiny pre-rendered
  // transparent PNG (just the four tiny corner wedges a 10px radius would
  // normally cut away, pre-painted in the card's own mat/background
  // color) that rotates glued to the card via the exact same transform,
  // patching over the sharp corner tips with a convincing rounded-looking
  // edge instead of actually clipping anything.
  var FAN_CORNER_FIX_URI = 'http://127.0.0.1:8098/orbit-latest/fan-corner-fix.png';
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
    coverInset: { position: 'absolute', overflow: 'hidden', borderRadius: 10, backgroundColor: '#263a58' },
    // The dashed-frame placeholder art, full-bleed, for the "Orbit Store
    // isn't running" empty state only (see renderCoverEmpty).
    coverFrameBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
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
    coverHeader: { position: 'absolute', left: 0, right: 0, top: 0, padding: 16 },
    // "Vitrine" cover layout (cfg.heroCover): a promo-banner-style display,
    // one featured game at a time -- title/hint text on the left over the
    // widget's own mat background, full-height cover art on the right.
    // Unlike the fan stack, nothing here is ever rotated, so a plain
    // overflow:hidden + borderRadius clips the art correctly with no
    // corner-fix patch needed.
    heroBody: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', padding: 28 },
    heroLeft: { flex: 1, justifyContent: 'center', paddingRight: 16 },
    heroCoverFrame: { borderRadius: 16, overflow: 'hidden', backgroundColor: '#263a58' }
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
    var frame = circle + CIRCLE_RING;
    var marginX = (cellW - frame) / 2, marginY = (cellH - frame) / 2;
    // Fifth attempt: focusedStyle alone (transparent -> white) still never
    // showed anything, even though it matches the SDK's own documented
    // Focusable pattern. The one thing every actually-working example of
    // that pattern (the SDK reference widget's Chip, this widget's own
    // pill-shaped chips elsewhere) has in common that our ring didn't: the
    // *base* style is never fully transparent -- it's a translucent
    // '#ffffff1f' that's always faintly visible, and focusedStyle brightens
    // that to solid white. A transparent -> colour swap may simply not
    // repaint reliably on this engine; a colour -> brighter-colour one is
    // the only transition actually confirmed. So the ring is now always
    // faintly visible around every circle, and brightens to solid white on
    // focus, instead of invisible until (never) focused.
    return ce(wh.Focusable, {
      onPress: props.onPress,
      style: {
        width: frame, height: frame,
        marginLeft: marginX, marginRight: marginX, marginTop: marginY, marginBottom: marginY,
        borderRadius: 999, overflow: 'hidden', backgroundColor: '#ffffff1f',
        alignItems: 'center', justifyContent: 'center'
      },
      focusedStyle: { backgroundColor: '#ffffff' }
    }, function (selected) {
      if (selected) debugLogSelect('GridCell', item.id || item.titleId || '?');
      return ce(View, { style: [styles.circleImg, { width: circle, height: circle }] },
        Image && item.cover
          ? ce(Image, { source: { uri: item.cover }, resizeMode: 'cover', style: { width: circle, height: circle, borderRadius: circle / 2 } })
          : null);
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
    // List and grid both drop the "Orbit Store" icon+title row now (per
    // on-console feedback it was wasted space at either size) and, freed
    // of the header, also use a tighter 8px edge padding instead of the
    // standard 16px so the circles get noticeably bigger -- closer to the
    // size of the PS5's own stock "controllers" widget's circles.
    var noHeader = mode === 'list' || mode === 'grid';
    var pad = noHeader ? 8 : 16, titleH = 40, gap = 8;
    var innerW = W - pad;
    var innerH = noHeader ? H - pad : H - pad - titleH - gap;
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
      if (cfg.heroCover) { setCoverIndex(function (i) { return (i - 1 + total) % total; }); return; }
      startCoverTransition('prev');
    });
    wh.onPressed(B.R1, function () {
      if (mode !== 'cover' || total < 2) return false;
      if (cfg.heroCover) { setCoverIndex(function (i) { return (i + 1) % total; }); return; }
      startCoverTransition('next');
    });
    wh.onPressed(B.Cross, function () {
      if (mode !== 'cover' || !total) return false;
      openItem(data.items[coverIndex]);
    });

    // Cover mode fills the whole tile edge to edge (no card padding, no
    // separate header row) in every state, not just once a cover is ready --
    // the Nov 2026 refresh added a proper empty state (dashed-frame art +
    // centered icon + status line) instead of falling through to the plain
    // list-style loading/error text below.
    if (mode === 'cover') {
      // The dashed-frame + centered icon (data.error -- the catalog fetch
      // itself failed, meaning Orbit Store's own backend isn't up) is the
      // real "nothing to show" state: no jaquette exists to display at
      // all. Loading and a genuinely empty catalog aren't that -- Orbit
      // IS running, there's just nothing (yet) -- so they get a plain
      // status line only, same as the list/grid modes' own fallback,
      // instead of the frame/icon treatment meant for "not launched".
      if (data.error) {
        return ce(View, { style: [styles.card, { width: W, height: H }] },
          renderCoverEmpty(W, H, cfg, 'Erreur: ' + data.error));
      }
      var statusLabel = data.loading ? 'Chargement du catalogue...'
        : !total ? 'Aucun jeu dans le catalogue.'
        : null;
      return ce(View, { style: [styles.card, { width: W, height: H }] },
        statusLabel
          ? ce(View, { style: styles.coverFill },
              ce(View, { style: styles.coverHeader }, ce(wh.Title, { iconId: cfg.iconId || 'game' }, cfg.title || 'Orbit Store')),
              ce(Label, { style: [styles.coverEmptyStatus, styles.small, styles.dim], numberOfLines: 2 }, statusLabel))
          : cfg.heroCover
            ? renderCoverHero(data.items, coverIndex, W, H, cfg)
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
    var header = noHeader ? null
      : ce(wh.Title, { iconId: cfg.iconId || 'game', badge: badge, style: { marginBottom: 8 } }, cfg.title || 'Orbit Store');

    return ce(View, { style: [styles.card, { width: W, height: H }] },
      ce(View, { lightMat: 'auto', style: styles.mat }),
      ce(View, { style: [styles.body, noHeader ? { padding: 8 } : null] }, header, body)
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
    var frame = circle + CIRCLE_RING;
    // Same fix as GridCell (see its comment): the ring now rides
    // wh.Focusable's own style/focusedStyle swap -- the one mechanism
    // actually proven on console, via Row -- instead of the `selected`
    // function-child argument, which never produced a visible ring here
    // even after removing the extra wrapping View. Focusable is the direct
    // array item (key moved onto it), sized frame x frame with margins so
    // it still fills the whole slotW slot, matching Row's own box-is-the-
    // highlight structure exactly.
    var marginX = (slotW - frame) / 2;
    var cells = items.map(function (item, i) {
      return ce(wh.Focusable, {
        key: item.id || item.titleId || i,
        onPress: function () { openItem(item); },
        style: {
          width: frame, height: frame,
          marginLeft: marginX, marginRight: marginX,
          borderRadius: 999, overflow: 'hidden', backgroundColor: '#ffffff1f',
          alignItems: 'center', justifyContent: 'center'
        },
        focusedStyle: { backgroundColor: '#ffffff' }
      }, function (selected) {
        if (selected) debugLogSelect('Trio', item.id || item.titleId || '?');
        return ce(View, { style: [styles.circleImg, { width: circle, height: circle }] },
          Image && item.cover
            ? ce(Image, { source: { uri: item.cover }, resizeMode: 'cover', style: { width: circle, height: circle, borderRadius: circle / 2 } })
            : null);
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

  // One jaquette tile within the cover-mode fan.
  //
  // Two pivot techniques were tried and both still showed square corners
  // on console for the left/right cards (only the un-rotated center card
  // ever came out rounded) -- a zero-size pivot wrapper, then a real,
  // generously sized one, both rotating an ANCESTOR with the actual
  // clipped/rounded card as its un-rotated child. That split (center
  // rounds, any non-zero angle doesn't) points at a well-known RN
  // limitation this engine inherits (it's RN-based -- see "RNPS" in the
  // clock widget's comments): overflow:hidden clipping on a child does
  // not survive a rotation applied to an ancestor, because the clip is
  // computed before the ancestor's transform matrix is applied. horloge's
  // hands never hit this because they have no clipped child at all --
  // just a single rounded, solid-filled bar.
  //
  // Fix: don't rotate an ancestor at all. Put the rotation on the SAME
  // view that owns the borderRadius/overflow:hidden/Image, so there's no
  // ancestor boundary for the clip to get lost across. To still rotate
  // around a point other than this view's own center (which is all this
  // engine supports naturally), use the standard translate/rotate/
  // translate-back trick: shift the pivot to where the view's center
  // already is, rotate (now effectively around the pivot), then shift
  // back by the same amount.
  function FanCard(props) {
    var r = props.r, item = props.item;
    // Every dimension fed to a rotated view gets rounded to a whole pixel
    // (same rule as the clock widget's hands) -- size is 253 (odd), so
    // size/2 lands on a half pixel.
    var size = Math.round(r.size);
    var left = Math.round(r.left), top = Math.round(r.top);
    var pivotX = Math.round(left + FAN_PIVOT_X_RATIO * r.size);
    var pivotY = Math.round(top + FAN_PIVOT_Y_RATIO * r.size);
    // Vector from this card's own (un-rotated) center to the pivot.
    var dx = Math.round(pivotX - (left + size / 2));
    var dy = Math.round(pivotY - (top + size / 2));
    // extraY is a plain additional screen-space nudge applied AFTER the
    // pivot rotation, not folded into dx/dy: dx/dy are plain numbers
    // computed once per render, so a prop that changes between the
    // transition's last frame and the following steady-state render would
    // otherwise snap instantly. Appending it as its own transform step
    // lets it be an Animated-interpolated value exactly like `rot`/`op`
    // already are (RN's Animated.View accepts a mix of static and
    // Animated entries in the same transform array), so it can ramp in
    // step with the rotation instead of popping in once the rotation
    // settles.
    // Three different techniques all left the rotated cards square on
    // console (ancestor rotates+child clips; rotation merged onto the
    // same clipped view; no clip at all, Image's own borderRadius with
    // no parent clipping it) -- always square on both sides, at rest,
    // never just the center card (permanently rot: 0deg). So no runtime
    // clip/borderRadius combination survives an actual rotation on this
    // engine, full stop; it isn't about which element owns the clip.
    //
    // Given that, don't ask the engine to clip a rotated corner at all:
    // patch it visually instead. FAN_CORNER_FIX_URI is a tiny
    // pre-rendered transparent PNG holding just the four corner wedges a
    // 10px radius would normally cut away, pre-painted in the card's own
    // mat/background color -- rendered as a second child of this same
    // Animated.View so it picks up the exact same transform as the cover
    // Image (glued to the card through every rotation, steady or
    // animated), landing right on top of the real card's sharp corners
    // and covering them with a convincing rounded-looking edge. Skipped
    // for the one card that's permanently rot: 0deg (cornerFix prop),
    // since that corner already renders correctly and doesn't need it.
    return ce(Animated.View, {
      style: [styles.coverInset, {
        left: left, top: top, width: size, height: size, opacity: props.op,
        transform: [
          { translateX: dx }, { translateY: dy },
          { rotate: props.rot },
          { translateX: -dx }, { translateY: -dy },
          { translateY: props.extraY || 0 }
        ]
      }]
    },
      Image && item && item.cover
        ? ce(Image, { source: { uri: item.cover }, resizeMode: 'cover', style: { width: size, height: size, borderRadius: 10 } })
        : null,
      props.cornerFix && Image
        ? ce(Image, { source: { uri: FAN_CORNER_FIX_URI }, resizeMode: 'stretch', style: { position: 'absolute', left: 0, top: 0, width: size, height: size } })
        : null
    );
  }

  // The left (-20deg) card reads slightly high against the dashed frame
  // art -- it lines up with the left dashed edge but doesn't reach down to
  // the bottom one. Confirmed on-console; nudging it down a few pixels
  // (FanCard's extraY, a plain post-rotation screen-space shift) fixes it
  // without touching the right side, which wasn't reported as off. 10px
  // was right all along -- the 20/40 bumps were chasing a different bug
  // (extraY snapping in only once a transition ended, fixed above by
  // animating it instead); confirmed on-console at 10 with that fix in.
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
        prevItem ? ce(FanCard, { key: fanKey(prevItem, 'l'), r: r, item: prevItem, rot: -FAN_DEG + 'deg', op: 0.9, extraY: FAN_LEFT_PIVOT_Y_ADJUST, cornerFix: true }) : null,
        nextItem ? ce(FanCard, { key: fanKey(nextItem, 'r'), r: r, item: nextItem, rot: FAN_DEG + 'deg', op: 0.9, cornerFix: true }) : null,
        ce(FanCard, { key: fanKey(curItem, 'c'), r: r, item: curItem, rot: '0deg', op: 1 })
      ];
    } else if (trans.dir === 'next') {
      cards = [
        trans.left ? ce(FanCard, {
          key: fanKey(trans.left, 'exit'), r: r, item: trans.left,
          rot: animT.interpolate({ inputRange: [0, 1], outputRange: [-FAN_DEG + 'deg', (-FAN_DEG - 15) + 'deg'] }),
          op: animT.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
          extraY: FAN_LEFT_PIVOT_Y_ADJUST, cornerFix: true
        }) : null,
        ce(FanCard, {
          key: fanKey(trans.cur, 'toLeft'), r: r, item: trans.cur,
          rot: animT.interpolate({ inputRange: [0, 1], outputRange: ['0deg', -FAN_DEG + 'deg'] }),
          op: animT.interpolate({ inputRange: [0, 1], outputRange: [1, 0.9] }),
          extraY: animT.interpolate({ inputRange: [0, 1], outputRange: [0, FAN_LEFT_PIVOT_Y_ADJUST] }),
          cornerFix: true
        }),
        ce(FanCard, {
          key: fanKey(trans.right, 'toCenter'), r: r, item: trans.right,
          rot: animT.interpolate({ inputRange: [0, 1], outputRange: [FAN_DEG + 'deg', '0deg'] }),
          op: animT.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }),
          cornerFix: true
        })
      ];
    } else { // 'prev' -- exact mirror of 'next'
      cards = [
        trans.right ? ce(FanCard, {
          key: fanKey(trans.right, 'exit'), r: r, item: trans.right,
          rot: animT.interpolate({ inputRange: [0, 1], outputRange: [FAN_DEG + 'deg', (FAN_DEG + 15) + 'deg'] }),
          op: animT.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
          cornerFix: true
        }) : null,
        ce(FanCard, {
          key: fanKey(trans.cur, 'toRight'), r: r, item: trans.cur,
          rot: animT.interpolate({ inputRange: [0, 1], outputRange: ['0deg', FAN_DEG + 'deg'] }),
          op: animT.interpolate({ inputRange: [0, 1], outputRange: [1, 0.9] }),
          cornerFix: true
        }),
        ce(FanCard, {
          key: fanKey(trans.left, 'toCenter'), r: r, item: trans.left,
          rot: animT.interpolate({ inputRange: [0, 1], outputRange: [-FAN_DEG + 'deg', '0deg'] }),
          op: animT.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }),
          extraY: animT.interpolate({ inputRange: [0, 1], outputRange: [FAN_LEFT_PIVOT_Y_ADJUST, 0] }),
          cornerFix: true
        })
      ];
    }
    return ce(View, { style: styles.coverFill },
      cards,
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

  // "Vitrine" cover layout (cfg.heroCover, first try -- see widget.js header
  // comment thread): inspired by the stock PS5 home screen's own full-width
  // promo banner for a featured game (title/blurb/buttons on the left, a big
  // piece of cover art on the right). That banner is a totally different,
  // editorial-only system component we can't reach from a widget -- this is
  // just our own layout built from the same View/Label/Image/wh.Title
  // building blocks every other mode here already uses, styled to evoke it.
  // L1/R1 just step the index directly (no fan to animate); Cross still
  // opens the game via the existing onPressed(B.Cross) handler above.
  function renderCoverHero(allItems, index, W, H, cfg) {
    var total = allItems.length;
    var item = allItems[index] || {};
    var pad = 28;
    var imgH = H - pad * 2;
    var imgW = Math.round(W * 0.4);
    return ce(View, { style: [styles.card, { width: W, height: H }] },
      ce(View, { lightMat: 'auto', style: styles.mat }),
      ce(View, { style: styles.heroBody },
        ce(View, { style: styles.heroLeft },
          ce(wh.Title, { iconId: cfg.iconId || 'game' }, cfg.title || 'Orbit Store'),
          ce(View, { style: { height: 16 } }),
          ce(Label, { style: styles.body18, numberOfLines: 2 }, String(item.title || item.titleId || '?')),
          ce(View, { style: { height: 6 } }),
          ce(Label, { style: [styles.small, styles.dim], numberOfLines: 1 },
            total > 1 ? ('Jeu ' + (index + 1) + ' / ' + total) : 'Dernier ajout'),
          ce(View, { style: { height: 12 } }),
          total > 1
            ? ce(Label, { style: [styles.small, styles.dim] }, 'Croix : jouer -- L1/R1 : changer de jeu')
            : ce(Label, { style: [styles.small, styles.dim] }, 'Croix : jouer')
        ),
        ce(View, { style: [styles.heroCoverFrame, { width: imgW, height: imgH }] },
          Image && item.cover
            ? ce(Image, { source: { uri: item.cover }, resizeMode: 'cover', style: { width: imgW, height: imgH } })
            : null)
      ));
  }

  // Cover mode, nothing to show yet (loading, errored, or an empty catalog):
  // the bare "no image" glyph centered in the same slot a real jaquette
  // would occupy, and the status line where the title/dots normally sit.
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

