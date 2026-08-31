'use strict';

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function calculateInitialWindowSize(workAreaSize) {
  if (!Number.isFinite(workAreaSize?.width)
    || workAreaSize.width <= 0
    || !Number.isFinite(workAreaSize?.height)
    || workAreaSize.height <= 0) {
    throw new TypeError('Logical work area must contain positive finite dimensions');
  }

  return {
    width: clamp(Math.round(workAreaSize.width * 0.86), 1200, 1920),
    height: clamp(Math.round(workAreaSize.height * 0.88), 720, 1200)
  };
}

module.exports = {calculateInitialWindowSize};
