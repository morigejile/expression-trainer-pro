(function initializeSafeRendering(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.SafeRendering = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const VAGUE_WORDS = [
    '开心', '难过', '害怕', '生气', '不舒服', '很好', '很多', '很快',
    '很大', '很小', '好看', '不好', '喜欢', '讨厌', '觉得', '想想'
  ];
  const FILLER_PATTERN = /(嗯|啊|呃|额|那个|就是|然后|这个|对吧|是吧|反正|基本上)/g;
  const HEDGE_PATTERN = /(可能|也许|大概|应该|我觉得|好像|似乎|或许|不一定|差不多|感觉)/g;

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function markTextTokens(tokens, pattern, type) {
    const result = [];

    for (const token of tokens) {
      if (token.type !== 'text') {
        result.push(token);
        continue;
      }

      let cursor = 0;
      pattern.lastIndex = 0;
      for (const match of token.text.matchAll(pattern)) {
        if (match.index > cursor) {
          result.push({ type: 'text', text: token.text.slice(cursor, match.index) });
        }
        result.push({ type, text: match[0] });
        cursor = match.index + match[0].length;
      }
      if (cursor < token.text.length) {
        result.push({ type: 'text', text: token.text.slice(cursor) });
      }
    }

    return result;
  }

  function tokenizeHighlightedText(text) {
    const input = String(text ?? '');
    const vaguePattern = new RegExp(VAGUE_WORDS.map(escapeRegExp).join('|'), 'g');
    let tokens = [{ type: 'text', text: input }];
    tokens = markTextTokens(tokens, vaguePattern, 'vague');
    tokens = markTextTokens(tokens, FILLER_PATTERN, 'filler');
    tokens = markTextTokens(tokens, HEDGE_PATTERN, 'hedge');
    return tokens;
  }

  function renderHighlightedText(container, text) {
    const document = container.ownerDocument;
    container.replaceChildren();

    for (const token of tokenizeHighlightedText(text)) {
      if (token.type === 'text') {
        container.appendChild(document.createTextNode(token.text));
        continue;
      }

      const span = document.createElement('span');
      span.className = token.type;
      span.appendChild(document.createTextNode(token.text));
      container.appendChild(span);
    }
  }

  function tokenizeInlineMarkdown(text) {
    const input = String(text ?? '');
    const pattern = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;
    const tokens = [];
    let cursor = 0;

    for (const match of input.matchAll(pattern)) {
      if (match.index > cursor) {
        tokens.push({ type: 'text', text: input.slice(cursor, match.index) });
      }
      if (match[0].startsWith('**')) {
        tokens.push({ type: 'strong', text: match[0].slice(2, -2) });
      } else {
        tokens.push({ type: 'code', text: match[0].slice(1, -1) });
      }
      cursor = match.index + match[0].length;
    }

    if (cursor < input.length) {
      tokens.push({ type: 'text', text: input.slice(cursor) });
    }
    return tokens;
  }

  function appendInlineMarkdown(document, container, text) {
    for (const token of tokenizeInlineMarkdown(text)) {
      if (token.type === 'text') {
        container.appendChild(document.createTextNode(token.text));
        continue;
      }

      const element = document.createElement(token.type);
      element.appendChild(document.createTextNode(token.text));
      container.appendChild(element);
    }
  }

  function renderReportContent(container, report) {
    const document = container.ownerDocument;
    const lines = String(report ?? '').replace(/\r\n?/g, '\n').split('\n');
    container.replaceChildren();

    for (const line of lines) {
      let tagName = 'div';
      let content = line;

      if (line.startsWith('### ')) {
        tagName = 'h3';
        content = line.slice(4);
      } else if (line.startsWith('## ')) {
        tagName = 'h2';
        content = line.slice(3);
      } else if (line.startsWith('> ')) {
        tagName = 'blockquote';
        content = line.slice(2);
      } else if (line === '') {
        container.appendChild(document.createElement('br'));
        continue;
      }

      const block = document.createElement(tagName);
      appendInlineMarkdown(document, block, content);
      container.appendChild(block);
    }
  }

  return {
    escapeHtml,
    renderHighlightedText,
    renderReportContent,
    tokenizeHighlightedText
  };
});
