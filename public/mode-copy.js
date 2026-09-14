'use strict';

(function exposeModeCopy(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.portalModeCopy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => ({
  modeNotice(mode) {
    if (mode === 'demo') return 'Demonstration only: these are fictional records with non-specific locations.';
    if (mode === 'live') return 'Live data: inspection history is limited to this authorized connection and company; locations are city/state only.';
    return 'Data mode unavailable. Do not rely on this inspection history.';
  }
}));
