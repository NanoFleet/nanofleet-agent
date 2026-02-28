import { EventEmitter } from 'node:events';

export interface Notification {
  text: string;
  timestamp: string;
  source: string;
}

class NotificationEmitter extends EventEmitter {
  emit(event: 'notification', notification: Notification): boolean;
  emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  on(event: 'notification', listener: (notification: Notification) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  notify(text: string, source = 'heartbeat'): void {
    const notification: Notification = { text, timestamp: new Date().toISOString(), source };

    if (this.listenerCount('notification') === 0) {
      console.log(`[notification] No channel connected, notification dropped: ${text.substring(0, 80)}...`);
      return;
    }

    this.emit('notification', notification);
  }
}

export const notificationEmitter = new NotificationEmitter();
