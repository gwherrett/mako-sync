import { describe, it, expect } from 'vitest';
import { domExceptionToError, getVideoConstraints } from '@/hooks/useCamera';

// ─── domExceptionToError ──────────────────────────────────────────────────────

function makeDOMException(name: string): DOMException {
  const e = new DOMException('test', name);
  return e;
}

describe('domExceptionToError — error code mapping', () => {
  it('maps NotAllowedError to PERMISSION_DENIED', () => {
    expect(domExceptionToError(makeDOMException('NotAllowedError'))).toEqual({ code: 'PERMISSION_DENIED' });
  });

  it('maps PermissionDeniedError to PERMISSION_DENIED', () => {
    expect(domExceptionToError(makeDOMException('PermissionDeniedError'))).toEqual({ code: 'PERMISSION_DENIED' });
  });

  it('maps NotFoundError to NOT_FOUND', () => {
    expect(domExceptionToError(makeDOMException('NotFoundError'))).toEqual({ code: 'NOT_FOUND' });
  });

  it('maps DevicesNotFoundError to NOT_FOUND', () => {
    expect(domExceptionToError(makeDOMException('DevicesNotFoundError'))).toEqual({ code: 'NOT_FOUND' });
  });

  it('maps NotReadableError to NOT_READABLE', () => {
    expect(domExceptionToError(makeDOMException('NotReadableError'))).toEqual({ code: 'NOT_READABLE' });
  });

  it('maps TrackStartError to NOT_READABLE', () => {
    expect(domExceptionToError(makeDOMException('TrackStartError'))).toEqual({ code: 'NOT_READABLE' });
  });

  it('maps an unrecognised DOMException name to UNKNOWN with message', () => {
    const e = new DOMException('some detail', 'OverconstrainedError');
    const result = domExceptionToError(e);
    expect(result.code).toBe('UNKNOWN');
    if (result.code === 'UNKNOWN') expect(result.message).toBe('some detail');
  });

  it('maps a plain Error to UNKNOWN with message', () => {
    const result = domExceptionToError(new Error('network failure'));
    expect(result.code).toBe('UNKNOWN');
    if (result.code === 'UNKNOWN') expect(result.message).toBe('network failure');
  });

  it('maps a string to UNKNOWN with string as message', () => {
    const result = domExceptionToError('oops');
    expect(result.code).toBe('UNKNOWN');
    if (result.code === 'UNKNOWN') expect(result.message).toBe('oops');
  });
});

// ─── getVideoConstraints ──────────────────────────────────────────────────────

describe('getVideoConstraints — mobile vs desktop', () => {
  it('requests facingMode environment on a mobile user agent', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) Mobile Safari/537.36';
    const constraints = getVideoConstraints(ua);
    expect(constraints.video).toEqual({ facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } });
  });

  it('requests facingMode environment on an Android tablet UA containing "Android"', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 13; SM-T870) AppleWebKit/537.36';
    const constraints = getVideoConstraints(ua);
    expect(constraints.video).toEqual({ facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } });
  });

  it('requests ideal 1920x1080 resolution on a desktop user agent (no Mobi/Android)', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
    const constraints = getVideoConstraints(ua);
    expect(constraints.video).toEqual({ width: { ideal: 1920 }, height: { ideal: 1080 } });
  });

  it('requests ideal 1920x1080 resolution on a Windows desktop UA', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    const constraints = getVideoConstraints(ua);
    expect(constraints.video).toEqual({ width: { ideal: 1920 }, height: { ideal: 1080 } });
  });
});
