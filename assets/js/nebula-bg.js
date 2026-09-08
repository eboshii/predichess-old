(function () {
  const canvas = document.getElementById('nebula-bg');
  if (!canvas) return;

  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power'
  }) || canvas.getContext('experimental-webgl');

  if (!gl) {
    console.warn('WebGL not supported for nebula background');
    return;
  }

  const vsSource = `
    attribute vec2 a_position;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fsSource = `
    precision highp float;

    uniform vec2 u_resolution;
    uniform float u_time;
    uniform float u_seed;
    uniform vec4 u_wake_nodes[20]; // x, y, birthTime, strength
    uniform vec4 u_kofi_box;      // x, y (center in screen pixels), half_w, half_h
    uniform float u_kofi_radius;
    uniform float u_kofi_fade;
    uniform vec4 u_glow_boxes[6];  // x, y (center, screen px), half_w, half_h
    uniform vec4 u_glow_params[6]; // x = fade px, y = intensity 0..1, z = whiteness

    // Standard 4x4 Bayer Matrix (100% WebGL 1.0 compliant)
    float bayer4x4(vec2 p) {
      vec2 b = mod(floor(p), 4.0);
      float x = b.x;
      float y = b.y;

      if (y < 0.5) {
        if (x < 0.5) return -0.5000;
        if (x < 1.5) return  0.0000;
        if (x < 2.5) return -0.3750;
        return  0.1250;
      } else if (y < 1.5) {
        if (x < 0.5) return  0.2500;
        if (x < 1.5) return -0.2500;
        if (x < 2.5) return  0.3750;
        return -0.1250;
      } else if (y < 2.5) {
        if (x < 0.5) return -0.3125;
        if (x < 1.5) return  0.1875;
        if (x < 2.5) return -0.4375;
        return  0.0625;
      } else {
        if (x < 0.5) return  0.4375;
        if (x < 1.5) return -0.0625;
        if (x < 2.5) return  0.3125;
        return -0.1875;
      }
    }

    // Fast 2D Hash
    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    // 2D Value Noise with Hermite Curve
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);

      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));

      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }

    // 3-Octave Lightweight FBM with Rotation
    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
      for (int i = 0; i < 3; i++) {
        v += a * noise(p);
        p = rot * p * 2.02;
        a *= 0.5;
      }
      return v;
    }

    // Sharply Varying Continuous Weierstrass + Sine Modulation for Perimeter Extrusion
    float weierstrassSin(float theta, float time) {
      float t = time * 0.09;
      // High-contrast, multi-harmonic Weierstrass fractal synthesis
      float w = 0.0;
      w += 1.00 * sin( 1.0 * theta + t * 0.60 + 0.35);
      w += 0.70 * cos( 3.0 * theta - t * 0.75 + 1.28);
      w += 0.48 * sin( 7.0 * theta + t * 0.95 + 2.74);
      w += 0.32 * cos(15.0 * theta - t * 1.20 + 4.19);
      w += 0.20 * sin(31.0 * theta + t * 1.50 + 5.61);
      w += 0.12 * cos(63.0 * theta - t * 1.85 + 1.83);

      // Low frequency sinusoidal modulation
      float baseSin = sin(theta * 2.0 - t * 0.40) * 0.85;

      float raw = (w + baseSin) / 3.67; // Normalized [-1.0, 1.0]
      // Sharpen peaks and troughs with non-linear power curve
      float signW = sign(raw);
      float sharp = signW * pow(abs(raw), 1.45);

      float norm = clamp(0.5 + 0.5 * sharp, 0.0, 1.0);

      // Extends between 1.0x and 3.2x with dramatic fractal undulations
      return 1.0 + 2.2 * norm;
    }

    // Signed distance to a rounded box (negative inside)
    float roundedBoxSDF(vec2 rel, vec2 halfExtent, float radius) {
      vec2 d = abs(rel) - (halfExtent - vec2(radius));
      return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - radius;
    }

    // Poisson-Disk-Style Star Layer (Jittered Grid)
    vec3 starLayer(vec2 uv, float gridDensity, float threshold, float brightnessScale, float time, float speedFactor) {
      vec2 p = uv * gridDensity;
      vec2 id = floor(p);
      vec2 gv = fract(p) - 0.5;

      vec3 totalStars = vec3(0.0);

      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 offset = vec2(float(x), float(y));
          vec2 cellId = id + offset;

          float prob = hash(cellId + 0.137);
          if (prob > threshold) {
            vec2 jitter = vec2(hash(cellId + 1.71), hash(cellId + 9.33)) - 0.5;
            vec2 starPos = offset + jitter * 0.70;
            float dist = length(gv - starPos);

            float starRadius = 0.015 + hash(cellId + 4.19) * 0.020;
            float core = smoothstep(starRadius, 0.0, dist);
            float glow = 0.0012 / (dist * dist + 0.0018);

            float freq = (1.0 + hash(cellId + 5.72) * 1.5) * speedFactor;
            float phase = hash(cellId + 8.29) * 6.28318;
            float twinkle = 0.55 + 0.45 * sin(time * freq + phase);

            float hueRnd = hash(cellId + 2.91);
            vec3 tint = vec3(1.0, 0.96, 0.92);
            if (hueRnd < 0.35) {
              tint = vec3(1.0, 0.82, 0.55);
            } else if (hueRnd < 0.65) {
              tint = vec3(0.72, 0.88, 1.0);
            }

            float intensity = (core * 1.0 + glow * 0.15) * twinkle * brightnessScale;
            totalStars += tint * intensity;
          }
        }
      }
      return totalStars;
    }

    // 2.5D Pure Physical Dispersive Wavefront Accumulation
    // The V-wake envelope naturally emerges from the superposition of historical expanding nodes!
    vec2 get25DWaveDistortion(vec2 rawUv, float time) {
      vec2 grad = vec2(0.0);

      for (int i = 0; i < 20; i++) {
        if (u_wake_nodes[i].z > 0.0001) {
          vec2 nodePos = u_wake_nodes[i].xy;
          float birth = u_wake_nodes[i].z;
          float strength = u_wake_nodes[i].w;
          float age = time - birth;

          if (age > 0.0 && age < 4.8) {
            vec2 d = rawUv - nodePos;
            // 2.5D Isometric perspective flattening
            d.y *= 1.75;

            float r = length(d);
            float waveFront = age * 0.14;
            float deltaR = r - waveFront;

            // Dispersive water wave packet envelope
            float envelope = exp(-abs(deltaR) * 22.0) * exp(-age * 0.55) * strength;
            float phase = deltaR * 48.0 - age * 4.0;
            float wave = sin(phase) * envelope;

            vec2 dir = normalize(vec2(d.x, d.y / 1.75) + 0.0001);
            grad += dir * wave * 0.038;
          }
        }
      }

      return grad;
    }

    void main() {
      // Retro pixelation (3.0 physical pixels per cell)
      float pixelSize = 3.0;
      vec2 gridCoord = floor(gl_FragCoord.xy / pixelSize);
      vec2 rawUv = (gridCoord * pixelSize - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

      // --- Pure 2.5D Wave Refraction Distortion ---
      vec2 waveDistort = get25DWaveDistortion(rawUv, u_time);

      // Computer clock seed spatial offset
      vec2 seedOffset = vec2(sin(u_seed * 7.13), cos(u_seed * 11.47)) * 8.0;
      vec2 uv = (rawUv + waveDistort) * 2.8 + seedOffset;

      float t = u_time * 0.05;

      // --- Layer 1: Far Cosmic Clouds (Muted violet & indigo) ---
      vec2 uvFar = uv * 1.1 + vec2(t * 0.05, t * 0.025);
      float swirlFar = fbm(uvFar * 0.3 + t * 0.1) * 6.28318;
      vec2 warpFar = vec2(
        fbm(uvFar + vec2(1.7, 9.2)),
        fbm(uvFar + vec2(8.3, 2.8))
      ) - 0.5;
      vec2 rWarpFar = vec2(
        warpFar.x * cos(swirlFar) - warpFar.y * sin(swirlFar),
        warpFar.x * sin(swirlFar) + warpFar.y * cos(swirlFar)
      );
      float dFar = fbm(uvFar + rWarpFar * 1.6);

      // --- Layer 2: Near Swirling Filaments (Teal, magenta, and amber) ---
      vec2 uvNear = uv * 1.8 + vec2(-t * 0.10, t * 0.07);
      float swirlNear = fbm(uvNear * 0.4 - t * 0.15) * 6.28318;
      vec2 warpNear = vec2(
        fbm(uvNear + vec2(5.2, 1.3)),
        fbm(uvNear + vec2(3.1, 7.4))
      ) - 0.5;
      vec2 rWarpNear = vec2(
        warpNear.x * cos(swirlNear) - warpNear.y * sin(swirlNear),
        warpNear.x * sin(swirlNear) + warpNear.y * cos(swirlNear)
      );
      float dNear = fbm(uvNear + rWarpNear * 2.0);

      // --- Color Palette ---
      vec3 c_space    = vec3(0.027, 0.015, 0.051); // #07040d Deep void
      vec3 c_far_gas  = vec3(0.125, 0.063, 0.220); // #201038 Deep violet cloud
      vec3 c_teal     = vec3(0.055, 0.247, 0.322); // #0e3f52 Glowing cyan filament
      vec3 c_magenta  = vec3(0.318, 0.086, 0.231); // #51163b Rose magenta filament
      vec3 c_amber    = vec3(0.682, 0.365, 0.114); // #ae5d1d Glowing stellar core

      // Base space
      vec3 col = c_space;

      // Far gas layer
      float maskFar = smoothstep(0.10, 0.58, dFar);
      col = mix(col, c_far_gas, maskFar * 0.95);

      // Near filament layer
      float filamentHue = noise(uv * 1.4 + t * 0.08);
      vec3 filamentCol  = mix(c_teal, c_magenta, filamentHue);
      float maskNear    = smoothstep(0.20, 0.65, dNear);
      col = mix(col, filamentCol, maskNear * 0.98);

      // Dense intersection highlights
      float intersection = smoothstep(0.42, 0.85, dNear) * smoothstep(0.26, 0.75, dFar);
      col = mix(col, c_amber, intersection * 0.92);

      // --- Dynamic Ko-fi Glow Halo with Weierstrass-Randomized Extrusion ---
      if (u_kofi_box.z > 0.1) {
        vec2 p = gl_FragCoord.xy;
        vec2 rel = p - u_kofi_box.xy;
        float dist = roundedBoxSDF(rel, u_kofi_box.zw, u_kofi_radius);

        // Continuous angular parameter around the shape
        float theta = atan(rel.y, rel.x);
        float extrudeMult = weierstrassSin(theta, u_time);
        float dynamicFade = u_kofi_fade * extrudeMult; // Extends between 1.0x and 3.0x

        if (dist < dynamicFade) {
          float uNorm = clamp(dist / dynamicFade, 0.0, 1.0);
          float inv = 1.0 - uNorm;
          // Shifted S-curve: solid white drops off within the first 10-15%, lingering as a wide translucent veil
          float core = pow(inv, 7.0);       // Ultra-tight solid core at the immediate boundary
          float tail = pow(inv, 2.4) * 0.38; // Long ethereal near-translucent tail
          float sCurve = clamp(core * 0.62 + tail, 0.0, 1.0);

          col = mix(col, vec3(1.0, 1.0, 1.0), sCurve);
        }
      }

      // --- Index Entry Halos: the gas reacts to the UI sitting on it ---
      // Take the strongest halo covering this pixel rather than mixing each in
      // turn: sequential mixing compounds where two rows' outlines meet, which
      // reads as a bright seam between them instead of two separate edges.
      float maxHalo = 0.0;
      vec3 haloCol = c_amber;
      for (int i = 0; i < 6; i++) {
        float intensity = u_glow_params[i].y;
        if (u_glow_boxes[i].z > 0.1 && intensity > 0.002) {
          vec2 rel = gl_FragCoord.xy - u_glow_boxes[i].xy;
          float dist = roundedBoxSDF(rel, u_glow_boxes[i].zw, 2.0);
          float fade = u_glow_params[i].x * weierstrassSin(atan(rel.y, rel.x), u_time);

          if (dist > -1.5 && dist < fade) {
            float inv = 1.0 - clamp(dist / fade, 0.0, 1.0);
            // Tight core at the boundary, short tail - an outline, not a cloud
            float halo = pow(inv, 6.0) * 0.62 + pow(inv, 2.6) * 0.22;
            float h = clamp(halo * intensity, 0.0, 1.0);
            if (h > maxHalo) {
              maxHalo = h;
              // Amber by default, white where a box asks for it, as the Ko-fi
              // halo does
              haloCol = mix(c_amber, vec3(1.0), u_glow_params[i].z);
            }
          }
        }
      }

      if (maxHalo > 0.001) {
        col = mix(col, haloCol, maxHalo * 0.85);
      }

      // ---------------------------------------------------------
      // Multi-Pass Poisson-Disk Starfield (Seeded continuous coordinate)
      // ---------------------------------------------------------
      vec2 starUv = (rawUv + waveDistort * 0.8) + seedOffset * 0.3;
      vec3 stars = vec3(0.0);
      stars += starLayer(starUv, 70.0, 0.20, 0.35, u_time, 0.8);
      stars += starLayer(starUv, 36.0, 0.35, 0.65, u_time, 1.0);
      stars += starLayer(starUv, 18.0, 0.72, 0.95, u_time, 1.2);

      // 4x4 Ordered Bayer Dithering + Subtle Shadow Noise
      float dither = bayer4x4(gridCoord);
      float shadowNoise = (hash(gridCoord + fract(u_time * 0.2)) - 0.5) * 0.035;

      vec3 dithered = col + stars + (dither * 0.085) + shadowNoise;

      // Discrete retro quantization
      float levels = 14.0;
      vec3 finalCol = floor(clamp(dithered, 0.0, 1.0) * levels + 0.5) / levels;

      gl_FragColor = vec4(finalCol, 1.0);
    }
  `;

  function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
  if (!vertexShader || !fragmentShader) return;

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    return;
  }
  gl.useProgram(program);

  const quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -1.0, -1.0,
       1.0, -1.0,
      -1.0,  1.0,
      -1.0,  1.0,
       1.0, -1.0,
       1.0,  1.0,
    ]),
    gl.STATIC_DRAW
  );

  const aPosition = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

  const uResolution = gl.getUniformLocation(program, 'u_resolution');
  const uTime = gl.getUniformLocation(program, 'u_time');
  const uSeed = gl.getUniformLocation(program, 'u_seed');
  const uWakeNodes = gl.getUniformLocation(program, 'u_wake_nodes[0]');
  const uKofiBox = gl.getUniformLocation(program, 'u_kofi_box');
  const uKofiRadius = gl.getUniformLocation(program, 'u_kofi_radius');
  const uKofiFade = gl.getUniformLocation(program, 'u_kofi_fade');
  const uGlowBoxes = gl.getUniformLocation(program, 'u_glow_boxes[0]');
  const uGlowParams = gl.getUniformLocation(program, 'u_glow_params[0]');

  // Session Anchor Time & Seed
  let sessionStartTime = parseFloat(sessionStorage.getItem('nebula_session_start'));
  let sessionSeed = parseFloat(sessionStorage.getItem('nebula_session_seed'));

  if (isNaN(sessionStartTime) || isNaN(sessionSeed)) {
    sessionStartTime = Date.now();
    sessionSeed = 0.0;
    sessionStorage.setItem('nebula_session_start', sessionStartTime.toString());
    sessionStorage.setItem('nebula_session_seed', sessionSeed.toString());
  }

  gl.uniform1f(uSeed, sessionSeed);

  // -------------------------------------------------------------
  // Dynamic Emergent Wake Trail Nodes (20-node ring buffer)
  // -------------------------------------------------------------
  const MAX_WAKE_NODES = 20;
  const wakeNodes = [];
  for (let i = 0; i < MAX_WAKE_NODES; i++) {
    wakeNodes.push({ x: 0, y: 0, birth: -999, strength: 0 });
  }
  let nextWakeIdx = 0;
  const flatWake = new Float32Array(MAX_WAKE_NODES * 4);

  // The canvas is CSS-sized 100vw/100vh. On mobile, 100vh is the LARGE
  // viewport and stays fixed, while window.innerHeight shrinks whenever the
  // URL bar is showing - so sizing the buffer or flipping coordinates against
  // innerHeight stretches shader space relative to CSS space, and everything
  // drawn against DOM rects drifts until a scroll collapses the bar. Measure
  // the canvas's own box instead, which is URL-bar independent, and shares its
  // origin with getBoundingClientRect since the canvas is position: fixed.
  function canvasCssSize() {
    return {
      w: canvas.clientWidth || window.innerWidth,
      h: canvas.clientHeight || window.innerHeight
    };
  }

  function toNormUv(screenX, screenY) {
    const vp = canvasCssSize();
    const minDim = Math.min(vp.w, vp.h);
    return {
      x: (screenX - 0.5 * vp.w) / minDim,
      y: ((vp.h - screenY) - 0.5 * vp.h) / minDim
    };
  }

  let lastBoatWake = -99999;
  let lastPointerWake = -99999;

  // Add an expanding wake node in screen coordinates
  function depositWake(screenX, screenY, strength) {
    const uv = toNormUv(screenX, screenY);
    const node = wakeNodes[nextWakeIdx];
    node.x = uv.x;
    node.y = uv.y;
    node.birth = (Date.now() - sessionStartTime) * 0.001;
    node.strength = Math.max(0.01, Math.min(1.0, strength));
    nextWakeIdx = (nextWakeIdx + 1) % MAX_WAKE_NODES;
  }

  // The boat passes boat.speed / maxSpeed, which can fall to ~0.11 just above
  // its wake threshold; the 0.2 floor keeps a slow boat's trail visible. It
  // lives here rather than in depositWake so quieter sources can go below it.
  window.addBoatWakeNode = function (screenX, screenY, strength = 1.0) {
    lastBoatWake = Date.now();
    depositWake(screenX, screenY, Math.max(0.2, Math.min(1.0, strength)));
  };

  // -------------------------------------------------------------
  // Index Entry Halos
  // Feeds the bounding boxes of [data-nx-glow] rows to the shader so the
  // nebula blooms around them, and rises on hover. Rows are re-queried when
  // instant-nav swaps <main>, so SPA navigation keeps working.
  // -------------------------------------------------------------
  const MAX_GLOW_BOXES = 6; // headroom: the games list is data-driven
  const REST_GLOW = 0.26;
  const flatGlowBoxes = new Float32Array(MAX_GLOW_BOXES * 4);
  const flatGlowParams = new Float32Array(MAX_GLOW_BOXES * 4);
  const reduceMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  let glowEls = [];

  function refreshGlowEls() {
    glowEls = Array.prototype.slice.call(
      document.querySelectorAll('[data-nx-glow]'), 0, MAX_GLOW_BOXES
    );
  }

  // This script runs in <body> ahead of <main>, so bind once the DOM exists
  function initGlowTargets() {
    refreshGlowEls();
    if (!window.MutationObserver) return;
    const mainEl = document.querySelector('main');
    if (mainEl) {
      new MutationObserver(refreshGlowEls).observe(mainEl, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGlowTargets);
  } else {
    initGlowTargets();
  }

  // Delegated so rows swapped in by instant-nav need no rebinding.
  // Hover raises the halo only - the ripple belongs to the cursor, not to the
  // middle of a 700px-wide row, which is a source nothing is standing at.
  document.addEventListener('mouseover', e => {
    const el = e.target.closest && e.target.closest('[data-nx-glow]');
    if (!el) return;
    el._nxHot = true;
  }, { passive: true });

  document.addEventListener('mouseout', e => {
    const el = e.target.closest && e.target.closest('[data-nx-glow]');
    if (el && (!e.relatedTarget || !el.contains(e.relatedTarget))) el._nxHot = false;
  }, { passive: true });

  document.addEventListener('focusin', e => {
    const el = e.target.closest && e.target.closest('[data-nx-glow]');
    if (el) el._nxHot = true;
  });

  document.addEventListener('focusout', e => {
    const el = e.target.closest && e.target.closest('[data-nx-glow]');
    if (el) el._nxHot = false;
  });

  function updateGlowBoxes(dpr) {
    const vp = canvasCssSize();

    for (let i = 0; i < MAX_GLOW_BOXES; i++) {
      const el = glowEls[i];
      if (!el) {
        flatGlowBoxes[i * 4 + 2] = 0.0;
        flatGlowParams[i * 4 + 1] = 0.0;
        continue;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.bottom < 0 || rect.top > vp.h) {
        flatGlowBoxes[i * 4 + 2] = 0.0;
        flatGlowParams[i * 4 + 1] = 0.0;
        continue;
      }

      const target = el._nxHot ? 1.0 : REST_GLOW;
      const cur = typeof el._nxGlow === 'number' ? el._nxGlow : REST_GLOW;
      el._nxGlow = reduceMotion.matches ? target : cur + (target - cur) * 0.12;

      flatGlowBoxes[i * 4 + 0] = (rect.left + rect.width * 0.5) * dpr;
      flatGlowBoxes[i * 4 + 1] = (vp.h - (rect.top + rect.height * 0.5)) * dpr;
      flatGlowBoxes[i * 4 + 2] = rect.width * 0.5 * dpr;
      flatGlowBoxes[i * 4 + 3] = rect.height * 0.5 * dpr;
      flatGlowParams[i * 4 + 0] = 11.0 * dpr;
      flatGlowParams[i * 4 + 1] = el._nxGlow;
      flatGlowParams[i * 4 + 2] = el.getAttribute('data-nx-glow') === 'white' ? 1.0 : 0.0;
    }

    gl.uniform4fv(uGlowBoxes, flatGlowBoxes);
    gl.uniform4fv(uGlowParams, flatGlowParams);
  }

  // -------------------------------------------------------------
  // Ambient Pointer Ripples
  // Gentle disturbance trailing the cursor. The boat's V-wake emerges from the
  // superposition of its historical nodes in this same 20-slot ring, so while
  // the boat is sailing the pointer stays out of the ring rather than punching
  // holes in the trail. Gated on distance as well as time so a resting cursor
  // deposits nothing.
  // -------------------------------------------------------------
  const POINTER_WAKE_INTERVAL = 55;   // ms between ripples (boat: 75)
  const POINTER_WAKE_DISTANCE = 18;   // px of travel between ripples
  const POINTER_WAKE_STRENGTH = 0.125; // vs 0.7-1.0 for the boat
  const POINTER_MIN_SPEED = 0.15;     // px/ms - below this the cursor is at rest
  const BOAT_PRIORITY_WINDOW = 2000;  // ms of silence after a boat deposit

  let pointerAnchorX = null;
  let pointerAnchorY = null;
  let lastMoveX = null;
  let lastMoveY = null;
  let lastMoveTime = 0;

  document.addEventListener('mousemove', e => {
    if (reduceMotion.matches) return;

    const now = Date.now();

    // Instantaneous cursor speed, sampled every event. Gating on speed rather
    // than on distance travelled since the last ripple means a slow creep
    // never accumulates its way into one - ripples require actual movement.
    const prevX = lastMoveX;
    const prevY = lastMoveY;
    const prevT = lastMoveTime;
    lastMoveX = e.clientX;
    lastMoveY = e.clientY;
    lastMoveTime = now;

    if (prevX === null) return;

    const mx = e.clientX - prevX;
    const my = e.clientY - prevY;
    const speed = Math.sqrt(mx * mx + my * my) / Math.max(now - prevT, 1);
    if (speed < POINTER_MIN_SPEED) return;

    if (now - lastBoatWake < BOAT_PRIORITY_WINDOW) return;
    if (now - lastPointerWake < POINTER_WAKE_INTERVAL) return;

    if (pointerAnchorX !== null) {
      const dx = e.clientX - pointerAnchorX;
      const dy = e.clientY - pointerAnchorY;
      if (dx * dx + dy * dy < POINTER_WAKE_DISTANCE * POINTER_WAKE_DISTANCE) return;
    }

    pointerAnchorX = e.clientX;
    pointerAnchorY = e.clientY;
    lastPointerWake = now;
    depositWake(e.clientX, e.clientY, POINTER_WAKE_STRENGTH);
  }, { passive: true });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.0);
    const vp = canvasCssSize();
    const displayWidth = Math.floor(vp.w * dpr);
    const displayHeight = Math.floor(vp.h * dpr);

    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform2f(uResolution, canvas.width, canvas.height);
    }
  }

  window.addEventListener('resize', resize);
  resize();

  let isRunning = true;

  // The fragment shader is the expensive part and it runs per pixel per frame.
  // On touch hardware, cap it: the nebula drifts slowly enough that 30fps is
  // indistinguishable, and it halves GPU time and battery draw. Desktop keeps
  // its uncapped rAF exactly - FRAME_MS is 0 there and the check short-circuits.
  const FRAME_MS = (window.matchMedia &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches) ? 1000 / 30 : 0;
  let lastFrameAt = 0;

  function render(now) {
    if (!isRunning) return;

    if (FRAME_MS && now && now - lastFrameAt < FRAME_MS) {
      requestAnimationFrame(render);
      return;
    }
    lastFrameAt = now || 0;

    const elapsed = (Date.now() - sessionStartTime) * 0.001;
    gl.uniform1f(uTime, elapsed);

    if (uWakeNodes) {
      for (let i = 0; i < MAX_WAKE_NODES; i++) {
        flatWake[i * 4 + 0] = wakeNodes[i].x;
        flatWake[i * 4 + 1] = wakeNodes[i].y;
        flatWake[i * 4 + 2] = wakeNodes[i].birth;
        flatWake[i * 4 + 3] = wakeNodes[i].strength;
      }
      gl.uniform4fv(uWakeNodes, flatWake);
    }

    if (uKofiBox) {
      const kofiHost = document.getElementById('global-kofi-host');
      if (kofiHost && kofiHost.classList.contains('active')) {
        const rect = kofiHost.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 1.0);
        const cx = (rect.left + rect.width * 0.5) * dpr;
        const cy = (canvasCssSize().h - (rect.top + rect.height * 0.5)) * dpr;
        const hw = (rect.width * 0.5 - 1.5) * dpr;
        const hh = (rect.height * 0.5 - 1.5) * dpr;
        gl.uniform4f(uKofiBox, cx, cy, hw, hh);
        gl.uniform1f(uKofiRadius, 8.0 * dpr);
        gl.uniform1f(uKofiFade, 72.0 * dpr); // 2x width: 72px base (extends 72px to 230px with Weierstrass modulation)
      } else {
        gl.uniform4f(uKofiBox, -9999.0, -9999.0, 0.0, 0.0);
        gl.uniform1f(uKofiRadius, 0.0);
        gl.uniform1f(uKofiFade, 0.0);
      }
    }

    if (uGlowBoxes && uGlowParams) {
      updateGlowBoxes(Math.min(window.devicePixelRatio || 1, 1.0));
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    requestAnimationFrame(render);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      isRunning = false;
    } else {
      isRunning = true;
      requestAnimationFrame(render);
    }
  });

  // Render initial frame synchronously and reveal canvas immediately
  render();
  canvas.classList.add('loaded');
})();
