// Build-time only. Bundled by esbuild into ../vendor/three.bundle.js as a
// single classic-script IIFE that exposes THREE + the FontLoader / TextGeometry
// addons on window, so the composition stays fully synchronous (no ES-module
// load timing to race against the HyperFrames readiness poll).
import * as THREE from "three";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";

window.THREE = THREE;
window.HF3D = { FontLoader, TextGeometry };
