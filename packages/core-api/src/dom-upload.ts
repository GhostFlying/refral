/** Normalized source facts and GL parameters. DOM objects remain in the facade. */
export interface DomTextureUploadRequest {
  readonly operation: 'texImage2D' | 'texSubImage2D';
  readonly target: number;
  readonly level: number;
  readonly internalFormat: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly format: number;
  readonly type: number;
  readonly sourceValid: boolean;
}

/** Preparation validates without changing texture storage or versions. */
export interface DomTextureUploadPlan {
  readonly flipY: boolean;
  readonly premultiplyAlpha: boolean;
  readonly colorSpaceConversion: number;
}
