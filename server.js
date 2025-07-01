const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Состояние игры
let gameState = {
  robots: {
    blue1: { connected: false, player: null, battery: 87, lastSeen: 0 },
    blue2: { connected: false, player: null, battery: 91, lastSeen: 0 },
    red1: { connected: false, player: null, battery: 83, lastSeen: 0 },
    red2: { connected: false, player: null, battery: 95, lastSeen: 0 }
  },
  players: new Map(),
  viewers: 0,
  score: { blue: 0, red: 0 }
};

// Отдаем статические файлы
app.use(express.static('public'));
app.use(express.json());

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebSocket соединения
io.on('connection', (socket) => {
  console.log('Новое соединение:', socket.id);
  
  socket.on('selectRobot', (data) => {
    console.log('Выбор робота:', data.robotId);
  });
  
  socket.on('robotCommand', (data) => {
    console.log('Команда роботу:', data.command);
  });
  
  socket.on('disconnect', () => {
    console.log('Отключение:', socket.id);
  });
});

// Запуск сервера
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});