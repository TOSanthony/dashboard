// sorties-jeux - prochaines sorties de jeux, via l'API IGDB (par Twitch).
//
// RAWG (la premiere version de ce widget) a un souci d'inscription
// recurrent et connu (erreurs serveur au moment de creer un compte,
// signale par plein de monde ces derniers mois) -- remplace par IGDB, qui
// passe par un compte Twitch (inscription nettement plus fiable).
//
// Pour obtenir les identifiants :
//   1. Un compte Twitch (le compte normal suffit, mais l'authentification
//      a deux facteurs doit etre activee dessus -- Parametres > Securite).
//   2. https://dev.twitch.tv/console/apps/create -> cree une appli
//      (categorie "Application Integration" ou "Website Integration",
//      URL de redirection peu importe ici puisqu'on n'utilise que le flux
//      "client credentials", ex. http://localhost).
//   3. Copie le Client ID genere, et clique "New Secret" pour le Client
//      Secret -- colle les deux ci-dessous.
//
// Comme pour RAWG, pas de champ de texte libre possible dans les reglages
// du Hub (seuls "choice"/"toggle" existent) donc ces deux valeurs se
// collent ici une bonne fois.
//
// Fond transparent comme meteo (pas de mat peinte). Plateforme et fenetre
// de temps choisies via config.json "settings" -> popup Options (Start),
// meme idiome que meteo/orbit-latest.
//
// NOTE non testee sur console : on suppose, comme pour meteo, un acces
// reseau Internet normal (id.twitch.tv + api.igdb.com), pas seulement
// 127.0.0.1.
(function (wh) {
  var React = wh.React;
  var View = wh.View;
  var Label = wh.Label;
  var Image = wh.Image;
  var ce = React.createElement;
  var F = wh.FontSizePS;

  var IGDB_CLIENT_ID = 'COLLE_TON_CLIENT_ID_TWITCH_ICI';
  var IGDB_CLIENT_SECRET = 'COLLE_TON_CLIENT_SECRET_TWITCH_ICI';

  // Id de plateforme IGDB (different du systeme RAWG) -- liste complete
  // sur https://api-docs.igdb.com/#platform si besoin de verifier/ajouter.
  var PLATFORM_IDS = {
    ps5: 167, ps4: 48, switch: 130, pc: 6, xboxseries: 169
  };

  // ---------------------------------------------------------------------
  // Jeton Twitch (client_credentials) : valable des semaines, mis en cache
  // en memoire (variable de module -- le runtime JS du hub tourne en
  // continu, pas besoin de persister sur disque).
  var tokenCache = { token: null, expiresAt: 0 };

  function fetchToken() {
    var url = 'https://id.twitch.tv/oauth2/token?client_id=' + encodeURIComponent(IGDB_CLIENT_ID) +
      '&client_secret=' + encodeURIComponent(IGDB_CLIENT_SECRET) +
      '&grant_type=client_credentials';
    return fetch(url, { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.access_token) {
          throw new Error((j && (j.message || j.error)) || 'reponse Twitch invalide');
        }
        tokenCache.token = j.access_token;
        // Marge de 60s pour ne jamais utiliser un jeton perime de justesse.
        tokenCache.expiresAt = Date.now() + (Math.max(0, (j.expires_in || 0) - 60)) * 1000;
        return tokenCache.token;
      });
  }

  function getToken() {
    if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
      return Promise.resolve(tokenCache.token);
    }
    return fetchToken();
  }

  // ---------------------------------------------------------------------
  function todayStartUnix() {
    var n = new Date();
    return Math.floor(new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime() / 1000);
  }
  function addDaysUnix(u, days) { return u + days * 86400; }

  // IGDB liste aussi bien les gros titres que la moindre petite sortie
  // inde du jour (il en sort plusieurs par semaine rien que sur PS5) -- vu
  // qu'on n'affiche de toute facon que les 4/7 premiers tries par date,
  // ca remplissait systematiquement les emplacements avec "ce qui sort
  // aujourd'hui", quelle que soit la fenetre choisie. Un essai avec
  // "game.hypes > 0" (nb de "follow" avant sortie) donnait une liste VIDE
  // en test reel -- la plupart des entrees IGDB n'ont pas de hypes du tout
  // (valeur null, pas 0), donc ce filtre les excluait quasiment toutes.
  // Retire. On garde seulement category=0 (jeu complet, pas DLC/bundle),
  // qui ne risque pas ce probleme (presque tous les jeux l'ont).
  function queryReleases(platformId, horizonDays, token) {
    var from = todayStartUnix(), to = addDaysUnix(from, horizonDays);
    var body = 'fields date,game.name,game.cover.image_id;' +
      ' where platform = ' + platformId +
      ' & date >= ' + from + ' & date <= ' + to +
      ' & game != null & game.cover != null' +
      ' & game.category = 0;' +
      ' sort date asc; limit 40;';
    return fetch('https://api.igdb.com/v4/release_dates', {
      method: 'POST',
      headers: {
        'Client-ID': IGDB_CLIENT_ID,
        Authorization: 'Bearer ' + token,
        Accept: 'application/json',
        'Content-Type': 'text/plain'
      },
      body: body
    }).then(function (r) {
      if (r.status === 401) { var e = new Error('401'); e.unauthorized = true; throw e; }
      return r.json();
    });
  }

  // "Aujourd'hui" / "Demain" / "Dans N jours" / date FR pour le reste.
  var MONTHS_FR = ['janv.', 'fevr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'aout', 'sept.', 'oct.', 'nov.', 'dec.'];
  function daysLabel(dateUnix) {
    var now = new Date(), rel = new Date(dateUnix * 1000);
    var relDay = new Date(rel.getFullYear(), rel.getMonth(), rel.getDate()).getTime();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var n = Math.round((relDay - today) / 86400000);
    if (n === 0) return "Aujourd'hui";
    if (n === 1) return 'Demain';
    if (n > 1 && n <= 13) return 'Dans ' + n + ' j';
    return rel.getDate() + ' ' + MONTHS_FR[rel.getMonth()];
  }

  function coverUrl(imageId) {
    return 'https://images.igdb.com/igdb/image/upload/t_cover_big/' + imageId + '.jpg';
  }

  // ---------------------------------------------------------------------
  function useReleases(platformKey, horizonDays) {
    var st = React.useState([]); var items = st[0], setItems = st[1];
    var est = React.useState(null); var err = est[0], setErr = est[1];
    var mounted = React.useRef(true);
    React.useEffect(function () {
      mounted.current = true;
      var platformId = PLATFORM_IDS[platformKey] || PLATFORM_IDS.ps5;
      function load(retried) {
        getToken()
          .then(function (token) { return queryReleases(platformId, horizonDays, token); })
          .then(function (j) {
            if (!mounted.current) return;
            if (!Array.isArray(j)) { setErr(String((j && (j.message || j.error)) || 'reponse IGDB invalide')); return; }
            var seen = {}, out = [];
            for (var i = 0; i < j.length; i++) {
              var row = j[i], g = row.game;
              if (!g || seen[g.id]) continue;
              seen[g.id] = true;
              out.push({
                id: g.id,
                title: g.name,
                released: row.date,
                cover: (g.cover && g.cover.image_id) ? coverUrl(g.cover.image_id) : null
              });
            }
            setItems(out);
            setErr(null);
          })
          .catch(function (e) {
            if (!mounted.current) return;
            if (e && e.unauthorized && !retried) {
              tokenCache.token = null;
              load(true);
              return;
            }
            setErr((e && e.message) || 'fetch failed');
          });
      }
      load(false);
      var id = setInterval(function () { load(false); }, 60 * 60 * 1000);
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
