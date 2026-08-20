// ══════════════════════════════════════════
// PRESS-AND-HOLD — reusable hold interaction
// ══════════════════════════════════════════

export const HOLD_DURATION_MS = 800;
export const HOLD_MOVE_THRESHOLD_PX = 12;

export function createPressHoldController({
  duration = HOLD_DURATION_MS,
  moveThreshold = HOLD_MOVE_THRESHOLD_PX,
  onComplete,
  onProgress,
  onCancel,
  now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
} = {}) {
  let active = false;
  let completed = false;
  let startT = 0;
  let x0 = 0;
  let y0 = 0;

  function resetProgress() {
    onProgress?.(0);
  }

  const controller = {
    pointerDown(x, y) {
      active = true;
      completed = false;
      startT = now();
      x0 = x;
      y0 = y;
      onProgress?.(0);
    },
    pointerMove(x, y) {
      if (!active || completed) return;
      const dx = x - x0;
      const dy = y - y0;
      if ((dx * dx) + (dy * dy) > moveThreshold * moveThreshold) {
        controller.cancel();
      }
    },
    pointerUp() {
      if (!active) return;
      active = false;
      if (!completed) {
        resetProgress();
        onCancel?.();
      }
    },
    cancel() {
      if (!active) return;
      active = false;
      completed = false;
      resetProgress();
      onCancel?.();
    },
    tick() {
      if (!active || completed) return false;
      const elapsed = now() - startT;
      const p = Math.min(1, elapsed / duration);
      onProgress?.(p);
      if (p >= 1) {
        completed = true;
        active = false;
        onComplete?.();
        return true;
      }
      return false;
    },
    isActive() {
      return active;
    },
    didComplete() {
      return completed;
    }
  };

  return controller;
}

function setRingProgress(el, progress) {
  const value = el.querySelector('.hold-progress-value');
  const wrap = el.querySelector('.hold-progress');
  if (wrap) {
    wrap.classList.toggle('visible', progress > 0 && progress < 1);
  }
  if (value) {
    const radius = Number(value.getAttribute('r') || 15.5);
    const circ = 2 * Math.PI * radius;
    value.style.strokeDasharray = String(circ);
    value.style.strokeDashoffset = String(circ * (1 - progress));
  }
}

export function bindPressAndHold(el, { onComplete, shouldIgnore } = {}) {
  const controller = createPressHoldController({
    onComplete: () => {
      setRingProgress(el, 0);
      el.classList.remove('is-holding');
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(10);
        }
      } catch {
        // haptic not available
      }
      onComplete?.();
    },
    onProgress: (p) => {
      el.classList.toggle('is-holding', p > 0 && p < 1);
      setRingProgress(el, p);
    },
    onCancel: () => {
      el.classList.remove('is-holding');
      setRingProgress(el, 0);
    }
  });

  let rafId = 0;
  let pointerId = null;
  let suppressClick = false;

  function stopLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function loop() {
    controller.tick();
    if (controller.isActive()) {
      rafId = requestAnimationFrame(loop);
    } else {
      rafId = 0;
    }
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (shouldIgnore && shouldIgnore(e)) return;
    pointerId = e.pointerId;
    suppressClick = false;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // capture optional
    }
    controller.pointerDown(e.clientX, e.clientY);
    stopLoop();
    rafId = requestAnimationFrame(loop);
  }

  function onPointerMove(e) {
    if (pointerId !== null && e.pointerId !== pointerId) return;
    controller.pointerMove(e.clientX, e.clientY);
    if (!controller.isActive()) stopLoop();
  }

  function onPointerUp(e) {
    if (pointerId !== null && e.pointerId !== pointerId) return;
    if (controller.didComplete()) {
      suppressClick = true;
    }
    controller.pointerUp();
    stopLoop();
    pointerId = null;
  }

  function onPointerCancel() {
    controller.cancel();
    stopLoop();
    pointerId = null;
  }

  function onClickCapture(e) {
    if (!suppressClick) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClick = false;
  }

  function onContextMenu(e) {
    e.preventDefault();
  }

  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerCancel);
  el.addEventListener('lostpointercapture', onPointerCancel);
  el.addEventListener('click', onClickCapture, true);
  el.addEventListener('contextmenu', onContextMenu);

  return () => {
    stopLoop();
    el.removeEventListener('pointerdown', onPointerDown);
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('pointercancel', onPointerCancel);
    el.removeEventListener('lostpointercapture', onPointerCancel);
    el.removeEventListener('click', onClickCapture, true);
    el.removeEventListener('contextmenu', onContextMenu);
  };
}
