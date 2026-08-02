"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/components/patterns/use-reduced-motion";

const VERTEX = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

/** fBm over a cheap value-noise basis. One fullscreen quad, no libraries. */
const FRAGMENT = `#version 300 es
precision mediump float;
out vec4 fragColor;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uAccent;
uniform vec3 uWarm;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y);
}

float fbm(vec2 p) {
  float total = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    total += noise(p) * amp;
    p *= 2.02;
    amp *= 0.5;
  }
  return total;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = uv * vec2(uRes.x / uRes.y, 1.0) * 1.6;

  float t = uTime * 0.035;
  float n1 = fbm(p + vec2(t, t * 0.6));
  float n2 = fbm(p * 1.4 + vec2(-t * 0.8, t * 0.4) + n1);

  float glow = smoothstep(0.35, 0.95, n2);
  float rim = smoothstep(0.55, 1.0, n1);

  vec3 colour = mix(uAccent * glow, uWarm * rim, 0.35);
  // Fade toward the bottom so content never fights the mesh for contrast.
  float falloff = smoothstep(1.05, 0.1, uv.y);
  fragColor = vec4(colour, glow * 0.42 * falloff);
}`;

function parseColour(value: string): [number, number, number] {
  const hex = value.trim().replace("#", "");
  if (hex.length === 6) {
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
    ];
  }
  return [0.29, 0.23, 1];
}

/**
 * Aurora mesh — a single fullscreen WebGL2 quad running a hand-written fBm
 * shader. No three.js: this is one program, one buffer, ~2KB of source.
 *
 * Rendered at half device-pixel-ratio and capped at 30fps because it is a
 * background. Paused when off-screen or the tab is hidden. Under reduced motion
 * or on coarse pointers it never initialises at all and the CSS gradient
 * underneath is what you see.
 */
export function AuroraMesh({ className = "" }: { className?: string }) {
  const reduced = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (reduced) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      powerPreference: "low-power",
    });
    if (!gl) {
      setFailed(true);
      return;
    }

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vs = compile(gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vs || !fs || !program) {
      setFailed(true);
      return;
    }

    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      setFailed(true);
      return;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const uRes = gl.getUniformLocation(program, "uRes");
    const uTime = gl.getUniformLocation(program, "uTime");
    const styles = getComputedStyle(document.documentElement);
    gl.uniform3fv(
      gl.getUniformLocation(program, "uAccent"),
      parseColour(styles.getPropertyValue("--accent") || "#4b3bff"),
    );
    gl.uniform3fv(
      gl.getUniformLocation(program, "uWarm"),
      parseColour(styles.getPropertyValue("--accent-warm") || "#ff5c38"),
    );

    const resize = () => {
      // Half DPR: the mesh is blurry by design, so pixels are wasted on it.
      const dpr = Math.min(1, (window.devicePixelRatio || 1) * 0.5);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
    };
    resize();

    let raf = 0;
    let last = 0;
    let visible = true;
    const start = performance.now();

    const frame = (now: number) => {
      if (visible && !document.hidden && now - last > 33) {
        last = now;
        gl.uniform1f(uTime, (now - start) / 1000);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    io.observe(canvas);
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("resize", resize);
      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
    };
  }, [reduced]);

  if (failed) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none block size-full ${className}`}
    />
  );
}
