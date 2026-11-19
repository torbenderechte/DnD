// =========================================================
// THEMA „Lost Place": Szenen-Motor.
// Hängt nur bei <html data-theme="lostplace"> eine Kulisse in den Body:
//   - endloser Backrooms-Korridor, gezeichnet in EINEM WebGL-Canvas
//     (Flur, Dunst, Staub, Taschenlampe – ein Layer in Fenstergröße
//     statt vier riesiger CSS-3D-Ebenen)
//   - Taschenlampe folgt dem Zeiger, die Kamera schaut weich hinterher
//   - gelegentlich steht etwas am Ende des Flurs …
//   - VHS-Overlay mit laufender REC-Uhr
// Alles rein dekorativ (aria-hidden, pointer-events: none). Beim Wechsel
// des Themas wird alles wieder abgebaut, Timer gestoppt.
// Die Texturen kommen aus den CSS-Variablen --bk-* des Themas.
// =========================================================
(function () {
    'use strict';
    const ID = 'lostplace';
    const root = document.documentElement;
    const motion = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

    // Maße des Flurs (CSS-Pixel): 1600 breit, 960 hoch, eine Schritt-Periode = 240
    const PERSPECTIVE = 760, ORIGIN_Y = 0.48;
    const HALF_W = 800, HALF_H = 480, PERIOD = 240, Z_PHASE = 4600;
    const Z_FAR = -9400, Z_NEAR = 720;       // bis knapp vor die Kamera: deckt jedes Fenster
    const WALK_S = 3.2, SWAY_S = 6.4;
    const MAX_DPR = 1.5;                      // Kulisse ist weich & abgedunkelt – mehr sieht man nicht
    const ENTITY_PAD = 40;

    let scene = null, fx = null, osdTime = null, canvas = null;
    let timers = [];
    let started = 0, clockStart = 0;
    let gfx = null;          // { gl, programs, buffers, textures }
    let sources = null;      // gerasterte Texturen (Canvas), überleben einen Kontextverlust
    let raf = 0, resizeObs = null;
    let mx = null, my = null;                 // Zeiger in CSS-Pixeln (null = Mitte)
    let lookX = 0, lookY = 0, lastFrame = 0;
    const entity = { x: 0, z: -1800, target: 0, alpha: 0 };
    let bitmapVars = null;   // einmal gerasterte Flächen-Texturen (Blob-URLs)

    const rand = (a, b) => a + Math.random() * (b - a);
    const later = (fn, ms) => { const t = setTimeout(() => { timers = timers.filter(x => x !== t); fn(); }, ms); timers.push(t); return t; };

    function el(tag, cls, html) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html) e.innerHTML = html;
        return e;
    }

    function build() {
        // ---- Kulisse hinter dem Inhalt ------------------------------------
        scene = el('div', 'lp-scene');
        scene.setAttribute('aria-hidden', 'true');
        canvas = el('canvas', 'lp-canvas');
        scene.append(canvas);

        // ---- Effekte über dem Inhalt (klickt nichts weg) ---------------------
        fx = el('div', 'lp-fx');
        fx.setAttribute('aria-hidden', 'true');
        fx.innerHTML =
            '<div class="lp-noise"></div>' +
            '<div class="lp-vignette"></div>' +
            '<div class="lp-osd lp-osd-tl"><span class="lp-play">▶ PLAY</span><span class="lp-level">LEVEL 0</span></div>' +
            '<div class="lp-osd lp-osd-bl"><span class="lp-rec">● REC</span><span class="lp-time">00:00:00</span><span class="lp-date">JAN. 01 1996</span></div>' +
            '<div class="lp-osd lp-osd-tr">SP ▮▮▮▯</div>';
        osdTime = fx.querySelector('.lp-time');
    }

    // ---- Texturen: SVG aus CSS-Variable → Canvas ------------------------------
    function cssUrl(name) {
        const m = /url\(\s*(["']?)(.*?)\1\s*\)/.exec(getComputedStyle(root).getPropertyValue(name));
        return m ? m[2] : null;
    }

    async function raster(name, w, h, scale, opts) {
        let url = cssUrl(name);
        if (!url) throw new Error('Variable fehlt: ' + name);
        // SVGs ohne feste Größe zeichnet nicht jeder Browser in ein Canvas
        if (opts && opts.sized) url = url.replace('%3Csvg ', "%3Csvg width='" + w + "' height='" + h + "' ");
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        await img.decode();
        const pad = (opts && opts.pad) || 0;
        const c = document.createElement('canvas');
        c.width = Math.round((w + pad * 2) * scale);
        c.height = Math.round((h + pad * 2) * scale);
        const ctx = c.getContext('2d');
        if (opts && opts.filter && 'filter' in ctx) ctx.filter = opts.filter(scale);
        ctx.drawImage(img, pad * scale, pad * scale, w * scale, h * scale);
        return c;
    }

    function loadSources() {
        const s = window.devicePixelRatio > 1 ? 2 : 1;
        return Promise.all([
            raster('--bk-floor', 1600, 240, s),
            raster('--bk-ceil', 1600, 240, s),
            raster('--bk-wall', 240, 960, s),
            raster('--bk-entity', 160, 520, 2, {
                sized: true, pad: ENTITY_PAD,
                filter: k => 'blur(' + 0.6 * k + 'px) drop-shadow(0 0 ' + 18 * k + 'px rgba(0,0,0,0.9))'
            })
        ]).then(([floor, ceil, wall, ent]) => ({ floor, ceil, wall, entity: ent }));
    }

    // Schimmel/Korn/Teppich stecken als SVG-Filter in CSS-Variablen und würden bei
    // jedem Neuzeichnen einer Karte neu berechnet. Einmal zu Bitmaps rastern.
    async function bakeSurfaceTextures() {
        if (!bitmapVars) {
            const s = window.devicePixelRatio > 1 ? 2 : 1;
            const jobs = [['--mildew', 480, 1], ['--grain', 220, s], ['--carpet', 200, s]];
            bitmapVars = Promise.all(jobs.map(async ([name, size, k]) => {
                const c = await raster(name, size, size, k);
                const blob = await new Promise(res => c.toBlob(res, 'image/png'));
                return blob ? [name, 'url("' + URL.createObjectURL(blob) + '")'] : null;
            })).catch(() => []);
        }
        const vars = await bitmapVars;
        if (!scene) return;
        vars.forEach(v => { if (v) root.style.setProperty(v[0], v[1]); });
    }

    // ---- WebGL ---------------------------------------------------------------
    const VS_WORLD = `#version 300 es
        in vec3 a_pos; in vec2 a_uv;
        uniform vec3 u_walk; uniform mat3 u_rot; uniform vec4 u_view; // B, H, Fluchtpunkt-y, Perspektive
        out vec2 v_uv;
        void main() {
            vec3 p = u_rot * (a_pos + u_walk);
            float w = 1.0 - p.z / u_view.w;
            gl_Position = vec4(p.x * 2.0 / u_view.x, -(u_view.z * w + p.y - u_view.z) * 2.0 / u_view.y, 0.0, w);
            v_uv = a_uv;
        }`;
    const FS_PLANE = `#version 300 es
        precision highp float;
        uniform sampler2D u_tex; in vec2 v_uv; out vec4 o;
        void main() { o = vec4(texture(u_tex, v_uv).rgb, 1.0); }`;
    const FS_SPRITE = `#version 300 es
        precision highp float;
        uniform sampler2D u_tex; uniform float u_alpha; uniform int u_mode;
        in vec2 v_uv; out vec4 o;
        void main() {
            if (u_mode == 1) {   // Schatten auf dem Teppich
                float t = length(v_uv - 0.5) / 0.7071;
                o = vec4(0.0, 0.0, 0.0, 0.7 * clamp(1.0 - t / 0.7, 0.0, 1.0) * u_alpha);
            } else {
                o = texture(u_tex, v_uv) * u_alpha;
            }
        }`;
    const VS_POST = `#version 300 es
        void main() {
            vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
            gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
        }`;
    // Dunst, Staub, Taschenlampe und Grundabdunklung in einem Durchgang:
    // sammelt alle Schichten als (Aufschlag b, Durchlass k) → Bild = b + k * Flur.
    const FS_POST = `#version 300 es
        precision highp float;
        uniform vec2 u_res; uniform float u_scale; uniform vec2 u_mouse;
        uniform vec2 u_dust1; uniform vec2 u_dust2;
        out vec4 o;
        vec3 b = vec3(0.0); float k = 1.0;
        void over(vec3 c, float a) { b = b * (1.0 - a) + c * a; k *= 1.0 - a; }
        float fall(vec2 p, vec2 c, vec2 r) { return clamp(length((p - c) / r), 0.0, 1.0); }
        float dot1(vec2 q, vec2 tile, vec2 c, float r0, float r1, float a) {
            float d = length(mod(q, tile) - c);
            return a * (1.0 - clamp((d - r0) / (r1 - r0), 0.0, 1.0));
        }
        float dot2(vec2 q, vec2 tile, vec2 c, float r0, float r1, float a) {   // weichgezeichnet
            vec2 m = mod(q, tile) - c;
            float rm = 0.5 * (r0 + r1);
            return a * (rm * rm / 5.8) * exp(-dot(m, m) / 5.8);
        }
        float dust(vec2 q, int soft) {
            if (soft == 1) return dot2(q, vec2(160.0, 220.0), vec2(16.0, 44.0), 1.0, 2.0, 0.75)
                + dot2(q, vec2(270.0, 310.0), vec2(162.0, 217.0), 1.4, 2.6, 0.55)
                + dot2(q, vec2(190.0, 170.0), vec2(161.5, 59.5), 0.8, 1.8, 0.45)
                + dot2(q, vec2(330.0, 260.0), vec2(115.5, 221.0), 1.1, 2.2, 0.6);
            return dot1(q, vec2(160.0, 220.0), vec2(16.0, 44.0), 1.0, 2.0, 0.75)
                + dot1(q, vec2(270.0, 310.0), vec2(162.0, 217.0), 1.4, 2.6, 0.55)
                + dot1(q, vec2(190.0, 170.0), vec2(161.5, 59.5), 0.8, 1.8, 0.45)
                + dot1(q, vec2(330.0, 260.0), vec2(115.5, 221.0), 1.1, 2.2, 0.6);
        }
        void main() {
            vec2 p = vec2(gl_FragCoord.x, u_res.y * u_scale - gl_FragCoord.y) / u_scale;
            vec2 c = u_res * vec2(0.5, 0.48);

            // Dunst, der den Flur ins Unendliche frisst
            over(vec3(150.0, 128.0, 40.0) / 255.0, 0.12);
            over(vec3(120.0, 104.0, 46.0) / 255.0, 0.18 * (1.0 - fall(p, c, u_res * vec2(0.60, 0.65))));
            over(vec3(60.0, 52.0, 22.0) / 255.0, 0.5 * (1.0 - fall(p, c, u_res * vec2(0.26, 0.30))));
            float t = fall(p, c, u_res * vec2(0.09, 0.12));
            over(vec3(52.0, 46.0, 20.0) / 255.0, 0.97 * (1.0 - clamp((t - 0.4) / 0.6, 0.0, 1.0)));

            // Staub im Röhrenlicht
            vec3 mote = vec3(255.0, 248.0, 210.0) / 255.0;
            over(mote, 0.55 * min(dust(p + 300.0 - u_dust1, 0), 1.0));
            over(mote, 0.30 * min(dust((p - 0.5 * u_res - u_dust2) / 1.4 + 0.5 * u_res + 300.0, 1), 1.0));

            // Taschenlampe: hell, wo der Zeiger ist; Ränder versinken
            float d = length(p - u_mouse);
            vec3 warm = vec3(255.0, 246.0, 200.0) / 255.0, dark = vec3(6.0, 5.0, 1.0) / 255.0;
            if (d < 140.0) over(warm, mix(0.2, 0.07, d / 140.0));
            else if (d < 240.0) over(warm, 0.07 * (1.0 - (d - 140.0) / 100.0));
            else if (d < 560.0) over(dark, 0.5 * (d - 240.0) / 320.0);
            else over(dark, mix(0.5, 0.78, min((d - 560.0) / 340.0, 1.0)));

            // Grundabdunklung
            over(vec3(5.0, 4.0, 2.0) / 255.0, 0.22);

            // etwas Rauschen gegen Farbstufen in den dunklen Verläufen
            float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
            o = vec4(b + (n - 0.5) / 255.0, k);
        }`;

    function program(gl, vs, fs, names) {
        const p = gl.createProgram();
        [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].forEach(([type, src]) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'Shader');
            gl.attachShader(p, s);
        });
        gl.bindAttribLocation(p, 0, 'a_pos');
        gl.bindAttribLocation(p, 1, 'a_uv');
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'Programm');
        const u = {};
        names.forEach(n => { u[n] = gl.getUniformLocation(p, 'u_' + n); });
        return { p, u };
    }

    function quad(out, a, b, c, d) { out.push(...a, ...b, ...c, ...a, ...c, ...d); }

    function corridorMesh() {
        const v = [];
        const along = z => (z + Z_PHASE) / PERIOD;
        const f = along(Z_FAR), n = along(Z_NEAR);
        // Boden, Decke (Kachel 1600 × 240), Wände (Kachel 240 × 960)
        quad(v, [-HALF_W, HALF_H, Z_FAR, 0, f], [HALF_W, HALF_H, Z_FAR, 1, f], [HALF_W, HALF_H, Z_NEAR, 1, n], [-HALF_W, HALF_H, Z_NEAR, 0, n]);
        quad(v, [-HALF_W, -HALF_H, Z_FAR, 0, -f], [HALF_W, -HALF_H, Z_FAR, 1, -f], [HALF_W, -HALF_H, Z_NEAR, 1, -n], [-HALF_W, -HALF_H, Z_NEAR, 0, -n]);
        quad(v, [-HALF_W, -HALF_H, Z_FAR, -f, 0], [-HALF_W, -HALF_H, Z_NEAR, -n, 0], [-HALF_W, HALF_H, Z_NEAR, -n, 1], [-HALF_W, HALF_H, Z_FAR, -f, 1]);
        quad(v, [HALF_W, -HALF_H, Z_FAR, f, 0], [HALF_W, -HALF_H, Z_NEAR, n, 0], [HALF_W, HALF_H, Z_NEAR, n, 1], [HALF_W, HALF_H, Z_FAR, f, 1]);
        return new Float32Array(v);
    }

    function entityMesh() {
        const v = [], x = entity.x, z = entity.z, P = ENTITY_PAD;
        // Schatten (288 × 36 zu Füßen), dann die Gestalt (160 × 520 + Rand für den Schein)
        quad(v, [x - 144, 462, z, 0, 0], [x + 144, 462, z, 1, 0], [x + 144, 498, z, 1, 1], [x - 144, 498, z, 0, 1]);
        quad(v, [x - 80 - P, -40 - P, z, 0, 0], [x + 80 + P, -40 - P, z, 1, 0], [x + 80 + P, HALF_H + P, z, 1, 1], [x - 80 - P, HALF_H + P, z, 0, 1]);
        return new Float32Array(v);
    }

    function initGL() {
        const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: false, stencil: false, powerPreference: 'low-power' });
        if (!gl) return null;
        const world = ['walk', 'rot', 'view'];
        const g = {
            gl,
            plane: program(gl, VS_WORLD, FS_PLANE, world.concat('tex')),
            sprite: program(gl, VS_WORLD, FS_SPRITE, world.concat('tex', 'alpha', 'mode')),
            post: program(gl, VS_POST, FS_POST, ['res', 'scale', 'mouse', 'dust1', 'dust2']),
            tex: {}
        };
        const vao = data => {
            const a = gl.createVertexArray(), buf = gl.createBuffer();
            gl.bindVertexArray(a);
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
            gl.enableVertexAttribArray(1);
            gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
            return { a, buf };
        };
        g.corridor = vao(corridorMesh());
        g.entity = vao(entityMesh());
        g.empty = gl.createVertexArray();

        const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        Object.keys(sources).forEach(name => {
            const t = gl.createTexture(), tiled = name !== 'entity';
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sources[name]);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, tiled ? gl.REPEAT : gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, tiled ? gl.REPEAT : gl.CLAMP_TO_EDGE);
            if (aniso && tiled) {
                gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT,
                    Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
            }
            g.tex[name] = t;
        });
        gl.clearColor(0x4a / 255, 0x42 / 255, 0x20 / 255, 1);   // Ende des Flurs: gelbes Nichts
        gl.activeTexture(gl.TEXTURE0);
        return g;
    }

    // CSS: rotateZ(a) rotateY(b) rotateX(c) – als 3×3, spaltenweise
    function rotation(a, b, c) {
        const r = Math.PI / 180;
        const ca = Math.cos(a * r), sa = Math.sin(a * r), cb = Math.cos(b * r), sb = Math.sin(b * r), cc = Math.cos(c * r), sc = Math.sin(c * r);
        return [
            ca * cb, sa * cb, -sb,
            ca * sb * sc - sa * cc, sa * sb * sc + ca * cc, cb * sc,
            ca * sb * cc + sa * sc, sa * sb * cc - ca * sc, cb * cc
        ];
    }

    function resize() {
        if (!canvas) return false;
        const k = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        const w = Math.max(1, Math.round(canvas.clientWidth * k)), h = Math.max(1, Math.round(canvas.clientHeight * k));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        return true;
    }

    function draw(now) {
        if (!gfx || !canvas.clientWidth || !canvas.clientHeight) return;
        const gl = gfx.gl, still = motion.matches;
        const W = canvas.clientWidth, H = canvas.clientHeight;
        const t = still ? 0 : (now - started) / 1000;
        const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
        lastFrame = now;

        const px = mx === null ? W * 0.5 : mx, py = my === null ? H * 0.45 : my;
        // Kamera schaut leicht dem Licht hinterher (weich nachgeführt)
        const ease = still ? 1 : 1 - Math.exp(-dt * 7);
        lookX += ((px / W - 0.5) * 6 - lookX) * ease;
        lookY += ((0.5 - py / H) * 4 - lookY) * ease;
        // Ein Schritt durch den Flur: 240px vor, zwei Schritte Kopfnicken
        const step = (t / WALK_S) % 1, half = (step * 2) % 1, bob = still ? 0 : 1 - Math.abs(2 * half - 1);
        const sway = still ? 0 : -Math.cos(t / SWAY_S * 2 * Math.PI);
        const rot = rotation(0.3 * sway, lookX + 0.5 * sway, lookY);
        const view = [W, H, (ORIGIN_Y - 0.5) * H, PERSPECTIVE];

        entity.alpha += Math.sign(entity.target - entity.alpha) * Math.min(Math.abs(entity.target - entity.alpha), dt / 1.2);

        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.disable(gl.BLEND);

        const world = (prog, walk) => {
            gl.useProgram(prog.p);
            gl.uniform3fv(prog.u.walk, walk);
            gl.uniformMatrix3fv(prog.u.rot, false, rot);
            gl.uniform4fv(prog.u.view, view);
            gl.uniform1i(prog.u.tex, 0);
        };
        world(gfx.plane, [step < 0.5 ? bob : -bob, -3 * bob, step * PERIOD]);
        gl.bindVertexArray(gfx.corridor.a);
        gl.bindTexture(gl.TEXTURE_2D, gfx.tex.floor); gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindTexture(gl.TEXTURE_2D, gfx.tex.ceil); gl.drawArrays(gl.TRIANGLES, 6, 6);
        gl.bindTexture(gl.TEXTURE_2D, gfx.tex.wall); gl.drawArrays(gl.TRIANGLES, 12, 12);

        gl.enable(gl.BLEND);
        if (entity.alpha > 0.002) {
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            world(gfx.sprite, [0, 0, 0]);
            gl.uniform1f(gfx.sprite.u.alpha, entity.alpha);
            gl.bindVertexArray(gfx.entity.a);
            gl.bindTexture(gl.TEXTURE_2D, gfx.tex.entity);
            gl.uniform1i(gfx.sprite.u.mode, 1); gl.drawArrays(gl.TRIANGLES, 0, 6);
            gl.uniform1i(gfx.sprite.u.mode, 0); gl.drawArrays(gl.TRIANGLES, 6, 6);
        }

        gl.blendFunc(gl.ONE, gl.SRC_ALPHA);
        gl.useProgram(gfx.post.p);
        gl.uniform2f(gfx.post.u.res, W, H);
        gl.uniform1f(gfx.post.u.scale, canvas.width / W);
        gl.uniform2f(gfx.post.u.mouse, px, py);
        gl.uniform2f(gfx.post.u.dust1, -160 * t / 26, 220 * t / 26);
        gl.uniform2f(gfx.post.u.dust2, 140 * t / 41, -260 * t / 41);
        gl.bindVertexArray(gfx.empty);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function frame(now) {
        raf = 0;
        draw(now);
        if (!motion.matches) schedule();
    }
    function schedule() { if (!raf && gfx) raf = requestAnimationFrame(frame); }

    function startGL() {
        try { gfx = initGL(); } catch (e) { console.warn('Lost Place: Kulisse ohne WebGL.', e); gfx = null; }
        if (!gfx) { scene.classList.add('lp-nogl'); return; }
        resize();
        lastFrame = performance.now();
        schedule();
        scene.classList.add('is-live');
    }

    // ---- Uhr -----------------------------------------------------------------
    function tickClock() {
        if (!osdTime) return;
        const s = Math.floor((Date.now() - clockStart) / 1000);
        const p = n => String(n).padStart(2, '0');
        osdTime.textContent = p(Math.floor(s / 3600)) + ':' + p(Math.floor(s / 60) % 60) + ':' + p(s % 60);
        later(tickClock, 1000);
    }

    // ---- Etwas steht im Flur ----------------------------------------------
    function entityLoop() {
        entity.z = Math.round(rand(-1500, -700));
        entity.x = Math.round(rand(-180, 180));
        if (gfx) {
            gfx.gl.bindBuffer(gfx.gl.ARRAY_BUFFER, gfx.entity.buf);
            gfx.gl.bufferSubData(gfx.gl.ARRAY_BUFFER, 0, entityMesh());
        }
        entity.target = 1;
        const stay = rand(4000, 7000);
        later(() => { entity.target = 0; }, stay); // blendet weich aus
        later(entityLoop, stay + rand(40000, 90000));
    }

    // ---- Taschenlampe ----------------------------------------------------------
    function onMove(e) {
        mx = e.clientX;
        my = e.clientY;
        if (motion.matches) schedule(); // sonst läuft die Schleife ohnehin
    }

    function onContextLost(e) {
        e.preventDefault();
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        gfx = null;
    }
    function onContextRestored() { if (scene && sources) startGL(); }

    function mount() {
        if (scene || !document.body) return;
        build();
        const mine = scene;
        document.body.prepend(scene);
        document.body.append(fx);
        clockStart = Date.now();
        started = performance.now();
        tickClock();
        window.addEventListener('pointermove', onMove, { passive: true });
        canvas.addEventListener('webglcontextlost', onContextLost);
        canvas.addEventListener('webglcontextrestored', onContextRestored);
        if (window.ResizeObserver) {
            resizeObs = new ResizeObserver(() => { if (resize() && gfx) { if (raf) cancelAnimationFrame(raf); raf = 0; draw(performance.now()); schedule(); } });
            resizeObs.observe(canvas);
        }
        loadSources().then(s => {
            if (scene !== mine) return;
            sources = s;
            startGL();
        }).catch(e => {
            console.warn('Lost Place: Kulisse konnte nicht geladen werden.', e);
            if (scene === mine) scene.classList.add('lp-nogl');
        });
        bakeSurfaceTextures();
        if (motion.matches) return; // Ruhige Fassung: Kulisse ja, Gezappel nein
        later(entityLoop, rand(9000, 18000));
    }

    function unmount() {
        timers.forEach(clearTimeout);
        timers = [];
        window.removeEventListener('pointermove', onMove);
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        if (resizeObs) resizeObs.disconnect();
        resizeObs = null;
        if (gfx) { const lose = gfx.gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); }
        gfx = sources = null;
        if (scene) scene.remove();
        if (fx) fx.remove();
        scene = fx = osdTime = canvas = null;
        entity.target = entity.alpha = 0;
        mx = my = null;
        lookX = lookY = 0;
        ['--mildew', '--grain', '--carpet'].forEach(p => root.style.removeProperty(p));
    }

    function sync() {
        if (root.dataset.theme === ID) mount(); else unmount();
    }

    new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    if (motion.addEventListener) motion.addEventListener('change', () => { if (scene) { unmount(); sync(); } });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync);
    else sync();
})();
