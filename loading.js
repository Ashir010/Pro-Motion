(function () {
  'use strict';

  var REDUCED = window.matchMedia &&
                window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ═══════════════════════════════════════════════════════════════
     GRADIENT WAVES — background configuration

     These are the <GradientWaves /> props, one-for-one. Every entry
     below is bound to a shader uniform of the same name, so tuning
     the look means editing this object and nothing else.
     ═══════════════════════════════════════════════════════════════ */
  var WAVES = {
    horizonColor: '#fbfbfb',   // sky + far fog
    waveColor:    '#0f0e0f',   // trough / body of the water
    crestColor:   '#FFFFFF',   // wave tops and specular

    speed:        0.4,         // time multiplier
    amplitude:    2.5,         // vertical scale of the surface
    waveScale:    0.6,         // spatial frequency
    waveRatio:    0.9,         // x/z anisotropy — <1 stretches swells along z
    swell:        35,          // strength of the low-frequency rolling trains
    turbulence:   20,          // strength of the high-frequency chop

    tilt:         1.11,        // camera pitch — raises/lowers the horizon
    zoom:         1,           // focal length; >1 narrows the field of view
    height:       5.5,         // camera elevation above mean water level
    fogDepth:     15,          // distance over which colour washes to horizon

    detail:       'medium',    // 'low' | 'medium' | 'high' — octaves + march steps
    brightness:   1,
    opacity:      1,

    mouseInteraction: true,
    parallaxStrength: 0.5,

    grain:            true,
    grainIntensity:   0.05
  };

  var DETAIL = {
    low:    { oct: 3, steps: 40, scale: 0.45 },
    medium: { oct: 4, steps: 56, scale: 0.55 },
    high:   { oct: 6, steps: 88, scale: 0.70 }
  };

  /* ═══════════════════════════════════════════════════════════════
     CHROME KNOT — the object that materialises behind the wordmark

     A torus knot lit by a procedural studio rather than a texture, so
     it stays in the same greyscale register as the water. Its colour
     comes only from dispersion: R and B sample the environment along
     slightly different reflection vectors, so every black/white edge
     fringes warm on one side and cool on the other.
     ═══════════════════════════════════════════════════════════════ */
  var KNOT = {
    p: 2, q: 3,          // trefoil
    tube: 0.52,          // thickness relative to the curve radius

    size:       0.52,    // on-screen diameter as a fraction of viewport height
    widthLimit: 0.60,    // ...and never more than this fraction of the width
    offsetY:   -0.05,    // nudged down so the wordmark rides its upper third

    fov:        32,
    distance:   5.2,
    spin:       0.22,    // radians per second about the primary axis
    parallax:   0.30,    // pointer-driven tilt

    level:      0.46,    // environment value that splits black from white
    contrast:   0.13,    // half-width of that split — smaller is harder marbling
    dispersion: 0.085,   // reflection offset between the R and B samples
    rim:        0.52,    // fresnel whitening at grazing angles
    gloss:      0.95,    // strength of the sharp specular

    /* Glass, not a solid: the body lets the water through at this alpha
       while the silhouette and the highlights stay opaque, which is how
       a real transparent object holds its shape. Thin enough that the
       waves read continuously through the flat faces — the object should
       sit in the water, not on top of it. */
    opacity:    0.22
  };

  /* ═══════════════════════════════════════════════════════════════
     PROGRESS MODEL
     Drive it yourself:  ProMotionLoader.set(0.42)  /  .finish()
     Otherwise it eases toward 94% and completes on window load.
     ═══════════════════════════════════════════════════════════════ */

  // Shortest time the loader may stay on screen, so the entrance stagger and
  // ring sweep always get to play even when the page is already cached.
  var MIN_MS = REDUCED ? 900 : 2800;

  var Loader = {
    request: 0,     // value asked for from outside
    target: 0,      // where progress is allowed to go (0..1)
    current: 0,     // eased value actually shown
    manual: false,  // true once .set() is called
    forced: false,  // true once .finish() is called
    done: false
  };

  window.ProMotionLoader = {
    set: function (v) {
      Loader.manual = true;
      Loader.request = Math.max(Loader.request, Math.min(1, Math.max(0, v)));
    },
    finish: function () { Loader.forced = true; Loader.request = 1; },
    get progress() { return Loader.current; }
  };

  var pageLoaded = false;
  window.addEventListener('load', function () { pageLoaded = true; });

  var t0 = performance.now();

  function driveTarget() {
    var ms = performance.now() - t0;

    // Synthetic curve: fast start, believable stall short of the end.
    var ceiling = Math.min(0.94, 1 - Math.exp(-(ms / 1000) * 0.62));

    var want = Loader.manual ? Loader.request
             : (Loader.forced || pageLoaded) ? 1
             : ceiling;
    if (Loader.forced) { want = 1; }
    if (ms < MIN_MS) { want = Math.min(want, ceiling); }

    Loader.target = Math.max(Loader.target, Math.min(1, want));
  }

  /* ═══════════════════════════════════════════════════════════════
     HUD BINDINGS
     ═══════════════════════════════════════════════════════════════ */
  var numEl    = document.getElementById('num');
  var railEl   = document.getElementById('rail');
  var statusEl = document.querySelector('.status');
  var statusTx = document.getElementById('statusTxt');
  var assetEl  = document.getElementById('assetCount');
  var loaderEl = document.getElementById('loader');

  var STATUS = [
    [0.00, 'Establishing context'],
    [0.14, 'Compiling shaders'],
    [0.31, 'Allocating buffers'],
    [0.49, 'Streaming geometry'],
    [0.66, 'Baking light probes'],
    [0.82, 'Warming pipeline'],
    [0.96, 'Ready']
  ];
  var statusIdx = -1;

  function pad3(n) { n = String(n); while (n.length < 3) { n = '0' + n; } return n; }

  function paintHUD(p) {
    var pc = Math.round(p * 100);
    numEl.textContent = pad3(pc);
    assetEl.textContent = pad3(Math.round(p * 128));
    railEl.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    loaderEl.setAttribute('aria-valuenow', pc);

    var next = 0;
    for (var i = 0; i < STATUS.length; i++) { if (p >= STATUS[i][0]) { next = i; } }
    if (next !== statusIdx) {
      statusIdx = next;
      statusEl.classList.add('swapping');
      setTimeout(function () {
        statusTx.textContent = STATUS[statusIdx][1];
        statusEl.classList.remove('swapping');
      }, REDUCED ? 0 : 300);
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     WEBGL

     Four passes:
       1. waves      → render target at DETAIL.scale resolution
       2. knot       → render target, lightly supersampled, alpha-keyed
       3. composite  → full res; upsamples the waves, lays the knot over
                       them, draws the progress ring, grain and vignette
       4. particles  → full res, additive sea spray
     ═══════════════════════════════════════════════════════════════ */
  var gl = { ok: false };

  var FULLSCREEN_VERT = 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }';

  // Shared noise basis, prepended to both fragment shaders.
  var NOISE = [
    'float hash21(vec2 p){',
    '  p = fract(p * vec2(123.34, 456.21));',
    '  p += dot(p, p + 45.32);',
    '  return fract(p.x * p.y);',
    '}',
    'float vnoise(vec2 p){',
    '  vec2 i = floor(p), f = fract(p);',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  float a = hash21(i);',
    '  float b = hash21(i + vec2(1.0, 0.0));',
    '  float c = hash21(i + vec2(0.0, 1.0));',
    '  float d = hash21(i + vec2(1.0, 1.0));',
    '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
    '}'
  ].join('\n');

  function wavesFragment(oct, steps) {
    return [
      '#define OCT ' + oct,
      '#define STEPS ' + steps,

      'uniform vec2  uRes;',
      'uniform float uTime;',
      'uniform vec2  uMouse;',
      'uniform vec3  uHorizon;',
      'uniform vec3  uWave;',
      'uniform vec3  uCrest;',
      'uniform float uAmp;',
      'uniform float uWaveScale;',
      'uniform float uWaveRatio;',
      'uniform float uSwell;',
      'uniform float uTurb;',
      'uniform float uTilt;',
      'uniform float uZoom;',
      'uniform float uHeight;',
      'uniform float uFogDepth;',
      'uniform float uBright;',
      'uniform float uParallax;',

      NOISE,

      'vec3 rotX(vec3 v, float a){',
      '  float s = sin(a), c = cos(a);',
      '  return vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z);',
      '}',
      'vec3 rotY(vec3 v, float a){',
      '  float s = sin(a), c = cos(a);',
      '  return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);',
      '}',

      /* Height of the water surface at world xz. */
      'float waveHeight(vec2 w){',
      '  vec2 q = w * uWaveScale;',
      '  q.y *= uWaveRatio;',
      '  float t = uTime;',

      /* Two crossed low-frequency trains: the rolling swell. */
      '  float h = sin(q.x * 0.55 + t * 1.05) * 0.55',
      '          + sin(q.y * 0.42 - t * 0.80 + q.x * 0.18) * 0.45;',
      '  h *= uSwell;',

      /* Rotated fbm octaves riding on top: the chop. */
      '  float sum = 0.0, amp = 1.0, frq = 1.0, norm = 0.0;',
      '  vec2 r = q;',
      '  for (int i = 0; i < OCT; i++){',
      '    vec2 s = r * frq + vec2(t * (0.60 + float(i) * 0.11), -t * 0.35);',
      '    sum  += amp * (vnoise(s) * 2.0 - 1.0);',
      '    norm += amp;',
      '    amp *= 0.52;',
      '    frq *= 1.93;',
      '    r = mat2(0.80, 0.60, -0.60, 0.80) * r;',
      '  }',
      '  h += (sum / norm) * uTurb;',

      '  return h * uAmp;',
      '}',

      'void main(){',
      '  vec2 sp = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;',

      /* Camera: elevated, pitched down so the horizon sits high in frame. */
      '  vec3 ro = vec3(0.0, uHeight, 0.0);',
      '  vec3 rd = normalize(vec3(sp.x, sp.y, 1.6 * uZoom));',
      '  rd = rotX(rd, 0.13 * uTilt);',
      '  rd = rotY(rd, uMouse.x * 0.10 * uParallax);',
      '  rd = rotX(rd, uMouse.y * 0.045 * uParallax);',

      '  float tmax = 60.0;',
      '  float t = 1.0, tPrev = 1.0, hitT = -1.0;',

      /* Clearance march against the heightfield. */
      '  for (int i = 0; i < STEPS; i++){',
      '    if (hitT < 0.0) {',
      '      vec3 pos = ro + rd * t;',
      '      float d = pos.y - waveHeight(pos.xz);',
      '      if (d < 0.0) { hitT = t; }',
      '      else {',
      '        tPrev = t;',
      '        t = min(t + max(0.10, d * 0.50), tmax);',
      '      }',
      '    }',
      '  }',

      /* Bisect the last bracket to land cleanly on the surface. */
      '  if (hitT > 0.0) {',
      '    float lo = tPrev, hi = hitT;',
      '    for (int k = 0; k < 5; k++){',
      '      float mid = 0.5 * (lo + hi);',
      '      vec3 pm = ro + rd * mid;',
      '      if (pm.y - waveHeight(pm.xz) < 0.0) { hi = mid; } else { lo = mid; }',
      '    }',
      '    hitT = hi;',
      '  }',

      /* Sky: brightest along the horizon, cooling toward the zenith,
         with a bloom band sitting on the horizon line itself. */
      '  float up = clamp(rd.y * 6.0, 0.0, 1.0);',
      '  vec3 col = uHorizon * mix(1.0, 0.855, up);',
      '  col = mix(col, uCrest, exp(-abs(rd.y) * 46.0) * 0.5);',

      '  if (hitT > 0.0) {',
      '    vec3 pos = ro + rd * hitT;',
      '    float h0 = waveHeight(pos.xz);',

      /* Distance-scaled epsilon keeps far normals from aliasing. */
      '    float e = 0.02 + hitT * 0.012;',
      '    float hx = waveHeight(pos.xz + vec2(e, 0.0));',
      '    float hz = waveHeight(pos.xz + vec2(0.0, e));',
      '    vec3 n = normalize(vec3(h0 - hx, e, h0 - hz));',

      '    vec3  L    = normalize(vec3(0.35, 0.72, -0.58));',
      '    vec3  ref  = reflect(rd, n);',
      '    float dif  = clamp(dot(n, L), 0.0, 1.0);',
      '    float fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 4.0);',
      '    float rl   = clamp(dot(ref, L), 0.0, 1.0);',
      '    float spec  = pow(rl, 44.0);',
      '    float glint = pow(rl, 190.0);',

      /* Crests: high water, plus foam on the steep faces. */
      '    float hn = h0 / max(uAmp, 0.001);',
      '    float crest = smoothstep(0.18, 0.52, hn);',
      '    crest = max(crest * 0.9, smoothstep(0.02, 0.20, 1.0 - n.y) * 0.5);',
      '    crest *= exp(-hitT * 0.020);',

      '    vec3 water = uWave;',
      '    water = mix(water, uCrest, crest);',
      '    water += uCrest * (spec * 0.45 + glint * 1.15);',
      '    water = mix(water, uHorizon, fres * 0.42);',

      /* Wider lit/unlit spread than a flat lambert, so troughs go black. */
      '    water *= 0.42 + 0.78 * dif;',
      /* Ground the foreground so the bottom of frame reads as deep water. */
      '    water *= mix(0.74, 1.0, smoothstep(9.0, 26.0, hitT));',

      /* Quadratic fog: foreground stays readable, distance washes out fast. */
      '    float fd = hitT / max(uFogDepth, 0.001);',
      '    float fog = 1.0 - exp(-fd * fd * 0.32);',
      '    col = mix(water, uHorizon, fog);',
      '  }',

      '  gl_FragColor = vec4(col * uBright, 1.0);',
      '}'
    ].join('\n');
  }

  var COMPOSITE_FRAG = [
    'uniform sampler2D uScene;',
    'uniform sampler2D uKnot;',
    'uniform vec2  uRes;',
    'uniform float uTime;',
    'uniform float uProg;',
    'uniform float uReveal;',
    'uniform vec2  uMouse;',
    'uniform float uGrain;',
    'uniform float uOpacity;',
    'uniform float uKnotFade;',
    '#define PI 3.14159265359',

    NOISE,

    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / uRes;',
    '  vec3 col = texture2D(uScene, uv).rgb;',

    /* The knot lands on the water before anything else, so the ring's
       ink flip, the vignette and the grain all read it as scene. */
    '  vec4 knot = texture2D(uKnot, uv);',
    '  col = mix(col, knot.rgb, knot.a * uKnotFade);',

    '  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y);',

    /* Ring ink flips with the background so it reads over sky and water alike. */
    '  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));',
    '  vec3 ink = mix(vec3(0.98), vec3(0.05), smoothstep(0.30, 0.62, luma));',

    '  vec2 rp = p - uMouse * 0.020;',
    '  float rr = length(rp);',
    '  float radius = 0.300 + uReveal * 0.95;',

    /* angle: 0 at top, sweeping clockwise */
    '  float a = fract(atan(rp.x, rp.y) / (2.0 * PI));',
    '  float full = step(0.9995, uProg);',
    '  float arc  = max(smoothstep(0.0, 0.0035, uProg - a), full);',
    '  float head = exp(-abs(uProg - a) * 240.0) * (1.0 - full);',

    /* Chromatic aberration: R/G/B masked at drifting radii. */
    '  float ca    = (0.0055 + 0.0075 * sin(uTime * 0.55)) * (1.0 + uReveal * 5.0);',
    '  float thick = 0.0024 + uReveal * 0.004;',
    '  vec3 cov = vec3(',
    '    smoothstep(thick, 0.0, abs(rr - (radius - ca))),',
    '    smoothstep(thick, 0.0, abs(rr - radius)),',
    '    smoothstep(thick, 0.0, abs(rr - (radius + ca)))',
    '  );',

    '  float fade = 1.0 - uReveal;',

    /* Unlit track, then the lit arc, its halo, and the leading spark. */
    '  float track = smoothstep(0.0018, 0.0, abs(rr - radius));',
    '  col = mix(col, ink, track * 0.22 * fade);',
    '  col = mix(col, ink, clamp(cov * arc * fade, 0.0, 1.0));',
    '  col = mix(col, ink, exp(-abs(rr - radius) * 24.0) * arc * 0.16 * fade);',
    '  col = mix(col, ink, head * smoothstep(thick * 3.2, 0.0, abs(rr - radius)) * fade);',

    /* Vignette, then film grain. */
    '  col *= mix(0.88, 1.0, smoothstep(1.30, 0.20, length(p)));',
    '  col += (hash21(gl_FragCoord.xy + fract(uTime) * 137.0) - 0.5) * uGrain;',

    '  gl_FragColor = vec4(col, uOpacity);',
    '}'
  ].join('\n');

  /* Procedural studio: two crossed bands give the marbling, three
     directional lobes give the softboxes. Sampled once per channel. */
  var KNOT_VERT = [
    'varying vec3 vN;',
    'varying vec3 vView;',
    'void main(){',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  vN    = normalize(mat3(modelMatrix) * normal);',
    '  vView = normalize(wp.xyz - cameraPosition);',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}'
  ].join('\n');

  var KNOT_FRAG = [
    'uniform float uTime;',
    'uniform float uLevel;',
    'uniform float uContrast;',
    'uniform float uDisp;',
    'uniform float uRim;',
    'uniform float uGloss;',
    'uniform float uAlpha;',
    'varying vec3 vN;',
    'varying vec3 vView;',

    'const vec3 KEY  = vec3(-0.4256, 0.7903, 0.4661);',
    'const vec3 FILL = vec3( 0.8757, 0.0597, 0.4795);',
    'const vec3 BACK = vec3( 0.1010,-0.5252,-0.8451);',

    'float studio(vec3 d){',
    '  float key  = pow(max(dot(d, KEY),  0.0), 2.6);',
    '  float fill = pow(max(dot(d, FILL), 0.0), 5.0);',
    '  float back = pow(max(dot(d, BACK), 0.0), 3.4);',
    '  float b1 = 0.5 + 0.5 * sin(d.y * 4.6 + d.x * 2.2 + d.z * 1.3 + uTime * 0.22);',
    '  float b2 = 0.5 + 0.5 * sin(d.x * 3.1 - d.z * 3.7 - uTime * 0.16);',
    '  return b1 * 0.42 + b2 * 0.24 + key * 1.05 + fill * 0.42 + back * 0.70;',
    '}',
    'float shade(vec3 d){',
    '  return smoothstep(uLevel - uContrast, uLevel + uContrast, studio(d));',
    '}',

    'void main(){',
    '  vec3 n = normalize(vN);',
    '  vec3 v = normalize(vView);',
    '  vec3 r = reflect(v, n);',
    '  float fres = pow(1.0 - clamp(dot(n, -v), 0.0, 1.0), 3.0);',

    // Dispersion widens toward the silhouette, where refraction through
    // real glass would be strongest.
    '  float d = uDisp * (0.35 + fres);',
    '  vec3 col = vec3(',
    '    shade(normalize(r + n * d)),',
    '    shade(r),',
    '    shade(normalize(r - n * d))',
    '  );',

    '  float spec = pow(max(dot(r, KEY), 0.0), 90.0);',
    '  col += spec * uGloss;',
    '  col = mix(col, vec3(1.0), fres * uRim);',

    /* Opacity rises where the surface turns away from the camera and
       where it catches the key, so the rim and the highlights read solid
       while the flat faces stay see-through. The dark reflection bands
       get a lift too, or the marbling washes out once the water shows
       through them. */
    '  float ink = 1.0 - clamp(col.g, 0.0, 1.0);',
    '  float a = uAlpha + (1.0 - uAlpha) *',
    '            clamp(fres * 1.45 + spec * 1.6 + ink * 0.28, 0.0, 1.0);',

    // Never fully black: it has to stay legible over the dark water.
    '  gl_FragColor = vec4(clamp(col, 0.035, 1.0), clamp(a, 0.0, 1.0));',
    '}'
  ].join('\n');

  function initGL() {
    if (typeof THREE === 'undefined') { return false; }

    var canvas = document.getElementById('gl');
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas, antialias: false, alpha: true, powerPreference: 'high-performance'
      });
    } catch (e) { return false; }

    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;

    var DPR = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(DPR);
    renderer.setSize(window.innerWidth, window.innerHeight, false);

    var q = DETAIL[WAVES.detail] || DETAIL.medium;
    var rtScale = q.scale;

    function col3(hex) { var c = new THREE.Color(hex); return new THREE.Vector3(c.r, c.g, c.b); }

    /* ── pass 1 : waves ── */
    var waveTarget = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false
    });

    var wu = {
      uRes:        { value: new THREE.Vector2(1, 1) },
      uTime:       { value: 0 },
      uMouse:      { value: new THREE.Vector2(0, 0) },
      uHorizon:    { value: col3(WAVES.horizonColor) },
      uWave:       { value: col3(WAVES.waveColor) },
      uCrest:      { value: col3(WAVES.crestColor) },
      uAmp:        { value: WAVES.amplitude },
      uWaveScale:  { value: WAVES.waveScale },
      uWaveRatio:  { value: WAVES.waveRatio },
      uSwell:      { value: WAVES.swell / 100 },
      uTurb:       { value: WAVES.turbulence / 100 },
      uTilt:       { value: WAVES.tilt },
      uZoom:       { value: WAVES.zoom },
      uHeight:     { value: WAVES.height },
      uFogDepth:   { value: WAVES.fogDepth },
      uBright:     { value: WAVES.brightness },
      uParallax:   { value: WAVES.mouseInteraction ? WAVES.parallaxStrength : 0 }
    };

    var waveScene = new THREE.Scene();
    var flatCam   = new THREE.Camera();
    var waveQuad  = new THREE.Mesh(
      new THREE.PlaneBufferGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: wu,
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: wavesFragment(q.oct, q.steps),
        depthTest: false,
        depthWrite: false
      })
    );
    waveQuad.frustumCulled = false; // the vertex shader bypasses the camera matrices
    waveScene.add(waveQuad);

    /* ── pass 2 : chrome knot ── */
    var knotTarget = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: false
    });

    var ku = {
      uTime:     { value: 0 },
      uLevel:    { value: KNOT.level },
      uContrast: { value: KNOT.contrast },
      uDisp:     { value: KNOT.dispersion },
      uRim:      { value: KNOT.rim },
      uGloss:    { value: KNOT.gloss },
      uAlpha:    { value: KNOT.opacity }
    };

    var knotScene = new THREE.Scene();
    var knotCam   = new THREE.PerspectiveCamera(KNOT.fov, 1, 0.1, 100);
    knotCam.position.z = KNOT.distance;

    var TUBULAR = window.innerWidth < 760 ? 160 : 256;
    var knotMesh = new THREE.Mesh(
      new THREE.TorusKnotBufferGeometry(1, KNOT.tube, TUBULAR, 40, KNOT.p, KNOT.q),
      new THREE.ShaderMaterial({
        uniforms: ku,
        vertexShader: KNOT_VERT,
        fragmentShader: KNOT_FRAG,
        // Written straight into the target; the composite pass does the
        // blending, so this must not blend against the cleared buffer.
        blending: THREE.NoBlending
      })
    );
    knotScene.add(knotMesh);

    // The curve of a p=2 knot reaches 1.5x the radius; the tube rides outside it.
    var KNOT_BOUND = 1.5 + KNOT.tube;
    var KNOT_SPIN  = REDUCED ? KNOT.spin * 0.3 : KNOT.spin;

    var knotFade = 0;   // 0 while loading, 1 once the stage is revealed
    var knotFit  = 1;   // scale that makes the object meet KNOT.size

    function fitKnot(aspect) {
      var halfH = KNOT.distance * Math.tan(KNOT.fov * Math.PI / 360);
      return Math.min(KNOT.size * halfH, KNOT.widthLimit * halfH * aspect) / KNOT_BOUND;
    }
    function applyKnotScale() {
      knotMesh.scale.setScalar(knotFit * (0.84 + 0.16 * knotFade));
    }

    /* ── pass 3 : composite + ring ── */
    var cu = {
      uScene:   { value: waveTarget.texture },
      uKnot:    { value: knotTarget.texture },
      uRes:     { value: new THREE.Vector2(1, 1) },
      uTime:    { value: 0 },
      uProg:    { value: 0 },
      uReveal:  { value: 0 },
      uMouse:   { value: new THREE.Vector2(0, 0) },
      uGrain:    { value: WAVES.grain ? WAVES.grainIntensity : 0 },
      uOpacity:  { value: WAVES.opacity },
      uKnotFade: { value: 0 }
    };

    var compScene = new THREE.Scene();
    var compQuad  = new THREE.Mesh(
      new THREE.PlaneBufferGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: cu,
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: COMPOSITE_FRAG,
        transparent: WAVES.opacity < 1,
        depthTest: false,
        depthWrite: false
      })
    );
    compQuad.frustumCulled = false;
    compScene.add(compQuad);

    /* ── pass 4 : spray particles ── */
    var pScene  = new THREE.Scene();
    var pCamera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 100);
    pCamera.position.z = 9;

    var COUNT = window.innerWidth < 760 ? 160 : 380;
    var pos   = new Float32Array(COUNT * 3);
    var seed  = new Float32Array(COUNT);
    var size  = new Float32Array(COUNT);

    for (var i = 0; i < COUNT; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 17.0;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 11.5;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 7.0 - 1.0;
      seed[i] = Math.random();
      size[i] = 0.5 + Math.pow(Math.random(), 3.0) * 2.4;
    }

    var pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pGeo.setAttribute('aSeed',    new THREE.BufferAttribute(seed, 1));
    pGeo.setAttribute('aSize',    new THREE.BufferAttribute(size, 1));

    var pu = {
      uTime:   { value: 0 },
      uBurst:  { value: 0 },  // outward push during the reveal
      uAlpha:  { value: 1 },  // driven separately so spray can return after
      uMouse:  { value: new THREE.Vector2(0, 0) },
      uDpr:    { value: DPR },
      uMotion: { value: REDUCED ? 0.15 : 1.0 }
    };

    var P_VERT = [
      'attribute float aSeed;',
      'attribute float aSize;',
      'uniform float uTime;',
      'uniform float uBurst;',
      'uniform float uAlpha;',
      'uniform vec2  uMouse;',
      'uniform float uDpr;',
      'uniform float uMotion;',
      'varying float vAlpha;',
      'void main(){',
      '  vec3 pos = position;',
      '  pos.x += sin(uTime * 0.17 + aSeed * 6.283) * 0.42 * uMotion;',
      '  pos.y += cos(uTime * 0.14 + aSeed * 4.712) * 0.34 * uMotion;',
      '  pos.xy += uMouse * (0.30 + (pos.z + 4.0) * 0.055);',
      '  pos *= 1.0 + uBurst * 1.9;',
      '  vec4 mv = modelViewMatrix * vec4(pos, 1.0);',
      '  gl_Position = projectionMatrix * mv;',
      '  float tw = 0.42 + 0.58 * sin(uTime * 1.25 + aSeed * 21.7);',
      '  vAlpha = max(tw, 0.10) * uAlpha;',
      '  gl_PointSize = aSize * uDpr * (34.0 / max(-mv.z, 0.001));',
      '}'
    ].join('\n');

    var P_FRAG = [
      'varying float vAlpha;',
      'void main(){',
      '  vec2 c = gl_PointCoord - 0.5;',
      '  float d = length(c);',
      '  if (d > 0.5) discard;',
      '  float a = pow(smoothstep(0.5, 0.0, d), 2.4);',
      '  gl_FragColor = vec4(vec3(0.96, 0.97, 1.0), a * vAlpha * 0.42);',
      '}'
    ].join('\n');

    var points = new THREE.Points(pGeo, new THREE.ShaderMaterial({
      uniforms: pu,
      vertexShader: P_VERT,
      fragmentShader: P_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    }));
    points.frustumCulled = false; // positions are displaced in the vertex shader
    pScene.add(points);

    /* ── sizing ── */
    function resize() {
      var w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h, false);
      cu.uRes.value.set(w * DPR, h * DPR);

      var rw = Math.max(2, Math.floor(w * DPR * rtScale));
      var rh = Math.max(2, Math.floor(h * DPR * rtScale));
      waveTarget.setSize(rw, rh);
      wu.uRes.value.set(rw, rh);

      // Render targets cannot be multisampled, so the knot is drawn a
      // little oversized and let down by the linear filter instead.
      var kdpr = Math.min(2, DPR * 1.5);
      knotTarget.setSize(Math.max(2, Math.floor(w * kdpr)), Math.max(2, Math.floor(h * kdpr)));
      knotCam.aspect = w / h;
      knotCam.updateProjectionMatrix();
      knotFit = fitKnot(w / h);
      applyKnotScale();

      pCamera.aspect = w / h;
      pCamera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener('resize', resize);

    /* ── pointer parallax with inertia ── */
    var mx = 0, my = 0, tx = 0, ty = 0;
    function point(x, y) {
      tx =  (x / window.innerWidth  - 0.5) * 2;
      ty = -(y / window.innerHeight - 0.5) * 2;
    }
    if (WAVES.mouseInteraction) {
      window.addEventListener('mousemove', function (e) { point(e.clientX, e.clientY); }, { passive: true });
      window.addEventListener('touchmove', function (e) {
        if (e.touches[0]) { point(e.touches[0].clientX, e.touches[0].clientY); }
      }, { passive: true });
    }

    /* ── adaptive quality: drop render-target scale once if we are slow ── */
    var frames = 0, accum = 0, downshifted = false;
    function sample(dt) {
      if (downshifted || rtScale <= 0.34) { return; }
      frames++; accum += dt;
      if (frames === 60) {
        if (accum / frames > 24) { rtScale = 0.34; downshifted = true; resize(); }
        frames = 0; accum = 0;
      }
    }

    function rendererLabel() {
      try {
        var c = renderer.getContext();
        var dbg = c.getExtension('WEBGL_debug_renderer_info');
        if (dbg) {
          var s = String(c.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '')
                    .replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
          if (s) { return s.length > 22 ? s.slice(0, 22) + '…' : s; }
        }
      } catch (e) {}
      return 'WebGL';
    }

    gl = {
      ok: true,
      name: rendererLabel(),
      setProgress: function (p) { cu.uProg.value = p; },
      setReveal: function (r) {
        cu.uReveal.value = r;
        pu.uBurst.value = r;
        // Trails the ring burst slightly, so the object arrives into the
        // space the HUD has just vacated rather than alongside it.
        knotFade = Math.max(0, Math.min(1, (r - 0.12) / 0.88));
        cu.uKnotFade.value = knotFade;
        applyKnotScale();
      },
      setSpray: function (a) { pu.uAlpha.value = a; },
      render: function (time, dt) {
        sample(dt);

        mx += (tx - mx) * 0.045;
        my += (ty - my) * 0.045;

        wu.uTime.value = time * WAVES.speed;
        wu.uMouse.value.set(mx, my);
        cu.uTime.value = time;
        cu.uMouse.value.set(mx, my);
        pu.uTime.value = time;
        pu.uMouse.value.set(mx, my);
        ku.uTime.value = time;

        renderer.setRenderTarget(waveTarget);
        renderer.clear();
        renderer.render(waveScene, flatCam);

        if (knotFade > 0.001) {
          var kt = time * KNOT_SPIN;
          knotMesh.rotation.set(
            0.40 * Math.sin(kt * 0.53) + my * KNOT.parallax,
            kt,
            0.16 * Math.sin(kt * 0.37) + mx * KNOT.parallax * 0.7
          );
          knotMesh.position.set(
            mx * 0.09,
            KNOT.offsetY + Math.sin(time * 0.42) * 0.05,
            0
          );
          renderer.setRenderTarget(knotTarget);
          renderer.clear();
          renderer.render(knotScene, knotCam);
        }

        renderer.setRenderTarget(null);
        renderer.clear();
        renderer.render(compScene, flatCam);
        renderer.clearDepth();
        renderer.render(pScene, pCamera);
      }
    };
    return true;
  }

  try {
    if (initGL()) { document.getElementById('rendererName').textContent = gl.name; }
  } catch (e) {
    gl.ok = false; // the CSS field carries the visual on its own
  }

  /* ═══════════════════════════════════════════════════════════════
     LOOP  &  EXIT
     ═══════════════════════════════════════════════════════════════ */
  var start = performance.now();
  var last = start;
  var holdUntil = 0;
  var revealStart = 0;
  var settle = 0;
  var REVEAL_MS = REDUCED ? 260 : 1150;

  function frame(now) {
    requestAnimationFrame(frame);
    var time = (now - start) / 1000;
    var dt = now - last;
    last = now;

    if (!Loader.done) {
      driveTarget();
      // ease with a soft approach so the arc never snaps
      Loader.current += (Loader.target - Loader.current) * (Loader.target === 1 ? 0.055 : 0.032);
      if (Loader.target === 1 && Loader.current > 0.9992) { Loader.current = 1; }
      paintHUD(Loader.current);
      if (gl.ok) { gl.setProgress(Loader.current); }

      if (Loader.current === 1) {
        Loader.done = true;
        holdUntil = now + (REDUCED ? 120 : 480);
      }
    } else if (holdUntil && now >= holdUntil) {
      holdUntil = 0;
      revealStart = now;
      document.body.classList.add('is-complete');
    }

    if (revealStart) {
      var r = Math.min(1, (now - revealStart) / REVEAL_MS);
      if (gl.ok) {
        gl.setReveal(1 - Math.pow(1 - r, 3)); // easeOutCubic
        if (r < 1) { gl.setSpray(1 - r); }    // spray thins out with the burst
      }
      if (r === 1 && !document.body.classList.contains('is-revealed')) {
        document.body.classList.add('is-revealed');
        window.dispatchEvent(new CustomEvent('loader:complete'));
      }
    }

    // Once revealed, ease the spray back in — the scene keeps living
    // behind the page instead of going still.
    if (settle < 1 && document.body.classList.contains('is-revealed')) {
      settle = Math.min(1, settle + dt / 1400);
      if (gl.ok) { gl.setSpray(settle * 0.75); }
    }

    if (gl.ok) { gl.render(time, dt); }
  }

  paintHUD(0);
  requestAnimationFrame(frame);
})();
