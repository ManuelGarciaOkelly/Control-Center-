import { EventEmitter } from 'events';

export const DEFAULT_RECONNECT_INTERVAL_MS = 1000; // 1 second
const MAX_RECONNECT_INTERVAL_MS = 30 * 1000; // 30 seconds

export class SSEClient extends EventEmitter {
  constructor({ url, team, agent }) {
    super();
    this.url = url;
    this.team = team;
    this.agent = agent;
    this.controller = null;
    this.reconnectTimeout = null;
    this.currentReconnectInterval = DEFAULT_RECONNECT_INTERVAL_MS;
    this.isConnected = false;
    this.textDecoder = new TextDecoder('utf-8', { stream: true }); // Single TextDecoder instance
  }

  async connect() {
    // If already connected, close the existing connection before attempting a new one.
    if (this.isConnected) {
      this.close();
    }

    this.controller = new AbortController();
    const { signal } = this.controller;

    try {
      const fetchUrl = `${this.url}/api/events?team=${this.team}&agent=${this.agent}`;
      const response = await fetch(fetchUrl, { signal });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      this.isConnected = true;
      this.emit('open');
      // Reset reconnect interval on successful connection.
      this.currentReconnectInterval = DEFAULT_RECONNECT_INTERVAL_MS;

      const reader = response.body.getReader();
      let buffer = '';

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // Connection closed by server.
          break;
        }

        buffer += this.textDecoder.decode(value, { stream: true }); // Use single TextDecoder
        // SSE messages are terminated by double newlines.
        const messages = buffer.split("\n\n");

        // Process all but the last potential incomplete message.
        for (let i = 0; i < messages.length - 1; i++) {
          const message = messages[i];
          if (message.trim() === '') continue;

          let eventName = 'message'; // Default event name
          let data = '';

          const lines = message.split("\n");
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventName = line.substring('event: '.length).trim();
            } else if (line.startsWith('data: ')) {
              // Concatenate data lines, trimming leading/trailing whitespace.
              data += line.substring('data: '.length).trim();
            }
          }

          if (data) {
            try {
              const parsedData = JSON.parse(data);
              this.emit(eventName, parsedData);
              this.emit('*', eventName, parsedData); // Emit for wildcard handler
            } catch (e) {
              console.error('Failed to parse SSE data as JSON:', data, e);
            }
          }
        }
        // Keep the last part of the buffer which might be an incomplete message.
        buffer = messages[messages.length - 1];
      }
    } catch (error) {
      // Check if the error is due to abortion (intentional close).
      if (signal.aborted) {
        console.log('SSE connection aborted.');
      } else {
        console.error('SSE connection error:', error);
        this.reconnect();
      }
    } finally {
      // This finally block will only run if connect() was called.
      // The 'close' event needs to be reliably emitted even if connect() never ran.
      if (this.isConnected) { // Only emit close if it was actually connected
        this.isConnected = false;
        this.emit('close');
      }
    }
  }

  reconnect() {
    // Clear any existing reconnect timeout to prevent multiple reconnect attempts.
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectTimeout = setTimeout(() => {
      console.log(`Attempting to reconnect in ${this.currentReconnectInterval / 1000}s...`);
      // Exponentially increase the reconnect interval, capped at MAX_RECONNECT_INTERVAL_MS.
      this.currentReconnectInterval = Math.min(
        this.currentReconnectInterval * 2,
        MAX_RECONNECT_INTERVAL_MS
      );
      this.connect(); // Attempt to connect again.
    }, this.currentReconnectInterval);
  }

  // Wrapper for EventEmitter's on method.
  on(eventName, handler) {
    super.on(eventName, handler);
  }

  close() {
    // Always emit 'close' when the client is told to close.
    // This ensures 'close' is emitted reliably, even if connect() never ran.
    if (this.isConnected) { // Only set isConnected to false if it was true
      this.isConnected = false;
    }
    this.emit('close'); // Emit the close event unconditionally

    // Abort the fetch request if a controller exists.
    if (this.controller) {
      this.controller.abort();
      this.controller = null;
    }
    // Clear any pending reconnect timeout.
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    // Reset TextDecoder to clear any buffered data
    if (this.textDecoder) {
      this.textDecoder.decode(new Uint8Array(), { stream: false });
    }
  }
}
