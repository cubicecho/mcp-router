import { describe, expect, it } from 'vitest';
import { namespaceNotification } from '../notifications.ts';

describe('namespaceNotification', () => {
  it('namespaces a resources/updated uri when a prefix is given (aggregate endpoint)', () => {
    const notification = { method: 'notifications/resources/updated', params: { uri: 'file:///x' } };
    expect(namespaceNotification(notification, 'alpha')).toEqual({
      method: 'notifications/resources/updated',
      params: { uri: 'alpha__file:///x' },
    });
  });

  it('leaves a resources/updated notification untouched with no prefix (per-server endpoint)', () => {
    const notification = { method: 'notifications/resources/updated', params: { uri: 'file:///x' } };
    expect(namespaceNotification(notification)).toBe(notification);
  });

  it('passes list_changed notifications through unchanged (nothing to namespace)', () => {
    const notification = { method: 'notifications/tools/list_changed' };
    expect(namespaceNotification(notification, 'alpha')).toBe(notification);
  });

  it('passes log messages through unchanged', () => {
    const notification = { method: 'notifications/message', params: { level: 'info', data: 'hi' } };
    expect(namespaceNotification(notification, 'alpha')).toBe(notification);
  });
});
