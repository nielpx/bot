require('dotenv').config();
const { makeWASocket, useMultiFileAuthState, DisconnectReason, proto } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const qrcode = require("qrcode-terminal");
const { createCanvas, registerFont, loadImage } = require("canvas");
const fs = require("fs");
const sharp = require("sharp");
const twemoji = require("twemoji");

// Gunakan fetch bawaan Node.js v18+, atau node-fetch jika tersedia
let fetchFn;
if (typeof globalThis.fetch === "function") {
    fetchFn = globalThis.fetch.bind(globalThis);
} else {
    fetchFn = require("node-fetch");
}

// Konfigurasi dari .env
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const AUTH_DIR = process.env.AUTH_DIR || "auth_info";
const BOT_NAME = process.env.BOT_NAME || "WhatsApp Bot";

// Validasi konfigurasi
if (!GROQ_API_KEY) {
    console.error("❌ ERROR: GROQ_API_KEY tidak ditemukan di file .env");
    console.log("📝 Pastikan Anda telah:");
    console.log("1. Membuat file .env");
    console.log("2. Menambahkan GROQ_API_KEY=your_groq_api_key_here");
    console.log("3. Mendapatkan API key dari https://console.groq.com/keys");
    process.exit(1);
}

// Register font Arial Narrow
try {
    const fontPaths = [
        "C:/Windows/Fonts/ARIALN.TTF",
        "C:/Windows/Fonts/arialn.ttf",
        "/usr/share/fonts/truetype/msttcorefonts/Arial_Narrow.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSansNarrow-Regular.ttf",
        "/Library/Fonts/Arial Narrow.ttf",
        "/System/Library/Fonts/Supplemental/Arial Narrow.ttf"
    ];
    for (const fontPath of fontPaths) {
        if (fs.existsSync(fontPath)) {
            registerFont(fontPath, { family: "Arial Narrow" });
            console.log(`✅ Font Arial Narrow loaded: ${fontPath}`);
            break;
        }
    }
} catch (error) {
    console.log("ℹ️  Arial Narrow font not found, using fallback font");
}

// Konfigurasi Groq AI
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

async function chatWithAI(prompt) {
    try {
        console.log(`🤖 Mengirim request ke Groq API...`);
        
        const response = await fetchFn(GROQ_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                messages: [
                    {
                        role: "system",
                        content: "Anda adalah asisten AI yang membantu pengguna WhatsApp. Berikan respon yang ramah, informatif, dan mudah dipahami. Gunakan bahasa Indonesia yang baik dan santun."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                model: "llama-3.1-8b-instant", // Model pengganti yang direkomendasikan
                temperature: 0.7,
                max_tokens: 1024,
                top_p: 1,
                stream: false
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ HTTP Error: ${response.status}`, errorText);
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        
        if (data.choices && data.choices[0] && data.choices[0].message) {
            return data.choices[0].message.content;
        } else {
            console.error("❌ Format response tidak dikenali:", data);
            return "Maaf, saya mengalami kesalahan dalam memproses permintaan Anda.";
        }
    } catch (error) {
        console.error("❌ Error calling Groq API:", error);
        
        const errorMsg = error.message.toLowerCase();
        if (errorMsg.includes('401')) {
            return "Maaf, API key Groq tidak valid. Silakan periksa konfigurasi.";
        } else if (errorMsg.includes('429')) {
            return "Maaf, rate limit telah tercapai. Silakan coba lagi nanti.";
        } else if (errorMsg.includes('500')) {
            return "Maaf, server Groq sedang mengalami masalah. Silakan coba lagi nanti.";
        } else if (errorMsg.includes('model_decommissioned')) {
            return "Maaf, model AI yang digunakan telah didepresiasi. Silakan hubungi administrator untuk update.";
        } else {
            return "Maaf, terjadi kesalahan koneksi ke AI service. Silakan coba lagi.";
        }
    }
}

// Test Groq API connection on startup
async function testGroqConnection() {
    console.log("🔗 Testing Groq API connection...");
    try {
        const testResponse = await chatWithAI("Halo, balas dengan 'OK' jika kamu bisa mendengar saya.");
        if (testResponse && !testResponse.includes("Maaf")) {
            console.log(`✅ Groq API Test Response: ${testResponse.substring(0, 100)}...`);
            return true;
        } else {
            console.error("❌ Groq API Test Failed:", testResponse);
            return false;
        }
    } catch (error) {
        console.error("❌ Groq API Test Failed:", error);
        return false;
    }
}

async function startBot() {
    console.log(`🤖 Starting ${BOT_NAME}...`);
    console.log(`📁 Using auth directory: ${AUTH_DIR}`);
    
    // Test koneksi Groq API saat startup
    const groqTest = await testGroqConnection();
    if (!groqTest) {
        console.log("⚠️  Groq API tidak tersedia, fitur AI akan dimatikan");
    } else {
        console.log("✅ Groq API tersedia, fitur AI aktif");
    }
    
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const sock = makeWASocket({ auth: state });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return; // Abaikan pesan dari bot sendiri

        const from = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        const isReply = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
        const replyText = isReply?.conversation || isReply?.extendedTextMessage?.text;

        console.log("📩 Pesan masuk:", text, "fromMe:", msg.key.fromMe);

        if (!text) return;

        // Command /hai
        if (text.toLowerCase() === "/hai") {
            await sock.sendMessage(from, { 
                text: `Halo! Saya ${BOT_NAME} 🤖\n\n` +
                      `Saya dilengkapi dengan AI yang powerful untuk membantu Anda.\n` +
                      `Ketik /menu untuk melihat daftar perintah.` 
            });
        } 
        // Command /menu
        else if (text.toLowerCase() === "/menu") {
            const aiStatus = groqTest ? "🟢 AKTIF" : "🔴 NON-AKTIF";
            await sock.sendMessage(from, { 
                text: `📌 Menu ${BOT_NAME}:\n\n` +
                      `🤖 Status AI: ${aiStatus}\n\n` +
                      `1. /hai - Sambutan bot\n` +
                      `2. /menu - Menu ini\n` +
                      `3. /mkstr <teks> - Buat stiker dari teks\n` +
                      `4. /ayat - Kata-kata Hari Ini dari Alkitab\n` +
                      `5. /msg <pertanyaan> - Chat dengan AI\n` +
                      `6. Reply pesan dengan '/msg' atau '/msg <pertanyaan>' - Chat dengan AI\n\n` +
                      `💡 AI menggunakan Groq dengan model Llama 3.1 yang sangat cepat!`
            });
        } 
        // Command /mkstr <teks>
        else if (text.startsWith("/mkstr")) {
            let stickerText = text.replace("/mkstr", "").trim();
            if (!stickerText && isReply) {
                const quotedMsg = isReply.conversation || isReply.extendedTextMessage?.text;
                stickerText = quotedMsg || "Teks kosong";
            }
            if (stickerText) {
                await createSticker(sock, from, stickerText);
            } else {
                await sock.sendMessage(from, { text: "❌ Gunakan: /mkstr <teks> atau reply pesan dengan /mkstr" });
            }
        } 
        // Command /ayat
        else if (text.toLowerCase() === "/ayat") {
            try {
                const versesList = [
                    "John 3:16", "Psalm 23:1", "Philippians 4:13", "Jeremiah 29:11",
                    "Psalm 119:105", "Romans 8:28", "Proverbs 3:5-6", "Matthew 6:33",
                    "Isaiah 41:10", "Romans 12:2"
                ];

                // Hitung hari dalam setahun (1–365)
                const today = new Date();
                const start = new Date(today.getFullYear(), 0, 0);
                const diff = today - start;
                const oneDay = 1000 * 60 * 60 * 24;
                const dayOfYear = Math.floor(diff / oneDay);

                // Pilih ayat berdasarkan hari agar konsisten tiap hari
                const dailyVerse = versesList[dayOfYear % versesList.length];

                const res = await fetchFn(`https://bible-api.com/${encodeURIComponent(dailyVerse)}?translation=kjv`);
                const data = await res.json();

                const ayat = `${data.reference}\n"${data.verses[0].text}"\n(${data.translation_name})`;

                await sock.sendMessage(from, { text: `📖 Kata-kata Hari Ini:\n\n${ayat}` });
            } catch (err) {
                console.error("❌ Gagal ambil ayat:", err);
                await sock.sendMessage(from, { text: "❌ Gagal mengambil ayat hari ini." });
            }
        }
        // Command AI Chat - /msg <input> or /msg with reply
        else if (text.startsWith("/msg")) {
            // Jika Groq tidak tersedia
            if (!groqTest) {
                await sock.sendMessage(from, { 
                    text: "❌ Fitur AI sedang tidak tersedia.\n\n" +
                          "Kemungkinan penyebab:\n" +
                          "• API key Groq tidak valid\n" +
                          "• Quota API telah habis\n" +
                          "• Koneksi internet bermasalah\n\n" +
                          "Silakan hubungi administrator atau coba lagi nanti."
                });
                return;
            }
            
            let aiPrompt = text.replace("/msg", "").trim();
            
            // Jika ada reply
            if (isReply && replyText) {
                if (aiPrompt) {
                    // Gabungkan teks yang di-reply dengan input pengguna
                    aiPrompt = `${replyText} ${aiPrompt}`;
                } else {
                    // Gunakan hanya teks yang di-reply jika /msg tanpa input
                    aiPrompt = replyText;
                }
            }
            
            if (aiPrompt) {
                // Kirim status "typing"
                await sock.sendPresenceUpdate('composing', from);
                
                try {
                    console.log(`🤖 AI Request: ${aiPrompt.substring(0, 100)}...`);
                    const aiResponse = await chatWithAI(aiPrompt);
                    
                    // Stop typing indicator
                    await sock.sendPresenceUpdate('paused', from);
                    
                    await sock.sendMessage(from, { 
                        text: `🤖 ${BOT_NAME} AI:\n\n${aiResponse}\n\n` +
                              `💡 Powered by Groq + Llama 3.1` 
                    });
                    console.log(`✅ AI Response sent (${aiResponse.length} characters)`);
                } catch (error) {
                    console.error("❌ Error in AI chat:", error);
                    await sock.sendPresenceUpdate('paused', from);
                    await sock.sendMessage(from, { 
                        text: "❌ Maaf, terjadi kesalahan saat memproses permintaan AI. Silakan coba lagi." 
                    });
                }
            } else {
                await sock.sendMessage(from, { 
                    text: `🤖 Cara menggunakan AI Chat ${BOT_NAME}:\n\n` +
                          `1. Ketik: /msg <pertanyaan Anda>\n` +
                          `   Contoh: /msg jelaskan tentang artificial intelligence\n\n` +
                          `2. Reply pesan dengan: /msg atau /msg <pertanyaan>\n` +
                          `   - /msg: Gunakan teks pesan yang di-reply\n` +
                          `   - /msg <pertanyaan>: Gabungkan teks yang di-reply dengan pertanyaan\n\n` +
                          `💡 Dibuat oleh atmint` 
                });
            }
        }
        // Jika hanya mention bot tanpa command (hanya respons untuk "bot" atau nama bot persis)
        else if (text.toLowerCase() === "bot" || text.toLowerCase() === BOT_NAME.toLowerCase()) {
            await sock.sendMessage(from, { 
                text: `Hai! Saya ${BOT_NAME}. Ketik /menu untuk melihat apa yang bisa saya bantu! 🤖` 
            });
        }
    });

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("📱 Scan QR Code berikut untuk login:");
            qrcode.generate(qr, { small: true });
        }

        if (connection === "close") {
            const shouldReconnect =
                (lastDisconnect.error = new Boom(lastDisconnect.error))?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("🔌 Koneksi putus. Reconnect:", shouldReconnect);
            if (shouldReconnect) {
                console.log("🔄 Menghubungkan ulang...");
                startBot();
            }
        } else if (connection === "open") {
            console.log(`✅ ${BOT_NAME} siap digunakan!`);
        }
    });
}

// Fungsi untuk memproses SVG dan menambahkan width/height
function processSVG(svgString, size) {
    // Tambahkan width dan height ke SVG jika tidak ada
    if (!svgString.includes('width=') && !svgString.includes('height=')) {
        svgString = svgString.replace(
            '<svg',
            `<svg width="${size}" height="${size}"`
        );
    }
    return svgString;
}

// Fungsi untuk render teks dengan emoji
// Fungsi untuk render teks dengan emoji
async function drawTextWithEmoji(ctx, text, x, y, fontSize) {
    const parsed = twemoji.parse(text, { folder: "svg", ext: ".svg" });
    const parts = parsed.split(/(<img.*?>)/g).filter(Boolean);
    let cursorX = x;

    for (let part of parts) {
        if (part.startsWith("<img")) {
            const match = part.match(/src="([^"]+)"/);
            if (match) {
                const url = match[1];
                try {
                    const res = await fetchFn(url);
                    let svgString = await res.text();
                    
                    // Process SVG untuk menambahkan width dan height
                    const emojiSize = Math.round(fontSize * 0.9); // Diperkecil dari 1.2 menjadi 0.9
                    
                    svgString = processSVG(svgString, emojiSize);
                    
                    // Convert SVG string ke buffer
                    const svgBuffer = Buffer.from(svgString);
                    
                    // Load image dari SVG buffer
                    const img = await loadImage(svgBuffer);

                    // Draw emoji - posisi Y disesuaikan agar sejajar dengan teks
                    const emojiY = y - (fontSize * 0.7); // Posisi Y disesuaikan
                    ctx.drawImage(img, cursorX, emojiY, emojiSize, emojiSize);
                    cursorX += emojiSize * 0.8; // Spasi setelah emoji juga diperkecil
                } catch (err) {
                    console.error("❌ Gagal load emoji:", err);
                    // Fallback: render sebagai teks biasa
                    ctx.font = `bold ${fontSize}px "Arial Narrow", Arial, sans-serif`;
                    ctx.fillText("□", cursorX, y);
                    cursorX += fontSize * 0.8;
                }
            }
        } else {
            ctx.font = `bold ${fontSize}px "Arial Narrow", Arial, sans-serif`;
            ctx.fillStyle = "#000";
            ctx.textBaseline = "alphabetic";
            ctx.fillText(part, cursorX, y);
            cursorX += ctx.measureText(part).width;
        }
    }
    
    return cursorX;
}

// Fungsi buat stiker dari teks
async function createSticker(sock, from, text) {
    try {
        const canvasWidth = 512;
        const canvasHeight = 512;
        const canvas = createCanvas(canvasWidth, canvasHeight);
        const ctx = canvas.getContext("2d");

        // Background putih
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        ctx.fillStyle = "#000";
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        
        // Pisahkan teks menjadi kata-kata
        const words = text.trim().split(/\s+/);
        if (words.length === 0) return;

        // Fungsi untuk menemukan ukuran font optimal yang dinamis
        function findOptimalFontSize() {
            let fontSize = 120; // Mulai dari font size besar
            const margin = canvasWidth * 0.05;
            const maxWidth = canvasWidth - (margin * 2);
            const maxHeight = canvasHeight - (margin * 2);
            
            while (fontSize > 10) {
                ctx.font = `bold ${fontSize}px "Arial Narrow", Arial, sans-serif`;
                
                let lines = [];
                let currentLine = [];
                let currentLineWidth = 0;
                const spaceWidth = ctx.measureText(' ').width;
                
                // Coba susun semua kata dengan font size saat ini
                let canFitAllWords = true;
                
                for (let word of words) {
                    const wordWidth = ctx.measureText(word).width;
                    
                    // Jika kata tunggal lebih lebar dari maxWidth, kurangi font size
                    if (wordWidth > maxWidth) {
                        canFitAllWords = false;
                        break;
                    }
                    
                    // Cek jika kata bisa ditambahkan ke baris saat ini
                    if (currentLineWidth + wordWidth <= maxWidth || currentLine.length === 0) {
                        currentLine.push(word);
                        currentLineWidth += wordWidth + spaceWidth;
                    } else {
                        lines.push(currentLine);
                        currentLine = [word];
                        currentLineWidth = wordWidth + spaceWidth;
                    }
                }
                
                // Tambahkan baris terakhir
                if (currentLine.length > 0) {
                    lines.push(currentLine);
                }
                
                // Hitung total tinggi yang dibutuhkan
                const lineHeight = fontSize * 1.2;
                const totalHeight = lines.length * lineHeight;
                
                // Cek jika semua kata muat dan tidak melebihi tinggi maksimum
                if (canFitAllWords && totalHeight <= maxHeight) {
                    return { fontSize, lines, lineHeight };
                }
                
                // Kurangi font size untuk percobaan berikutnya
                fontSize -= 2;
            }
            
            // Fallback: gunakan font size minimal dan susun ulang
            ctx.font = `bold 10px "Arial Narrow", Arial, sans-serif`;
            let lines = [];
            let currentLine = [];
            let currentLineWidth = 0;
            const spaceWidth = ctx.measureText(' ').width;
            
            for (let word of words) {
                const wordWidth = ctx.measureText(word).width;
                
                if (currentLineWidth + wordWidth <= maxWidth || currentLine.length === 0) {
                    currentLine.push(word);
                    currentLineWidth += wordWidth + spaceWidth;
                } else {
                    lines.push(currentLine);
                    currentLine = [word];
                    currentLineWidth = wordWidth + spaceWidth;
                }
            }
            if (currentLine.length > 0) {
                lines.push(currentLine);
            }
            
            return { fontSize: 10, lines, lineHeight: 12 };
        }

        const { fontSize, lines, lineHeight } = findOptimalFontSize();
        
        // Render teks dengan layout yang optimal
        const margin = canvasWidth * 0.05;
        const startY = margin + fontSize;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineText = line.join(' ');
            
            // Hitung posisi x untuk rata kiri
            const x = margin;
            const y = startY + (i * lineHeight);
            
            // Gunakan fungsi drawTextWithEmoji untuk render teks dan emoji
            await drawTextWithEmoji(ctx, lineText, x, y, fontSize);
        }

        const buffer = canvas.toBuffer("image/png");
        const webpBuffer = await sharp(buffer)
            .resize(canvasWidth, canvasHeight)
            .toFormat("webp")
            .toBuffer();

        await sock.sendMessage(from, {
            sticker: webpBuffer,
            mimetype: "image/webp",
        });
        
        console.log(`✅ Sticker created for text: ${text.substring(0, 50)}... (Font size: ${fontSize}px)`);
    } catch (error) {
        console.error("❌ Error creating sticker:", error);
        await sock.sendMessage(from, { text: "❌ Gagal membuat stiker." });
    }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the bot
startBot();