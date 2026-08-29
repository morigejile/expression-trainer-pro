/**
 * 词库匹配模块
 * 加载情感词库JSON，分析文本中的情绪词、填充词、犹豫词
 */

const fs = require('fs');
const path = require('path');
const {FILLER_WORDS, HEDGE_WORDS, VAGUE_TO_PRECISE} = require('../shared/expression-rules');

let lexiconData = null;

/**
 * 加载词库
 */
function loadLexicon() {
  const lexiconPath = path.join(__dirname, '..', 'data', 'emotion-lexicon.json');

  if (fs.existsSync(lexiconPath)) {
    const raw = fs.readFileSync(lexiconPath, 'utf-8');
    lexiconData = JSON.parse(raw);
    console.log(`[词库] 加载完成，共 ${Object.keys(lexiconData.emotions || {}).length} 个情绪词`);
  } else {
    console.warn('[词库] emotion-lexicon.json 未找到，使用内置词表');
    lexiconData = { emotions: {} };
  }
}

/**
 * 简单中文分词（基于最大正向匹配 + 词表）
 */
function segmentText(text, extraFillers = new Set()) {
  const words = [];
  let i = 0;
  const maxLen = Math.max(6, ...[...extraFillers].map((word) => word.length));

  // 构建词表用于匹配
  const dict = new Set([
    ...FILLER_WORDS,
    ...HEDGE_WORDS,
    ...Object.keys(VAGUE_TO_PRECISE),
    ...extraFillers,
    ...Object.keys(lexiconData.emotions || {})
  ]);

  while (i < text.length) {
    let matched = false;
    for (let len = Math.min(maxLen, text.length - i); len >= 2; len--) {
      const word = text.substring(i, i + len);
      if (dict.has(word)) {
        words.push(word);
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // 单字
      words.push(text[i]);
      i++;
    }
  }

  return words;
}

/**
 * 分析文本
 * @param {string} text - 输入文本
 * @returns {Object} 分析结果
 */
function analyzeText(text, {extraFillers = []} = {}) {
  if (!text || !text.trim()) {
    return null;
  }

  const boundedExtraFillers = new Set(extraFillers
    .filter((word) => typeof word === 'string' && word.length > 0 && word.length <= 32)
    .slice(0, 64));
  const words = segmentText(text, boundedExtraFillers);
  const totalWords = words.length;

  // 检测填充词
  const fillers = [];
  words.forEach((word, idx) => {
    if (FILLER_WORDS.includes(word) || boundedExtraFillers.has(word)) {
      fillers.push({ word, position: idx });
    }
  });

  // 检测犹豫词
  const hedges = [];
  words.forEach((word, idx) => {
    if (HEDGE_WORDS.includes(word)) {
      hedges.push({ word, position: idx });
    }
  });

  // 检测笼统词
  const vagueWords = [];
  words.forEach((word, idx) => {
    if (VAGUE_TO_PRECISE[word]) {
      vagueWords.push({
        word,
        position: idx,
        alternatives: VAGUE_TO_PRECISE[word]
      });
    }
  });

  // 检测情绪词（来自词库）
  const emotionWords = [];
  if (lexiconData && lexiconData.emotions) {
    words.forEach((word, idx) => {
      if (lexiconData.emotions[word]) {
        emotionWords.push({
          word,
          position: idx,
          ...lexiconData.emotions[word]
        });
      }
    });
  }

  // 计算表达密度
  const meaningfulWords = totalWords - fillers.length - hedges.length;
  const density = totalWords > 0 ? (meaningfulWords / totalWords) : 1;

  return {
    totalWords,
    fillers,
    hedges,
    vagueWords,
    emotionWords,
    density: Math.round(density * 100),
    suggestions: generateSuggestions(vagueWords, fillers, hedges)
  };
}

/**
 * 生成替代建议
 */
function generateSuggestions(vagueWords, fillers, hedges) {
  const suggestions = [];

  // 笼统词替代
  vagueWords.forEach(item => {
    suggestions.push({
      type: 'vague',
      original: item.word,
      alternatives: item.alternatives.slice(0, 3),
      message: `「${item.word}」→ 试试更精准的：${item.alternatives.slice(0, 3).join('、')}`
    });
  });

  // 填充词提醒
  if (fillers.length >= 3) {
    const topFillers = [...new Set(fillers.map(f => f.word))].slice(0, 3);
    suggestions.push({
      type: 'filler',
      message: `填充词偏多（${fillers.length}次）：${topFillers.join('、')}。试试用停顿替代`
    });
  }

  // 犹豫词提醒
  if (hedges.length >= 2) {
    suggestions.push({
      type: 'hedge',
      message: `犹豫表达较多（${hedges.length}次）。试试把「我觉得」改成直接陈述`
    });
  }

  return suggestions;
}

module.exports = { loadLexicon, analyzeText, VAGUE_TO_PRECISE, FILLER_WORDS, HEDGE_WORDS };
