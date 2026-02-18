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
  
  console.log('🔍 WhatsApp Group ID Finder\n');
  console.log('This tool will connect to WhatsApp and list all your groups.\n');
  
  async function findGroups() {
    const { state, saveCreds } = await useMultiFileAuthState(join(__dirname, '..', 'auth_info'));
    const { version } = await fetchLatestBaileysVersion();
  
    const sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      auth: state,
    });
  
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
  
      if (qr) {
        console.log('📱 Scan this QR code with WhatsApp:\n');
        qrcode.generate(qr, { small: true });
        console.log('\n👆 Open WhatsApp > Settings > Linked Devices > Link a Device\n');
      }
  
      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error instanceof Boom)
          ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
          : true;
  
        if (!shouldReconnect) {
          console.log('❌ Logged out. Please run again.');
          process.exit(1);
        }
      } else if (connection === 'open') {
        console.log('✅ Connected to WhatsApp!\n');
        console.log('🔍 Fetching your groups...\n');
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        try {
          const groups = await sock.groupFetchAllParticipating();
          const groupList = Object.values(groups);
          
          if (groupList.length === 0) {
            console.log('⚠️  No groups found. Make sure you\'re in some WhatsApp groups.');
          } else {
            console.log(`📋 Found ${groupList.length} groups:\n`);
            console.log('━'.repeat(80));
            
            groupList.forEach((group, index) => {
              console.log(`\n${index + 1}. ${group.subject}`);
              console.log(`   👥 ${group.participants.length} members`);
              console.log(`   🆔 ID: ${group.id}`);
              console.log(`   ${'-'.repeat(70)}`);
            });
            
            console.log('\n━'.repeat(80));
            console.log('\n✅ Copy the ID of your basketball group and paste it in your .env file:');
            console.log('   WHATSAPP_GROUP_ID=your-group-id-here\n');
          }
        } catch (error) {
          console.error('❌ Error fetching groups:', error.message);
        }
        
        console.log('\n👋 Disconnecting...\n');
        // Don't logout - just exit so session is preserved
        process.exit(0);
      }
    });
  
    sock.ev.on('creds.update', saveCreds);
  }
  
  findGroups().catch(error => {
    console.error('❌ Error:', error.message);
    process.exit(1);
  });