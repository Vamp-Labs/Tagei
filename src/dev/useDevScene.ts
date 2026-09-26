import { useEffect, useRef, useState } from 'react';
import { marketFeed } from '../services/marketFeed';
import { installSceneRuntime, readSceneParams, sceneErrors } from './runtime';
import type { DevSceneContext, DevSceneParams, DevSceneState } from './types';

const INACTIVE: DevSceneState = { active: false, sim: false };

let sceneStarted = false;

function reportSceneFailure(params: DevSceneParams, error: unknown): void {
  window.__scene = { name: params.name, fontsOk: false, errors: [...sceneErrors, String(error)] };
  document.documentElement.dataset.sceneReady = '1';
}

function useDevSceneInDev(ctx: DevSceneContext): DevSceneState {
  const [params] = useState<DevSceneParams | null>(() => {
    const parsed = readSceneParams(window.location.search);
    if (parsed) installSceneRuntime(parsed);
    return parsed;
  });

  const ctxRef = useRef(ctx);
  useEffect(() => {
    ctxRef.current = ctx;
  });

  useEffect(() => {
    if (!params || sceneStarted) return;
    sceneStarted = true;
    if (params.freeze) marketFeed.cleanup();
    import('./scenes')
      .then(({ playScene }) => playScene(params, () => ctxRef.current))
      .catch((error: unknown) => reportSceneFailure(params, error));
  }, [params]);

  return params ? { active: true, sim: params.sim } : INACTIVE;
}

function useInactiveDevScene(_ctx: DevSceneContext): DevSceneState {
  return INACTIVE;
}

export const useDevScene = import.meta.env.DEV ? useDevSceneInDev : useInactiveDevScene;
