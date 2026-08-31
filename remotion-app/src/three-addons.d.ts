// This pinned `three` version ships no .d.ts at all (core or addons) --
// nothing in this repo imported it directly in TS before now. A blanket
// fallback for the core keeps `noImplicitAny` from cascading; the two addon
// modules below get real (if minimal) types matching their actual API.
declare module "three";

// Minimal ambient types for the two examples/jsm addons used here.

declare module "three/addons/loaders/FontLoader.js" {
  import { Loader, LoadingManager } from "three";

  export class Font {
    constructor(data: unknown);
    data: unknown;
    generateShapes(text: string, size?: number): unknown[];
  }

  export class FontLoader extends Loader {
    constructor(manager?: LoadingManager);
    parse(json: unknown): Font;
    load(
      url: string,
      onLoad: (font: Font) => void,
      onProgress?: (event: ProgressEvent) => void,
      onError?: (event: ErrorEvent) => void,
    ): void;
  }
}

declare module "three/addons/geometries/TextGeometry.js" {
  import { ExtrudeGeometry } from "three";
  import { Font } from "three/addons/loaders/FontLoader.js";

  export type TextGeometryParameters = {
    font: Font;
    size?: number;
    height?: number;
    curveSegments?: number;
    bevelEnabled?: boolean;
    bevelThickness?: number;
    bevelSize?: number;
    bevelOffset?: number;
    bevelSegments?: number;
  };

  export class TextGeometry extends ExtrudeGeometry {
    constructor(text: string, parameters: TextGeometryParameters);
  }
}
