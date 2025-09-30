import { describe, expect, it } from 'vitest';

import {
  MatomoAuthError,
  MatomoClientError,
  MatomoPermissionError,
} from '../src/errors.js';

describe('MatomoApiError guidance', () => {
  it('provides remediation for invalid site id errors', () => {
    const error = new MatomoClientError(
      'Matomo request failed (400): No website found with id 99'
    );

    expect(error.guidance).toContain('siteId value');
  });

  it('suggests fixing invalid period messages', () => {
    const error = new MatomoClientError(
      'Matomo request failed (400): The period "foobar" is not supported'
    );

    expect(error.guidance).toContain('Matomo-supported periods');
  });

  it('highlights date formatting issues', () => {
    const error = new MatomoClientError(
      'Matomo request failed (400): The date parameter is invalid for period=range'
    );

    expect(error.guidance).toContain('Matomo formats');
  });

  it('covers invalid segment expressions', () => {
    const error = new MatomoClientError(
      'Matomo request failed (400): The segment "browserName==Edge" is not valid'
    );

    expect(error.guidance).toContain('segment expression');
  });

  it('guides when methods are unknown', () => {
    const error = new MatomoClientError(
      'Matomo request failed (400): Unknown method "Actions.getFoo"'
    );

    expect(error.guidance).toContain('method/module name');
  });

  it('addresses missing goals', () => {
    const error = new MatomoClientError(
      'Matomo request failed (400): Goal ID = 4 does not exist'
    );

    expect(error.guidance).toContain('goal ID exists');
  });

  it('offers remediation for token errors', () => {
    const error = new MatomoAuthError(
      'Matomo authentication failed: Invalid token_auth provided'
    );

    expect(error.guidance).toContain('Generate a new token');
  });

  it('suggests adjusting permissions when denied', () => {
    const error = new MatomoPermissionError(
      'Matomo permission error: Access denied for site id=3'
    );

    expect(error.guidance).toContain('Grant view access');
  });
});
