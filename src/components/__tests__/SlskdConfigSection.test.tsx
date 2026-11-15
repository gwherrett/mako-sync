import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SlskdConfigSection } from '@/components/SlskdConfigSection';
import { describeSlskdConnection } from '@/components/slskdConnection.utils';
import { useSlskdConfig, type SlskdConnectionTest } from '@/hooks/useSlskdConfig';
import type { SlskdConfig, SlskdConnectionResult } from '@/types/slskd';

/**
 * Tests for the slskd connection test messages (MAK-214). The suite runs without a DOM,
 * so the section is rendered to static markup with a mocked hook.
 */

vi.mock('@/hooks/useSlskdConfig', () => ({ useSlskdConfig: vi.fn() }));

const savedConfig: SlskdConfig = {
  apiEndpoint: 'http://localhost:5030',
  apiKey: 'key-123',
  downloadsFolder: '',
  searchFormat: 'primary',
  connectionStatus: true,
};

function renderWith(lastTest: SlskdConnectionTest | null, config: SlskdConfig = savedConfig): string {
  vi.mocked(useSlskdConfig).mockReturnValue({
    config,
    lastTest,
    saveConfig: vi.fn(),
    testConnection: vi.fn(),
    isSaving: false,
    isTesting: false,
  } as unknown as ReturnType<typeof useSlskdConfig>);
  return renderToStaticMarkup(<SlskdConfigSection />);
}

function testOf(result: SlskdConnectionResult, apiKey = 'key-123'): SlskdConnectionTest {
  return { apiEndpoint: 'http://localhost:5030', apiKey, result };
}

describe('describeSlskdConnection', () => {
  it('says connected and logged in', () => {
    const message = describeSlskdConnection({ status: 'connected' });
    expect(message.tone).toBe('success');
    expect(message.title).toBe('Connected');
    expect(message.description).toContain('logged in to Soulseek');
  });

  it('says not logged in, with the server state', () => {
    const message = describeSlskdConnection({ status: 'not-logged-in', serverState: 'Disconnected' });
    expect(message.tone).toBe('error');
    expect(message.title).toBe('Not logged in to Soulseek');
    expect(message.description).toContain("isn't logged in to Soulseek (state: Disconnected).");
    expect(message.description).toContain('slskd web UI');
  });

  it('leaves out the state when slskd does not report one', () => {
    const message = describeSlskdConnection({ status: 'not-logged-in', serverState: null });
    expect(message.description).toContain("isn't logged in to Soulseek. Pushed searches");
    expect(message.description).not.toContain('state:');
  });

  it('says to check the API key for a 401', () => {
    const message = describeSlskdConnection({ status: 'unauthorized' });
    expect(message.tone).toBe('error');
    expect(message.title).toBe('API key rejected');
    expect(message.description).toContain('web.authentication.api_keys');
  });

  it('says to check slskd is running and the Chrome prompt for a network error', () => {
    const message = describeSlskdConnection({ status: 'unreachable', reason: 'network' });
    expect(message.tone).toBe('error');
    expect(message.title).toBe("Can't reach slskd");
    expect(message.description).toContain('slskd is running');
    expect(message.description).toContain("Chrome's local network access prompt");
  });

  it('says slskd did not answer for a timeout', () => {
    const message = describeSlskdConnection({ status: 'unreachable', reason: 'timeout' });
    expect(message.tone).toBe('error');
    expect(message.title).toBe("slskd didn't answer");
    expect(message.description).toContain('10 seconds');
    expect(message.description).toContain('local network access');
  });

  it('says to check the endpoint for an unexpected response', () => {
    const message = describeSlskdConnection({ status: 'unexpected-response', detail: 'HTTP 404' });
    expect(message.tone).toBe('error');
    expect(message.title).toBe('Unexpected response');
    expect(message.description).toContain('(HTTP 404)');
    expect(message.description).toContain('Check the API endpoint');
  });
});

describe('SlskdConfigSection connection message', () => {
  beforeEach(() => {
    vi.mocked(useSlskdConfig).mockReset();
  });

  const alertCount = (html: string) => html.split('role="alert"').length - 1;

  it('shows no message before a test, only the local storage note', () => {
    const html = renderWith(null);
    expect(alertCount(html)).toBe(1);
    expect(html).toContain('Configuration is stored locally');
  });

  it('adds one message box after a test', () => {
    expect(alertCount(renderWith(testOf({ status: 'connected' })))).toBe(2);
  });

  it.each<[string, SlskdConnectionResult, string]>([
    ['connected', { status: 'connected' }, 'slskd is running and logged in to Soulseek.'],
    ['not logged in', { status: 'not-logged-in', serverState: 'Disconnected' }, 'Not logged in to Soulseek'],
    ['a rejected key', { status: 'unauthorized' }, 'API key rejected'],
    ['a network error', { status: 'unreachable', reason: 'network' }, 'Can&#x27;t reach slskd'],
    ['a timeout', { status: 'unreachable', reason: 'timeout' }, 'slskd didn&#x27;t answer'],
  ])('shows the message for %s', (_label, result, text) => {
    expect(renderWith(testOf(result))).toContain(text);
  });

  it('hides the message once the API key no longer matches the one tested', () => {
    const html = renderWith(testOf({ status: 'unauthorized' }, 'old-key'));
    expect(html).not.toContain('API key rejected');
    expect(alertCount(html)).toBe(1);
  });

  it('still shows the Disconnected badge when the saved test was not logged in', () => {
    const html = renderWith(
      testOf({ status: 'not-logged-in', serverState: 'Disconnected' }),
      { ...savedConfig, connectionStatus: false }
    );
    expect(html).toContain('Disconnected');
    expect(html).not.toContain('>Connected<');
  });
});
