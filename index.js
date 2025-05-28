require('dotenv').config(); // agar .env fayl ishlatilsa, uni o'rnatish
const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const express = require('express');

const TOKEN = process.env.TOKEN || '7545031629:AAEVK_xtPKW35ZK7b-wrbdwwnV-1Fwred1A';
const bot = new TelegramBot(TOKEN, { polling: true });
const db = new sqlite3.Database('./ombor.db');

const session = {};
const ADMIN_IDS = [5809102043];  // Adminlar ro'yxati, keyinchalik bazaga o'tkazish mumkin

// Log yozish funksiyasi
function logWrite(message) {
  const time = new Date().toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' });
  fs.appendFileSync('log.txt', `[${time}] ${message}\n`);
}

// Asosiy menyu tugmalari
function getMainMenu(isAdmin) {
  const buttons = [
    [{ text: '➕ Mahsulot qo\'shish' }, { text: '📦 Mahsulotlar' }],
    [{ text: '📈 Statistika' }, { text: '📊 Qoldiq' }]
  ];
  if (isAdmin) buttons.push([{ text: '❌ Mahsulot o\'chirish' }]);
  return { reply_markup: { keyboard: buttons, resize_keyboard: true } };
}

// Inline mahsulot o'chirish tugmalari yaratish uchun
function getDeleteButtons(products) {
  // Inline tugmalar faqat id bilan ishlaydi, nomni bazadan olamiz callbackda
  return {
    reply_markup: {
      inline_keyboard: products.map(p => ([{ text: `❌ ${p.nom}`, callback_data: `delete_${p.id}` }]))
    }
  };
}

// /start buyrug'i
bot.onText(/\/start/, (msg) => {
  const isAdmin = ADMIN_IDS.includes(msg.from.id);
  bot.sendMessage(msg.chat.id, 'Ombor botiga xush kelibsiz!', getMainMenu(isAdmin));
});

// /admin buyrug'i (faqat mavjud adminlardan biri yangi admin qo'shishi mumkin)
bot.onText(/\/admin/, (msg) => {
  const userId = msg.from.id;
  if (!ADMIN_IDS.includes(userId)) {
    ADMIN_IDS.push(userId);
    bot.sendMessage(msg.chat.id, 'Siz admin sifatida qo‘shildingiz.');
    logWrite(`Admin qo‘shildi: ${userId}`);
  } else {
    bot.sendMessage(msg.chat.id, 'Siz allaqachon adminsiz.');
  }
});

// Bitta message handler hamma uchun
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const userId = msg.from.id;
  const isAdmin = ADMIN_IDS.includes(userId);

  if (!session[chatId]) session[chatId] = {};
  const s = session[chatId];

  // Agar botga faqat text xabar bo'lsa
  if (!text) return;

  // 1. Kirim/chiqim soni qabul qilish
  if (s.qadam === 'kirim_soni' || s.qadam === 'chiqim_soni') {
    const soni = parseInt(text);
    if (isNaN(soni)) return bot.sendMessage(chatId, 'Sonni to‘g‘ri kiriting.');
    const tur = s.qadam === 'kirim_soni' ? 'kirim' : 'chiqim';

    db.run("INSERT INTO harakatlar (nom, tur, soni) VALUES (?, ?, ?)", [s.nom, tur, soni], (err) => {
      if (err) {
        bot.sendMessage(chatId, 'Harakat qo‘shishda xatolik yuz berdi.');
        logWrite(`Xatolik: ${s.nom} uchun ${tur} qo‘shishda: ${err.message}`);
        return;
      }
      const replyMsg = tur === 'kirim' ? `✅ ${s.nom} uchun ${soni} ta kirim qilindi.` : `📤 ${s.nom} uchun ${soni} ta chiqim qilindi.`;
      bot.sendMessage(chatId, replyMsg, getMainMenu(isAdmin));
      session[chatId] = {};
    });
    return;
  }

  // 2. Yangi mahsulot qo'shish qadamlari
  if (s.qadam === 'nom') {
    s.nom = text.trim();
    if (!s.nom) return bot.sendMessage(chatId, 'Mahsulot nomini to‘g‘ri kiriting.');
    s.qadam = 'soni';
    return bot.sendMessage(chatId, 'Mahsulot sonini kiriting:');
  }

  if (s.qadam === 'soni') {
    const soni = parseInt(text);
    if (isNaN(soni)) return bot.sendMessage(chatId, 'Sonni to‘g‘ri kiriting.');
    // Mahsulot nomi takrorlanmasligi uchun tekshirish
    db.get("SELECT id FROM mahsulotlar WHERE nom = ?", [s.nom], (err, row) => {
      if (err) {
        bot.sendMessage(chatId, 'Bazaga ulanishda xatolik yuz berdi.');
        logWrite(`Bazaga ulanish xatoligi: ${err.message}`);
        return;
      }
      if (row) {
        // Mahsulot allaqachon mavjud, faqat kirim qo‘shamiz
        db.run("INSERT INTO harakatlar (nom, tur, soni) VALUES (?, 'kirim', ?)", [s.nom, soni], (err) => {
          if (err) {
            bot.sendMessage(chatId, 'Harakat qo‘shishda xatolik yuz berdi.');
            logWrite(`Harakat qo‘shishda xatolik: ${err.message}`);
            return;
          }
          bot.sendMessage(chatId, `${s.nom} mahsuloti mavjud, ${soni} ta kirim qo‘shildi.`, getMainMenu(isAdmin));
          session[chatId] = {};
        });
      } else {
        // Yangi mahsulot va kirim qo‘shish
        db.run("INSERT INTO mahsulotlar (nom) VALUES (?)", [s.nom], function (err) {
          if (err) {
            bot.sendMessage(chatId, 'Mahsulot qo‘shishda xatolik yuz berdi.');
            logWrite(`Mahsulot qo‘shishda xatolik: ${err.message}`);
            return;
          }
          db.run("INSERT INTO harakatlar (nom, tur, soni) VALUES (?, 'kirim', ?)", [s.nom, soni], (err) => {
            if (err) {
              bot.sendMessage(chatId, 'Harakat qo‘shishda xatolik yuz berdi.');
              logWrite(`Harakat qo‘shishda xatolik: ${err.message}`);
              return;
            }
            bot.sendMessage(chatId, `${s.nom} mahsuloti qo‘shildi (soni: ${soni}).`, getMainMenu(isAdmin));
            session[chatId] = {};
          });
        });
      }
    });
    return;
  }

  // 3. Menyulardagi tugmalar bo'yicha amallar
  switch (text) {
    case '➕ Mahsulot qo\'shish':
      session[chatId] = { qadam: 'nom' };
      return bot.sendMessage(chatId, 'Yangi mahsulot nomini kiriting:');

    case '📦 Mahsulotlar':
      db.all("SELECT nom FROM mahsulotlar", (err, rows) => {
        if (err || rows.length === 0) return bot.sendMessage(chatId, 'Mahsulotlar yo‘q.');
        const buttons = rows.map(r => [{ text: r.nom }]);
        buttons.push([{ text: '⬅️ Orqaga' }]);
        bot.sendMessage(chatId, 'Mahsulotlar ro‘yxati:', {
          reply_markup: { keyboard: buttons, resize_keyboard: true }
        });
      });
      return;

    case '📈 Statistika':
      db.all(`SELECT nom,
        SUM(CASE WHEN tur = 'kirim' THEN soni ELSE 0 END) AS kirim,
        SUM(CASE WHEN tur = 'chiqim' THEN soni ELSE 0 END) AS chiqim
        FROM harakatlar GROUP BY nom`, (err, rows) => {
        if (err || rows.length === 0) return bot.sendMessage(chatId, 'Statistika yo‘q.');
        let message = '📊 Statistika:\n';
        rows.forEach(r => {
          message += `\n${r.nom}\n  Kirim: ${r.kirim || 0}\n  Chiqim: ${r.chiqim || 0}`;
        });
        bot.sendMessage(chatId, message);
      });
      return;

    case '📊 Qoldiq':
      db.all(`SELECT nom, SUM(CASE WHEN tur = 'kirim' THEN soni ELSE -soni END) AS qoldiq
        FROM harakatlar GROUP BY nom`, (err, rows) => {
        if (err || rows.length === 0) return bot.sendMessage(chatId, 'Qoldiq yo‘q.');
        let message = '📦 Qoldiq:\n';
        rows.forEach(r => {
          message += `\n${r.nom}: ${r.qoldiq || 0}`;
        });
        bot.sendMessage(chatId, message);
      });
      return;

    case '❌ Mahsulot o\'chirish':
      if (!isAdmin) return bot.sendMessage(chatId, 'Sizda bu amalni bajarish huquqi yo‘q.');
      db.all("SELECT id, nom FROM mahsulotlar", (err, rows) => {
        if (err || rows.length === 0) return bot.sendMessage(chatId, 'Mahsulotlar yo‘q.');
        bot.sendMessage(chatId, 'O‘chirmoqchi bo‘lgan mahsulotni tanlang:', getDeleteButtons(rows));
      });
      return;

    case '⬅️ Orqaga':
      return bot.sendMessage(chatId, 'Asosiy menyu', getMainMenu(isAdmin));
  }

  // 4. Mahsulot nomi bosilganda amal tanlash uchun
  db.get("SELECT * FROM mahsulotlar WHERE nom = ?", [text], (err, row) => {
    if (err) {
      bot.sendMessage(chatId, 'Xatolik yuz berdi.');
      logWrite(`Bazadan mahsulot olishda xatolik: ${err.message}`);
      return;
    }
    if (!row) return; // Bunday mahsulot yo‘q, hech narsa qilmaymiz

    // Agar allaqachon amal tanlash bosqichida bo'lsa, takror bosilsa oldingi sessionni o'chiramiz
    session[chatId] = { nom: text, qadam: 'amal_tanlash' };

    bot.sendMessage(chatId, `${text} mahsuloti uchun amalni tanlang:`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '➕ Kirim', callback_data: `kirim_${row.nom}` },
            { text: '➖ Chiqim', callback_data: `chiqim_${row.nom}` }
          ]
        ]
      }
    });
  });

});

// Callback query handler
bot.on('callback_query', (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const userId = callbackQuery.from.id;
  const isAdmin = ADMIN_IDS.includes(userId);

  if (data.startsWith('kirim_')) {
    const nom = data.slice(6);
    session[chatId] = { nom, qadam: 'kirim_soni' };
    bot.sendMessage(chatId, `${nom} uchun kirim sonini kiriting:`);
    bot.answerCallbackQuery(callbackQuery.id);
    return;
  }

  if (data.startsWith('chiqim_')) {
    const nom = data.slice(7);
    session[chatId] = { nom, qadam: 'chiqim_soni' };
    bot.sendMessage(chatId, `${nom} uchun chiqim sonini kiriting:`);
    bot.answerCallbackQuery(callbackQuery.id);
    return;
  }

  if (data.startsWith('delete_')) {
    if (!isAdmin) {
      bot.answerCallbackQuery(callbackQuery.id, { text: 'Sizda bu amalni bajarish huquqi yo‘q.', show_alert: true });
      return;
    }
    const id = parseInt(data.slice(7));
    if (isNaN(id)) {
      bot.answerCallbackQuery(callbackQuery.id, { text: 'Noto‘g‘ri mahsulot ID.', show_alert: true });
      return;
    }

    // Mahsulotni o'chirish: mahsulotlar va harakatlardan
    db.run("DELETE FROM mahsulotlar WHERE id = ?", [id], (err) => {
      if (err) {
        bot.answerCallbackQuery(callbackQuery.id, { text: 'Mahsulot o‘chirishda xatolik.', show_alert: true });
        logWrite(`Mahsulot o‘chirishda xatolik: ${err.message}`);
        return;
      }
      db.run("DELETE FROM harakatlar WHERE nom = (SELECT nom FROM mahsulotlar WHERE id = ?)", [id], (err) => {
        // Bu yerda hech qanaqa xatolik bo‘lsa ham davom etamiz
      });
      bot.answerCallbackQuery(callbackQuery.id, { text: 'Mahsulot o‘chirildi.' });
      bot.sendMessage(chatId, 'Mahsulot o‘chirildi.', getMainMenu(isAdmin));
    });
    return;
  }
});
