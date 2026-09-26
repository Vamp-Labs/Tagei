import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { roundService, type ProgressionPayload } from '../../services/roundService';
import { LiveRoundController, type LiveView, type ResumeInfo } from './liveRoundController';

export interface LiveRoundHandlers {
  onProgression: (progression: ProgressionPayload) => void;
  onResume: (info: ResumeInfo) => void;
}

export function useLiveRound(enabled: boolean, handlers: LiveRoundHandlers): { view: LiveView; controller: LiveRoundController } {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const [controller] = useState(
    () =>
      new LiveRoundController(roundService, {
        onProgression: (progression) => handlersRef.current.onProgression(progression),
        onResume: (info) => handlersRef.current.onResume(info),
      }),
  );

  useEffect(() => {
    if (!enabled) return;
    controller.start();
    return () => {
      controller.stop();
      if (!roundService.isActive()) roundService.stop();
    };
  }, [enabled, controller]);

  const view = useSyncExternalStore(controller.subscribe, controller.getView);
  return { view, controller };
}
