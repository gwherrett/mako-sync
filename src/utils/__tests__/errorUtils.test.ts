import { describe, it, expect } from 'vitest';
import { errorFields, getErrorMessage } from '../errorUtils';

describe('errorFields', () => {
  it('reads the fields of an Error', () => {
    const error = Object.assign(new TypeError('bad input'), { code: 'E_BAD', status: 400 });

    expect(errorFields(error)).toMatchObject({
      message: 'bad input',
      name: 'TypeError',
      code: 'E_BAD',
      status: 400,
    });
    expect(errorFields(error).stack).toContain('bad input');
  });

  it('reads the fields of a plain error-like object', () => {
    expect(errorFields({ message: 'duplicate key', code: '23505' })).toEqual({
      message: 'duplicate key',
      name: undefined,
      code: '23505',
      status: undefined,
      stack: undefined,
    });
  });

  it('keeps a numeric code', () => {
    expect(errorFields({ code: 401 }).code).toBe(401);
  });

  it('drops fields of the wrong type', () => {
    expect(errorFields({ message: 42, name: {}, code: true, status: '500' })).toEqual({
      message: undefined,
      name: undefined,
      code: undefined,
      status: undefined,
      stack: undefined,
    });
  });

  it('returns no fields for values that are not objects', () => {
    expect(errorFields('boom')).toEqual({});
    expect(errorFields(null)).toEqual({});
    expect(errorFields(undefined)).toEqual({});
    expect(errorFields(404)).toEqual({});
  });
});

describe('getErrorMessage', () => {
  it('returns the message of an Error', () => {
    expect(getErrorMessage(new Error('Network down'))).toBe('Network down');
  });

  it('returns the message of an error-like object', () => {
    expect(getErrorMessage({ message: 'JWT expired', code: 'PGRST301' })).toBe('JWT expired');
  });

  it('turns other thrown values into a string', () => {
    expect(getErrorMessage('timeout')).toBe('timeout');
    expect(getErrorMessage(undefined)).toBe('undefined');
    expect(getErrorMessage({ reason: 'no message' })).toBe('[object Object]');
  });
});
