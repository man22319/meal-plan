// ══════════════════════════════════════════
// PRESS-AND-HOLD — reusable hold interaction
// ══════════════════════════════════════════

export const HOLD_DURATION_MS = 800;
export const HOLD_MOVE_THRESHOLD_PX = 36;

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

export function roundedRectPath(width, height, radius, inset = 1.5) {
  const x = inset;
  const y = inset;
  const w = Math.max(0, width - inset * 2);
  const h = Math.max(0, height - inset * 2);
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  const midX = x + w / 2;
  return [
    `M ${midX} ${y}`,
    `H ${x + w - r}`,
    `A ${r} ${r} 0 0 1 ${x + w} ${y + r}`,
    `V ${y + h - r}`,
    `A ${r} ${r} 0 0 1 ${x + w - r} ${y + h}`,
    `H ${x + r}`,
    `A ${r} ${r} 0 0 1 ${x} ${y + h - r}`,
    `V ${y + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
    `H ${midX}`
  ].join(' ');
}

function setRingProgress(el, progress) {
  const value = el.querySelector('.hold-progress-value');
  const track = el.querySelector('.hold-progress-track');
  const wrap = el.querySelector('.hold-progress');
  const svg = el.querySelector('.hold-progress-svg');
  if (wrap) {
    wrap.classList.toggle('visible', progress > 0 && progress < 1);
  }
  if (!value || !svg) return;

  const w = el.offsetWidth || 0;
  const h = el.offsetHeight || 0;
  if (w < 2 || h < 2) return;

  const radius = parseFloat(getComputedStyle(el).borderRadius) || 8;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));

  const d = roundedRectPath(w, h, radius);
  value.setAttribute('d', d);
  if (track) track.setAttribute('d', d);

  const len = typeof value.getTotalLength === 'function' ? value.getTotalLength() : (2 * (w + h));
  value.style.strokeDasharray = String(len);
  value.style.strokeDashoffset = String(len * (1 - progress));
}

function eventPoint(e) {
  if (e.touches && e.touches[0]) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  if (e.changedTouches && e.changedTouches[0]) {
    return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

export function bindPressAndHold(el, { onComplete } = {}) {
  let suppressClick = false;
  let rafId = 0;
  let holdTimer = 0;
  let listening = false;

  const controller = createPressHoldController({
    onComplete: () => {
      suppressClick = true;
      el.dataset.holdConsumed = 'true';
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

  function stopLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = 0;
    }
  }

  function loop() {
    controller.tick();
    if (controller.isActive()) {
      rafId = requestAnimationFrame(loop);
    } else {
      rafId = 0;
      if (controller.didComplete()) unbindRelease();
    }
  }

  function unbindRelease() {
    if (!listening) return;
    listening = false;
    window.removeEventListener('pointerup', onRelease, true);
    window.removeEventListener('pointercancel', onRelease, true);
    window.removeEventListener('touchend', onRelease, true);
    window.removeEventListener('touchcancel', onRelease, true);
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('touchmove', onMove, { capture: true });
  }

  function bindRelease() {
    if (listening) return;
    listening = true;
    window.addEventListener('pointerup', onRelease, true);
    window.addEventListener('pointercancel', onRelease, true);
    window.addEventListener('touchend', onRelease, true);
    window.addEventListener('touchcancel', onRelease, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('touchmove', onMove, { capture: true, passive: false });
  }

  function startHold(e) {
    if (e.type === 'pointerdown' && e.button !== undefined && e.button !== 0) return;
    if (e.type === 'touchstart' && window.PointerEvent) return;
    suppressClick = false;
    el.dataset.holdConsumed = '';
    const { x, y } = eventPoint(e);
    controller.pointerDown(x, y);
    stopLoop();
    bindRelease();
    holdTimer = window.setTimeout(() => {
      controller.tick();
      if (!controller.isActive()) {
        stopLoop();
        unbindRelease();
      }
    }, HOLD_DURATION_MS);
    rafId = requestAnimationFrame(loop);
  }

  function onMove(e) {
    if (!controller.isActive()) return;
    if (e.cancelable) e.preventDefault();
    const { x, y } = eventPoint(e);
    controller.pointerMove(x, y);
    if (!controller.isActive()) {
      stopLoop();
      unbindRelease();
    }
  }

  function onRelease(e) {
    if (e && e.type === 'pointercancel') return;
    if (controller.didComplete()) {
      suppressClick = true;
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    controller.pointerUp();
    stopLoop();
    unbindRelease();
  }

  function onClickCapture(e) {
    if (el.dataset.holdConsumed === 'true') suppressClick = true;
    if (!suppressClick) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClick = false;
    el.dataset.holdConsumed = '';
  }

  function onContextMenu(e) {
    e.preventDefault();
  }

  el.addEventListener('pointerdown', startHold);
  el.addEventListener('touchstart', startHold, { passive: true });
  el.addEventListener('click', onClickCapture, true);
  el.addEventListener('contextmenu', onContextMenu);

  return () => {
    stopLoop();
    unbindRelease();
    el.removeEventListener('pointerdown', startHold);
    el.removeEventListener('touchstart', startHold, { passive: true });
    el.removeEventListener('click', onClickCapture, true);
    el.removeEventListener('contextmenu', onContextMenu);
  };
}
