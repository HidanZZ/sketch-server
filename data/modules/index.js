function createMatch(context, logger, nk, payload) {
  //payload is a stringified JSON object
  var payloadObj = JSON.parse(payload);
  logger.info("payloadObj: " + JSON.stringify(payloadObj));
  var matchId = nk.matchCreate('match', payloadObj);
  return JSON.stringify({
    matchId: matchId
  });
}
//health check
function healthcheck(context, logger, nk, payload) {
  return JSON.stringify({
    status: 'ok'
  });
}
function matchList(context, logger, nk, payload) {
  var limit = 10;
  var isAuthoritative = true;
  var label = null;
  var minSize = 0;
  var maxSize = 4;
  var query = "+label.open:1";
  var matches = nk.matchList(limit, isAuthoritative, label, minSize, maxSize, query);
  return JSON.stringify({
    matches: matches
  });
}

var Mark;
(function (Mark) {
  Mark[Mark["X"] = 0] = "X";
  Mark[Mark["O"] = 1] = "O";
  Mark[Mark["UNDEFINED"] = 2] = "UNDEFINED";
})(Mark || (Mark = {}));
// The complete set of opcodes used for communication between clients and server.
var OpCode;
(function (OpCode) {
  OpCode[OpCode["REJECTED"] = 0] = "REJECTED";
  // New game round starting.
  OpCode[OpCode["START"] = 1] = "START";
  // Update to the state of an ongoing round.
  OpCode[OpCode["DRAW"] = 2] = "DRAW";
  // A game round has just completed.
  OpCode[OpCode["CLEAR"] = 3] = "CLEAR";
  // A move the player wishes to make and sends to the server.
  OpCode[OpCode["CHANGESETTINGS"] = 4] = "CHANGESETTINGS";
  OpCode[OpCode["KICK"] = 5] = "KICK";
  OpCode[OpCode["KICKED"] = 6] = "KICKED";
  OpCode[OpCode["GAMEHOST"] = 7] = "GAMEHOST";
  OpCode[OpCode["WORDS"] = 8] = "WORDS";
  OpCode[OpCode["DRAWERCHOOSING"] = 9] = "DRAWERCHOOSING";
  OpCode[OpCode["MESSAGE"] = 10] = "MESSAGE";
  OpCode[OpCode["TIMER"] = 11] = "TIMER";
  OpCode[OpCode["START_TURN"] = 12] = "START_TURN";
  OpCode[OpCode["SELECTWORD"] = 13] = "SELECTWORD";
  OpCode[OpCode["WORDIS"] = 14] = "WORDIS";
  OpCode[OpCode["GAMEOVER"] = 15] = "GAMEOVER";
  OpCode[OpCode["ENDTURN"] = 16] = "ENDTURN";
})(OpCode || (OpCode = {}));

// list of random words object/countries/food to be drawn from
var wordList = ["apple", "banana", "orange", "grape", "pear", "watermelon", "pineapple", "strawberry", "blueberry", "raspberry", "kiwi", "mango", "avocado", "lemon", "lime", "coconut", "peach", "plum", "cherry", "apricot", "pomegranate", "cantaloupe", "honeydew", "cucumber", "tomato", "potato", "carrot", "broccoli", "cauliflower", "spinach", "lettuce", "cabbage", "celery", "asparagus", "onion", "garlic", "ginger", "pepper", "bicycle", "car", "truck", "motorcycle", "scooter", "train", "plane", "boat", "ship", "submarine", "rocket", "spaceship", "helicopter", "airplane", "bus", "taxi", "ambulance", "firetruck"];

/* eslint-disable no-case-declarations */
var tickRate = 15;
var deadline = 150;
var matchInit = function (ctx, logger, nk, params) {
  var rounds = parseInt(params.rounds);
  var timeperturn = parseInt(params.timePerTurn);
  logger.info("Match Init with time per turn: " + timeperturn);
  var maxPlayers = parseInt(params.maxPlayers);
  var open = !!params.open;
  var label = {
    open: open ? 1 : 0,
    maxPlayers: maxPlayers,
    name: params.name
  };
  var state = {
    label: label,
    emptyTicks: 0,
    presences: {},
    joinsInProgress: 0,
    playing: false,
    gameHost: null,
    rounds: rounds,
    timePerTurn: timeperturn,
    words: [],
    isGameOver: false,
    newRound: false,
    selectedWord: "",
    isChoosingWord: false,
    currentRound: 1,
    currentTime: 0,
    drawer: null,
    isDrawing: false,
    maxPlayers: maxPlayers,
    drawers: [],
    guessedUsers: {},
    deadlineRemainingTicks: 0,
    winner: null,
    nextGameRemainingTicks: 0
  };
  logger.info('Match initialized.');
  return {
    state: state,
    tickRate: tickRate,
    label: JSON.stringify(label)
  };
};
var matchJoinAttempt = function (ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
  // Check if it's a user attempting to rejoin after a disconnect.
  if (presence.userId in state.presences) {
    if (state.presences[presence.userId] === null) {
      // User rejoining after a disconnect.
      state.joinsInProgress++;
      return {
        state: state,
        accept: false,
        rejectMessage: 'User rejoining after a disconnect.'
      };
    } else {
      // User attempting to join from 2 different devices at the same time.
      return {
        state: state,
        accept: false,
        rejectMessage: 'already joined'
      };
    }
  }
  // Check if match is full.
  if (connectedPlayers(state) + state.joinsInProgress >= state.maxPlayers) {
    return {
      state: state,
      accept: false,
      rejectMessage: 'match full'
    };
  }
  // New player attempting to connect.
  state.joinsInProgress++;
  return {
    state: state,
    accept: true
  };
};
var matchJoin = function (ctx, logger, nk, dispatcher, tick, state, presences) {
  // const t = msecToSec(Date.now());
  // for (const presence of presences) {
  //   state.emptyTicks = 0;
  //   state.presences[presence.userId] = presence;
  //   state.joinsInProgress--;
  //   // Check if we must send a message to this user to update them on the current game state.
  //   if (state.playing) {
  //     // There's a game still currently in progress, the player is re-joining after a disconnect. Give them a state update.
  //     const update: UpdateMessage = {
  //       board: state.board,
  //       mark: state.mark,
  //       deadline: t + Math.floor(state.deadlineRemainingTicks / tickRate),
  //     };
  //     // Send a message to the user that just joined.
  //     dispatcher.broadcastMessage(OpCode.UPDATE, JSON.stringify(update));
  //   } else if (state.board.length !== 0 && Object.keys(state.marks).length !== 0 && state.marks[presence.userId]) {
  //     logger.debug('player %s rejoined game', presence.userId);
  //     // There's no game in progress but we still have a completed game that the user was part of.
  //     // They likely disconnected before the game ended, and have since forfeited because they took too long to return.
  //     const done: DoneMessage = {
  //       board: state.board,
  //       winner: state.winner,
  //       winnerPositions: state.winnerPositions,
  //       nextGameStart: t + Math.floor(state.nextGameRemainingTicks / tickRate),
  //     };
  //     // Send a message to the user that just joined.
  //     dispatcher.broadcastMessage(OpCode.DONE, JSON.stringify(done));
  //   }
  // }
  for (var _i = 0, presences_1 = presences; _i < presences_1.length; _i++) {
    var presence = presences_1[_i];
    state.emptyTicks = 0;
    state.presences[presence.userId] = {
      user: presence,
      points: 0
    };
    state.joinsInProgress--;
  }
  var settings = {
    rounds: state.rounds,
    timePerTurn: state.timePerTurn,
    maxPlayers: state.maxPlayers,
    open: state.label.open === 1,
    name: state.label.name
  };
  // Send a message to the user that just joined.
  dispatcher.broadcastMessage(OpCode.CHANGESETTINGS, JSON.stringify(settings));
  //set gamehost to first player in state.presences if it is null
  if (state.gameHost === null) {
    for (var _a = 0, presences_2 = presences; _a < presences_2.length; _a++) {
      var presence = presences_2[_a];
      state.gameHost = presence;
      dispatcher.broadcastMessage(OpCode.GAMEHOST, JSON.stringify(state.gameHost));
      break;
    }
  }
  // Check if match was open to new players, but should now be closed.
  if (Object.keys(state.presences).length >= state.maxPlayers && state.label.open != 0) {
    state.label.open = 0;
    var labelJSON = JSON.stringify(state.label);
    dispatcher.matchLabelUpdate(labelJSON);
  }
  return {
    state: state
  };
};
var matchLeave = function (ctx, logger, nk, dispatcher, tick, state, presences) {
  var _a;
  for (var _i = 0, presences_3 = presences; _i < presences_3.length; _i++) {
    var presence = presences_3[_i];
    logger.info('Player: %s left match: %s.', presence.userId, ctx.matchId);
    state.presences[presence.userId] = null;
    if (presence.userId === ((_a = state.drawer) === null || _a === void 0 ? void 0 : _a.userId)) {
      state.isDrawing = false;
      chooseDrawer(state, logger);
      if (state.drawers.length === connectedPlayers(state)) {
        if (state.currentRound === state.rounds) {
          state.playing = false;
          state.isGameOver = true;
          dispatcher.broadcastMessage(OpCode.GAMEOVER, JSON.stringify({
            users: Object.values(getPresences(state)),
            round: state.currentRound,
            totalRounds: state.rounds,
            timePerTurn: state.timePerTurn
          }));
        }
        state.currentRound++;
        state.drawers = [];
        state.newRound = true;
        state.selectedWord = '';
        dispatcher.broadcastMessage(OpCode.ENDTURN, JSON.stringify({
          isGameOver: state.isGameOver,
          guessedUsers: state.guessedUsers,
          users: Object.values(getPresences(state))
        }));
      } else {
        state.newRound = true;
        dispatcher.broadcastMessage(OpCode.ENDTURN, JSON.stringify({
          isGameOver: state.isGameOver,
          guessedUsers: state.guessedUsers,
          users: Object.values(getPresences(state))
        }));
      }
    }
    dispatcher.broadcastMessage(OpCode.MESSAGE, JSON.stringify({
      sender: presence.username,
      message: "left the game.",
      color: '#EF4444'
    }));
  }
  //check if gamehost left and set gamehost to first player in state.presences if there is one
  if (state.gameHost !== null) {
    for (var _b = 0, presences_4 = presences; _b < presences_4.length; _b++) {
      var presence = presences_4[_b];
      if (presence.userId === state.gameHost.userId) {
        state.gameHost = null;
        //get first player in state.presences not equal to null
        for (var _c = 0, _d = Object.keys(state.presences); _c < _d.length; _c++) {
          var userID = _d[_c];
          if (userID !== presence.userId) {
            var gh = state.presences[userID];
            if (gh) state.gameHost = gh.user;
            dispatcher.broadcastMessage(OpCode.GAMEHOST, JSON.stringify(state.gameHost));
            break;
          }
        }
        break;
      }
    }
  }
  //check if non null presences length is less than 2
  if (Object.keys(getPresences(state)).length < 2) {
    state.playing = false;
    state.words = [];
    state.newRound = false;
    state.selectedWord = "";
    state.isChoosingWord = false;
    state.currentRound = 1;
    state.currentTime = 0;
    state.drawer = null;
    state.isDrawing = false;
    state.drawers = [];
    state.guessedUsers = {};
    state.deadlineRemainingTicks = 0;
    state.winner = null;
    dispatcher.broadcastMessage(OpCode.GAMEOVER, JSON.stringify({
      users: Object.values(getPresences(state)),
      round: state.currentRound,
      totalRounds: state.rounds,
      timePerTurn: state.timePerTurn
    }));
  }
  return {
    state: state
  };
};
var matchLoop = function (ctx, logger, nk, dispatcher, tick, state, messages) {
  var _a, _b, _c, _d;
  if (connectedPlayers(state) + state.joinsInProgress === 0) {
    state.emptyTicks++;
    if (state.emptyTicks >= 10 * tickRate) {
      // Match has been empty for too long, close it.
      logger.info('closing idle match');
      return null;
    }
  }
  for (var userID in state.presences) {
    if (state.presences[userID] === null) {
      delete state.presences[userID];
    }
  }
  // // There's a game in progresstate. Check for input, update match state, and send messages to clientstate.
  if (state.isChoosingWord) {
    state.deadlineRemainingTicks++;
    if (state.deadlineRemainingTicks >= deadline) {
      //choose random word from state.words
      var randomWord = state.words[Math.floor(Math.random() * state.words.length)];
      state.selectedWord = randomWord;
      state.isChoosingWord = false;
      state.deadlineRemainingTicks = 0;
      var msg = {
        word: state.selectedWord
      };
      dispatcher.broadcastMessage(OpCode.WORDIS, JSON.stringify(msg));
      var username = (_a = state.drawer) === null || _a === void 0 ? void 0 : _a.username;
      var message = {
        sender: username,
        content: 'is drawing now!',
        color: '#8B5CF6'
      };
      dispatcher.broadcastMessage(OpCode.MESSAGE, JSON.stringify(message));
      state.isDrawing = true;
      state.currentTime = state.timePerTurn;
    }
  }
  if (state.isDrawing) {
    if (state.currentTime == 0) {
      var message = {
        sender: 'The word was ',
        content: "\"".concat(state.selectedWord, "\""),
        color: '#84CC16'
      };
      dispatcher.broadcastMessage(OpCode.MESSAGE, JSON.stringify(message));
      state.isDrawing = false;
      if (state.drawers.length == connectedPlayers(state)) {
        if (state.currentRound == state.rounds) {
          state.playing = false;
          state.isGameOver = true;
          dispatcher.broadcastMessage(OpCode.GAMEOVER, JSON.stringify({
            users: Object.values(getPresences(state)),
            round: state.currentRound,
            totalRounds: state.rounds,
            timePerTurn: state.timePerTurn
          }));
        }
        state.currentRound++;
        state.newRound = true;
        state.guessedUsers = {};
        state.drawers = [];
        state.drawer = null;
        state.selectedWord = '';
        dispatcher.broadcastMessage(OpCode.ENDTURN, JSON.stringify({
          isGameOver: state.isGameOver,
          guessedUsers: state.guessedUsers,
          users: Object.values(getPresences(state))
        }));
      } else {
        state.newRound = false;
        dispatcher.broadcastMessage(OpCode.ENDTURN, JSON.stringify({
          isGameOver: state.isGameOver,
          guessedUsers: state.guessedUsers,
          users: Object.values(getPresences(state))
        }));
      }
      state.guessedUsers = {};
      state.isDrawing = false;
      state.currentTime = state.timePerTurn;
    } else {
      dispatcher.broadcastMessage(OpCode.TIMER, JSON.stringify({
        timer: state.currentTime
      }));
    }
    //decrement timer every 15 ticks
    if (tick % tickRate == 0) {
      state.currentTime--;
    }
  }
  for (var _i = 0, messages_1 = messages; _i < messages_1.length; _i++) {
    var message = messages_1[_i];
    logger.info('Received message: %s', message.opCode);
    switch (message.opCode) {
      case OpCode.START:
        //start game
        state.playing = true;
        //set drawer to random player from state.presences not null and not in state.drawers
        chooseDrawer(state, logger);
        state.words = getWords(3);
        dispatcher.broadcastMessage(OpCode.SELECTWORD, JSON.stringify({
          drawer: state.drawer,
          words: state.words,
          newRound: state.newRound,
          round: state.currentRound,
          users: Object.values(state.presences)
        }));
        state.isChoosingWord = true;
        break;
      case OpCode.MESSAGE:
        var messageSender = message.sender;
        var chatmesage = {};
        try {
          chatmesage = JSON.parse(nk.binaryToString(message.data));
        } catch (error) {
          // Client sent bad data.
          dispatcher.broadcastMessage(OpCode.REJECTED, null, [message.sender]);
          logger.debug('Bad data received: %v', error);
          continue;
        }
        if (chatmesage.content.toLowerCase() == state.selectedWord.toLowerCase()) {
          if (state.isDrawing && messageSender.userId !== ((_b = state.drawer) === null || _b === void 0 ? void 0 : _b.userId) && !Object.keys(state.guessedUsers).includes(messageSender.userId)) {
            var points = 0;
            if (Object.keys(state.guessedUsers).length === 0) {
              points = 400;
            } else if (Object.keys(state.guessedUsers).length === 1) {
              points = 350;
            } else if (Object.keys(state.guessedUsers).length === 2) {
              points = 300;
            } else if (Object.keys(state.guessedUsers).length === 3) {
              points = 250;
            } else if (Object.keys(state.guessedUsers).length === 4) {
              points = 200;
            } else if (Object.keys(state.guessedUsers).length === 5) {
              points = 150;
            }
            var us = state.presences[messageSender.userId];
            if (us) us.points += points;
            state.guessedUsers[messageSender.userId] = us;
            dispatcher.broadcastMessage(OpCode.MESSAGE, JSON.stringify({
              sender: messageSender.username,
              content: 'guessed the word!',
              color: '#84CC16'
            }));
            //sound effect
            if (Object.keys(state.guessedUsers).length === connectedPlayers(state) - 1) {
              dispatcher.broadcastMessage(OpCode.MESSAGE, JSON.stringify({
                sender: 'The word was ',
                content: "\"".concat(state.selectedWord, "\""),
                color: '#84CC16'
              }));
              state.isDrawing = false;
              logger.info('is length equal to connected players: %s.', state.drawers.length === connectedPlayers(state));
              logger.info('drawer players: %s.', state.drawers.length);
              logger.info('connected players: %s.', connectedPlayers(state));
              if (state.drawers.length === connectedPlayers(state)) {
                if (state.rounds === state.currentRound) {
                  state.playing = false;
                  state.isGameOver = true;
                  dispatcher.broadcastMessage(OpCode.GAMEOVER, JSON.stringify({
                    users: Object.values(getPresences(state)),
                    round: state.currentRound,
                    totalRounds: state.rounds,
                    timePerTurn: state.timePerTurn
                  }));
                }
                state.currentRound++;
                state.newRound = true;
                state.guessedUsers = {};
                state.drawers = [];
                state.drawer = null;
                state.selectedWord = '';
                logger.info('everyone have drawn : %s.', state.currentRound);
                dispatcher.broadcastMessage(OpCode.ENDTURN, JSON.stringify({
                  isGameOver: state.isGameOver,
                  guessedUsers: state.guessedUsers,
                  users: Object.values(getPresences(state))
                }));
              } else {
                state.newRound = false;
                dispatcher.broadcastMessage(OpCode.ENDTURN, JSON.stringify({
                  isGameOver: state.isGameOver,
                  guessedUsers: state.guessedUsers,
                  users: Object.values(getPresences(state))
                }));
              }
              state.currentTime = state.timePerTurn;
              state.guessedUsers = {};
            }
          }
        } else {
          dispatcher.broadcastMessage(OpCode.MESSAGE, JSON.stringify({
            sender: messageSender.username,
            content: chatmesage.content,
            color: 'black'
          }));
        }
        break;
      case OpCode.START_TURN:
        chooseDrawer(state, logger);
        state.words = getWords(3);
        dispatcher.broadcastMessage(OpCode.SELECTWORD, JSON.stringify({
          drawer: state.drawer,
          words: state.words,
          newRound: state.newRound,
          round: state.currentRound,
          users: Object.values(state.presences)
        }));
        state.isChoosingWord = true;
        break;
      case OpCode.WORDIS:
        logger.info('hereeeeeeeeeeeeeeeeeeeeeeeeeeeee');
        var wordisMessage = {};
        try {
          wordisMessage = JSON.parse(nk.binaryToString(message.data));
        } catch (error) {
          // Client sent bad data.
          dispatcher.broadcastMessage(OpCode.REJECTED, null, [message.sender]);
          logger.info('Bad data received: %v', error);
          continue;
        }
        logger.info('word is %s', wordisMessage.word);
        state.isChoosingWord = false;
        state.deadlineRemainingTicks = 0;
        state.selectedWord = wordisMessage.word;
        dispatcher.broadcastMessage(OpCode.WORDIS, JSON.stringify({
          word: state.selectedWord
        }));
        dispatcher.broadcastMessage(OpCode.MESSAGE, JSON.stringify({
          sender: (_c = state.drawer) === null || _c === void 0 ? void 0 : _c.username,
          content: 'is drawing now!',
          color: '#8B5CF6'
        }));
        state.isDrawing = true;
        state.currentTime = state.timePerTurn;
        logger.info('time is %s', state.currentTime);
        logger.info('timeturn is %s', state.timePerTurn);
        break;
      case OpCode.DRAW:
        var msg = {};
        try {
          msg = JSON.parse(nk.binaryToString(message.data));
        } catch (error) {
          // Client sent bad data.
          dispatcher.broadcastMessage(OpCode.REJECTED, JSON.stringify({}), [message.sender]);
          logger.debug('Bad data received: %v', error);
          continue;
        }
        logger.debug('Received update: %v', msg);
        dispatcher.broadcastMessage(message.opCode, JSON.stringify(msg));
        break;
      case OpCode.CLEAR:
        dispatcher.broadcastMessage(message.opCode, JSON.stringify({}));
        break;
      case OpCode.CHANGESETTINGS:
        var msg2 = {};
        try {
          msg2 = JSON.parse(nk.binaryToString(message.data));
        } catch (error) {
          // Client sent bad data.
          dispatcher.broadcastMessage(OpCode.REJECTED, null, [message.sender]);
          logger.debug('Bad data received: %v', error);
          continue;
        }
        // Update rounds,timeperround, and maxplayers
        state.rounds = msg2.rounds;
        state.timePerTurn = msg2.timePerTurn;
        logger.info("Change settings with time per turn: %s", state.timePerTurn);
        state.maxPlayers = msg2.maxPlayers;
        state.label.open = msg2.open ? 1 : 0;
        state.label.maxPlayers = msg2.maxPlayers;
        state.label.name = msg2.name;
        var labelJSON = JSON.stringify(state.label);
        dispatcher.matchLabelUpdate(labelJSON);
        dispatcher.broadcastMessage(message.opCode, JSON.stringify(msg2));
        break;
      case OpCode.KICK:
        //get the user who sent the message
        var sender = message.sender.userId;
        var msg3 = {};
        try {
          msg3 = JSON.parse(nk.binaryToString(message.data));
        } catch (error) {
          dispatcher.broadcastMessage(OpCode.REJECTED, null, [message.sender]);
          logger.debug('Bad data received: %v', error);
          continue;
        }
        //check if the user who sent the message is the game host
        if (((_d = state.gameHost) === null || _d === void 0 ? void 0 : _d.userId) === sender) {
          //get presence of user to kick
          var presence = state.presences[msg3.userId];
          if (presence != null) {
            dispatcher.broadcastMessage(OpCode.KICKED, JSON.stringify({
              userId: msg3.userId
            }), [presence.user]);
            dispatcher.matchKick([presence.user]);
          }
          //notify the user who was kicked
        }

        break;
      default:
        logger.error('Unexpected opcode received: %d', message.opCode);
    }
  }
  // // Keep track of the time remaining for the player to submit their move. Idle players forfeit.
  // if (state.playing) {
  //   state.deadlineRemainingTicks--;
  //   if (state.deadlineRemainingTicks <= 0) {
  //     // The player has run out of time to submit their move.
  //     state.playing = false;
  //     state.winner = state.mark === Mark.O ? Mark.X : Mark.O;
  //     state.deadlineRemainingTicks = 0;
  //     state.nextGameRemainingTicks = delaybetweenGamesSec * tickRate;
  //     const msg: DoneMessage = {
  //       board: state.board,
  //       winner: state.winner,
  //       nextGameStart: t + Math.floor(state.nextGameRemainingTicks / tickRate),
  //       winnerPositions: null,
  //     };
  //     dispatcher.broadcastMessage(OpCode.DONE, JSON.stringify(msg));
  //   }
  // }
  return {
    state: state
  };
};
function chooseDrawer(state, logger) {
  var _a;
  var players = Object.keys(getPresences(state));
  var drawers = state.drawers;
  //remove drawers from players
  for (var i = 0; i < drawers.length; i++) {
    var uid = (_a = drawers[i]) === null || _a === void 0 ? void 0 : _a.userId;
    if (uid != undefined) {
      {
        var index = players.indexOf(uid);
        if (index > -1) {
          players.splice(index, 1);
        }
      }
    }
  }
  logger.info('players are %s', players);
  logger.info('drawers are %s', drawers);
  // Choose a random player to be the drawer.
  if (players.length != 0) {
    var drawer = players[0];
    var dr = state.presences[drawer];
    logger.info('drawer is %s', dr);
    if (dr != null) {
      state.drawers.push(dr.user);
      state.drawer = dr.user;
    }
  }
}
function getWords(count) {
  var words = [];
  //get random words from word list
  for (var i = 0; i < count; i++) {
    words.push(wordList[Math.floor(Math.random() * wordList.length)]);
  }
  return words;
}
//get non null presences
function getPresences(state) {
  var presences = {};
  for (var _i = 0, _a = Object.values(state.presences); _i < _a.length; _i++) {
    var presence = _a[_i];
    if (presence != null) {
      presences[presence.user.userId] = presence;
    }
  }
  return presences;
}
var matchTerminate = function (ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
  return {
    state: state
  };
};
var matchSignal = function (ctx, logger, nk, dispatcher, tick, state) {
  return {
    state: state
  };
};
function connectedPlayers(s) {
  var count = 0;
  for (var _i = 0, _a = Object.keys(s.presences); _i < _a.length; _i++) {
    var p = _a[_i];
    if (p !== null) {
      count++;
    }
  }
  return count;
}

/// <reference types="nakama-runtime" />
function InitModule(ctx, logger, _nk, initializer) {
  initializer.registerMatch('match', {
    matchInit: matchInit,
    matchJoinAttempt: matchJoinAttempt,
    matchJoin: matchJoin,
    matchLeave: matchLeave,
    matchLoop: matchLoop,
    matchTerminate: matchTerminate,
    matchSignal: matchSignal
  });
  initializer.registerRpc('creatematch', createMatch);
  initializer.registerRpc('health', healthcheck);
  initializer.registerRpc('listmatches', matchList);
  logger.info("TypeScript modules loadaed.");
}
// Reference InitModule to avoid it getting removed on build
!InitModule && InitModule.bind(null);
