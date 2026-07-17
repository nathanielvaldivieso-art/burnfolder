'use strict';

/**
 * Pluggable distro adapter.
 * Tier 2: LabelGrid only. DISTRO_PROVIDER must be "labelgrid".
 *
 * Provider methods:
 *   createRelease(payload) → { providerReleaseId, tracks, upc, raw }
 *   submitRelease(providerReleaseId, opts) → { status, message, raw }
 *   getReleaseStatus(providerReleaseId) → { status, upc, tracks, raw }
 *   getAnalytics(query) → stub OK in Tier 2
 *   importCatalog() → Tier 3
 */

function getProviderName() {
  const name = String(process.env.DISTRO_PROVIDER || 'labelgrid').trim().toLowerCase();
  return name || 'labelgrid';
}

function getProvider() {
  const name = getProviderName();
  if (name !== 'labelgrid') {
    throw new Error(
      'DISTRO_PROVIDER must be "labelgrid" in Tier 2 (got "' + name + '"). No other provider is wired yet.'
    );
  }
  return require('./labelgrid.provider');
}

module.exports = {
  getProviderName,
  getProvider
};
