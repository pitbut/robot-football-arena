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
    blue1: { connected: false, player: null, battery: 87, lastSeen: 0, lastCommand: null, ip: null },
    blue2: { connected: false, player: null, battery: 91, lastSeen: 0, lastCommand: null, ip: null },
    red1: { connected: false, player: null, battery: 83, lastSeen: 0, lastCommand: null, ip: null },
    red2: { connected: false, player: null, battery: 95, lastSeen: 0, lastCommand: null, ip: null }
  },
  players: new Map(),
  viewers: 0,
  score: { blue: 0, red: 0 },
  // Очередь команд для каждого робота
  commandQueues: {
    blue1: [],
    blue2: [],
    red1: [],
    red2: []
  }
};

// Отдаем статические файлы
app.use(express.static('public'));
app.use(express.json());

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===========================================
// API МАРШРУТЫ ДЛЯ РОБОТОВ
// ===========================================

// Регистрация робота
app.post('/api/robot/register', (req, res) => {
  const { robotId, battery, version, ip } = req.body;
  
  if (!gameState.robots[robotId]) {
    return res.status(400).json({ error: 'Неверный ID робота' });
  }
  
  gameState.robots[robotId].connected = true;
  gameState.robots[robotId].battery = battery || 85;
  gameState.robots[robotId].lastSeen = Date.now();
  gameState.robots[robotId].ip = ip;
  
  console.log(`🤖 Робот ${robotId} зарегистрирован (IP: ${ip})`);
  
  // Уведомляем всех клиентов
  io.emit('robotConnected', { robotId, timestamp: Date.now() });
  
  res.json({ 
    status: 'registered', 
    robotId, 
    server_time: Date.now(),
    commands_endpoint: `/api/robot/commands/${robotId}`
  });
});

// Получение команд для робота
app.get('/api/robot/commands/:robotId', (req, res) => {
  const robotId = req.params.robotId;
  
  if (!gameState.robots[robotId]) {
    return res.status(404).json({ error: 'Робот не найден' });
  }
  
  // Обновляем время последней активности
  gameState.robots[robotId].lastSeen = Date.now();
  
  // Получаем команду из очереди
  const commands = gameState.commandQueues[robotId];
  
  if (commands.length > 0) {
    const command = commands.shift(); // Берем первую команду
    gameState.robots[robotId].lastCommand = command;
    
    console.log(`📤 Отправляем команду ${command.command} роботу ${robotId}`);
    
    res.json(command);
  } else {
    // Нет команд - возвращаем 204 No Content
    res.status(204).send();
  }
});

// Отправка телеметрии от робота
app.post('/api/robot/telemetry', (req, res) => {
  const { robotId, batteryLevel, wifiStrength, uptime, freeHeap, currentCommand } = req.body;
  
  if (!gameState.robots[robotId]) {
    return res.status(404).json({ error: 'Робот не найден' });
  }
  
  // Обновляем данные робота
  gameState.robots[robotId].battery = batteryLevel;
  gameState.robots[robotId].lastSeen = Date.now();
  
  console.log(`📊 Телеметрия от ${robotId}: батарея ${batteryLevel}%, wifi ${wifiStrength}dBm`);
  
  // Отправляем обновления клиентам
  io.emit('robotTelemetry', {
    robotId,
    battery: batteryLevel,
    wifiStrength,
    uptime,
    freeHeap,
    timestamp: Date.now()
  });
  
  res.json({ status: 'received' });
});

// Подтверждение выполнения команды
app.post('/api/robot/ack', (req, res) => {
  const { robotId, command, timestamp, status } = req.body;
  
  console.log(`✅ Робот ${robotId} выполнил команду: ${command}`);
  
  // Уведомляем клиентов
  io.emit('commandExecuted', {
    robotId,
    command,
    status,
    timestamp: Date.now()
  });
  
  res.json({ status: 'acknowledged' });
});

// Получение статуса всех роботов
app.get('/api/robots/status', (req, res) => {
  const robotsStatus = {};
  
  Object.keys(gameState.robots).forEach(robotId => {
    const robot = gameState.robots[robotId];
    robotsStatus[robotId] = {
      connected: robot.connected,
      battery: robot.battery,
      lastSeen: robot.lastSeen,
      hasPlayer: !!robot.player,
      lastCommand: robot.lastCommand,
      queueLength: gameState.commandQueues[robotId].length
    };
  });
  
  res.json({
    robots: robotsStatus,
    gameState: {
      score: gameState.score,
      playersCount: gameState.players.size,
      viewers: gameState.viewers
    },
    timestamp: Date.now()
  });
});

// Добавление команды в очередь робота (используется веб-интерфейсом)
app.post('/api/robot/command', (req, res) => {
  const { robotId, command, speed = 200, playerId } = req.body;
  
  if (!gameState.robots[robotId]) {
    return res.status(404).json({ error: 'Робот не найден' });
  }
  
  if (!gameState.robots[robotId].connected) {
    return res.status(503).json({ error: 'Робот не подключен' });
  }
  
  // Создаем команду
  const commandObj = {
    command,
    speed,
    timestamp: Date.now(),
    playerId
  };
  
  // Добавляем в очередь
  gameState.commandQueues[robotId].push(commandObj);
  
  // Ограничиваем размер очереди
  if (gameState.commandQueues[robotId].length > 10) {
    gameState.commandQueues[robotId].shift();
  }
  
  console.log(`🎮 Команда ${command} добавлена в очередь робота ${robotId}`);
  
  res.json({ 
    status: 'queued', 
    queueLength: gameState.commandQueues[robotId].length,
    command: commandObj
  });
});

// ===========================================
// WEBSOCKET СОЕДИНЕНИЯ (для веб-клиентов)
// ===========================================

io.on('connection', (socket) => {
  console.log('🔌 Новое соединение:', socket.id);
  
  // Отправляем текущее состояние
  socket.emit('gameState', getPublicGameState());
  
  // Выбор робота игроком
  socket.on('selectRobot', (data) => {
    handleRobotSelection(socket, data);
  });
  
  // Команда роботу от игрока
  socket.on('robotCommand', (data) => {
    handleRobotCommandFromPlayer(socket, data);
  });
  
  // Регистрация игрока
  socket.on('playerJoin', (data) => {
    const playerName = data.playerName || `Игрок${Math.floor(Math.random() * 1000)}`;
    
    gameState.players.set(socket.id, {
      name: playerName,
      robotId: null,
      joinTime: Date.now(),
      commandsSent: 0
    });
    
    socket.emit('playerRegistered', { 
      playerId: socket.id, 
      playerName: playerName 
    });
    
    console.log(`👤 Игрок ${playerName} присоединился`);
  });
  
  // Отключение
  socket.on('disconnect', () => {
    handlePlayerDisconnection(socket);
  });
});

function handleRobotSelection(socket, data) {
  const robotId = data.robotId;
  const robot = gameState.robots[robotId];
  
  if (!robot) {
    socket.emit('error', { message: 'Неверный ID робота' });
    return;
  }
  
  if (!robot.connected) {
    socket.emit('error', { message: 'Робот не подключен' });
    return;
  }
  
  if (robot.player && robot.player !== socket.id) {
    socket.emit('error', { message: 'Робот занят другим игроком' });
    return;
  }
  
  const player = gameState.players.get(socket.id);
  if (!player) {
    socket.emit('error', { message: 'Сначала зарегистрируйтесь как игрок' });
    return;
  }
  
  // Освобождаем предыдущий робот
  if (player.robotId) {
    const prevRobot = gameState.robots[player.robotId];
    if (prevRobot) {
      prevRobot.player = null;
    }
  }
  
  // Назначаем нового робота
  robot.player = socket.id;
  player.robotId = robotId;
  
  console.log(`🎯 ${player.name} выбрал робота ${robotId}`);
  
  socket.emit('robotSelected', { robotId, success: true });
  io.emit('gameState', getPublicGameState());
}

function handleRobotCommandFromPlayer(socket, data) {
  const player = gameState.players.get(socket.id);
  
  if (!player || !player.robotId) {
    socket.emit('error', { message: 'Сначала выберите робота' });
    return;
  }
  
  const robot = gameState.robots[player.robotId];
  if (!robot || !robot.connected) {
    socket.emit('error', { message: 'Робот недоступен' });
    return;
  }
  
  // Ограничение на частоту команд
  const now = Date.now();
  if (player.lastCommand && now - player.lastCommand < 50) {
    return;
  }
  player.lastCommand = now;
  
  // Добавляем команду в очередь робота
  const commandObj = {
    command: data.command,
    speed: data.speed || 200,
    timestamp: now,
    playerId: socket.id
  };
  
  gameState.commandQueues[player.robotId].push(commandObj);
  
  // Ограничиваем размер очереди
  if (gameState.commandQueues[player.robotId].length > 5) {
    gameState.commandQueues[player.robotId].shift();
  }
  
  player.commandsSent++;
  
  console.log(`🎮 ${data.command} → ${player.robotId} (${player.name})`);
  
  socket.emit('commandQueued', {
    command: data.command,
    robotId: player.robotId,
    queueLength: gameState.commandQueues[player.robotId].length,
    timestamp: now
  });
}

function handlePlayerDisconnection(socket) {
  const player = gameState.players.get(socket.id);
  
  if (player) {
    // Освобождаем робота
    if (player.robotId) {
      const robot = gameState.robots[player.robotId];
      if (robot) {
        robot.player = null;
      }
    }
    
    gameState.players.delete(socket.id);
    console.log(`👤❌ Игрок ${player.name} отключился`);
  }
  
  io.emit('gameState', getPublicGameState());
}

function getPublicGameState() {
  const publicRobots = {};
  
  Object.keys(gameState.robots).forEach(robotId => {
    const robot = gameState.robots[robotId];
    publicRobots[robotId] = {
      connected: robot.connected,
      hasPlayer: !!robot.player,
      battery: robot.battery,
      lastSeen: robot.lastSeen,
      lastCommand: robot.lastCommand
    };
  });
  
  return {
    robots: publicRobots,
    playersCount: gameState.players.size,
    viewersCount: gameState.viewers,
    score: gameState.score,
    timestamp: Date.now()
  };
}

// Периодическая очистка неактивных роботов
setInterval(() => {
  const now = Date.now();
  const timeoutThreshold = 60000; // 1 минута
  
  Object.keys(gameState.robots).forEach(robotId => {
    const robot = gameState.robots[robotId];
    if (robot.connected && robot.lastSeen && now - robot.lastSeen > timeoutThreshold) {
      console.log(`⏰ Робот ${robotId} не отвечает, отключаем...`);
      robot.connected = false;
      robot.player = null;
      
      // Очищаем очередь команд
      gameState.commandQueues[robotId] = [];
      
      io.emit('robotDisconnected', { robotId, reason: 'timeout' });
    }
  });
}, 30000);

// Запуск сервера
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`🤖 API для роботов доступно на /api/robot/*`);
  console.log(`📱 Веб-интерфейс доступен на /`);
});
