const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const TOKEN = '7545031629:AAEVK_xtPKW35ZK7b-wrbdwwnV-1Fwred1A';
const URL = 'https://nis-12.onrender.com';  // Sizning public URL

// Botni webhook rejimida ishga tushiramiz
const bot = new TelegramBot(TOKEN, { webHook: true });
bot.setWebHook(`${URL}/bot${TOKEN}`);

const app = express();
app.use(bodyParser.json());

const db = new sqlite3.Database('ombor.db');

const admins = [1120730495];  // Adminlar IDlari

// Log yozish funksiyasi
function logWrite(text) {
  const vaqt = new Date().toISOString();
  fs.appendFile('bot.log.txt', `[${vaqt}] ${text}\n`, err => {
    if (err) console.error("Log yozishda xatolik:", err);
  });
}

// Bazani yaratish
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS mahsulotlar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT UNIQUE,
    soni INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS harakatlar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mahsulot_id INTEGER,
    miqdor INTEGER,
    turi TEXT,
    sana TEXT,
    FOREIGN KEY(mahsulot_id) REFERENCES mahsulotlar(id)
  )`);
});

// Asosiy menyu tugmalari (emoji bilan)
function getMainMenu(isAdmin) {
  const buttons = [
    ["📋 Mahsulotlar"],
    ["📦 Qoldiq"],
    ["📊 Statistika"]
  ];
  if (isAdmin) {
    buttons.unshift(
      ["➕ Mahsulot qo'shish"],
      ["🗑️ Mahsulot o'chirish"],
      ["📥 Kirim"],
      ["📤 Chiqim"]
    );
  }
  return {
    reply_markup: {
      keyboard: buttons,
      resize_keyboard: true,
      one_time_keyboard: false,
    }
  };
}

// Inline tugmalar - mahsulotlar ro'yxati
function mahsulotInlineButtons(mahsulotlar, forDelete = false) {
  return {
    reply_markup: {
      inline_keyboard: mahsulotlar.map(m => [{
        text: m.nom,
        callback_data: forDelete ? 'del_' + m.nom : m.nom
      }])
    }
  };
}

// Session ma'lumotlari
const session = {};

// Stickerlar
const stickers = {
  add: 'CAACAgIAAxkBAAEHsPZj9uN6syVdE9v5frjPPGrj6yZTVAACsRUAAmJ1rUlr2xyJXlgf7CME',
  delete: 'CAACAgIAAxkBAAEHsPlj9uN8O8-F7pa-VQ_dOPLyIZjPVwAC1RUAAm8prUsHDCXp3XpCqCME',
  kirim: 'CAACAgIAAxkBAAEHsPpj9uN9UxQf3np1tbTfqXx4QYt6TgACxBQAAl2WrUsN2l8th5GZPSECME',
  chiqim: 'CAACAgIAAxkBAAEHsP5j9uN-JmYRXOxnRgZtj9xq-RIm7AACsxUAAnokrUqXzBpv9A0F3CME',
  qoldiq: 'CAACAgIAAxkBAAEHsP9j9uN-MoExu7R9Kcv-J1hxXs7-BQAC6hUAAl61rUvnGuB9xCGoxCME',
  statistik: 'CAACAgIAAxkBAAEHsQFj9uN-PES3vJqv-w_iFJQMa9xGZQAC7RUAAlVKrUtq-1XZlDPgSCME'
};

// Mahsulot qo'shish yoki kirim/chiqim operatsiyasi uchun umumiy funksiya
function mahsulotSoniniYangilash(chatId, nom, soni, turi, isAdmin) {
  const sana = new Date().toISOString();
  db.get("SELECT * FROM mahsulotlar WHERE nom = ?", [nom], (err, row) => {
    if (err) {
      bot.sendMessage(chatId, "Xatolik yuz berdi.");
      logWrite(`DB error (${turi}): ${err.message}`);
      session[chatId] = {};
      return;
    }
    if (!row) {
      if (turi === 'chiqim') {
        bot.sendMessage(chatId, "Mahsulot topilmadi yoki yetarli zaxira yo'q.", getMainMenu(isAdmin));
        session[chatId] = {};
        return;
      }
      // Mahsulot yo'q, kirim uchun yangi qo'shamiz
      db.run("INSERT INTO mahsulotlar (nom, soni) VALUES (?, ?)", [nom, soni], function(err) {
        if (err) {
          bot.sendMessage(chatId, "Mahsulot qo‘shishda xatolik yuz berdi.");
          logWrite(`DB insert error (${turi}): ${err.message}`);
          session[chatId] = {};
          return;
        }
        db.run("INSERT INTO harakatlar (mahsulot_id, miqdor, turi, sana) VALUES (?, ?, ?, ?)", [this.lastID, soni, turi, sana]);
        bot.sendMessage(chatId, `${nom} mahsuloti tizimga qo‘shildi. Son: ${soni}`, getMainMenu(isAdmin));
        logWrite(`${nom} mahsuloti tizimga qo‘shildi. Son: ${soni}`);
        session[chatId] = {};
      });
      return;
    }

    if (turi === 'kirim') {
      const yangiSoni = row.soni + soni;
      db.run("UPDATE mahsulotlar SET soni = ? WHERE id = ?", [yangiSoni, row.id], (err) => {
        if (err) {
          bot.sendMessage(chatId, "Yangilashda xatolik yuz berdi.", getMainMenu(isAdmin));
          session[chatId] = {};
          return;
        }
        db.run("INSERT INTO harakatlar (mahsulot_id, miqdor, turi, sana) VALUES (?, ?, ?, ?)", [row.id, soni, turi, sana]);
        bot.sendMessage(chatId, `${nom} mahsulotiga ${soni} dona kirim qilindi. Jami: ${yangiSoni}`, getMainMenu(isAdmin));
        session[chatId] = {};
      });
    } else if (turi === 'chiqim') {
      if (row.soni < soni) {
        bot.sendMessage(chatId, `Xatolik: mavjud qoldiq ${row.soni} dona, siz ${soni} dona chiqarolmaysiz.`, getMainMenu(isAdmin));
        session[chatId] = {};
        return;
      }
      const yangiSoni = row.soni - soni;
      db.run("UPDATE mahsulotlar SET soni = ? WHERE id = ?", [yangiSoni, row.id], (err) => {
        if (err) {
          bot.sendMessage(chatId, "Yangilashda xatolik yuz berdi.", getMainMenu(isAdmin));
          session[chatId] = {};
          return;
        }
        db.run("INSERT INTO harakatlar (mahsulot_id, miqdor, turi, sana) VALUES (?, ?, ?, ?)", [row.id, soni, turi, sana]);
        bot.sendMessage(chatId, `${nom} mahsulotidan ${soni} dona chiqim qilindi. Jami: ${yangiSoni}`, getMainMenu(isAdmin));
        session[chatId] = {};
      });
    }
  });
}

// /start va /menu komandalarini boshqarish
bot.onText(/\/start|\/menu/, (msg) => {
  const chatId = msg.chat.id;
  const isAdmin = admins.includes(chatId);
  session[chatId] = {};
  bot.sendMessage(chatId, "Assalomu alaykum! Ombor hisob botiga xush kelibsiz. Tanlang:", getMainMenu(isAdmin));
});

// Xabarlarni boshqarish
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const isAdmin = admins.includes(chatId);

  if (!session[chatId]) session[chatId] = {};

  // Faqat adminlarga mo'ljallangan funksiyalarni cheklash
  if (!isAdmin && ["➕ Mahsulot qo'shish", "🗑️ Mahsulot o'chirish", "📥 Kirim", "📤 Chiqim", "📊 Statistika"].includes(text)) {
    bot.sendMessage(chatId, "Bu funksiyalar faqat adminlar uchun mavjud.", getMainMenu(isAdmin));
    return;
  }

  // Mahsulot qo'shish
  if (text === "➕ Mahsulot qo'shish") {
    bot.sendSticker(chatId, stickers.add);
    session[chatId] = { qadam: 'add_nom' };
    bot.sendMessage(chatId, "Qo'shmoqchi bo'lgan mahsulot nomini kiriting:");
    return;
  }
  if (session[chatId].qadam === 'add_nom') {
    session[chatId].nom = text.trim();
    session[chatId].qadam = 'add_soni';
    bot.sendMessage(chatId, `${session[chatId].nom} uchun sonini kiriting (0 dan boshlashingiz mumkin):`);
    return;
  }
  if (session[chatId].qadam === 'add_soni') {
    const soni = parseInt(text.trim());
    if (isNaN(soni) || soni < 0) {
      bot.sendMessage(chatId, "Iltimos, 0 yoki undan katta son kiriting.");
      return;
    }
    mahsulotSoniniYangilash(chatId, session[chatId].nom, soni, 'kirim', isAdmin);
    return;
  }

  // Mahsulot o'chirish
  if (text === "🗑️ Mahsulot o'chirish") {
    bot.sendSticker(chatId, stickers.delete);
    db.all("SELECT nom FROM mahsulotlar", (err, rows) => {
      if (err) {
        bot.sendMessage(chatId, "Xatolik yuz berdi.");
        return;
      }
      if (rows.length === 0) {
        bot.sendMessage(chatId, "Hozircha mahsulotlar mavjud emas.", getMainMenu(isAdmin));
        return;
      }
      bot.sendMessage(chatId, "O'chirmoqchi bo'lgan mahsulotni tanlang:", mahsulotInlineButtons(rows, true));
    });
    return;
  }

  // Kirim
  if (text === "📥 Kirim") {
    bot.sendSticker(chatId, stickers.kirim);
    db.all("SELECT nom FROM mahsulotlar", (err, rows) => {
      if (err) {
        bot.sendMessage(chatId, "Xatolik yuz berdi.");
        return;
      }
      if (rows.length === 0) {
        bot.sendMessage(chatId, "Hozircha mahsulotlar mavjud emas.", getMainMenu(isAdmin));
        return;
      }
      bot.sendMessage(chatId, "Kirim qilmoqchi bo'lgan mahsulotni tanlang:", mahsulotInlineButtons(rows));
      session[chatId].qadam = 'kirim_tanlash';
    });
    return;
  }

  // Chiqim
  if (text === "📤 Chiqim") {
    bot.sendSticker(chatId, stickers.chiqim);
    db.all("SELECT nom FROM mahsulotlar", (err, rows) => {
      if (err) {
        bot.sendMessage(chatId, "Xatolik yuz berdi.");
        return;
      }
      if (rows.length === 0) {
        bot.sendMessage(chatId, "Hozircha mahsulotlar mavjud emas.", getMainMenu(isAdmin));
        return;
      }
      bot.sendMessage(chatId, "Chiqim qilmoqchi bo'lgan mahsulotni tanlang:", mahsulotInlineButtons(rows));
      session[chatId].qadam = 'chiqim_tanlash';
    });
    return;
  }

  // Kirim soni kiritish
  if (session[chatId].qadam === 'kirim_soni') {
    const soni = parseInt(text.trim());
    if (isNaN(soni) || soni <= 0) {
      bot.sendMessage(chatId, "Iltimos, 1 yoki undan katta son kiriting.");
      return;
    }
    mahsulotSoniniYangilash(chatId, session[chatId].nom, soni, 'kirim', isAdmin);
    return;
  }

  // Chiqim soni kiritish
  if (session[chatId].qadam === 'chiqim_soni') {
    const soni = parseInt(text.trim());
    if (isNaN(soni) || soni <= 0) {
      bot.sendMessage(chatId, "Iltimos, 1 yoki undan katta son kiriting.");
      return;
    }
    mahsulotSoniniYangilash(chatId, session[chatId].nom, soni, 'chiqim', isAdmin);
    return;
  }

  // Qoldiqni ko‘rsatish
  if (text === "📦 Qoldiq") {
    bot.sendSticker(chatId, stickers.qoldiq);
    db.all("SELECT nom, soni FROM mahsulotlar", (err, rows) => {
      if (err) {
        bot.sendMessage(chatId, "Xatolik yuz berdi.");
        return;
      }
      if (rows.length === 0) {
        bot.sendMessage(chatId, "Hozircha mahsulotlar mavjud emas.", getMainMenu(isAdmin));
        return;
      }
      let javob = "Ombordagi mahsulotlar va qoldiqlari:\n\n";
      rows.forEach(r => {
        javob += `${r.nom}: ${r.soni} dona\n`;
      });
      bot.sendMessage(chatId, javob, getMainMenu(isAdmin));
    });
    return;
  }

if (text === "📊 Statistika") {
  bot.sendSticker(chatId, stickers.statistik);
  db.all(`SELECT 
    m.nom AS nom,
    SUM(CASE WHEN h.turi = 'kirim' THEN h.miqdor ELSE 0 END) AS jami_kirim,
    MAX(CASE WHEN h.turi = 'kirim' THEN h.sana ELSE NULL END) AS oxirgi_kirim,
    SUM(CASE WHEN h.turi = 'chiqim' THEN h.miqdor ELSE 0 END) AS jami_chiqim,
    MAX(CASE WHEN h.turi = 'chiqim' THEN h.sana ELSE NULL END) AS oxirgi_chiqim
    FROM mahsulotlar m
    LEFT JOIN harakatlar h ON m.id = h.mahsulot_id
    GROUP BY m.id
    ORDER BY m.nom`, (err, rows) => {
    if (err) {
      bot.sendMessage(chatId, "Xatolik yuz berdi.");
      return;
    }

    if (rows.length === 0) {
      bot.sendMessage(chatId, "Hech qanday mahsulot topilmadi.");
      return;
    }

    let javob = "📊 Har bir mahsulot bo‘yicha statistika:\n\n";

    rows.forEach(row => {
      const kirim = row.jami_kirim || 0;
      const chiqim = row.jami_chiqim || 0;
      const oxirgiKirim = row.oxirgi_kirim ? new Date(row.oxirgi_kirim).toLocaleString() : "Yo‘q";
      const oxirgiChiqim = row.oxirgi_chiqim ? new Date(row.oxirgi_chiqim).toLocaleString() : "Yo‘q";

      javob += `📦 *${row.nom}*\n` +
        `  ▫️ Kirim: ${kirim} dona\n` +
        `  ▫️ Oxirgi kirim: ${oxirgiKirim}\n` +
        `  ▫️ Chiqim: ${chiqim} dona\n` +
        `  ▫️ Oxirgi chiqim: ${oxirgiChiqim}\n\n`;
    });

    bot.sendMessage(chatId, javob, { parse_mode: "Markdown", ...getMainMenu(isAdmin) });
  });
  return;
}

  // Noma'lum buyruq uchun menyuni ko'rsatish
  if (!text.startsWith('/')) {
    bot.sendMessage(chatId, "Iltimos, menyudan biror tugmani tanlang yoki /menu yozing.", getMainMenu(isAdmin));
  }
});

// Callback query ishlash (inline tugmalar)
bot.on('callback_query', (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const isAdmin = admins.includes(chatId);

  if (!session[chatId]) session[chatId] = {};

  // Mahsulotni o'chirish
  if (data.startsWith('del_')) {
    if (!isAdmin) {
      bot.answerCallbackQuery(callbackQuery.id, { text: "Bu amal uchun ruxsat yo'q." });
      return;
    }
    const nom = data.slice(4);
    db.get("SELECT id FROM mahsulotlar WHERE nom = ?", [nom], (err, row) => {
      if (err || !row) {
        bot.answerCallbackQuery(callbackQuery.id, { text: "Mahsulot topilmadi yoki xatolik yuz berdi." });
        return;
      }
      const mahsulotId = row.id;
      db.run("DELETE FROM harakatlar WHERE mahsulot_id = ?", [mahsulotId], (err) => {
        if (err) {
          bot.answerCallbackQuery(callbackQuery.id, { text: "Harakatlarni o'chirishda xatolik yuz berdi." });
          return;
        }
        db.run("DELETE FROM mahsulotlar WHERE id = ?", [mahsulotId], function(err) {
          if (err) {
            bot.answerCallbackQuery(callbackQuery.id, { text: "Mahsulotni o'chirishda xatolik yuz berdi." });
            return;
          }
          bot.answerCallbackQuery(callbackQuery.id, { text: `${nom} o'chirildi.` });
          bot.editMessageText(`${nom} mahsuloti o'chirildi.`, {
            chat_id: chatId,
            message_id: callbackQuery.message.message_id,
            reply_markup: { inline_keyboard: [] }
          });
          logWrite(`${nom} mahsuloti o'chirildi va unga tegishli harakatlar o'chirildi.`);
          session[chatId] = {};
        });
      });
    });
    return;
  }

  // Kirim mahsulot tanlandi
  if (session[chatId].qadam === 'kirim_tanlash') {
    session[chatId].nom = data;
    session[chatId].qadam = 'kirim_soni';
    bot.answerCallbackQuery(callbackQuery.id);
    bot.sendMessage(chatId, `${data} mahsuloti uchun kirim sonini kiriting:`);
    return;
  }

  // Chiqim mahsulot tanlandi
  if (session[chatId].qadam === 'chiqim_tanlash') {
    session[chatId].nom = data;
    session[chatId].qadam = 'chiqim_soni';
    bot.answerCallbackQuery(callbackQuery.id);
    bot.sendMessage(chatId, `${data} mahsuloti uchun chiqim sonini kiriting:`);
    return;
  }

  bot.answerCallbackQuery(callbackQuery.id);
});

const express = require('express');
const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server port ${PORT} da ishga tushdi`);
});

app.get("/", (req, res) => {
  res.send("Bot ishlamoqda (webhook orqali)");
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Server ishga tushdi');
});

