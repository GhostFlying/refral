export const caseNames = [
  'uniform-snapshot', 'vertex-index-update', 'upload-snapshot', 'storage-replacement',
  'relink-and-errors', 'masked-clear', 'render-to-texture', 'resource-ownership',
  'error-state', 'automatic-submit', 'texture-orientation', 'depth-blend',
  'texture-reallocation', 'resize-framebuffer', 'constant-alpha-blend',
  'zero-initialized-rgb',
  'index-format-cache', 'texture-subimage-snapshot',
] as const;

export type CaseName = typeof caseNames[number];
