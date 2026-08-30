'use strict';

(function exposeSupportLinks(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SupportLinks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const FEEDBACK_DOCUMENT_URL = 'https://docs.qq.com/sheet/DYnRYV0xWQ0hwcnZI';

  function isAllowedSupportUrl(rawUrl) {
    return rawUrl === FEEDBACK_DOCUMENT_URL;
  }

  return {FEEDBACK_DOCUMENT_URL, isAllowedSupportUrl};
});
