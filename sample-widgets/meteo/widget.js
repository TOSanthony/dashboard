// meteo - weather widget, built with the Welcome Hub SDK.
//
// Fond transparent (pas de mat peinte) pour laisser voir le fond natif de la
// tuile du hub -- donc impossible de "fausser" un anneau/croissant en
// superposant un disque de la couleur exacte du fond (technique utilisee
// par horloge/orbit-latest pour border/ring) puisque ce fond n'est pas une
// couleur connue ici. Les icones sont donc des formes pleines (cercles,
// rectangles arrondis) + une fine ombre semi-transparente POSEE SUR la forme
// elle-meme (jamais sur le fond) pour suggerer le relief, et animees avec
// wh.Animated (loop/sequence/parallel) plutot que du SVG (ce moteur n'a pas
// d'element <svg> ni de WebView : seulement View/Text/Image).
//
// Donnees : Open-Meteo (gratuit, sans cle). Ville + unite (Celsius/Kelvin)
// choisies via config.json "settings" -> popup Options (Start) standard.
(function (wh) {
  var React = wh.React;
  var View = wh.View;
  var Label = wh.Label;
  var Animated = wh.Animated;
  var ce = React.createElement;
  var F = wh.FontSizePS;

  // ---------------------------------------------------------------------
  // Villes (reglage "city") -> coordonnees pour Open-Meteo.
  var CITIES = {
    paris: { label: 'Paris', lat: 48.8566, lon: 2.3522 },
    lyon: { label: 'Lyon', lat: 45.7640, lon: 4.8357 },
    marseille: { label: 'Marseille', lat: 43.2965, lon: 5.3698 },
    lehavre: { label: 'Le Havre', lat: 49.4944, lon: 0.1079 }
  };

  function weatherUrl(city) {
    return 'https://api.open-meteo.com/v1/forecast?latitude=' + city.lat +
      '&longitude=' + city.lon +
      '&current=temperature_2m,weather_code,is_day' +
      '&hourly=temperature_2m,weather_code' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
      '&timezone=auto&forecast_days=7&temperature_unit=celsius';
  }

  // WMO weather_code (Open-Meteo) -> groupe d'icone (meme decoupage que les
  // codes d'icone OpenWeatherMap 01/02/03/04/09/10/11/13/50, qui est la
  // convention des SVG fournis par l'utilisateur).
  function wmoGroup(code) {
    if (code === 0) return '01';
    if (code === 1) return '02';
    if (code === 2) return '03';
    if (code === 3) return '04';
    if (code === 45 || code === 48) return '50';
    if (code === 51 || code === 53 || code === 55 || code === 56 || code === 57) return '09';
    if (code === 61 || code === 63 || code === 65 || code === 66 || code === 67) return '10';
    if (code === 80 || code === 81 || code === 82) return '09';
    if (code === 71 || code === 73 || code === 75 || code === 77 || code === 85 || code === 86) return '13';
    if (code === 95 || code === 96 || code === 99) return '11';
    return '03';
  }

  var COND_FR = {
    '01': 'Ciel degage', '02': 'Peu nuageux', '03': 'Nuageux',
    '04': 'Couvert', '09': 'Averses', '10': 'Pluie',
    '11': 'Orage', '13': 'Neige', '50': 'Brouillard'
  };

  function fmtTemp(celsius, unit) {
    if (celsius == null || isNaN(celsius)) return '--';
    if (unit === 'k') return Math.round(celsius + 273.15) + 'K';
    return Math.round(celsius) + '°';
  }

  // ---------------------------------------------------------------------
  // Petits utilitaires d'animation (valeurs/loops reutilisables).
  function useAnimVal(initial) {
    var ref = React.useRef(null);
    if (!ref.current) ref.current = new Animated.Value(initial || 0);
    return ref.current;
  }
  // Lance factory(val) (qui doit retourner une Animated.CompositeAnimation)
  // au montage, l'arrete au demontage. delay decale juste le depart.
  function useLoopEffect(val, factory, delay) {
    React.useEffect(function () {
      var anim = null, to = null;
      function start() { anim = factory(val); anim.start(); }
      if (delay) to = setTimeout(start, delay); else start();
      return function () {
        if (to) clearTimeout(to);
        if (anim) anim.stop();
      };
      // eslint-disable-next-line
    }, []);
  }
  function spin(val, durMs) {
    val.setValue(0);
    return Animated.loop(Animated.timing(val, { toValue: 1, duration: durMs, useNativeDriver: false }));
  }
  function pingpong(val, durMsEach) {
    val.setValue(0);
    return Animated.loop(Animated.sequence([
      Animated.timing(val, { toValue: 1, duration: durMsEach, useNativeDriver: false }),
      Animated.timing(val, { toValue: 0, duration: durMsEach, useNativeDriver: false })
    ]));
  }
  function fallLoop(val, durMs) {
    val.setValue(0);
    return Animated.loop(Animated.timing(val, { toValue: 1, duration: durMs, useNativeDriver: false }));
  }
  function flicker(val) {
    val.setValue(0);
    return Animated.loop(Animated.sequence([
      Animated.timing(val, { toValue: 1, duration: 90, useNativeDriver: false }),
      Animated.timing(val, { toValue: 0.15, duration: 90, useNativeDriver: false }),
      Animated.timing(val, { toValue: 1, duration: 90, useNativeDriver: false }),
      Animated.timing(val, { toValue: 0.15, duration: 700, useNativeDriver: false }),
      Animated.timing(val, { toValue: 0.15, duration: 1200, useNativeDriver: false })
    ]));
  }

  // ---------------------------------------------------------------------
  // Formes de base (toutes en pixels entiers -- une forme tournee avec une
  // dimension fractionnaire ressort mal sur ce moteur, meme lecon que les
  // aiguilles de l'horloge).
  function disc(d, color, extra) {
    d = Math.max(1, Math.round(d));
    return [d, { width: d, height: d, borderRadius: Math.round(d / 2), backgroundColor: color }, extra];
  }
  function Circle(props) {
    var d = Math.max(1, Math.round(props.d));
    return ce(View, {
      style: {
        position: 'absolute', left: Math.round(props.x), top: Math.round(props.y),
        width: d, height: d, borderRadius: Math.round(d / 2),
        backgroundColor: props.color, opacity: props.opacity != null ? props.opacity : 1
      }
    });
  }
  function Bar(props) {
    var w = Math.max(1, Math.round(props.w)), h = Math.max(1, Math.round(props.h));
    return ce(View, {
      style: {
        position: 'absolute', left: Math.round(props.x), top: Math.round(props.y),
        width: w, height: h, borderRadius: Math.round(Math.min(w, h) / 2),
        backgroundColor: props.color, opacity: props.opacity != null ? props.opacity : 1
      }
    });
  }

  // Soleil : disque + 8 rayons portes par UN SEUL conteneur pivot anime en
  // rotation continue (meme technique pivot que Tick/Hand de l'horloge,
  // mais le conteneur lui-meme est un Animated.View tournant sans fin).
  function Sun(props) {
    var size = Math.round(props.size);
    var r = Math.round(size * 0.5);
    var spinVal = useAnimVal(0);
    useLoopEffect(spinVal, function (v) { return spin(v, 9000); });
    var deg = spinVal.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
    var rays = [];
    var rayLen = Math.max(2, Math.round(size * 0.18));
    var rayTh = Math.max(2, Math.round(size * 0.07));
    var inset = Math.max(1, Math.round(size * 0.04));
    for (var i = 0; i < 8; i++) {
      rays.push(ce(View, {
        key: 'r' + i,
        style: {
          position: 'absolute', left: r - r, top: r - r, width: size, height: size,
          transform: [{ rotate: (i * 45) + 'deg' }]
        }
      }, ce(View, {
        style: {
          position: 'absolute', left: r - Math.round(rayTh / 2), top: inset,
          width: rayTh, height: rayLen, borderRadius: Math.round(rayTh / 2),
          backgroundColor: props.color
        }
      })));
    }
    var sunD = Math.round(size * 0.58);
    return ce(View, { style: { position: 'absolute', left: Math.round(props.x), top: Math.round(props.y), width: size, height: size } },
      ce(Animated.View, { style: { position: 'absolute', width: size, height: size, transform: [{ rotate: deg }] } }, rays),
      ce(Circle, { x: r - Math.round(sunD / 2), y: r - Math.round(sunD / 2), d: sunD, color: props.color })
    );
  }

  // Lune : disque plein + ombrage partiel semi-transparent POSE SUR le
  // disque (jamais sur le fond -> marche quel que soit le fond de la tuile).
  function Moon(props) {
    var size = Math.round(props.size);
    var d = Math.round(size * 0.62);
    return ce(View, { style: { position: 'absolute', left: Math.round(props.x), top: Math.round(props.y), width: size, height: size } },
      ce(Circle, { x: Math.round((size - d) / 2), y: Math.round((size - d) / 2), d: d, color: '#cbd5e1' }),
      ce(Circle, { x: Math.round((size - d) / 2) + Math.round(d * 0.28), y: Math.round((size - d) / 2) - Math.round(d * 0.06), d: Math.round(d * 0.86), color: '#0000', opacity: 0 }),
      ce(View, {
        style: {
          position: 'absolute',
          left: Math.round((size - d) / 2) + Math.round(d * 0.30), top: Math.round((size - d) / 2) - Math.round(d * 0.05),
          width: Math.round(d * 0.86), height: Math.round(d * 0.86), borderRadius: Math.round(d * 0.43),
          backgroundColor: '#0b1020', opacity: 0.55
        }
      })
    );
  }

  // Nuage : base arrondie + 3 bosses (cercles) qui se chevauchent -- meme
  // esprit "formes pleines qui se superposent" que l'anneau de l'horloge,
  // mais ici les couleurs des bosses/base sont toutes connues d'avance (pas
  // besoin de matcher un fond), donc pas de probleme avec le fond transparent.
  function Cloud(props) {
    var w = Math.round(props.w), h = Math.round(props.h);
    var baseH = Math.round(h * 0.6);
    var x = Math.round(props.x), y = Math.round(props.y);
    var bump1 = Math.round(h * 0.62), bump2 = Math.round(h * 0.78), bump3 = Math.round(h * 0.58);
    return ce(View, { style: { position: 'absolute', left: x, top: y, width: w, height: h } },
      ce(Circle, { x: 0, y: h - baseH - Math.round(bump1 * 0.55), d: bump1, color: props.color }),
      ce(Circle, { x: Math.round(w * 0.30), y: h - baseH - Math.round(bump2 * 0.78), d: bump2, color: props.color }),
      ce(Circle, { x: w - bump3, y: h - baseH - Math.round(bump3 * 0.52), d: bump3, color: props.color }),
      ce(View, { style: { position: 'absolute', left: 0, top: h - baseH, width: w, height: baseH, borderRadius: Math.round(baseH / 2), backgroundColor: props.color } })
    );
  }

  // Goutte de pluie qui tombe en s'estompant, en boucle (translateY + opacity
  // pilotes par la meme valeur animee).
  function Raindrop(props) {
    var val = useAnimVal(0);
    useLoopEffect(val, function (v) { return fallLoop(v, props.duration || 900); }, props.delay || 0);
    var ty = val.interpolate({ inputRange: [0, 1], outputRange: [-Math.round(props.travel), Math.round(props.travel)] });
    var op = val.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 1, 0] });
    var w = Math.max(2, Math.round(props.w)), h = Math.max(4, Math.round(props.h));
    return ce(Animated.View, {
      style: {
        position: 'absolute', left: Math.round(props.x), top: Math.round(props.y),
        width: w, height: h, borderRadius: Math.round(w / 2),
        backgroundColor: props.color, opacity: op,
        transform: [{ translateY: ty }]
      }
    });
  }

  // Flocon : 3 barres croisees (asterisque) dans un conteneur qui tourne en
  // continu + une 2e valeur animee qui pilote la chute/disparition.
  function Snowflake(props) {
    var rot = useAnimVal(0);
    var fall = useAnimVal(0);
    useLoopEffect(rot, function (v) { return spin(v, 4000); }, props.delay || 0);
    useLoopEffect(fall, function (v) { return fallLoop(v, 1800); }, props.delay || 0);
    var deg = rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
    var ty = fall.interpolate({ inputRange: [0, 1], outputRange: [-Math.round(props.travel), Math.round(props.travel)] });
    var op = fall.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 1, 1, 0] });
    var size = Math.round(props.size);
    var th = Math.max(2, Math.round(size * 0.16));
    var bars = [0, 60, 120].map(function (a, i) {
      return ce(View, {
        key: i,
        style: {
          position: 'absolute', left: 0, top: 0, width: size, height: size,
          transform: [{ rotate: a + 'deg' }]
        }
      }, ce(View, {
        style: {
          position: 'absolute', left: Math.round((size - th) / 2), top: 0,
          width: th, height: size, borderRadius: Math.round(th / 2), backgroundColor: props.color
        }
      }));
    });
    return ce(Animated.View, {
      style: {
        position: 'absolute', left: Math.round(props.x), top: Math.round(props.y),
        width: size, height: size, opacity: op, transform: [{ translateY: ty }, { rotate: deg }]
      }
    }, bars);
  }

  // Eclair : zigzag approxime par 2 barres fines qui se croisent, opacite
  // clignotante.
  function Bolt(props) {
    var val = useAnimVal(1);
    useLoopEffect(val, function (v) { return flicker(v); }, props.delay || 0);
    var size = Math.round(props.size);
    return ce(Animated.View, {
      style: { position: 'absolute', left: Math.round(props.x), top: Math.round(props.y), width: size, height: size, opacity: val }
    },
      ce(View, { style: { position: 'absolute', left: Math.round(size * 0.46), top: 0, width: Math.max(2, Math.round(size * 0.16)), height: Math.round(size * 0.62), borderRadius: 3, backgroundColor: props.color, transform: [{ rotate: '18deg' }] } }),
      ce(View, { style: { position: 'absolute', left: Math.round(size * 0.30), top: Math.round(size * 0.42), width: Math.max(2, Math.round(size * 0.16)), height: Math.round(size * 0.62), borderRadius: 3, backgroundColor: props.color, transform: [{ rotate: '18deg' }] } })
    );
  }

  // Brouillard : 3 rangees de tirets qui derivent horizontalement, en
  // alternance (une rangee sur deux part dans l'autre sens).
  function FogBars(props) {
    var v1 = useAnimVal(0), v2 = useAnimVal(0);
    useLoopEffect(v1, function (v) { return pingpong(v, 3000); });
    useLoopEffect(v2, function (v) { return pingpong(v, 3000); }, 450);
    var amp = Math.round(props.w * 0.1);
    var tx1 = v1.interpolate({ inputRange: [0, 1], outputRange: [-amp, amp] });
    var tx2 = v2.interpolate({ inputRange: [0, 1], outputRange: [amp, -amp] });
    var rowH = Math.max(2, Math.round(props.h / 7));
    function row(y, tx, w) {
      return ce(Animated.View, { style: { position: 'absolute', left: Math.round((props.w - w) / 2), top: y, width: w, height: rowH, transform: [{ translateX: tx }] } },
        ce(View, { style: { position: 'absolute', left: 0, top: 0, width: w, height: rowH, borderRadius: Math.round(rowH / 2), backgroundColor: props.color } })
      );
    }
    return ce(View, { style: { position: 'absolute', left: Math.round(props.x), top: Math.round(props.y), width: props.w, height: props.h } },
      row(0, tx1, props.w),
      row(Math.round(props.h * 0.42), tx2, Math.round(props.w * 0.88)),
      row(Math.round(props.h * 0.84), tx1, Math.round(props.w * 0.7))
    );
  }

  // Compose l'icone complete pour un groupe (01/02/03/04/09/10/11/13/50)
  // dans une boite size x size, avec/sans soleil ou lune.
  function WeatherIcon(props) {
    var size = Math.round(props.size);
    var group = props.group || '03';
    var isDay = props.isDay !== false;
    var kids = [];
    var sunColor = '#fbbf24';
    function sunOrMoon(x, y, s) {
      return isDay ? ce(Sun, { key: 'sm', x: x, y: y, size: s, color: sunColor })
        : ce(Moon, { key: 'sm', x: x, y: y, size: s });
    }
    if (group === '01') {
      kids.push(sunOrMoon(size * 0.18, size * 0.18, size * 0.64));
    } else if (group === '02') {
      kids.push(sunOrMoon(size * 0.30, size * 0.04, size * 0.54));
      kids.push(ce(Cloud, { key: 'c', x: size * 0.04, y: size * 0.40, w: size * 0.78, h: size * 0.46, color: '#eef4fd' }));
    } else if (group === '03') {
      kids.push(ce(Cloud, { key: 'c', x: size * 0.10, y: size * 0.32, w: size * 0.80, h: size * 0.46, color: '#d9e3f0' }));
    } else if (group === '04') {
      kids.push(ce(Cloud, { key: 'c1', x: size * 0.30, y: size * 0.14, w: size * 0.62, h: size * 0.36, color: '#9ca3af' }));
      kids.push(ce(Cloud, { key: 'c2', x: size * 0.02, y: size * 0.40, w: size * 0.82, h: size * 0.46, color: '#eef4fd' }));
    } else if (group === '09' || group === '10') {
      kids.push(sunOrMoon(size * 0.04, size * 0.02, size * 0.40));
      kids.push(ce(Cloud, { key: 'c1', x: size * 0.34, y: size * 0.14, w: size * 0.58, h: size * 0.32, color: '#9ca3af' }));
      kids.push(ce(Cloud, { key: 'c2', x: size * 0.06, y: size * 0.32, w: size * 0.80, h: size * 0.40, color: '#eef4fd' }));
      var n = group === '10' ? 3 : 2;
      for (var i = 0; i < n; i++) {
        kids.push(ce(Raindrop, {
          key: 'd' + i, x: size * (0.26 + i * 0.22), y: size * 0.74,
          w: size * 0.045, h: size * 0.16, travel: size * 0.1,
          color: '#2563eb', duration: 800 + i * 120, delay: i * 180
        }));
      }
    } else if (group === '11') {
      kids.push(sunOrMoon(size * 0.04, size * 0.02, size * 0.40));
      kids.push(ce(Cloud, { key: 'c1', x: size * 0.34, y: size * 0.14, w: size * 0.58, h: size * 0.32, color: '#6b7280' }));
      kids.push(ce(Cloud, { key: 'c2', x: size * 0.06, y: size * 0.32, w: size * 0.80, h: size * 0.40, color: '#eef4fd' }));
      kids.push(ce(Bolt, { key: 'b', x: size * 0.32, y: size * 0.56, size: size * 0.4, color: '#2563eb' }));
    } else if (group === '13') {
      kids.push(sunOrMoon(size * 0.04, size * 0.02, size * 0.40));
      kids.push(ce(Cloud, { key: 'c1', x: size * 0.34, y: size * 0.14, w: size * 0.58, h: size * 0.32, color: '#9ca3af' }));
      kids.push(ce(Cloud, { key: 'c2', x: size * 0.06, y: size * 0.32, w: size * 0.80, h: size * 0.40, color: '#eef4fd' }));
      for (var j = 0; j < 3; j++) {
        kids.push(ce(Snowflake, {
          key: 'f' + j, x: size * (0.22 + j * 0.24), y: size * 0.70,
          size: size * 0.2, travel: size * 0.12, color: '#86c3db', delay: j * 300
        }));
      }
    } else { // '50' brouillard
      kids.push(ce(Cloud, { key: 'c1', x: size * 0.30, y: size * 0.08, w: size * 0.56, h: size * 0.30, color: '#9ca3af' }));
      kids.push(ce(Cloud, { key: 'c2', x: size * 0.04, y: size * 0.30, w: size * 0.78, h: size * 0.38, color: '#eef4fd' }));
      kids.push(ce(FogBars, { key: 'fog', x: size * 0.08, y: size * 0.66, w: size * 0.84, h: size * 0.28, color: '#9fb0c3' }));
    }
    return ce(View, { style: { width: size, height: size, position: 'relative' } }, kids);
  }

  // ---------------------------------------------------------------------
  // Recuperation des donnees (Open-Meteo). Rafraichi toutes les 10 min.
  // NOTE non testee sur console : on suppose que ce runtime a un acces
  // reseau Internet normal (comme le reste du systeme PS5), contrairement
  // aux autres widgets du depot qui ne parlent qu'a 127.0.0.1.
  function useWeather(cityId) {
    var st = React.useState(null); var data = st[0], setData = st[1];
    var est = React.useState(null); var err = est[0], setErr = est[1];
    var mounted = React.useRef(true);
    React.useEffect(function () {
      mounted.current = true;
      var city = CITIES[cityId] || CITIES.paris;
      function load() {
        fetch(weatherUrl(city), { headers: { Accept: 'application/json' } })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (!mounted.current) return;
            setData(j); setErr(null);
          })
          .catch(function (e) {
            if (mounted.current) setErr((e && e.message) || 'fetch failed');
          });
      }
      load();
      var id = setInterval(load, 10 * 60 * 1000);
      return function () { mounted.current = false; clearInterval(id); };
    }, [cityId]);
    return { data: data, err: err };
  }

  // Prochaines heures (a partir de "maintenant") depuis le tableau hourly.
  function nextHours(data, count) {
    if (!data || !data.hourly || !data.hourly.time) return [];
    var times = data.hourly.time, temps = data.hourly.temperature_2m, codes = data.hourly.weather_code;
    var nowIso = data.current && data.current.time;
    var startIdx = 0;
    if (nowIso) {
      for (var i = 0; i < times.length; i++) { if (times[i] >= nowIso) { startIdx = i; break; } }
    }
    var out = [];
    for (var k = 0; k < count && startIdx + k < times.length; k++) {
      var idx = startIdx + k;
      var hh = times[idx].slice(11, 13);
      out.push({ hour: hh + 'h', temp: temps[idx], code: codes[idx] });
    }
    return out;
  }

  function dayLabel(iso, idx) {
    if (idx === 0) return 'Auj.';
    var names = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    var d = new Date(iso + 'T12:00:00');
    return names[d.getDay()];
  }

  // ---------------------------------------------------------------------
  var styles = wh.StyleSheet.create({
    card: { overflow: 'hidden' },
    body: { flex: 1, padding: 16 },
    row: { flexDirection: 'row', alignItems: 'center' },
    between: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
    city: { opacity: 0.85 },
    cond: { opacity: 0.85, textAlign: 'right' },
    hl: { opacity: 0.6, textAlign: 'right' },
    hourCol: { alignItems: 'center' },
    dayCol: { alignItems: 'center' }
  });

  function Header(props) {
    return ce(View, { style: styles.between },
      ce(Label, { style: [styles.city, { fontSize: F.SizeSmall }] }, props.city),
      ce(View, null,
        ce(Label, { style: [styles.cond, { fontSize: F.Size3XSmall }] }, props.cond),
        ce(Label, { style: [styles.hl, { fontSize: F.Size4XSmall }] }, props.hl)
      )
    );
  }

  // DEFAULT ne fait que 152px de haut (120px une fois la marge du corps
  // retiree) : pas assez pour un en-tete + une rangee "temp/icone" + une
  // rangee horaire empiles (c'est ce qui causait le chevauchement de texte
  // -- un flex:1 au milieu, coince entre deux rangees deja trop hautes pour
  // la place disponible, ne peut que deborder). Ici tout tient sur UNE
  // seule rangee, sans flex:1, avec des tailles choisies pour que le total
  // (~80px) reste nettement sous les 120px disponibles.
  function DefaultView(props) {
    return ce(View, { style: [styles.row, { flex: 1, justifyContent: 'space-between', alignItems: 'center' }] },
      ce(View, null,
        ce(Label, { style: [styles.city, { fontSize: F.Size3XSmall }] }, props.cityLabel),
        ce(Label, { style: { fontSize: F.SizeXLarge, marginTop: 2 } }, props.tempStr)
      ),
      ce(View, { style: { alignItems: 'flex-end' } },
        ce(WeatherIcon, { group: props.group, isDay: props.isDay, size: 48 }),
        ce(Label, { style: [styles.cond, { fontSize: F.Size4XSmall, marginTop: 2 }] }, props.cond),
        ce(Label, { style: [styles.hl, { fontSize: F.Size4XSmall }] }, props.hl)
      )
    );
  }

  function FullView(props) {
    return ce(View, { style: { flex: 1, alignItems: 'center', justifyContent: 'center' } },
      ce(Label, { style: [styles.city, { fontSize: F.SizeNormal }] }, props.cityLabel),
      ce(View, { style: { marginVertical: 8 } }, ce(WeatherIcon, { group: props.group, isDay: props.isDay, size: 150 })),
      ce(Label, { style: { fontSize: F.Size3XLarge } }, props.tempStr),
      ce(Label, { style: [styles.cond, { textAlign: 'center', fontSize: F.SizeSmall, marginTop: 4 }] }, props.cond),
      ce(Label, { style: [styles.hl, { textAlign: 'center', fontSize: F.Size2XSmall, marginTop: 2 }] }, props.hl)
    );
  }

  function LargeView(props) {
    var d = props.data && props.data.daily;
    var days = [];
    if (d && d.time) {
      for (var i = 0; i < d.time.length && i < 7; i++) {
        days.push({
          label: dayLabel(d.time[i], i),
          group: wmoGroup(d.weather_code[i]),
          max: d.temperature_2m_max[i], min: d.temperature_2m_min[i]
        });
      }
    }
    return ce(View, { style: { flex: 1 } },
      ce(Header, { city: props.cityLabel, cond: 'Prevision 7 jours', hl: '' }),
      ce(View, { style: [styles.row, { flex: 1, justifyContent: 'space-between', marginTop: 8 }] },
        days.map(function (dd, i) {
          return ce(View, { key: i, style: styles.dayCol },
            ce(Label, { style: { fontSize: F.Size3XSmall, opacity: 0.75 } }, dd.label),
            ce(View, { style: { marginVertical: 4 } }, ce(WeatherIcon, { group: dd.group, isDay: true, size: 34 })),
            ce(Label, { style: { fontSize: F.Size3XSmall } }, fmtTemp(dd.max, props.unit)),
            ce(Label, { style: { fontSize: F.Size4XSmall, opacity: 0.55 } }, fmtTemp(dd.min, props.unit))
          );
        })
      )
    );
  }

  function Meteo(props) {
    var settings = props.settings || {};
    var cityId = settings.city || 'paris';
    var unit = settings.unit || 'c';
    var city = CITIES[cityId] || CITIES.paris;
    var w = useWeather(cityId);
    var data = w.data;

    var cur = data && data.current;
    var group = cur ? wmoGroup(cur.weather_code) : '03';
    var isDay = cur ? !!cur.is_day : true;
    var tempStr = cur ? fmtTemp(cur.temperature_2m, unit) : '--';
    var cond = COND_FR[group] || '';
    var today = data && data.daily;
    var hl = today ? ('H:' + fmtTemp(today.temperature_2m_max[0], unit) + '  L:' + fmtTemp(today.temperature_2m_min[0], unit)) : '';

    var W = props.width || 504, H = props.height || 152;
    var sz = props.size != null ? props.size : 1;
    var body;
    if (sz === 3) body = ce(FullView, { cityLabel: city.label, group: group, isDay: isDay, tempStr: tempStr, cond: cond, hl: hl });
    else if (sz === 2) body = ce(LargeView, { cityLabel: city.label, data: data, unit: unit });
    else body = ce(DefaultView, { cityLabel: city.label, data: data, unit: unit, group: group, isDay: isDay, tempStr: tempStr, cond: cond, hl: hl });

    return ce(View, { style: [styles.card, { width: W, height: H }] },
      ce(View, { style: styles.body }, body)
    );
  }

  wh.register(Meteo);
})(globalThis.__wh);
