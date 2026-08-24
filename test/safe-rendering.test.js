const test = require('node:test');
const assert = require('node:assert/strict');

const {
  escapeHtml,
  renderHighlightedText,
  renderReportContent,
  tokenizeHighlightedText
} = require('../src/safe-rendering');

class FakeNode {
  constructor(ownerDocument, nodeType, name = '', data = '') {
    this.ownerDocument = ownerDocument;
    this.nodeType = nodeType;
    this.tagName = name.toUpperCase();
    this.data = data;
    this.className = '';
    this.children = [];
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }

  replaceChildren(...nodes) {
    this.children = [...nodes];
  }

  get textContent() {
    if (this.nodeType === 3) return this.data;
    return this.children.map(child => child.textContent).join('');
  }
}

class FakeDocument {
  createElement(name) {
    return new FakeNode(this, 1, name);
  }

  createTextNode(text) {
    return new FakeNode(this, 3, '', String(text));
  }
}

function elementSnapshot(node) {
  return node.children
    .filter(child => child.nodeType === 1)
    .map(child => ({ tagName: child.tagName, className: child.className }));
}

function descendantTags(node) {
  const tags = [];
  for (const child of node.children) {
    if (child.nodeType !== 1) continue;
    tags.push(child.tagName);
    tags.push(...descendantTags(child));
  }
  return tags;
}

test('highlight tokens preserve hostile markup as text while classifying Chinese terms', () => {
  const input = '正常<script>evil()</script><img src=x onerror=evil()>这个很好可能';

  const tokens = tokenizeHighlightedText(input);

  assert.deepEqual(tokens, [
    { type: 'text', text: '正常<script>evil()</script><img src=x onerror=evil()>' },
    { type: 'filler', text: '这个' },
    { type: 'vague', text: '很好' },
    { type: 'hedge', text: '可能' }
  ]);
  assert.equal(tokens.map(token => token.text).join(''), input);
});

test('highlight renderer creates only controlled spans and text nodes', () => {
  const document = new FakeDocument();
  const container = document.createElement('div');
  const input = '<script>evil()</script><img src=x onerror=evil()>这个很好可能';

  renderHighlightedText(container, input);

  assert.equal(container.textContent, input);
  assert.deepEqual(elementSnapshot(container), [
    { tagName: 'SPAN', className: 'filler' },
    { tagName: 'SPAN', className: 'vague' },
    { tagName: 'SPAN', className: 'hedge' }
  ]);
});

test('report renderer allows formatting without creating elements from hostile HTML', () => {
  const document = new FakeDocument();
  const container = document.createElement('div');
  const report = [
    '## 标题 <img src=x onerror=evil()>',
    '普通<script>evil()</script> **重点** `代码`',
    '> 引用 <span onclick=evil()>内容</span>'
  ].join('\n');

  renderReportContent(container, report);

  assert.deepEqual(descendantTags(container), [
    'H2', 'DIV', 'STRONG', 'CODE', 'BLOCKQUOTE'
  ]);
  assert.deepEqual(container.children.map(child => child.textContent), [
    '标题 <img src=x onerror=evil()>',
    '普通<script>evil()</script> 重点 代码',
    '引用 <span onclick=evil()>内容</span>'
  ]);
});

test('HTML escaping neutralizes tags, quotes, and event attributes', () => {
  const input = '<script>evil()</script><img src=x onerror="evil()">\'';

  assert.equal(
    escapeHtml(input),
    '&lt;script&gt;evil()&lt;/script&gt;&lt;img src=x onerror=&quot;evil()&quot;&gt;&#39;'
  );
});
