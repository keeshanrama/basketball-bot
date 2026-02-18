import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class GameDatabase {
  constructor() {
    this.db = new Database(join(__dirname, '..', 'basketball.db'));
    this.initTables();
  }

  initTables() {
    // Games table: tracks each basketball session
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_date TEXT NOT NULL,
        game_time TEXT NOT NULL,
        court_name TEXT,
        announcement_msg_id TEXT UNIQUE,
        player_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        booking_confirmed INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Players table: tracks who committed to each game
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id INTEGER NOT NULL,
        player_name TEXT NOT NULL,
        whatsapp_number TEXT,
        committed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (game_id) REFERENCES games(id),
        UNIQUE(game_id, player_name)
      )
    `);

    // Waitlist table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS waitlist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id INTEGER NOT NULL,
        player_name TEXT NOT NULL,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (game_id) REFERENCES games(id),
        UNIQUE(game_id, player_name)
      )
    `);
  }

  // Create or update a game session
  upsertGame(gameData) {
    const { gameDate, gameTime, courtName, announcementMsgId } = gameData;
    
    const stmt = this.db.prepare(`
      INSERT INTO games (game_date, game_time, court_name, announcement_msg_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(announcement_msg_id) DO UPDATE SET
        game_date = excluded.game_date,
        game_time = excluded.game_time,
        court_name = excluded.court_name,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `);
    
    const result = stmt.get(gameDate, gameTime, courtName, announcementMsgId);
    return result.id;
  }

  // Add a player to a game
  addPlayer(gameId, playerName, whatsappNumber = null) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO players (game_id, player_name, whatsapp_number)
        VALUES (?, ?, ?)
        ON CONFLICT(game_id, player_name) DO NOTHING
      `);
      
      stmt.run(gameId, playerName.trim(), whatsappNumber);
      
      // Update player count
      this.updatePlayerCount(gameId);
      
      return true;
    } catch (error) {
      console.error('Error adding player:', error);
      return false;
    }
  }

  // Remove a player from a game
  removePlayer(gameId, playerName) {
    const stmt = this.db.prepare(`
      DELETE FROM players 
      WHERE game_id = ? AND player_name = ?
    `);
    
    stmt.run(gameId, playerName.trim());
    this.updatePlayerCount(gameId);
  }

  // Update the player count for a game
  updatePlayerCount(gameId) {
    const countStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM players WHERE game_id = ?
    `);
    
    const { count } = countStmt.get(gameId);
    
    const updateStmt = this.db.prepare(`
      UPDATE games SET player_count = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    
    updateStmt.run(count, gameId);
    return count;
  }

  // Get current player count for a game
  getPlayerCount(gameId) {
    const stmt = this.db.prepare(`
      SELECT player_count FROM games WHERE id = ?
    `);
    
    const result = stmt.get(gameId);
    return result ? result.player_count : 0;
  }

  // Get game by announcement message ID
  getGameByMsgId(msgId) {
    const stmt = this.db.prepare(`
      SELECT * FROM games WHERE announcement_msg_id = ?
    `);
    
    return stmt.get(msgId);
  }

  // Get all players for a game
  getPlayers(gameId) {
    const stmt = this.db.prepare(`
      SELECT player_name, committed_at FROM players 
      WHERE game_id = ? 
      ORDER BY committed_at ASC
    `);
    
    return stmt.all(gameId);
  }

  // Mark game as confirmed for booking
  confirmBooking(gameId) {
    const stmt = this.db.prepare(`
      UPDATE games 
      SET booking_confirmed = 1, status = 'confirmed', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    
    stmt.run(gameId);
  }

  // Mark game as booked
  markBooked(gameId) {
    const stmt = this.db.prepare(`
      UPDATE games 
      SET status = 'booked', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    
    stmt.run(gameId);
  }

  // Get pending games that hit threshold but not confirmed
  getPendingGames() {
    const stmt = this.db.prepare(`
      SELECT * FROM games 
      WHERE player_count >= ? AND booking_confirmed = 0 AND status = 'pending'
    `);
    
    return stmt.all(parseInt(process.env.PLAYER_THRESHOLD || 10));
  }

  // Add to waitlist
  addToWaitlist(gameId, playerName) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO waitlist (game_id, player_name)
        VALUES (?, ?)
        ON CONFLICT(game_id, player_name) DO NOTHING
      `);
      
      stmt.run(gameId, playerName.trim());
      return true;
    } catch (error) {
      console.error('Error adding to waitlist:', error);
      return false;
    }
  }

  /**
 * Clear old pending games that are in the past
 */
clearOldPendingGames() {
    const stmt = this.db.prepare(`
      DELETE FROM games 
      WHERE status = 'pending' 
      AND booking_confirmed = 0
      AND created_at < datetime('now', '-7 days')
    `);
    const result = stmt.run();
    console.log(`🧹 Cleared ${result.changes} old pending games`);
  }

  close() {
    this.db.close();
  }
}

export default GameDatabase;