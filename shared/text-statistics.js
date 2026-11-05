(function initializeTextStatistics(root, factory) {
  const statistics = factory();
  if (typeof module === 'object' && module.exports) module.exports = statistics;
  else root.TextStatistics = statistics;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  // 按 Unicode 文字和数字计数；标点、空白及其他符号不计入字数。
  function countCharacters(text) {
    return (text.match(/[\p{L}\p{N}]/gu) || []).length;
  }

  function analysisCharacterCounts({fillers, hedges}) {
    // 同一分词位置可能同时命中自定义口癖和犹豫词，密度只扣除一次。
    const excluded = new Map([...fillers, ...hedges].map(item => [item.position, item.word]));
    return {
      excludedCharacters: [...excluded.values()].reduce((sum, word) => sum + countCharacters(word), 0),
      hedgeCharacters: hedges.reduce((sum, item) => sum + countCharacters(item.word), 0)
    };
  }

  function percentage(characters, totalCharacters) {
    return totalCharacters > 0 ? Math.round(characters / totalCharacters * 100) : null;
  }

  function densityPercent(totalCharacters, excludedCharacters) {
    return percentage(totalCharacters - excludedCharacters, totalCharacters);
  }

  function hasDuration(duration) {
    return Number.isFinite(duration) && duration > 0;
  }

  return {countCharacters, analysisCharacterCounts, percentage, densityPercent, hasDuration};
});
