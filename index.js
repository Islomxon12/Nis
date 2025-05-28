const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const express = require('express');

const TOKEN = '7545031629:AAEVK_xtPKW35ZK7b-wrbdwwnV-1Fwred1A';
const bot = new TelegramBot(TOKEN, { polling: true });
const db = new sqlite3.Database('./ombor.db');
const session = {};
const ADMIN_IDS = [5809102043];

function logWrite(message) {
  const time = new Date().toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' });
  fs.appendFileSync('log.txt', `[${time}] ${message}\n`);
}

function getMainMenu(isAdmin) {
  const buttons = [
    [{ text: '➕ Mahsulot qo\'shish' }, { text: '📦 Mahsulotlar' }],
    [{ text: '📈 Statistika' }, { text: '📊 Qoldiq' }]
  ];
  if (isAdmin) buttons.push([{ text: '❌ Mahsulot o\'chirish' }]);
  return { reply_markup: { keyboard: buttons, resize_keyboard: true } };
}

bot.onText(/\/start/, (msg) => {
  const isAdmin = ADMIN_IDS.includes(msg.from.id);
  bot.sendMessage(msg.chat.id, 'Ombor botiga xush kelibsiz!', getMainMenu(isAdmin));
});

bot.onText(/\/admin/, (msg) => {
  if (!ADMIN_IDS.includes(msg.from.id)) {
    ADMIN_IDS.push(msg.from.id);
    bot.sendMessage(msg.chat.id, 'Siz admin sifatida qo‘shildingiz.');
  } else {
    bot.sendMessage(msg.chat.id, 'Siz allaqachon adminsiz.');
  }
});

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const isAdmin = ADMIN_IDS.includes(msg.from.id);

  if (!session[chatId]) session[chatId] = {};

  if (text === '➕ Mahsulot qo\'shish') {
    session[chatId].qadam = 'nom';
    bot.sendMessage(chatId, 'Yangi mahsulot nomini kiriting:');
  } else if (text === '📦 Mahsulotlar') {
    db.all("SELECT nom FROM mahsulotlar", (err, rows) => {
      if (err || rows.length === 0) return bot.sendMessage(chatId, 'Mahsulotlar yo‘q.');
      const buttons = rows.map(r => [{ text: r.nom }]);
      bot.sendMessage(chatId, 'Mahsulotlar ro‘yxati:', {
        reply_markup: { keyboard: buttons.concat([[{ text: '⬅️ Orqaga' }]]), resize_keyboard: true }
      });
    });
  } else if (text === '📈 Statistika') {
    db.all("SELECT nom, SUM(CASE WHEN tur = 'kirim' THEN soni ELSE 0 END) AS kirim, SUM(CASE WHEN tur = 'chiqim' THEN soni ELSE 0 END) AS chiqim FROM harakatlar GROUP BY nom", (err, rows) => {
      if (err || rows.length === 0) return bot.sendMessage(chatId, 'Statistika yo‘q.');
      let message = '📊 Statistika:\n';
      rows.forEach(r => {
        message += `\n${r.nom}\n  Kirim: ${r.kirim || 0}\n  Chiqim: ${r.chiqim || 0}`;
      });
      bot.sendMessage(chatId, message);
    });
  } else if (text === '📊 Qoldiq') {
    db.all("SELECT nom, SUM(CASE WHEN tur = 'kirim' THEN soni ELSE -soni END) AS qoldiq FROM harakatlar GROUP BY nom", (err, rows) => {
      if (err || rows.length === 0) return bot.sendMessage(chatId, 'Qoldiq yo‘q.');
      let message = '📦 Qoldiq:\n';
      rows.forEach(r => {
        message += `\n${r.nom}: ${r.qoldiq || 0}`;
      });
      bot.sendMessage(chatId, message);
    });
  } else if (text === '❌ Mahsulot o\'chirish') {
    if (!isAdmin) return bot.sendMessage(chatId, 'Sizda bu amalni bajarish huquqi yo‘q.');
    db.all("SELECT id, nom FROM mahsulotlar", (err, rows) => {
      if (err || rows.length === 0) return bot.sendMessage(chatId, 'Mahsulotlar yo‘q.');
      const buttons = rows.map(r => [{ text: `❌ ${r.nom}`, callback_data: `delete_${r.id}_${r.nom}` }]);
      bot.sendMessage(chatId, 'O‘chirmoqchi bo‘lgan mahsulotni tanlang:', {
        reply_markup: { inline_keyboard: buttons }
      });
    });
  } else if (session[chatId].qadam === 'nom') {
    session[chatId].nom = text;
    session[chatId].qadam = 'soni';
    bot.sendMessage(chatId, 'Mahsulot sonini kiriting:');
  } else if (session[chatId].qadam === 'soni') {
    const nom = session[chatId].nom;
    const soni = parseInt(text);
    if (isNaN(soni)) return bot.sendMessage(chatId, 'Sonni to‘g‘ri kiriting.');
    db.run("INSERT INTO mahsulotlar (nom) VALUES (?)", [nom]);
    db.run("INSERT INTO harakatlar (nom, tur, soni) VALUES (?, ?, ?)", [nom, 'kirim', soni]);
    bot.sendMessage(chatId, `${nom} mahsuloti qo‘shildi (soni: ${soni}).`, getMainMenu(isAdmin));
    session[chatId] = {};
  } else if (text === '⬅️ Orqaga') {
    bot.sendMessage(chatId, 'Asosiy menyu', getMainMenu(isAdmin));
  } else if (text && !['📦 Mahsulotlar', '📈 Statistika', '📊 Qoldiq'].includes(text)) {
    db.get("SELECT * FROM mahsulotlar WHERE nom = ?", [text], (err, row) => {
      if (!row) return bot.sendMessage(chatId, 'Bunday mahsulot topilmadi.');
      session[chatId].nom = text;
      session[chatId].qadam = 'amal_tanlash';
      bot.sendMessage(chatId, `${text} mahsuloti uchun amalni tanlang:`, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '➕ Kirim', callback_data: 'kirim' },
              { text: '➖ Chiqim', callback_data: 'chiqim' }
            ]
          ]
        }
      });
    });
  }
});

bot.on('callback_query', (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  if (data.startsWith('delete_')) {
    const [_, mahsulotId, nom] = data.split('_');
    db.run("DELETE FROM mahsulotlar WHERE id = ?", [mahsulotId], (err) => {
      if (err) {
        bot.answerCallbackQuery(callbackQuery.id, { text: "O‘chirishda xatolik yuz berdi." });
        logWrite(`Xatolik: ${nom} mahsulotini o‘chirishda. ${err.message}`);
        return;
      }
      db.run("DELETE FROM harakatlar WHERE nom = ?", [nom]);
      bot.answerCallbackQuery(callbackQuery.id, { text: `${nom} o‘chirildi.` });
      bot.sendMessage(chatId, `${nom} mahsuloti muvaffaqiyatli o‘chirildi.`, getMainMenu(true));
      logWrite(`${nom} mahsuloti o‘chirildi.`);
    });
    return;
  }

  if (data === 'kirim') {
    session[chatId].qadam = 'kirim_soni';
    bot.sendMessage(chatId, 'Kirim sonini kiriting:');
  } else if (data === 'chiqim') {
    session[chatId].qadam = 'chiqim_soni';
    bot.sendMessage(chatId, 'Chiqim sonini kiriting:');
  }
});

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const nom = session[chatId]?.nom;

  if (session[chatId]?.qadam === 'kirim_soni') {
    const soni = parseInt(text);
    if (isNaN(soni)) return bot.sendMessage(chatId, 'Sonni to‘g‘ri kiriting.');
    db.run("INSERT INTO harakatlar (nom, tur, soni) VALUES (?, ?, ?)", [nom, 'kirim', soni]);
    bot.sendMessage(chatId, `✅ ${nom} uchun ${soni} ta kirim qilindi.`);
    session[chatId] = {};
  }
  if (session[chatId]?.qadam === 'chiqim_soni') {
    const soni = parseInt(text);
    if (isNaN(soni)) return bot.sendMessage(chatId, 'Sonni to‘g‘ri kiriting.');
    db.run("INSERT INTO harakatlar (nom, tur, soni) VALUES (?, ?, ?)", [nom, 'chiqim', soni]);
    bot.sendMessage(chatId, `📤 ${nom} uchun ${soni} ta chiqim qilindi.`);
    session[chatId] = {};
  }
});

// Express server faqat Render uchun
const app = express();
app.get('/', (req, res) => res.send('Bot ishlayapti'));
app.listen(process.env.PORT || 3000);
