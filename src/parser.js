import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class MessageParser {
  constructor() {
    this.gameAnnouncementPattern = /🚨\s*(\d{1,2}\/\d{1,2})\s+(\w+)\s+(\d{1,2}(?::\d{2})?\s*-\s*\d{1,2}(?::\d{2})?\s*[ap]m?)\s*\[([^\]]+)\]/i;
  }

  isGameAnnouncement(messageText) {
    return messageText.startsWith('🚨') || messageText.includes('🚨');
  }

  parseGameAnnouncement(messageText) {
    const match = messageText.match(this.gameAnnouncementPattern);
    
    if (!match) {
      const lines = messageText.split('\n');
      const firstLine = lines[0];
      const dateMatch = firstLine.match(/(\d{1,2}\/\d{1,2})/);
      const timeMatch = firstLine.match(/(\d{1,2}(?::\d{2})?\s*-\s*\d{1,2}(?::\d{2})?\s*[ap]m?)/i);
      const courtMatch = firstLine.match(/\[([^\]]+)\]/);
      
      if (dateMatch && timeMatch) {
        return {
          date: dateMatch[1],
          dayOfWeek: null,
          time: timeMatch[1],
          courtName: courtMatch ? courtMatch[1].trim() : null
        };
      }
      return null;
    }

    return {
      date: match[1],
      dayOfWeek: match[2],
      time: match[3],
      courtName: match[4].trim()
    };
  }

  parseGameMessage(messageText) {
    const gameInfo = this.parseGameAnnouncement(messageText);
    
    if (!gameInfo) return null;

    const lines = messageText.split('\n').map(line => line.trim()).filter(line => line);
    let playerLines = [];
    let waitlistLines = [];
    let isWaitlistSection = false;
    let countLine = null;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      if (/^\d+\/\d+$/.test(line)) { countLine = line; continue; }
      if (line.toLowerCase().includes('waitlist')) { isWaitlistSection = true; continue; }
      if (line.startsWith('🚨') || line.startsWith('[') || line.match(/^\d{1,2}\/\d{1,2}/)) continue;
      
      if (isWaitlistSection) {
        waitlistLines.push(line);
      } else {
        if (line.length > 0 && !line.match(/^\d+$/)) {
          playerLines.push(line);
        }
      }
    }

    return {
      gameInfo,
      players: playerLines,
      waitlist: waitlistLines,
      playerCount: playerLines.length,
      countLine
    };
  }

  isCommitment(messageText) {
    const text = messageText.toLowerCase().trim();
    const commitmentPatterns = [
      /\bi'?m in\b/i, /\bcount me in\b/i, /\bi'?ll be there\b/i,
      /\bdown\b/i, /^\+1$/, /^yes$/i, /^yup$/i, /^yeah$/i,
      /👍/, /🏀/, /✋,/
    ];
    return commitmentPatterns.some(pattern => pattern.test(text));
  }

  isCancellation(messageText) {
    const text = messageText.toLowerCase().trim();
    const cancellationPatterns = [
      /\bi'?m out\b/i, /\bcan'?t make it\b/i, /\bcan'?t come\b/i,
      /\bsorry/i, /\bnot coming\b/i, /^-1$/, /^no$/i, /^nope$/i
    ];
    return cancellationPatterns.some(pattern => pattern.test(text));
  }

  formatDateForBooking(dateString) {
    const [month, day] = dateString.split('/').map(n => parseInt(n));
    const currentYear = new Date().getFullYear();
    const now = new Date();
    const gameDate = new Date(currentYear, month - 1, day);
    if (gameDate < now) gameDate.setFullYear(currentYear + 1);
    return gameDate;
  }

  /**
   * Parse a time range string like "9-11p", "9:00-11:00pm", "12-2p", "11a-1p"
   * into 24-hour start/end times.
   *
   * FIXED: The old version had bugs with:
   *  - "12-2p" → start was set to 24 instead of 12
   *  - "9-11p" where start=9 → old code always added 12, correct
   *  - "11-1p" cross-noon → start should be 11 AM if start > end in 12h,
   *    but with a single trailing "p" this is ambiguous. We assume both
   *    hours share the AM/PM indicator UNLESS start > end in which case
   *    start is the opposite period.
   */
  parseTimeRange(timeString) {
    const match = timeString.match(
      /(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*([ap])m?/i
    );
    if (!match) return null;

    const startHour = parseInt(match[1]);
    const startMin = match[2] || '00';
    const endHour = parseInt(match[3]);
    const endMin = match[4] || '00';
    const period = match[5].toLowerCase(); // 'a' or 'p'

    // Convert to 24h: the trailing period (a/p) applies to the END hour.
    // The START hour gets the same period UNLESS that would make start > end,
    // in which case start gets the opposite period (e.g. "11-1p" = 11AM-1PM).
    let endHour24 = this._to24h(endHour, period);
    let startHour24 = this._to24h(startHour, period);

    // If start would be after end (e.g. "11-1p" → 23:00 > 13:00),
    // the start hour must be in the opposite period
    if (startHour24 >= endHour24) {
      const oppositePeriod = period === 'p' ? 'a' : 'p';
      startHour24 = this._to24h(startHour, oppositePeriod);
    }

    return {
      startTime: `${startHour24.toString().padStart(2, '0')}:${startMin}`,
      endTime: `${endHour24.toString().padStart(2, '0')}:${endMin}`,
      startDisplay: `${this._to12hLabel(startHour24, startMin)}`,
      endDisplay: `${this._to12hLabel(endHour24, endMin)}`,
    };
  }

  /**
   * Convert a 12-hour value + period to 24-hour.
   * Handles the tricky 12 o'clock cases:
   *   12a → 0,  12p → 12,  1p → 13,  11a → 11,  11p → 23
   */
  _to24h(hour12, period) {
    if (period === 'a') {
      return hour12 === 12 ? 0 : hour12;
    } else {
      return hour12 === 12 ? 12 : hour12 + 12;
    }
  }

  /**
   * Convert 24h hour + minutes to a display label like "9:00 PM"
   */
  _to12hLabel(hour24, min) {
    const amPm = hour24 >= 12 ? 'PM' : 'AM';
    const hour12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;
    return `${hour12}:${min} ${amPm}`;
  }

  // ─────────────────────────────────────────
  // !check command methods
  // ─────────────────────────────────────────

  isCheckCommand(messageText) {
    return messageText.trim().toLowerCase().startsWith('!check');
  }

  parseCheckCommand(messageText) {
    const text = messageText.trim();
    const match = text.match(
      /^!check\s+(\d{1,2}\/\d{1,2})\s+(\d{1,2}(?::\d{2})?\s*-\s*\d{1,2}(?::\d{2})?\s*[ap]m?)/i
    );
    if (!match) return null;
    return {
      date: match[1],
      time: match[2]
    };
  }
}

export default MessageParser;