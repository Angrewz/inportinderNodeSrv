const Fastify = require('fastify');
const { Kysely, PostgresDialect } = require('kysely');
const { Pool } = require('pg');
require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');

// Инициализация Fastify
const fastify = Fastify({
  logger: true,
});

// Настройка подключения к базе данных PostgreSQL через стандартный клиент pg
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Настройка Kysely с использованием PostgresDialect
const db = new Kysely({
  dialect: new PostgresDialect({
    pool: pool,
  }),
});

// Функция отправки сообщения в Telegram
async function sendTelegramMessage(userId, message) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  try {
    await axios.post(url, {
      chat_id: userId,
      text: message,
    });
  } catch (error) {
    console.error('Error sending message:', error);
  }
}

// Функция проверки аутентификации Telegram
function checkTelegramAuth(authData, botToken) {
  const checkString = Object.keys(authData)
    .filter((key) => key !== 'hash')
    .sort()
    .map((key) => `${key}=${authData[key]}`)
    .join('\n');

  const secret = crypto.createHmac('sha256', botToken).digest();
  const hash = crypto.createHmac('sha256', secret).update(checkString).digest('hex');

  return hash === authData.hash;
}

// Маршрут для добавления новой записи в таблицу
fastify.post('/submit', async (request, reply) => {
  const { request_type, country, currency, amount, bank, goods, features, auth_date, hash } = request.body;

  // Получаем initData из фронтенда
  const authData = { auth_date, hash };
  const botToken = process.env.TELEGRAM_BOT_TOKEN; // Токен вашего бота

  // if (!checkTelegramAuth(authData, botToken)) {
  //   return reply.status(403).send({ success: false, message: 'Verification failed' });
  // }

  try {
    const newTransaction = await db
      .insertInto('requests')
      .values({
        request_type,
        country,
        currency,
        amount,
        bank,
        goods,
        features,
      })
      .returning('id')
      .executeTakeFirst();

    reply.send({ success: true, id: newTransaction.id });

    // Отправляем данные обратно пользователю через Telegram
    const message = `Ваша заявка была отправлена:\nТип запроса: ${request_type}\nСтрана: ${JSON.stringify(country)}\nВалюта: ${currency}\nСумма: ${amount}\nБанк: ${bank}\nТовар: ${goods}\nОсобенности: ${features}`;
    await sendTelegramMessage(request.body.user_id, message);
  } catch (err) {
    fastify.log.error(err);
    reply.status(500).send({ error: 'Ошибка при сохранении данных' });
  }
});

// Получения записи по конкретному ID
fastify.get('/request/:id', async (request, reply) => {
  const { id } = request.params;

  try {
    const request_full = await db
      .selectFrom('requests')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!request_full) {
      return reply.status(404).send({ error: 'Запись не найдена' });
    }

    const { creator, ...request_filtered } = request_full; // Скрываем некоторые данные от фронта
    
    reply.send(request_filtered);
  } catch (err) {
    fastify.log.error(err);
    reply.status(500).send({ error: 'Ошибка при получении данных' });
  }
});

// Получения всех записей из таблицы requests
fastify.get('/requests', async (request, reply) => {
  try {
    const requests_full = await db
      .selectFrom('requests')
      .selectAll() 
      .execute();

    const requests_filtered = requests_full.map(({ creator, ...rest }) => rest); // Скрываем некоторые данные от фронта
    
    reply.send(requests_filtered);
  } catch (err) {
    fastify.log.error(err);
    reply.status(500).send({ error: 'Ошибка при получении данных' });
  }
});


// Запуск сервера
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    fastify.log.info('Сервер запущен на http://localhost:3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
