'use strict';

(function exposeSupportLinks(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SupportLinks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const FEEDBACK_DOCUMENT_URL = 'https://docs.qq.com/sheet/DYnRYV0xWQ0hwcnZI';
  const DEEPSEEK_GUIDE_URLS = Object.freeze([
    'https://platform.deepseek.com/',
    'https://platform.deepseek.com/api_keys',
    'https://api-docs.deepseek.com/zh-cn/',
    'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
    'https://api-docs.deepseek.com/zh-cn/quick_start/error_codes/',
    'https://api-docs.deepseek.com/zh-cn/news/news260424/'
  ]);

  function isAllowedSupportUrl(rawUrl) {
    return rawUrl === FEEDBACK_DOCUMENT_URL || DEEPSEEK_GUIDE_URLS.includes(rawUrl);
  }

  return {FEEDBACK_DOCUMENT_URL, DEEPSEEK_GUIDE_URLS, isAllowedSupportUrl};
});
