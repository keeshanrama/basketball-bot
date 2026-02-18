import makeWASocket, { 
    DisconnectReason, 
    useMultiFileAuthState,
    fetchLatestBaileysVersion 
  } from '@whiskeysockets/baileys';
  import { Boom } from '@hapi/boom';
  import pino from 'pino';
  import qrcode from 'qrcode-terminal';
  import { fileURLToPath } from 'url';
  import { dirname, join } from 'path';
  
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  
  class WhatsAppListener {
    constructor(onMessage) {
      this.sock = null;
      this.onMessage = onMessage;
      this.groupId = process.env.WHATSAPP_GROUP_ID;
      this.logger = pino({ level: 'info' });
    }
  
    /**
     * Initialize WhatsApp connection
     */
    async connect() {
      const { state, saveCreds } = await useMultiFileAuthState(join(__dirname, '..', 'auth_info'));
      const { version } = await fetchLatestBaileysVersion();
  
      this.sock = makeWASocket({
        version,
        logger: this.logger,
        printQRInTerminal: false,
        auth: state,
        getMessage: async () => undefined
      });
  
      // Handle QR code for login
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
  
        if (qr) {
          console.log('\n🔐 Scan this QR code with WhatsApp to login:\n');
          qrcode.generate(qr, { small: true });
          console.log('\nOpen WhatsApp > Linked Devices > Link a Device\n');
        }
  
        if (connection === 'close') {
          const shouldReconnect = (lastDisconnect?.error instanceof Boom)
            ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
            : true;
  
          console.log('❌ Connection closed. Reconnecting:', shouldReconnect);
  
          if (shouldReconnect) {
            await this.connect();
          }
        } else if (connection === 'open') {
          console.log('✅ WhatsApp connected successfully!');
          console.log(`👀 Monitoring group: ${this.groupId}\n`);
        }
      });
  
      // Save credentials on update
      this.sock.ev.on('creds.update', saveCreds);
  
      // Handle incoming messages
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
  
        for (const msg of messages) {
          await this.handleMessage(msg);
        }
      });
    }
  
    /**
     * Handle incoming WhatsApp message
     */
    async handleMessage(msg) {
      try {
        // Ignore messages from self
        if (msg.key.fromMe) return;
  
        // Only process messages from the configured group
        const isFromGroup = msg.key.remoteJid === this.groupId;
        if (!isFromGroup && this.groupId) return;
  
        // Extract message text
        const messageText = msg.message?.conversation || 
                           msg.message?.extendedTextMessage?.text || 
                           '';
  
        if (!messageText) return;
  
        // Extract sender info
        const sender = msg.key.participant || msg.key.remoteJid;
        const senderNumber = sender.split('@')[0];
        const messageId = msg.key.id;
  
        // Get sender's name from contact or use phone number
        let senderName = senderNumber;
        try {
          const pushName = msg.pushName || senderName;
          senderName = pushName;
        } catch (e) {
          // Use number if name not available
        }
  
        console.log(`\n📩 Message from ${senderName}: ${messageText.substring(0, 50)}...`);
  
        // Call the message handler
        if (this.onMessage) {
          await this.onMessage({
            messageId,
            text: messageText,
            sender: senderNumber,
            senderName,
            groupId: msg.key.remoteJid,
            timestamp: msg.messageTimestamp
          });
        }
  
      } catch (error) {
        console.error('Error handling message:', error);
      }
    }
  
    /**
     * Send a message to the group
     */
    async sendMessage(text) {
      if (!this.sock || !this.groupId) {
        console.error('Cannot send message: Not connected or no group ID');
        return;
      }
  
      try {
        await this.sock.sendMessage(this.groupId, { text });
        console.log(`✅ Sent message to group: ${text.substring(0, 50)}...`);
      } catch (error) {
        console.error('Error sending message:', error);
      }
    }
  
    /**
     * Reply to a specific message
     */
    async replyToMessage(messageId, text) {
      if (!this.sock || !this.groupId) {
        console.error('Cannot send reply: Not connected or no group ID');
        return;
      }
  
      try {
        await this.sock.sendMessage(this.groupId, { 
          text 
        }, {
          quoted: { key: { id: messageId, remoteJid: this.groupId } }
        });
        console.log(`✅ Sent reply: ${text.substring(0, 50)}...`);
      } catch (error) {
        console.error('Error sending reply:', error);
      }
    }
  
    /**
     * Get group metadata
     */
    async getGroupInfo() {
      if (!this.sock || !this.groupId) return null;
  
      try {
        const metadata = await this.sock.groupMetadata(this.groupId);
        return metadata;
      } catch (error) {
        console.error('Error getting group info:', error);
        return null;
      }
    }
  
    /**
     * Disconnect from WhatsApp
     */
    async disconnect() {
      if (this.sock) {
        await this.sock.logout();
        console.log('👋 Disconnected from WhatsApp');
      }
    }
    
    async sendImage(imagePath, caption = '') {
        if (!this.sock || !this.groupId) {
          console.error('Cannot send image: Not connected or no group ID');
          return;
        }
      
        try {
          const fs = await import('fs');
          const imageBuffer = fs.readFileSync(imagePath);
          
          await this.sock.sendMessage(this.groupId, {
            image: imageBuffer,
            caption: caption
          });
          console.log(`✅ Sent image to group: ${imagePath}`);
        } catch (error) {
          console.error('Error sending image:', error);
        }
      }
  }
  
  export default WhatsAppListener;