// jeux-favoris - lancement rapide des jeux installes, sans liste de favoris a
// configurer a la main : les reglages du Hub ne supportent que des listes
// d'options FIXES (choice/toggle), jamais une liste dynamique construite a
// partir de ce qui est reellement installe -- donc impossible de proposer
// "coche tes 4 jeux preferes" dans le popup Options. A la place : la liste
// reelle des jeux installes, triee par defaut par "joue le plus recemment",
// ce qui revient au meme pour l'usage courant (relancer vite le dernier
// jeu) sans jamais avoir besoin d'aller re-configurer le widget.
//
// Donnees et jaquettes : /__apps et /__app_icon?id=... sur le serveur local
// du payload (127.0.0.1:8098, voir applist.h/.c + server.c -- NOUVEAU,
// jamais teste sur une vraie console). Lancement : meme mecanisme que
// Orbit Store (VshNMApplicationLinkingPSModule.OpenURL('psgm:play?id=...')
// via base_dll), deja confirme fonctionnel sur console reelle par ce
// projet pour PPSA99177 -- ici generalise a n'importe quel titleId installe.
(function (wh) {
  var React = wh.React;
  var View = wh.View;
  var Label = wh.Label;
  var Image = wh.Image;
  var ce = React.createElement;
  var F = wh.FontSizePS;

  function log(msg) { try { if (wh.log) wh.log(String(msg)); } catch (e) {} }

  // Identique a orbit-latest/widget.js (deja verifie sur console reelle pour
  // PPSA99177) -- seul titleId change ici d'un appel a l'autre.
  function launchGame(titleId) {
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
      var target = 'psgm:play?id=' + titleId;
      Promise.resolve(link.CanOpenURL(target)).then(function (can) {
        if (!can) { log('launch: CanOpenURL false for ' + titleId); return; }
        return Promise.resolve(link.OpenURL(target)).then(function () { log('launch: OpenURL resolved for ' + titleId); });
      }).catch(function (e) { log('launch: EXCEPTION ' + ((e && e.message) || e)); });
    } catch (e) {
      log('launch: top-level EXCEPTION ' + ((e && e.message) || e));
    }
  }

  function useApps(tri) {
    var st = React.useState([]); var items = st[0], setItems = st[1];
    var est = React.useState(null); var err = est[0], setErr = est[1];
    var mounted = React.useRef(true);
    React.useEffect(function () {
      mounted.current = true;
      function load() {
        fetch('http://127.0.0.1:8098/__apps', { headers: { Accept: 'application/json' } })
          .then(function (r) {
            // Sur un 500 (app.db illisible cote payload, voir wh.log) le
            // corps est vide : r.json() planterait avec un message cryptique
            // ("Unexpected end of input"). On distingue ce cas pour afficher
            // un message clair, et on log le code pour le debug sur console.
            if (!r.ok) { log('GET /__apps -> ' + r.status); throw new Error('serveur /__apps: ' + r.status); }
            return r.json();
          })
          .then(function (j) {
            if (!mounted.current) return;
            var list = Array.isArray(j) ? j.slice() : [];
            if (tri === 'alpha') {
              list.sort(function (a, b) { return String(a.title).localeCompare(String(b.title)); });
            }
            setItems(list); setErr(null);
          })
          .catch(function (e) {
            if (mounted.current) setErr((e && e.message) || 'fetch failed');
          });
      }
      load();
      var id = setInterval(load, 2 * 60 * 1000);
      return function () { mounted.current = false; clearInterval(id); };
    }, [tri]);
    return { items: items, err: err };
  }

  // ---------------------------------------------------------------------
  var styles = wh.StyleSheet.create({
    card: { overflow: 'hidden' },
    body: { flex: 1, padding: 16 },
    row: { flexDirection: 'row', alignItems: 'center' },
    dim: { opacity: 0.6 },
    listRow: { marginBottom: 8 },
    // Meme precaution que orbit-latest/sorties-jeux : un borderRadius pose
    // directement sur une Image n'est pas fiable sur ce moteur -- on clippe
    // via la View wrapper (overflow:'hidden' + borderRadius dessus).
    cover: { borderRadius: 6, marginRight: 10, backgroundColor: '#263a58', overflow: 'hidden' },
    coverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
    rowFocused: { opacity: 0.7 }
  });

  function Cover(props) {
    var s = props.size;
    return ce(View, { style: [styles.cover, { width: s, height: s }] },
      (Image && props.uri)
        ? ce(Image, { source: { uri: props.uri }, resizeMode: 'cover', style: { width: s, height: s } })
        : ce(View, { style: [styles.coverPlaceholder, { width: s, height: s }] },
            ce(Label, { style: styles.dim }, '?'))
    );
  }
  function iconUrl(item) {
    return item.icon ? ('http://127.0.0.1:8098/__app_icon?id=' + encodeURIComponent(item.id)) : null;
  }

  // Une rangee pressable : X (ou le press manette/TV) lance le jeu.
  function GameRow(props) {
    var item = props.item, coverSize = props.coverSize;
    return ce(wh.Focusable, {
      onPress: function () { launchGame(item.id); },
      style: [styles.row, styles.listRow],
      focusedStyle: styles.rowFocused
    }, function () {
      return ce(View, { style: { flexDirection: 'row', alignItems: 'center', flex: 1 } },
        ce(Cover, { uri: iconUrl(item), size: coverSize }),
        ce(Label, { style: { flex: 1, fontSize: props.titleSize }, numberOfLines: 1 }, item.title || item.id)
      );
    });
  }

  // DEFAULT (152px, ~120px utiles) : le jeu le plus recent, en grand.
  function DefaultView(props) {
    var item = props.items[0];
    if (!item) return ce(Label, { style: styles.dim }, 'Aucun jeu installe');
    return ce(wh.Focusable, {
      onPress: function () { launchGame(item.id); },
      style: { flex: 1 },
      focusedStyle: styles.rowFocused
    }, function () {
      return ce(View, { style: [styles.row, { flex: 1 }] },
        ce(Cover, { uri: iconUrl(item), size: 88 }),
        ce(View, { style: { flex: 1 } },
          ce(Label, { style: [styles.dim, { fontSize: F.Size4XSmall }] }, 'Continuer'),
          ce(Label, { style: { fontSize: F.SizeSmall, marginTop: 2 }, numberOfLines: 2 }, item.title || item.id)
        )
      );
    });
  }

  // LARGE (328px, ~296px utiles) : les 4 plus recents/premiers (selon tri).
  function LargeView(props) {
    return ce(View, { style: { flex: 1 } },
      props.items.slice(0, 4).map(function (it, i) {
        return ce(GameRow, { key: it.id || i, item: it, coverSize: 56, titleSize: F.Size3XSmall });
      })
    );
  }

  // FULL (504px, ~472px utiles) : les 7 premiers.
  function FullView(props) {
    return ce(View, { style: { flex: 1 } },
      props.items.slice(0, 7).map(function (it, i) {
        return ce(GameRow, { key: it.id || i, item: it, coverSize: 56, titleSize: F.Size3XSmall });
      })
    );
  }

  function JeuxFavoris(props) {
    var settings = props.settings || {};
    var tri = settings.tri || 'recents';
    var a = useApps(tri);
    var items = a.items;

    var W = props.width || 504, H = props.height || 152;
    var sz = props.size != null ? props.size : 1;
    var body;
    if (a.err) {
      body = ce(Label, { style: styles.dim, numberOfLines: 3 }, 'Erreur: ' + a.err);
    } else if (sz === 3) {
      body = ce(FullView, { items: items });
    } else if (sz === 2) {
      body = ce(LargeView, { items: items });
    } else {
      body = ce(DefaultView, { items: items });
    }

    return ce(View, { style: [styles.card, { width: W, height: H }] },
      ce(View, { style: styles.body }, body)
    );
  }

  wh.register(JeuxFavoris);
})(globalThis.__wh);
