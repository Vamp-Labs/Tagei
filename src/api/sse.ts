export interface SseMessage {
  event: string;
  data: string;
  id: string | null;
  lastEventId: string;
}

export interface SseParserHandlers {
  onMessage(message: SseMessage): void;
  onComment?(text: string): void;
  onRetry?(delayMs: number): void;
}

export interface SseParser {
  push(chunk: string): void;
  end(): void;
}

const BYTE_ORDER_MARK = 0xfeff;

export function createSseParser(handlers: SseParserHandlers): SseParser {
  let buffer = '';
  let started = false;
  let dataLines: string[] = [];
  let eventName = '';
  let messageId: string | null = null;
  let lastEventId = '';

  const dispatch = () => {
    if (dataLines.length === 0) {
      eventName = '';
      messageId = null;
      return;
    }
    const message: SseMessage = {
      event: eventName || 'message',
      data: dataLines.join('\n'),
      id: messageId ? messageId : null,
      lastEventId,
    };
    dataLines = [];
    eventName = '';
    messageId = null;
    handlers.onMessage(message);
  };

  const processLine = (line: string) => {
    if (line === '') {
      dispatch();
      return;
    }
    if (line.startsWith(':')) {
      handlers.onComment?.(line.slice(1).trimStart());
      return;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    switch (field) {
      case 'event':
        eventName = value;
        break;
      case 'data':
        dataLines.push(value);
        break;
      case 'id':
        if (!value.includes('\u0000')) {
          lastEventId = value;
          messageId = value;
        }
        break;
      case 'retry':
        if (/^\d+$/.test(value)) handlers.onRetry?.(Number(value));
        break;
      default:
        break;
    }
  };

  const drain = (final: boolean) => {
    let lineStart = 0;
    for (let index = 0; index < buffer.length; index++) {
      const char = buffer[index];
      if (char !== '\n' && char !== '\r') continue;
      if (char === '\r' && index === buffer.length - 1 && !final) break;
      processLine(buffer.slice(lineStart, index));
      if (char === '\r' && buffer[index + 1] === '\n') index++;
      lineStart = index + 1;
    }
    buffer = buffer.slice(lineStart);
  };

  return {
    push(chunk: string) {
      let text = chunk;
      if (!started && text.length > 0) {
        started = true;
        if (text.charCodeAt(0) === BYTE_ORDER_MARK) text = text.slice(1);
      }
      buffer += text;
      drain(false);
    },
    end() {
      drain(true);
      buffer = '';
      dataLines = [];
      eventName = '';
      messageId = null;
    },
  };
}
