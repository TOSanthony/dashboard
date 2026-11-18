// sorties-jeux - prochaines sorties de jeux, via l'API RAWG (gratuite, cle
// perso requise -- voir RAWG_API_KEY juste en dessous).
//
// Fond transparent comme meteo (pas de mat peinte). Plateforme et fenetre
// de temps choisies via config.json "settings" -> popup Options (Start)
// standard, meme idiome que meteo/orbit-latest.
//
// NOTE non testee sur console : on suppose, comme pour meteo, un acces
// reseau Internet normal (api.rawg.io), pas seulement 127.0.0.1.
(function (wh) {
  var React = wh.React;
  var View = wh.View;
  var Label = wh.Label;
  var Image = wh.Image;
  var ce = React.createElement;
  var F = wh.FontSizePS;

  // ---------------------------------------------------------------------
  // RAWG exige une cle API sur CHAQUE requete (sinon elle peut etre bannie).
  // Pas de champ de texte libre possible dans les reglages du Hub (seuls
  // "choice"/"toggle" existent), donc la cle se colle ici une bonne fois --
  // gratuite et instantanee sur https://rawg.io/apidocs.
  var RAWG_API_KEY = 'COLLE_TA_CLE_RAWG_ICI';

  // Id de plateforme RAWG -- a verifier sur le compte reel (GET
  // https://api.rawg.io/api/platforms?key=... s'ils donnent des resultats
  // qui ne correspondent pas a la plateforme choisie dans les reglages).
  var PLATFORM_IDS = {
    ps5: 187, ps4: 18, switch: 7, pc: 4, xboxseries: 186
  };

  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function isoOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function todayIso() { return isoOf(new Date()); }
  function addDaysIso(iso, days) {
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return isoOf(d);
  }
  function releasesUrl(platformId, horizonDays) {
    var from = todayIso(), to = addDaysIso(from, horizonDays);
    return 'https://api.rawg.io/api/games?key=' + encodeURIComponent(RAWG_API_KEY) +
      '&dates=' + from + ',' + to +
      '&platforms=' + platformId +
      '&ordering=released&page_size=20';
  }

  // "Aujourd'hui" / "Demain" / "Dans N jours" / date FR pour le reste.
  var MONTHS_FR = ['janv.', 'fevr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'aout', 'sept.', 'oct.', 'nov.', 'dec.'];
  function daysLabel(iso) {
    var now = new Date(), rel = new Date(iso + 'T00:00:00');
    var ms = rel.setHours(0, 0, 0, 0) - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var n = Math.round(ms / 86400000);
    if (n === 0) return "Aujourd'hui";
    if (n === 1) return 'Demain';
    if (n > 1 && n <= 13) return 'Dans ' + n + ' j';
    var d = new Date(iso + 'T00:00:00');
    return d.getDate() + ' ' + MONTHS_FR[d.getMonth()];
  }

  // ---------------------------------------------------------------------
  function useReleases(platformKey, horizonDays) {
    var st = React.useState([]); var items = st[0], setItems = st[1];
    var est = React.useState(null); var err = est[0], setErr = est[1];
    var mounted = React.useRef(true);
    React.useEffect(function () {
      mounted.current = true;
      var platformId = PLATFORM_IDS[platformKey] || PLATFORM_IDS.ps5;
      function load() {
        fetch(releasesUrl(platformId, horizonDays), { headers: { Accept: 'application/json' } })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (!mounted.current) return;
            if (j && j.detail) { setErr(String(j.detail)); return; }
            var results = (j && j.results) || [];
            setItems(results.map(function (g) {
              return { id: g.id, title: g.name, released: g.released, cover: g.background_image };
            }));
            setErr(null);
          })
          .catch(function (e) {
            if (mounted.current) setErr((e && e.message) || 'fetch failed');
          });
      }
      load();
      var id = setInterval(load, 60 * 60 * 1000);
      return function () { mounted.current = false; clearInterval(id); };
    }, [platformKey, horizonDays]);
    return { items: items, err: err };
  }

  // ---------------------------------------------------------------------
  var styles = wh.StyleSheet.create({
    card: { overflow: 'hidden' },
    body: { flex: 1, padding: 16 },
    row: { flexDirection: 'row', alignItems: 'center' },
    dim: { opacity: 0.6 },
    header: { opacity: 0.85, marginBottom: 6 },
    // Meme precaution que orbit-latest : borderRadius pose directement sur
    // une Image (ou herite d'un ancetre eloigne) n'est pas fiable sur ce
    // moteur -- on clippe via une View wrapper qui porte elle-meme
    // overflow:'hidden' + borderRadius.
    cover: { borderRadius: 6, marginRight: 10, backgroundColor: '#263a58', overflow: 'hidden' },
    coverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
    listRow: { marginBottom: 8 }
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

  function ReleaseRow(props) {
    var item = props.item, coverSize = props.coverSize;
    return ce(View, { style: [styles.row, styles.listRow] },
      ce(Cover, { uri: item.cover, size: coverSize }),
      ce(View, { style: { flex: 1 } },
        ce(Label, { style: { fontSize: props.titleSize }, numberOfLines: 1 }, item.title || '?'),
        ce(Label, { style: [styles.dim, { fontSize: F.Size4XSmall, marginTop: 2 }] }, daysLabel(item.released))
      )
    );
  }

  // DEFAULT (152px, ~120px utiles) : juste la prochaine sortie.
  function DefaultView(props) {
    var item = props.items[0];
    if (!item) return ce(Label, { style: styles.dim }, 'Aucune sortie prevue');
    return ce(View, { style: [styles.row, { flex: 1 }] },
      ce(Cover, { uri: item.cover, size: 88 }),
      ce(View, { style: { flex: 1 } },
        ce(Label, { style: [styles.dim, { fontSize: F.Size4XSmall }] }, 'Prochaine sortie'),
        ce(Label, { style: { fontSize: F.SizeSmall, marginTop: 2 }, numberOfLines: 2 }, item.title),
        ce(Label, { style: { fontSize: F.Size3XSmall, marginTop: 4 } }, daysLabel(item.released))
      )
    );
  }

  // LARGE (328px, ~296px utiles) : les 4 prochaines.
  function LargeView(props) {
    return ce(View, { style: { flex: 1 } },
      ce(Label, { style: [styles.header, { fontSize: F.Size3XSmall }] }, 'Prochaines sorties'),
      props.items.slice(0, 4).map(function (it, i) {
        return ce(ReleaseRow, { key: it.id || i, item: it, coverSize: 56, titleSize: F.Size3XSmall });
      })
    );
  }

  // FULL (504px, ~472px utiles) : les 7 prochaines.
  function FullView(props) {
    return ce(View, { style: { flex: 1 } },
      ce(Label, { style: [styles.header, { fontSize: F.SizeSmall }] }, 'Prochaines sorties'),
      props.items.slice(0, 7).map(function (it, i) {
        return ce(ReleaseRow, { key: it.id || i, item: it, coverSize: 56, titleSize: F.Size3XSmall });
      })
    );
  }

  function SortiesJeux(props) {
    var settings = props.settings || {};
    var platform = settings.platform || 'ps5';
    var horizon = parseInt(settings.horizon || '90', 10);
    var rel = useReleases(platform, horizon);
    var items = rel.items;

    var W = props.width || 504, H = props.height || 152;
    var sz = props.size != null ? props.size : 1;
    var body;
    if (rel.err) {
      body = ce(Label, { style: styles.dim, numberOfLines: 3 }, 'Erreur: ' + rel.err);
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

  wh.register(SortiesJeux);
})(globalThis.__wh);
