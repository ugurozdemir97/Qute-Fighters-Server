const { deepEqual } = require('assert');
const dgram = require('dgram');
const server = dgram.createSocket('udp4');

const PORT = 3000;
const HOST = "127.0.0.1";
const sessions = {};
const rooms = {};

// If there is an error close server
server.on('error', (err) => {
  console.error(`Server error:\n${err.stack}`); 
  server.close();
});

server.on('message', (msg, rinfo) => {
  const message = JSON.parse(msg.toString());

  // If the user is already connected
  if (sessions[message.id]) {
    switch (message.type) {
      case 0:  // In game key inputs. It's the first one because it should be fast
        sendInput(message);
        break;
      case 1:  // Chatting
        sendMessage(message);
        break;
      case 2:  // Create room
        server.send(createRoom(message), rinfo.port, rinfo.address);
        break;
      case 3:  // Join room
        if (rooms[message.room]) server.send(joinRoom(message), rinfo.port, rinfo.address);
        break;
      case 4:  // Exit room
        if (message.room == 0) return;
        if (!rooms[message.room]) return;
        server.send(exitRoom(message), rinfo.port, rinfo.address);
        break;
      case 5:  // Join game
        joinGame(message)
        break;
      case 6:  // Leave game
        leaveGame(message)
        break;
      case 7:
        server.send(changeUsername(message), rinfo.port, rinfo.address);
        break;
      case 8:
        server.send(disconnectUser(message), rinfo.port, rinfo.address);
        break;
      case 9:  // Character select or deselect
        characterChange(message);
        break;
      case 10:
        roleChange(message); 
        break;
      case 11:
        gameIsStarted(message);
        break;
      default:
        break;
    }
  // If the user is not connected, connect and inform the user 
  } else {
    server.send(connectUser(message, rinfo), rinfo.port, rinfo.address);
  }

  //console.log(sessions);
  //console.log(rooms);

});

// The server is listening to the adress
server.on('listening', () => {
  console.log(`Server listening\n${HOST}:${PORT}`);
}); 

server.bind(PORT, HOST);  // Run server

// ************************************* FUNCTIONS ***************************************** //

// Disconnect users from the server
function disconnectUser(message) {
  exitRoom(message);
  delete sessions[message.id];
  return JSON.stringify({type:8});
}

// Connect users to the server
function connectUser(message, rinfo) {
  sessions[message.id] = {ip: rinfo.address, port: rinfo.port, username: message.username, character: null};
  return JSON.stringify({type: 9});
}

// Change username
function changeUsername(message) {
  sessions[message.id].username = message.username;
  return JSON.stringify({type: 7});
}

// Create room
function createRoom(message) {
  let room;
  do {room = Math.floor(100000 + Math.random() * 900000).toString(); // Create random 6 digit number
  } while (rooms[room])  // If a room like this already exist, try another number

  // Add the room to the rooms and add the user to the room
  rooms[room] = {   
    players: [sessions[message.id]],
    spectators: [],
    state1: [],  // Temporary game state comes from one player
    state2: [],  // Temporary game state comes from the other player
    rollBack: {} // Confirmed game state
  }

  return JSON.stringify({room: Number(room), type: 3});
}

function joinRoom(message) {
  if (rooms[message.room].players.length <= 1) {  // If we are a player, remove us from players

    rooms[message.room].players.push(sessions[message.id])
    return JSON.stringify({room: Number(message.room), player: rooms[message.room].players.indexOf(sessions[message.id]), type: 4});

  } else {
    rooms[message.room].spectators.push(sessions[message.id]);
    return JSON.stringify({room: Number(message.room), player: -1, type: 4});
  }
  
}

// Exit room
function exitRoom(message) {

  if (message.room == 0) return;
  if (!rooms[message.room]) return;

  // If there is only one player in the room, delete room
  if (rooms[message.room].players.length + rooms[message.room].spectators.length == 1) {  
    delete rooms[message.room];
  } else {

    let index;
    index = rooms[message.room].players.indexOf(sessions[message.id]);

    if (index == -1) {  // If we are a spectator, remove us from spectators

      index = rooms[message.room].spectators.indexOf(sessions[message.id]);
      rooms[message.room].spectators.splice(index, 1);

    } else {  // If we are a player, remove us from players

      rooms[message.room].players.splice(index, 1);
      roleChange(message);

    }

  }

  return JSON.stringify({type: 5});  // Send the information about exitting the room successfully
}

// Join the game from spectators
function joinGame(message) {

  let index;
  index = rooms[message.room].spectators.indexOf(sessions[message.id]);

  if (index != -1 && rooms[message.room].players.length <= 1) {  // If we are a spectator and there are less than 2 players

    rooms[message.room].players.push(sessions[message.id])
    rooms[message.room].spectators.splice(index, 1);
    roleChange(message);
  } 
}

// Leave the player status and be a spectater
function leaveGame(message) {

  let index;
  index = rooms[message.room].players.indexOf(sessions[message.id]);

  if (index != -1) {  // If we are a player, remove us from players

    rooms[message.room].players.splice(index, 1);
    rooms[message.room].spectators.push(sessions[message.id])
    roleChange(message);
  } 
}

// Update selected character status
function characterChange(message) {
  let index;
  index = rooms[message.room].players.indexOf(sessions[message.id]);
  if (index != -1) {
    if (message.character === false) sessions[message.id].character = null;
    else sessions[message.id].character = Number(message.character);
    roleChange(message);
  }
}

// Send message
function sendMessage(message) {

  let msg = sessions[message.id].username + ": " + message.message;

  rooms[message.room].players.forEach(i => {
    server.send(JSON.stringify({message: msg, type: 2}), i.port, i.ip);
  });

  rooms[message.room].spectators.forEach(i => { 
    server.send(JSON.stringify({message: msg, type: 2}), i.port, i.ip);
  });
}

// Send the key inputs to the players and spectators
function sendInput(message) {

  index = rooms[message.room].players.indexOf(sessions[message.id]);
  if (index != -1) {

    // Send inputs to the players and spectators in the room
    let otherPlayer = index == 0 ? 1 : 0;
    server.send(JSON.stringify({key: Number(message.key), press: Boolean(message.press), type: 1}), rooms[message.room].players[index].port, rooms[message.room].players[index].ip);
    server.send(JSON.stringify({key: Number(message.key), press: Boolean(message.press), type: 0, player: index}), rooms[message.room].players[otherPlayer].port, rooms[message.room].players[otherPlayer].ip);
    
    rooms[message.room].spectators.forEach(i => { 
      server.send(JSON.stringify({key: Number(message.key), press: Boolean(message.press), type: 0, player: index}), i.port, i.ip);
    });


  }

}

// Update players and send who are the new players to everyone in the room
function roleChange(message) {
  // New players
  let players = [];
  for (let i = 0; i < rooms[message.room].players.length; i++) {
    players.push({
      username: String(rooms[message.room].players[i].username),
      character: String(rooms[message.room].players[i].character),
      port: String(rooms[message.room].players[i].port)
    })
  }

  if (players.length == 0) players = [0, 1, 2]; 
  // Send new players to all players and spectators in the room
  rooms[message.room].players.forEach(i => {
    server.send(JSON.stringify({roleChange: players, type: 6}), i.port, i.ip);
  });

  rooms[message.room].spectators.forEach(i => { 
    server.send(JSON.stringify({roleChange: players, type: 6}), i.port, i.ip);
  });
}

function gameIsStarted(message) {
  rooms[message.room].players.forEach(i => {
    server.send(JSON.stringify({type: 10}), i.port, i.ip);
  });

  rooms[message.room].spectators.forEach(i => { 
    server.send(JSON.stringify({type: 10}), i.port, i.ip);
  });
}
