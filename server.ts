import 'dotenv/config';
console.log('>>> [Global] Server code starting execution...');
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState, 
  fetchLatestBaileysVersion,
  delay,
} from '@whiskeysockets/baileys';
// @ts-ignore
import { useInMemoryStore } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import fs from 'fs';
import admin from 'firebase-admin';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import QRCode from 'qrcode';

// ES Module fix for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin safely
let firebaseApp: admin.app.App | null = null;
let db: admin.firestore.Firestore | null = null;

try {
  const serviceAccountPath = path.join(process.cwd(), 'service-account.json');
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');

  if (fs.existsSync(serviceAccountPath)) {
    // CONFIGURATION POUR VS CODE (Local)
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    firebaseApp = admin.apps.length ? admin.apps[0] : admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    db = getFirestore(firebaseApp);
    console.log(`Firebase Admin initialized with service-account.json (Project: ${serviceAccount.project_id})`);
  } else if (fs.existsSync(configPath)) {
    // CONFIGURATION POUR AI STUDIO
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.projectId) {
      firebaseApp = admin.apps.length ? admin.apps[0] : admin.initializeApp({
        projectId: config.projectId
      });
      const dbId = config.firestoreDatabaseId || '(default)';
      db = dbId && dbId !== '(default)' ? getFirestore(firebaseApp, dbId) : getFirestore(firebaseApp);
      console.log(`Firebase Admin initialized with applet-config. Project: ${config.projectId}`);
    }
  }

  // Test connection if db was initialized
  if (db) {
    db.collection('health_check').doc('ping').set({
      timestamp: FieldValue.serverTimestamp(),
      message: 'Server online',
      env: process.env.NODE_ENV || 'development'
    }).then(() => {
      console.log('>>> Firebase connection test successful');
    }).catch((err: any) => {
      console.error('>>> Firebase connection test FAILED:', err.message);
    });
  }
} catch (error) {
  console.error('Firebase Admin initialization error:', error);
}

// Clean JID to be used as Firestore document ID
const cleanJid = (jid: string) => {
  const clean = jid.replace(/[^a-zA-Z0-9_\-]/g, '_');
  // Ensure it's not too long and doesn't start with __
  return clean.substring(0, 120);
};

async function startServer() {
  console.log('[Server] Starting startServer()...');
  const app = express();
  const httpServer = createServer(app);
  
  // Initialize Socket.io after server start to avoid blocking
  const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] }
  });

  const PORT = 3000;

  let sock: any = null;
  let qrCodeData: string | null = null;
  let connectionStatus: string = 'close';

  // API Routes
  app.get('/api/status', (req, res) => {
    res.json({ 
       status: connectionStatus, 
       hasQr: !!qrCodeData,
       qr: qrCodeData, // Return the actual QR code for immediate recovery
       firebase: !!db
    });
  });

  // Socket connection handling
  io.on('connection', (socket) => {
    console.log(`New client connected: ${socket.id}`);
    // Send current state immediately on connection
    socket.emit('whatsapp:status', connectionStatus === 'open' ? 'connected' : 'disconnected');
    if (qrCodeData) {
      socket.emit('whatsapp:qr', qrCodeData);
    }
  });

  // Middleware
  app.use(express.json());

  // Basic health check
  app.get('/health', (req, res) => res.send('OK'));

  const connectToWhatsApp = async (retryCount = 0) => {
    console.log(`[WhatsApp] 🚀 Initializing FAST connection... (Attempt ${retryCount + 1})`);
    const startTime = Date.now();
    try {
      const authPath = path.join(process.cwd(), 'baileys_auth_info');
      console.log(`[WhatsApp] 📁 Using auth path: ${authPath}`);
      console.log(`[WhatsApp] 📁 CWD: ${process.cwd()}`);
      console.log(`[WhatsApp] 📁 Dir contents: ${fs.readdirSync('.').join(', ')}`);
      
      if (!fs.existsSync(authPath)) {
        fs.mkdirSync(authPath, { recursive: true });
        console.log('[WhatsApp] 📁 Created auth directory');
      }
      
      console.log('[WhatsApp] 🔐 Loading auth state...');
      const { state, saveCreds } = await useMultiFileAuthState(authPath);
      
      console.log('[WhatsApp] 🌐 Fetching version...');
      // Improved version detection with faster fallback and timeout
      let version: [number, number, number];
      try {
        console.log('[WhatsApp] 🌐 Fetching latest version...');
        const latest = await Promise.race([
          fetchLatestBaileysVersion(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Version fetch timeout')), 4000))
        ]) as any;
        version = latest.version;
        console.log(`[WhatsApp] Latest version fetched: v${version.join('.')}`);
      } catch (err) {
        console.log('[WhatsApp] Version fetch failed or timed out, using fallback');
        version = [2, 3000, 1015901307]; // Robust fallback
      }
      
      sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }), // Set back to silent for speed
        browser: ['Mac OS', 'Chrome', '121.0.6167.160'], // More standard browser
        connectTimeoutMs: 20000,
        keepAliveIntervalMs: 20000,
        generateHighQualityLinkPreview: false,
        receivedPendingNotifications: false, // Prevents slow initial load
        markOnlineOnConnect: false,
        retryRequestDelayMs: 3000,
      });

      console.log(`[WhatsApp] Socket created in ${Date.now() - startTime}ms`);

      sock.ev.on('connection.update', async (update: any) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
          qrCodeData = await QRCode.toDataURL(qr);
          io.emit('whatsapp:qr', qrCodeData);
        }

        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const errorMessage = lastDisconnect?.error?.message || '';
          console.log(`[WhatsApp] Connection closed. Status: ${statusCode}, Error: ${errorMessage}`);
          
          connectionStatus = 'close';
          qrCodeData = null;
          
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          
          if (shouldReconnect) {
            // Handle specific errors that require clearing session
            const isCritical = statusCode === 401 || 
                             statusCode === 403 || 
                             statusCode === 405 || // Method Not Allowed / Conflict
                             errorMessage.includes('Unsupported state') ||
                             errorMessage.includes('authenticate data');
            
            const reconnectDelay = isCritical ? 10000 : 5000;
            console.log(`[WhatsApp] Reconnecting in ${reconnectDelay}ms... (Critical: ${isCritical})`);

            if (isCritical) {
              console.log('[WhatsApp] Resetting session for next attempt.');
              if (fs.existsSync(authPath)) {
                try { fs.rmSync(authPath, { recursive: true, force: true }); } catch (e) {}
              }
              setTimeout(() => connectToWhatsApp(0), reconnectDelay);
            } else {
              setTimeout(() => connectToWhatsApp(retryCount + 1), reconnectDelay);
            }
          }
          io.emit('whatsapp:status', 'disconnected');
        } else if (connection === 'open') {
          connectionStatus = 'open';
          qrCodeData = null;
          console.log('WhatsApp connection opened successfully!');
          io.emit('whatsapp:status', 'connected');
        }
      });

      sock.ev.on('creds.update', saveCreds);
    } catch (err: any) {
      console.error('WhatsApp connection strategy failure:', err.message);
      if (err.message.includes('Unsupported state') || err.message.includes('authenticate data')) {
         const authPath = path.join(process.cwd(), 'baileys_auth_info');
         if (fs.existsSync(authPath)) {
           fs.rmSync(authPath, { recursive: true, force: true });
         }
         setTimeout(() => connectToWhatsApp(0), 2000);
      }
    }
  };

  app.post('/api/logout', (req, res) => {
    const authPath = path.join(process.cwd(), 'baileys_auth_info');
    if (fs.existsSync(authPath)) {
      fs.rmSync(authPath, { recursive: true, force: true });
    }
    if (sock) {
      try { sock.logout(); } catch (e) {}
      sock = null;
    }
    qrCodeData = null;
    connectionStatus = 'close';
    connectToWhatsApp();
    res.json({ message: 'Logged out and session cleared' });
  });

  app.get('/api/records', async (req, res) => {
    if (!db) {
      return res.status(200).json([]); // Return empty if DB not connected
    }
    try {
      const snapshot = await db.collection('contacts').orderBy('lastBroadcastAt', 'desc').limit(20).get();
      const records = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      res.json(records);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to fetch records' });
    }
  });

  app.get('/api/groups', async (req, res) => {
    if (!sock || connectionStatus !== 'open') {
      return res.status(400).json({ error: 'WhatsApp not connected' });
    }
    try {
      // Baileys group fetching
      const groups = await sock.groupFetchAllParticipating();
      const groupList = Object.values(groups).map((g: any) => ({
        id: g.id,
        subject: g.subject,
        participantsCount: g.participants.length
      }));
      res.json(groupList);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch groups' });
    }
  });

  app.post('/api/broadcast', async (req, res) => {
    const { groupIds, message } = req.body;
    if (!sock || connectionStatus !== 'open') {
      return res.status(400).json({ error: 'WhatsApp not connected' });
    }
    if (!groupIds || !Array.isArray(groupIds) || !message) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    res.json({ message: 'Broadcast started' });

    // Background processing
    (async () => {
      try {
        const allContacts = new Set<string>();
        const groups = await sock.groupFetchAllParticipating();
        
        for (const id of groupIds) {
          const group = groups[id];
          if (group) {
            group.participants.forEach((p: any) => {
              if (p.id !== sock.user.id) { // Don't message self
                allContacts.add(p.id);
              }
            });
          }
        }

        const contactsList = Array.from(allContacts);
        const total = contactsList.length;
        let successCount = 0;
        let failCount = 0;

        console.log(`[Broadcast] Starting for ${total} unique contacts`);
        io.emit('broadcast:progress', { current: 0, total, successCount: 0, failCount: 0 });

        for (let i = 0; i < contactsList.length; i++) {
          const jid = contactsList[i];
          console.log(`[Broadcast] [${i + 1}/${total}] Sending to ${jid}...`);
          try {
            await sock.sendMessage(jid, { text: message });
            successCount++;
            console.log(`[Broadcast] [${i + 1}/${total}] Success for ${jid}. Progress: S=${successCount} F=${failCount}`);
            
            // Save to DB...
            if (db) {
              try {
                const docId = cleanJid(jid);
                await db.collection('contacts').doc(docId).set({
                  jid,
                  phoneNumber: jid.split('@')[0],
                  lastBroadcastAt: FieldValue.serverTimestamp(),
                  source: 'broadcast',
                  description: 'Contact enregistré suite à la diffusion du message'
                }, { merge: true });
              } catch (dbErr: any) {
                console.error(`[Broadcast] Firestore save failed for ${jid}:`, dbErr.message);
              }
            }
          } catch (err: any) {
            failCount++;
            console.error(`[Broadcast] [${i + 1}/${total}] Send FAILED for ${jid}:`, err.message);
            console.log(`[Broadcast] [${i + 1}/${total}] Progress: S=${successCount} F=${failCount}`);
          }

          io.emit('broadcast:progress', { 
            current: i + 1, 
            total, 
            successCount, 
            failCount 
          });

          // delay... 5-10s
          const waitTime = Math.floor(Math.random() * 5000) + 5000;
          await delay(waitTime);
        }

        console.log(`[Broadcast] COMPLETED. Success: ${successCount}, Fail: ${failCount}, Total: ${total}`);
        // Notify admin in DB
        if (db) {
          try {
            await db.collection('notifications').add({
              type: 'broadcast_complete',
              timestamp: FieldValue.serverTimestamp(),
              summary: `Diffusion terminée. Succès: ${successCount}, Échecs: ${failCount}`,
              status: failCount === 0 ? 'success' : 'partial_failure'
            });
          } catch (dbErr: any) {
            console.error('[Broadcast] Final notification save failed:', dbErr.message);
          }
        }
        
        io.emit('broadcast:complete', { successCount, failCount });
      } catch (err: any) {
        console.error('[Broadcast] Global error:', err.message);
        io.emit('broadcast:error', { error: 'Une erreur inattendue est survenue lors de la diffusion' });
      }
    })();
  });

  // Initialize WhatsApp connection independently
  console.log('[Server] Initializing WhatsApp connection...');
  connectToWhatsApp().catch(err => {
    console.error('[Server] Critical failure in WhatsApp connection:', err);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    console.log('Starting Vite in middleware mode...');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('Vite middleware mounted.');
  } else {
    console.log('Running in production mode.');
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log('=========================================');
    console.log(`[Server] Listening on http://0.0.0.0:${PORT}`);
    console.log('[Server] Environment:', process.env.NODE_ENV || 'development');
    console.log('=========================================');
  });
}

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

startServer().catch(err => {
  console.error('Failed to start server:', err);
});
