// horloge - live clock widget, digital or analog, built with the Welcome Hub SDK.
//
// Follows the same stock-look building blocks as the official SDK reference
// widgets (hello-wh, orbit-latest):
//   wh.Title      stock title row (icon + bold text)
//   wh.Label      stock text (theme color, font scaling capped)
//   props         config / focused / editing / size / width / height from the loader
//
// Settings (mode, format, seconds) are declared in config.json's "settings"
// array, which gives the widget a free Options (Start) popup -- the same
// stock menu Orbit Store's "Mode d'affichage" uses -- with no popup UI code
// of our own. The chosen values just show up on props.settings.
(function (wh) {
  var React = wh.React;
  var View = wh.View;
  var Label = wh.Label;
  var ce = React.createElement;
  var F = wh.FontSizePS;

  // The mat's own fill color: used to fake the dial's ring (see AnalogClock)
  // since plain borderWidth/borderColor is confirmed NOT to render in this
  // runtime (same finding as orbit-latest's GridCell selection ring) -- a
  // "border" here is really a smaller same-color disc peeking out from
  // behind a larger, differently-colored one.
  var MAT = '#17191ef0';

  var styles = wh.StyleSheet.create({
    card: { borderRadius: 16, overflow: 'hidden' },
    // stock mat: #17191E + native lightMat sheen
    mat: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: MAT, borderRadius: 16
    },
    body: { flex: 1, padding: 16 },
    clockArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    digital: { textAlign: 'center' },
    centerDot: { position: 'absolute', borderRadius: 999, backgroundColor: '#ffffff' },
    hand: { position: 'absolute' },
    tickWrap: { position: 'absolute' },
    numeral: { position: 'absolute', textAlign: 'center' }
  });

  // Ascending wh.FontSizePS values (RNPS throws on any other fontSize).
  var FSIZES = [15, 18, 21, 24, 27, 30, 36, 45, 54, 72];

  // Picks the largest stock font size whose rendered box still fits the
  // space the clock area has, so the digits scale with the widget's size
  // (DEFAULT/LARGE/FULL, and any in-between width from L1/R1 resize).
  function pickDigitalFontSize(boxW, boxH, chars) {
    var best = FSIZES[0];
    for (var i = 0; i < FSIZES.length; i++) {
      var fs = FSIZES[i];
      var neededH = fs * 1.3;
      var neededW = fs * 0.62 * chars;
      if (neededH <= boxH && neededW <= boxW) best = fs; else break;
    }
    return best;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function DigitalClock(props) {
    var d = props.date;
    var use12 = props.format === '12';
    var hr = d.getHours(), ampm = '';
    if (use12) { ampm = hr < 12 ? ' AM' : ' PM'; hr = hr % 12 || 12; }
    var text = (use12 ? hr : pad(hr)) + ':' + pad(d.getMinutes()) +
      (props.showSeconds ? ':' + pad(d.getSeconds()) : '') + ampm;
    var chars = text.length;
    var fs = pickDigitalFontSize(props.boxW, props.boxH, chars);
    return ce(Label, { style: [styles.digital, { fontSize: fs }] }, text);
  }

  // A clock hand drawn as a thin rounded bar inside a square container whose
  // own center is the pivot point: rotating the container (RN rotates around
  // a view's own center by default) rotates the hand around that pivot with
  // no transformOrigin dependency.
  function Hand(props) {
    var size = props.radius * 2;
    return ce(View, {
      style: [styles.hand, {
        left: props.cx - props.radius, top: props.cy - props.radius,
        width: size, height: size,
        transform: [{ rotate: props.angle + 'deg' }]
      }]
    },
      ce(View, {
        style: {
          position: 'absolute',
          left: props.radius - props.thickness / 2,
          top: props.radius - props.length,
          width: props.thickness, height: props.length,
          borderRadius: props.thickness / 2,
          backgroundColor: props.color
        }
      })
    );
  }

  // A short radial mark near the rim: same pivot-container technique as
  // Hand, but the bar sits just inside the edge instead of spanning out
  // from the center.
  function Tick(props) {
    var size = props.radius * 2;
    return ce(View, {
      style: [styles.tickWrap, {
        left: props.cx - props.radius, top: props.cy - props.radius,
        width: size, height: size,
        transform: [{ rotate: props.angle + 'deg' }]
      }]
    },
      ce(View, {
        style: {
          position: 'absolute',
          left: props.radius - props.thickness / 2, top: props.inset,
          width: props.thickness, height: props.len,
          borderRadius: props.thickness / 2,
          backgroundColor: props.color
        }
      })
    );
  }

  // Dial faces, selectable from the stock Options popup (config.json's
  // "dial" setting) -- same free-popup mechanism as "mode"/"format".
  function faceRing(r, cx, cy) {
    var th = Math.max(2, Math.round(r * 0.035));
    return [
      ce(View, { key: 'ring', style: { position: 'absolute', left: cx - r, top: cy - r, width: r * 2, height: r * 2, borderRadius: r, backgroundColor: '#ffffff40' } }),
      ce(View, { key: 'ringcut', style: { position: 'absolute', left: cx - r + th, top: cy - r + th, width: (r - th) * 2, height: (r - th) * 2, borderRadius: r - th, backgroundColor: MAT } })
    ];
  }
  function faceTicks(r, cx, cy) {
    var out = [];
    for (var i = 0; i < 12; i++) {
      var major = i % 3 === 0;
      out.push(ce(Tick, {
        key: 't' + i, cx: cx, cy: cy, radius: r, angle: i * 30,
        inset: r * 0.06, len: major ? r * 0.14 : r * 0.08,
        thickness: major ? Math.max(2, r * 0.035) : Math.max(1, r * 0.02),
        color: major ? '#ffffff' : '#ffffff80'
      }));
    }
    return out;
  }
  function faceNumerals(r, cx, cy) {
    var out = [];
    var fs = r >= 70 ? 21 : r >= 50 ? 18 : 15;
    var nr = r * 0.74;
    for (var i = 1; i <= 12; i++) {
      var ang = i * 30 * Math.PI / 180;
      var x = cx + nr * Math.sin(ang), y = cy - nr * Math.cos(ang);
      out.push(ce(Label, {
        key: 'n' + i,
        style: [styles.numeral, { left: x - 16, top: y - fs * 0.7, width: 32, fontSize: fs }]
      }, String(i)));
    }
    return out;
  }

  function AnalogClock(props) {
    var d = props.date;
    var r = Math.max(20, Math.floor(Math.min(props.boxW, props.boxH) / 2) - 4);
    var cx = r, cy = r;
    var h = d.getHours() % 12, m = d.getMinutes(), s = d.getSeconds(), ms = d.getMilliseconds();
    var secFrac = s + ms / 1000;
    var hourAngle = (h + m / 60) * 30;
    var minAngle = (m + secFrac / 60) * 6;
    var secAngle = secFrac * 6;
    var dial = props.dial || 'graduated';

    var kids = faceRing(r, cx, cy);
    if (dial === 'graduated') kids = kids.concat(faceTicks(r, cx, cy));
    else if (dial === 'numbers') kids = kids.concat(faceNumerals(r, cx, cy));

    kids.push(ce(Hand, { key: 'h', cx: cx, cy: cy, radius: r, length: r * 0.5, thickness: Math.max(3, r * 0.08), color: '#ffffff', angle: hourAngle }));
    kids.push(ce(Hand, { key: 'm', cx: cx, cy: cy, radius: r, length: r * 0.75, thickness: Math.max(2, r * 0.055), color: '#ffffff', angle: minAngle }));
    if (props.showSeconds) {
      kids.push(ce(Hand, { key: 's', cx: cx, cy: cy, radius: r, length: r * 0.85, thickness: Math.max(1, r * 0.02), color: '#ff5b5b', angle: secAngle }));
    }
    kids.push(ce(View, {
      key: 'dot',
      style: [styles.centerDot, { left: cx - 4, top: cy - 4, width: 8, height: 8 }]
    }));

    return ce(View, { style: { width: r * 2, height: r * 2 } }, kids);
  }

  function Horloge(props) {
    var s = React.useState(Date.now());
    var now = s[0], setNow = s[1];
    var mounted = React.useRef(true);
    React.useEffect(function () {
      mounted.current = true;
      var id = setInterval(function () { if (mounted.current) setNow(Date.now()); }, 1000);
      return function () { mounted.current = false; clearInterval(id); };
    }, []);

    var cfg = props.config || {};
    var settings = props.settings || {};
    var mode = settings.mode || 'digital';
    var format = settings.format || '24';
    var dial = settings.dial || 'graduated';
    var showSeconds = settings.seconds !== false;

    // Fill the tile the grid gives us (L1/R1 resize changes size/width/height
    // in edit mode), same layout math as the other reference widgets.
    var W = props.width || 504, H = props.height || 152;
    var pad2 = 32, titleH = 40, gap = 8;
    var boxW = Math.max(1, W - pad2);
    var boxH = Math.max(1, H - pad2 - titleH - gap);

    var d = new Date(now);
    var clock = mode === 'analog'
      ? ce(AnalogClock, { date: d, boxW: boxW, boxH: boxH, dial: dial, showSeconds: showSeconds })
      : ce(DigitalClock, { date: d, boxW: boxW, boxH: boxH, format: format, showSeconds: showSeconds });

    return ce(View, { style: [styles.card, { width: W, height: H }] },
      ce(View, { lightMat: 'auto', style: styles.mat }),
      ce(View, { style: styles.body },
        ce(wh.Title, { iconId: cfg.iconId || 'date_time' }, cfg.title || 'Horloge'),
        ce(View, { style: styles.clockArea }, clock)
      )
    );
  }

  wh.register(Horloge);
})(globalThis.__wh);
