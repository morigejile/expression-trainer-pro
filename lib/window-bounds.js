'use strict';

function calculateInitialWindowSize(workAreaSize) {
  if (!Number.isFinite(workAreaSize?.width)
    || workAreaSize.width <= 0
    || !Number.isFinite(workAreaSize?.height)
    || workAreaSize.height <= 0) {
    throw new TypeError('Logical work area must contain positive finite dimensions');
  }

  return {
    width: 1200,
    height: 800
  };
}

module.exports = {calculateInitialWindowSize};
