import dotenv from 'dotenv';
import WhatsAppListener from './whatsapp.js';
import MessageParser from './parser.js';
import GameDatabase from './database.js';
import CourtReserveBooker from './booking.js';

dotenv.config();

class BasketballBookingBot {
  constructor() {
    this.db = new GameDatabase();
    this.parser = new MessageParser();
    this.whatsapp = new WhatsAppListener(this.handleMessage.bind(this));
    this.booker = null;
    this.PLAYER_THRESHOLD = parseInt(process.env.PLAYER_THRESHOLD || 10);
    this.adminNumbers = (process.env.ADMIN_NUMBERS || '').split(',').filter(n => n);
    this.alertedGames = new Set();
  }

  async start() {
    console.log('🏀 Basketball Booking Bot Starting...\n');
    console.log(`📊 Configuration:`);
    console.log(`   - Player threshold: ${this.PLAYER_THRESHOLD}`);
    console.log(`   - Group ID: ${process.env.WHATSAPP_GROUP_ID || 'Not configured'}`);
    console.log(`   - Admin numbers: ${this.adminNumbers.length > 0 ? this.adminNumbers.join(', ') : 'None configured'}\n`);
    await this.whatsapp.connect();
    this.db.clearOldPendingGames();
  }

  async handleMessage(messageData) {
    const { messageId, text, sender, senderName } = messageData;

    // Check for game announcement
    if (this.parser.isGameAnnouncement(text)) {
      await this.handleGameAnnouncement(messageId, text);
      return;
    }

    // ─────────────────────────────────────────
    // NEW: !check command handler added here
    // ─────────────────────────────────────────
    if (this.parser.isCheckCommand(text)) {
      await this.handleCheckCommand(text);
      return;
    }

    // Check for booking confirmation
    if (this.isBookingConfirmation(text, sender)) {
      await this.handleBookingConfirmation(text, sender);
      return;
    }

    if (this.parser.isCommitment(text)) {
      console.log(`✅ Commitment detected from ${senderName}`);
    }
  }

  async handleGameAnnouncement(messageId, messageText) {
    console.log('\n🚨 Game announcement detected!');

    const parsed = this.parser.parseGameMessage(messageText);
    if (!parsed || !parsed.gameInfo) {
      console.log('⚠️  Could not parse game announcement');
      return;
    }

    const { gameInfo, players, waitlist, playerCount } = parsed;
    console.log(`📅 Game: ${gameInfo.date} ${gameInfo.dayOfWeek || ''} at ${gameInfo.time}`);
    console.log(`🏢 Court: ${gameInfo.courtName || 'Not specified'}`);
    console.log(`👥 Players: ${playerCount}/${this.PLAYER_THRESHOLD}`);

    const gameId = this.db.upsertGame({
      gameDate: gameInfo.date,
      gameTime: gameInfo.time,
      courtName: gameInfo.courtName,
      announcementMsgId: messageId
    });

    for (const playerName of players) {
      this.db.addPlayer(gameId, playerName);
    }
    for (const playerName of waitlist) {
      this.db.addToWaitlist(gameId, playerName);
    }

    const currentCount = this.db.getPlayerCount(gameId);
    console.log(`✅ Updated player count: ${currentCount}/${this.PLAYER_THRESHOLD}`);

    if (currentCount >= this.PLAYER_THRESHOLD && !this.alertedGames.has(gameId)) {
      await this.sendThresholdAlert(gameId, gameInfo, currentCount);
      this.alertedGames.add(gameId);
    }
  }

  async sendThresholdAlert(gameId, gameInfo, playerCount) {
    console.log('\n🎉 THRESHOLD REACHED!');

    const players = this.db.getPlayers(gameId);
    const playerList = players.map((p, i) => `${i + 1}. ${p.player_name}`).join('\n');

    const alertMessage = `🏀 COURT BOOKING READY! 🏀

We have ${playerCount} players committed for:
📅 ${gameInfo.date} ${gameInfo.dayOfWeek || ''} 
🕐 ${gameInfo.time}
🏢 ${gameInfo.courtName || 'Court TBD'}

Current players:
${playerList}

⚠️ READY TO BOOK! Reply with "BOOK IT" to confirm the reservation.`;

    await this.whatsapp.sendMessage(alertMessage);
    console.log('✅ Alert sent to group!');
  }

  isBookingConfirmation(text, sender) {
    const confirmText = text.toLowerCase().trim();
    const isAdmin = this.adminNumbers.length === 0 || this.adminNumbers.includes(sender);
    const confirmationPhrases = ['book it', 'book the court', 'confirm booking', 'yes book', 'go ahead'];
    const isConfirmation = confirmationPhrases.some(phrase => confirmText.includes(phrase));
    return isAdmin && isConfirmation;
  }

  async handleBookingConfirmation(text, sender) {
    console.log('\n✅ Booking confirmation received!');

    const pendingGames = this.db.getPendingGames();
    if (pendingGames.length === 0) {
      await this.whatsapp.sendMessage('⚠️ No games are ready for booking right now.');
      return;
    }

    const game = pendingGames[0];
    await this.whatsapp.sendMessage('🔄 Processing your booking request...');
    this.db.confirmBooking(game.id);

    const success = await this.performBooking(game);
    if (success) {
      this.db.markBooked(game.id);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // NEW: handleCheckCommand() added below handleBookingConfirmation
  // ─────────────────────────────────────────────────────────────

  async handleCheckCommand(messageText) {
    console.log('\n🔍 Check command received!');

    const parsed = this.parser.parseCheckCommand(messageText);

    if (!parsed) {
      await this.whatsapp.sendMessage(
        `⚠️ Invalid check format. Use:\n\n` +
        `!check 2/24 9-11p\n\n` +
        `Example: !check 2/24 9-11p`
      );
      return;
    }

    const { date, time } = parsed;
    await this.whatsapp.sendMessage(`🔍 Checking availability for ${date} at ${time}...`);

    try {
      if (this.booker) {
        try { await this.booker.close(); } catch (e) {}
      }
      this.booker = new CourtReserveBooker();
      await this.booker.initialize();

      const gameDate = this.parser.formatDateForBooking(date);
      const timeRange = this.parser.parseTimeRange(time);

      if (!timeRange) {
        await this.whatsapp.sendMessage(`⚠️ Could not parse time: ${time}\n\nUse format like: 9-11p`);
        return;
      }

      const result = await this.booker.checkAvailability(gameDate, timeRange);

      try { await this.booker.close(); } catch (e) {}
      this.booker = null;

      if (result.status === 'available') {
        await this.whatsapp.sendMessage(
          `✅ COURT AVAILABLE! 🏀\n\n` +
          `📅 ${date}\n` +
          `🕐 ${time}\n\n` +
          `The ${result.timeLabel} slot is open! Reply "BOOK IT" to reserve.`
        );
      } else if (result.status === 'unavailable') {
        await this.whatsapp.sendMessage(
          `❌ COURT UNAVAILABLE 😬\n\n` +
          `📅 ${date}\n` +
          `🕐 ${time}\n\n` +
          `The ${result.timeLabel} slot is already fully booked.`
        );
      } else {
        await this.whatsapp.sendMessage(
          `⚠️ Could not determine availability for ${date} at ${time}.\n\nPlease check manually.`
        );
      }

      if (result.screenshot) {
        await this.whatsapp.sendImage(
          result.screenshot,
          `📅 Court availability for ${date} at ${time}`
        );
      }

    } catch (error) {
      console.error('❌ Check command error:', error);
      if (this.booker) {
        try { await this.booker.close(); } catch (e) {}
        this.booker = null;
      }
      await this.whatsapp.sendMessage(
        `❌ Error checking availability. Please check manually.\n\nError: ${error.message}`
      );
    }
  }

  async performBooking(game) {
    console.log('\n🎯 Starting booking process...');

    try {
      if (this.booker) {
        try { await this.booker.close(); } catch (e) {}
      }
      this.booker = new CourtReserveBooker();
      await this.booker.initialize();

      const gameDate = this.parser.formatDateForBooking(game.game_date);
      const timeRange = this.parser.parseTimeRange(game.game_time);

      if (!timeRange) {
        console.error('❌ Could not parse time range');
        await this.whatsapp.sendMessage('❌ Could not parse game time. Please book manually.');
        return false;
      }

      console.log(`📅 Booking for: ${gameDate.toLocaleDateString()}`);
      console.log(`🕐 Time: ${timeRange.startDisplay} - ${timeRange.endDisplay}`);

      const result = await this.booker.bookCourt(gameDate, timeRange, game.court_name);

      try { await this.booker.close(); } catch (e) {}
      this.booker = null;

      if (result.success) {
        console.log('✅ Booking successful!');
        await this.whatsapp.sendMessage(
          `✅ COURT BOOKED! 🏀\n\n` +
          `📅 ${game.game_date} at ${game.game_time}\n` +
          `🏢 ${game.court_name || 'Court'}\n\n` +
          `See you on the court!`
        );
        if (result.screenshots?.confirmation) {
          await this.whatsapp.sendImage(result.screenshots.confirmation, '📋 Booking confirmation');
        }
        if (result.screenshots?.calendar) {
          await this.whatsapp.sendImage(result.screenshots.calendar, '📅 Court calendar - your slot is booked!');
        }
        return true;

      } else if (result.alreadyBooked) {
        console.log('❌ Slot is already fully booked!');
        await this.whatsapp.sendMessage(
          `⚠️ COURT UNAVAILABLE! 😬\n\n` +
          `The ${game.game_time} slot on ${game.game_date} is already fully booked.\n\n` +
          `❌ Please check for another time or date.`
        );
        if (result.screenshots?.failure) {
          await this.whatsapp.sendImage(result.screenshots.failure, '📅 Court calendar - this slot is full!');
        }
        return false;

      } else {
        console.error('❌ Booking failed:', result.message || result.error);
        await this.whatsapp.sendMessage(
          `❌ Booking failed. Please book manually.\n\n` +
          `📅 ${game.game_date} at ${game.game_time}\n` +
          `🏢 ${game.court_name || 'Court'}\n\n` +
          `Reason: ${result.message || result.error || 'Unknown error'}`
        );
        if (result.screenshots?.failure) {
          await this.whatsapp.sendImage(result.screenshots.failure, '❌ Screenshot at point of failure');
        } else if (result.screenshots?.confirmation) {
          await this.whatsapp.sendImage(result.screenshots.confirmation, '⚠️ Screenshot - please check if booking completed');
        }
        return false;
      }

    } catch (error) {
      console.error('❌ Booking error:', error);
      if (this.booker) {
        try { await this.booker.close(); } catch (e) {}
        this.booker = null;
      }
      await this.whatsapp.sendMessage(
        `❌ Unexpected error during booking. Please book manually.\n\nError: ${error.message}`
      );
      return false;
    }
  }

  async shutdown() {
    console.log('\n👋 Shutting down...');
    if (this.booker) await this.booker.close();
    if (this.whatsapp) await this.whatsapp.disconnect();
    if (this.db) this.db.close();
    process.exit(0);
  }
}

const bot = new BasketballBookingBot();
process.on('SIGINT', () => bot.shutdown());
process.on('SIGTERM', () => bot.shutdown());
bot.start().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});