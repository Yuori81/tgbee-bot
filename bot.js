const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const TOKEN = process.env.BOT_TOKEN || '8617784860:AAEhLMbs5v9Or1l4zUpYT016xPCPuNnTWaA';
const ADMIN_ID = 7852111017;
const TGSTAT_TOKEN = '97bdcc340e3769bd70caea8f8dc6a0ef';

const bot = new TelegramBot(TOKEN, { polling: true });
console.log('🐝 TG Bee запущен (с TGStat API)...');

process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled rejection:', reason?.message || reason);
});

bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

// ═══════════ УТИЛИТЫ ═══════════

function esc(text) {
  if (!text) return '—';
  return text.toString().replace(/[*_`[\]]/g, '\\$&');
}

function formatNum(n) {
  if (!n || n === 0) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toString();
}

function formatER(er) {
  if (!er || er === 0) return '—';
  return (er * 100).toFixed(1) + '%';
}

function cleanChannel(input) {
  if (!input) return '';
  let clean = input.trim();
  clean = clean.replace(/^https?:\/\/(t\.me|telegram\.me)\//i, '');
  clean = clean.replace(/^@/, '');
  clean = clean.split(' ')[0];
  return clean;
}

// ═══════════ TGStat API ═══════════

async function getChannelStats(channelInput) {
  const channel = cleanChannel(channelInput);
  if (!channel) return null;

  let ch = null;
  let channelId = null;

  try {
    const getRes = await axios.get('https://api.tgstat.ru/channels/get', {
      params: { token: TGSTAT_TOKEN, channelId: `@${channel}` }
    });
    ch = getRes.data?.response;
    channelId = ch?.id;
  } catch (e) {
    console.log('channels/get не нашёл, пробуем поиск...', e.message);
  }

  if (!ch) {
    try {
      const searchRes = await axios.get('https://api.tgstat.ru/channels/search', {
        params: { token: TGSTAT_TOKEN, q: channel, limit: 1 }
      });
      const items = searchRes.data?.response?.items;
      if (!items || items.length === 0) return null;
      ch = items[0];
      channelId = ch.id;
    } catch (e) {
      console.error('TGStat search error:', e.message);
      return null;
    }
  }

  if (!ch) return null;

  let stat = null;
  try {
    const statRes = await axios.get('https://api.tgstat.ru/channels/stat', {
      params: { token: TGSTAT_TOKEN, channelId: channelId }
    });
    stat = statRes.data?.response;
  } catch (e) {
    console.log('TGStat stat error (не критично):', e.message);
  }

  const cleanUsername = (ch.username || channel).replace(/^@/, '');
  const participants = ch.participants_count || 0;
  const avgPostReach = ch.avg_post_reach || stat?.avg_post_reach || 0;

  // Если TGStat не дал ER — считаем сами
  let er = ch.er || stat?.er || 0;
  if ((!er || er === 0) && participants > 0 && avgPostReach > 0) {
    er = avgPostReach / participants;
  }

  return {
    title: ch.title || channel,
    username: cleanUsername,
    participants: participants,
    avgPostReach: avgPostReach,
    er: er,
    er24: stat?.er24 || null,
    ciIndex: ch.ci_index || null,
    dailyReach: stat?.daily_reach || null,
    category: ch.category || '—',
    tgstatUrl: `https://tgstat.ru/channel/@${cleanUsername}`,
  };
}

// ═══════════ ВОПРОСЫ АНКЕТЫ ═══════════

const QUESTIONS = [
  {
    id: 'channel',
    text: '📋 *Шаг 1 из 6*\n\nВведите ссылку на ваш канал:\n\n_Например: @mychannel или https://t.me/mychannel_',
    type: 'text'
  },
  {
    id: 'who',
    text: '👤 *Шаг 2 из 6*\n\nКто вы?',
    type: 'buttons',
    options: [
      '🧠 Психолог / коуч / эксперт',
      '🏪 Малый бизнес / услуги',
      '🎓 Инфопродукты / курсы',
      '📰 Новостной / развлекательный',
      '🔹 Другое'
    ]
  },
  {
    id: 'income',
    text: '💰 *Шаг 3 из 6*\n\nДоход в месяц?',
    type: 'buttons',
    options: [
      'До 50 000 ₽',
      '50 000 – 150 000 ₽',
      '150 000 – 300 000 ₽',
      '300 000+ ₽'
    ]
  },
  {
    id: 'budget',
    text: '📈 *Шаг 4 из 6*\n\nБюджет на рост (в месяц)?',
    type: 'buttons',
    options: [
      'Не готов вкладывать',
      'До 20 000 ₽/мес',
      '20 000 – 50 000 ₽/мес',
      '50 000+ ₽/мес'
    ]
  },
  {
    id: 'tried',
    text: '🔍 *Шаг 5 из 6*\n\nЧто уже пробовали? (можно несколько)\n\n_Нажимайте на варианты, затем «Готово»_',
    type: 'multi',
    options: [
      'Взаимный пиар / каталоги',
      'Реклама VK / Дзен / Instagram',
      'Только контент',
      'Практически ничего'
    ]
  },
  {
    id: 'pain',
    text: '💬 *Шаг 6 из 6*\n\nОпишите главную проблему в 1–3 предложениях:\n\n_Например: есть подписчики, но никто не покупает_',
    type: 'text'
  }
];

// ═══════════ СЕССИИ ═══════════

const sessions = {};

function getSession(chatId) {
  if (!sessions[chatId]) {
    sessions[chatId] = { step: 0, answers: {}, multiSelected: [] };
  }
  return sessions[chatId];
}

function resetSession(chatId) {
  sessions[chatId] = { step: 0, answers: {}, multiSelected: [] };
}

// ═══════════ ПОКАЗАТЬ ВОПРОС ═══════════

async function showQuestion(chatId, step, messageId = null) {
  const session = getSession(chatId);
  const question = QUESTIONS[step];
  const isFirst = step === 0;

  let keyboard = [];

  if (question.type === 'buttons') {
    question.options.forEach(opt => {
      keyboard.push([{ text: opt, callback_data: `answer_${opt}` }]);
    });
    const navRow = [];
    if (!isFirst) navRow.push({ text: '← Назад', callback_data: 'nav_back' });
    if (navRow.length > 0) keyboard.push(navRow);

  } else if (question.type === 'multi') {
    const selected = session.multiSelected || [];
    question.options.forEach(opt => {
      const isSelected = selected.includes(opt);
      keyboard.push([{
        text: isSelected ? `✅ ${opt}` : opt,
        callback_data: `multi_${opt}`
      }]);
    });
    const navRow = [];
    if (!isFirst) navRow.push({ text: '← Назад', callback_data: 'nav_back' });
    if (selected.length > 0) navRow.push({ text: 'Готово →', callback_data: 'multi_done' });
    if (navRow.length > 0) keyboard.push(navRow);

  } else if (question.type === 'text') {
    if (!isFirst) {
      keyboard.push([{ text: '← Назад', callback_data: 'nav_back' }]);
    }
  }

  const opts = {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  };

  if (messageId) {
    try {
      await bot.editMessageText(question.text, {
        chat_id: chatId,
        message_id: messageId,
        ...opts
      });
    } catch (e) {
      await bot.sendMessage(chatId, question.text, opts);
    }
  } else {
    await bot.sendMessage(chatId, question.text, opts);
  }
}

// ═══════════ ОТПРАВИТЬ ЗАЯВКУ АДМИНУ ═══════════

async function sendToAdmin(chatId, answers, username) {
  try {
    const user = username ? `@${esc(username)}` : `ID: ${chatId}`;

    const text =
      `🐝 *Новая заявка — TG Bee*\n\n` +
      `👤 Пользователь: ${user}\n` +
      `🔗 Канал: ${esc(answers.channel)}\n` +
      `👥 Кто: ${esc(answers.who)}\n` +
      `💰 Доход: ${esc(answers.income)}\n` +
      `📈 Бюджет: ${esc(answers.budget)}\n` +
      `🔍 Пробовали: ${esc(answers.tried)}\n\n` +
      `💬 *Главная боль:*\n${esc(answers.pain)}`;

    await bot.sendMessage(ADMIN_ID, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '💬 Написать пользователю', url: `tg://user?id=${chatId}` }
        ]]
      }
    });

    if (answers.channel) {
      const stats = await getChannelStats(answers.channel);

      if (stats) {
        const statsText =
          `📊 *Метрики канала — TGStat*\n\n` +
          `📢 *${esc(stats.title)}*\n` +
          `@${esc(stats.username)}\n\n` +
          `👥 Подписчики: *${formatNum(stats.participants)}*\n` +
          `👁 Охват поста: *${formatNum(stats.avgPostReach)}*\n` +
          `📈 ER: *${formatER(stats.er)}*\n` +
          (stats.er24 ? `📈 ER24: *${formatER(stats.er24)}*\n` : '') +
          (stats.ciIndex ? `🏆 Индекс цитирования: *${stats.ciIndex}*\n` : '') +
          `📂 Категория: ${esc(stats.category)}\n\n` +
          `🔗 [Открыть в TGStat](${stats.tgstatUrl})`;

        await bot.sendMessage(ADMIN_ID, statsText, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [
              [{ text: '📊 Открыть в TGStat', url: stats.tgstatUrl }],
              [{ text: '💬 Написать пользователю', url: `tg://user?id=${chatId}` }]
            ]
          }
        });
      } else {
        await bot.sendMessage(ADMIN_ID,
          `⚠️ Не удалось найти канал *${esc(answers.channel)}* в TGStat.\n\nВозможно неправильный username или канал слишком маленький.`,
          { parse_mode: 'Markdown' }
        );
      }
    }
  } catch (error) {
    console.error('❌ Ошибка sendToAdmin:', error.message);
  }
}

// ═══════════ /start ═══════════

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from.first_name;
  resetSession(chatId);

  await bot.sendMessage(chatId,
    `Привет, ${esc(name)}! 👋\n\n` +
    `Я помогу *бесплатно* разобрать твой Telegram-канал —\n` +
    `найдём почему нет заявок и как это исправить.\n\n` +
    `Займёт 2 минуты. Начнём? 👇`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '🚀 Начать разбор', callback_data: 'start_survey' }
        ]]
      }
    }
  );
});

// ═══════════ ОБРАБОТКА КНОПОК ═══════════

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;
  const session = getSession(chatId);

  try {
    await bot.answerCallbackQuery(query.id);
  } catch (e) {
    // callback устарел — игнорируем
  }

  if (data === 'start_survey') {
    session.step = 0;
    await showQuestion(chatId, 0, messageId);
    return;
  }

  if (data === 'nav_back') {
    if (session.step > 0) {
      session.step -= 1;
      if (QUESTIONS[session.step].type === 'multi') {
        const saved = session.answers[QUESTIONS[session.step].id];
        session.multiSelected = saved ? saved.split(', ') : [];
      }
      await showQuestion(chatId, session.step, messageId);
    }
    return;
  }

  if (data.startsWith('multi_') && data !== 'multi_done') {
    const value = data.replace('multi_', '');
    if (!session.multiSelected) session.multiSelected = [];
    if (session.multiSelected.includes(value)) {
      session.multiSelected = session.multiSelected.filter(v => v !== value);
    } else {
      session.multiSelected.push(value);
    }
    await showQuestion(chatId, session.step, messageId);
    return;
  }

  if (data === 'multi_done') {
    const question = QUESTIONS[session.step];
    session.answers[question.id] = session.multiSelected.join(', ');
    session.step += 1;
    session.multiSelected = [];
    await showQuestion(chatId, session.step, messageId);
    return;
  }

  if (data.startsWith('answer_')) {
    const value = data.replace('answer_', '');
    const question = QUESTIONS[session.step];
    session.answers[question.id] = value;
    session.step += 1;

    if (session.step >= QUESTIONS.length) {
      try {
        await bot.editMessageText(
          '✅ *Заявка отправлена!*\n\n' +
          'Мы посмотрим ваш канал и напишем в личку в течение *1–2 рабочих дней*.\n\n' +
          '_Если не подойдёте для полноформатной работы — честно скажем и дадим рекомендации бесплатно._',
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
          }
        );
      } catch (e) {
        await bot.sendMessage(chatId,
          '✅ *Заявка отправлена!*\n\nНапишем в течение 1–2 рабочих дней.',
          { parse_mode: 'Markdown' }
        );
      }
      await sendToAdmin(chatId, session.answers, query.from.username);
      resetSession(chatId);
    } else {
      await showQuestion(chatId, session.step, messageId);
    }
    return;
  }
});

// ═══════════ ТЕКСТОВЫЕ ОТВЕТЫ ═══════════

bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;

  const chatId = msg.chat.id;
  const session = getSession(chatId);
  const question = QUESTIONS[session.step];

  if (!question || question.type !== 'text') return;

  session.answers[question.id] = msg.text;
  session.step += 1;

  if (session.step >= QUESTIONS.length) {
    await bot.sendMessage(chatId,
      '✅ *Заявка отправлена!*\n\n' +
      'Мы посмотрим ваш канал и напишем в личку в течение *1–2 рабочих дней*.\n\n' +
      '_Если не подойдёте для полноформатной работы — честно скажем и дадим рекомендации бесплатно._',
      { parse_mode: 'Markdown' }
    );
    await sendToAdmin(chatId, session.answers, msg.from.username);
    resetSession(chatId);
  } else {
    await showQuestion(chatId, session.step);
  }
});
