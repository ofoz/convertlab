import { useEffect, useRef, type DragEvent, type MouseEvent } from 'react';
import { SERVICE_HALL_HTML } from './serviceHallHtml';

export type HallStage =
  | 'welcome'
  | 'choosing'
  | 'receiving'
  | 'uploading'
  | 'placing'
  | 'working'
  | 'ready'
  | 'idle'
  | 'error';

type Props = {
  stage: HallStage;
  dialogue: string;
  stackCount?: number;
  stackLabel?: string;
  showStack?: boolean;
  showStartNew?: boolean;
  dragover?: boolean;
  onReceive: () => void;
  onCollect: () => void;
  onStartNew: () => void;
  onDropFiles?: (files: FileList) => void;
  onDragStateChange?: (active: boolean) => void;
};

/**
 * The service hall scene is reproduced verbatim from ConvertX (AGPL-3.0) so the SVG rig,
 * poses and CSS keyframes stay pixel-identical. React only drives the documented data
 * attributes and the handful of live-updating text nodes.
 */
export function ServiceHall({
  stage,
  dialogue,
  stackCount = 0,
  stackLabel = '文件已办好',
  showStack = false,
  showStartNew = false,
  dragover = false,
  onReceive,
  onCollect,
  onStartNew,
  onDropFiles,
  onDragStateChange,
}: Props) {
  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const hall = root.querySelector<HTMLElement>('#service-hall');
    if (!hall) return;
    hall.dataset.stage = stage;
    const line = root.querySelector<HTMLElement>('#hall-dialogue');
    if (line && line.textContent !== dialogue) line.textContent = dialogue;
    const receive = root.querySelector<HTMLButtonElement>('#hall-receive');
    if (receive) receive.disabled = stage !== 'receiving';
    const stack = root.querySelector<HTMLElement>('#hall-stack');
    if (stack) stack.hidden = !showStack;
    const count = root.querySelector<HTMLElement>('#hall-stack-count');
    if (count) count.textContent = `${stackCount} 份`;
    const top = root.querySelector<HTMLElement>('#hall-top-file');
    if (top) {
      top.textContent = stackLabel;
      top.title = stackLabel;
    }
    const again = root.querySelector<HTMLElement>('#hall-start-new');
    if (again) again.hidden = !showStartNew;
    hall.classList.toggle('is-dragover', dragover);
  }, [stage, dialogue, stackCount, stackLabel, showStack, showStartNew, dragover]);

  // Pause the decorative CSS motion when the scene is off-screen or the tab is hidden.
  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const hall = root.querySelector<HTMLElement>('#service-hall');
    if (!hall) return;
    let visible = true;
    const apply = () => {
      hall.dataset.motionPaused = visible && !document.hidden ? 'false' : 'true';
    };
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        apply();
      },
      { rootMargin: '120px' },
    );
    observer.observe(hall);
    document.addEventListener('visibilitychange', apply);
    apply();
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', apply);
    };
  }, []);

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest('#hall-receive')) onReceive();
    else if (target.closest('#collect-files')) onCollect();
    else if (target.closest('#hall-start-new')) onStartNew();
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!onDropFiles) return;
    event.preventDefault();
    if (!dragover) onDragStateChange?.(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!onDropFiles) return;
    const next = event.relatedTarget as Node | null;
    if (!next || !event.currentTarget.contains(next)) onDragStateChange?.(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!onDropFiles) return;
    event.preventDefault();
    onDragStateChange?.(false);
    if (event.dataTransfer?.files?.length) onDropFiles(event.dataTransfer.files);
  }

  return (
    <div
      ref={host}
      className="service-hall-host"
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      dangerouslySetInnerHTML={{ __html: SERVICE_HALL_HTML }}
    />
  );
}
