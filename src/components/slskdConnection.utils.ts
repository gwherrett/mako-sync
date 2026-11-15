/**
 * Messages for the slskd connection test (MAK-214).
 *
 * SlskdConfigSection shows one of these after Save or Test Connection, so each failure
 * points at its own fix: the API key, slskd not running or blocked by Chrome, or the
 * Soulseek login.
 */

import type { SlskdConnectionResult } from '@/types/slskd';

export interface SlskdConnectionMessage {
  tone: 'success' | 'error';
  title: string;
  description: string;
}

export function describeSlskdConnection(result: SlskdConnectionResult): SlskdConnectionMessage {
  switch (result.status) {
    case 'connected':
      return {
        tone: 'success',
        title: 'Connected',
        description: 'slskd is running and logged in to Soulseek.',
      };

    case 'not-logged-in':
      return {
        tone: 'error',
        title: 'Not logged in to Soulseek',
        description:
          `slskd is running, but it isn't logged in to Soulseek` +
          (result.serverState ? ` (state: ${result.serverState})` : '') +
          '. Pushed searches would return no results. Connect it from the slskd web UI, then test again.',
      };

    case 'unauthorized':
      return {
        tone: 'error',
        title: 'API key rejected',
        description:
          'slskd rejected the API key. Check that it matches the key under web.authentication.api_keys in slskd.yml.',
      };

    case 'unreachable':
      if (result.reason === 'timeout') {
        return {
          tone: 'error',
          title: "slskd didn't answer",
          description:
            "slskd didn't answer within 10 seconds. If Chrome is asking to allow local network access, allow it and test again. Otherwise check that slskd is running.",
        };
      }
      return {
        tone: 'error',
        title: "Can't reach slskd",
        description:
          "Check that slskd is running and the API endpoint is right. On the Vercel site, also check that you allowed Chrome's local network access prompt.",
      };

    case 'unexpected-response':
      return {
        tone: 'error',
        title: 'Unexpected response',
        description: `The endpoint answered, but not the way slskd does (${result.detail}). Check the API endpoint.`,
      };
  }
}
