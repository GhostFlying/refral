import { runCubemapCase } from './cubemap-cases';

declare global {
  interface Window {
    runCubemapDeployment: typeof runCubemapCase;
  }
}

window.runCubemapDeployment = runCubemapCase;
