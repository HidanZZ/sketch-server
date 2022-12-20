function createMatch(context, logger, nk, payload) {
  //payload is a stringified JSON object
  var payloadObj = JSON.parse(payload);
  logger.info('payloadObj: ' + JSON.stringify(payloadObj));
  var matchId = nk.matchCreate('match', payloadObj);
  return JSON.stringify({
    matchId: matchId,
  });
}
//health check
function healthcheck(context, logger, nk, payload) {
  return JSON.stringify({
    status: 'ok',
  });
}
function matchList(context, logger, nk, payload) {
  var limit = 10;
  var isAuthoritative = true;
  var label = null;
  var minSize = 0;
  var maxSize = 4;
  var query = '+label.open:1';
  var matches = nk.matchList(limit, isAuthoritative, label, minSize, maxSize, query);
  return JSON.stringify({
    matches: matches,
  });
}

var tickRate = 15;
// The complete set of opcodes used for communication between clients and server.
var OpCode;
(function (OpCode) {
  OpCode[(OpCode['REJECTED'] = 0)] = 'REJECTED';
  // New game round starting.
  OpCode[(OpCode['START'] = 1)] = 'START';
  // Update to the state of an ongoing round.
  OpCode[(OpCode['DRAW'] = 2)] = 'DRAW';
  // A game round has just completed.
  OpCode[(OpCode['CLEAR'] = 3)] = 'CLEAR';
  // A move the player wishes to make and sends to the server.
  OpCode[(OpCode['CHANGESETTINGS'] = 4)] = 'CHANGESETTINGS';
  OpCode[(OpCode['KICK'] = 5)] = 'KICK';
  OpCode[(OpCode['KICKED'] = 6)] = 'KICKED';
  OpCode[(OpCode['GAMEHOST'] = 7)] = 'GAMEHOST';
  OpCode[(OpCode['WORDS'] = 8)] = 'WORDS';
  OpCode[(OpCode['DRAWERCHOOSING'] = 9)] = 'DRAWERCHOOSING';
  OpCode[(OpCode['MESSAGE'] = 10)] = 'MESSAGE';
  OpCode[(OpCode['TIMER'] = 11)] = 'TIMER';
  OpCode[(OpCode['START_TURN'] = 12)] = 'START_TURN';
  OpCode[(OpCode['SELECTWORD'] = 13)] = 'SELECTWORD';
  OpCode[(OpCode['WORDIS'] = 14)] = 'WORDIS';
  OpCode[(OpCode['GAMEOVER'] = 15)] = 'GAMEOVER';
  OpCode[(OpCode['ENDTURN'] = 16)] = 'ENDTURN';
  OpCode[(OpCode['UPDATE'] = 17)] = 'UPDATE';
  OpCode[(OpCode['NEWROUND'] = 18)] = 'NEWROUND';
  OpCode[(OpCode['LOBBY'] = 19)] = 'LOBBY';
  OpCode[(OpCode['PRESENCE'] = 20)] = 'PRESENCE';
  OpCode[(OpCode['IMAGE'] = 21)] = 'IMAGE';
})(OpCode || (OpCode = {}));
var GameStateEnum;
(function (GameStateEnum) {
  GameStateEnum['NEW_ROUND'] = 'new_round';
  GameStateEnum['DRAWING'] = 'drawing';
  GameStateEnum['SELECT_WORD'] = 'select_word';
  GameStateEnum['END_TURN'] = 'end_turn';
  GameStateEnum['GAME_OVER'] = 'game_over';
  GameStateEnum['LOBBY'] = 'lobby';
})(GameStateEnum || (GameStateEnum = {}));

var lobbyLoop = function (ctx, logger, nk, dispatcher, tick, state, messages) {
  var _a, _b, _c;
  for (var _i = 0, messages_1 = messages; _i < messages_1.length; _i++) {
    var message = messages_1[_i];
    switch (message.opCode) {
      case OpCode.START:
        if (((_a = state.gameHost) === null || _a === void 0 ? void 0 : _a.userId) === message.sender.userId) {
          //start game
          state.playing = true;
          state.currentState = GameStateEnum.NEW_ROUND;
          dispatcher.broadcastMessage(
            OpCode.NEWROUND,
            JSON.stringify({
              round: state.currentRound,
            })
          );
          state.currentRound = 1;
          state.deadlineRemainingTicks = tickRate * 3;
          //set drawer to random player from state.presences not null and not in state.drawers
        }

        break;
      case OpCode.CHANGESETTINGS:
        if (((_b = state.gameHost) === null || _b === void 0 ? void 0 : _b.userId) === message.sender.userId) {
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
          state.maxPlayers = msg2.maxPlayers;
          state.label.open = msg2.open ? 1 : 0;
          state.label.maxPlayers = msg2.maxPlayers;
          state.label.name = msg2.name;
          var labelJSON = JSON.stringify(state.label);
          dispatcher.matchLabelUpdate(labelJSON);
          dispatcher.broadcastMessage(message.opCode, JSON.stringify(msg2));
          break;
        }
        break;
      case OpCode.GAMEHOST:
        break;
      case OpCode.KICK:
        if (((_c = state.gameHost) === null || _c === void 0 ? void 0 : _c.userId) === message.sender.userId) {
          var msg3 = {};
          try {
            msg3 = JSON.parse(nk.binaryToString(message.data));
          } catch (error) {
            dispatcher.broadcastMessage(OpCode.REJECTED, null, [message.sender]);
            logger.debug('Bad data received: %v', error);
            continue;
          }
          //check if the user who sent the message is the game host
          //get presence of user to kick
          var presence = state.presences[msg3.userId];
          dispatcher.broadcastMessage(
            OpCode.KICKED,
            JSON.stringify({
              userId: msg3.userId,
            }),
            [presence.user]
          );
          dispatcher.matchKick([presence.user]);
          //notify the user who was kicked
          break;
        }
        break;
    }
  }
  return {
    state: state,
  };
};

var drawingLoop = function (ctx, logger, nk, dispatcher, tick, state, messages, connectedPlayers, EMPTYYPRESENCE) {
  if (tick % tickRate == 0) {
    state.currentTime--;
    dispatcher.broadcastMessage(
      OpCode.TIMER,
      JSON.stringify({
        timer: state.currentTime,
      })
    );
  }
  if (state.currentTime <= 0) {
    var message = {
      sender: 'The word was ',
      content: '"'.concat(state.selectedWord, '"'),
      color: '#84CC16',
    };
    state.presences[state.drawer.userId].points += Math.floor(
      400 * (Object.keys(state.guessedUsers).length / (connectedPlayers(state) - 1))
    );
    dispatcher.broadcastMessage(OpCode.MESSAGE, JSON.stringify(message));
    if (state.drawers.length == connectedPlayers(state)) {
      if (state.currentRound == state.rounds) {
        state.currentState = GameStateEnum.GAME_OVER;
        state.deadlineRemainingTicks = tickRate * 5;
        state.winner = Object.values(state.presences).reduce(function (prev, current) {
          return prev.points > current.points ? prev : current;
        }).user;
        dispatcher.broadcastMessage(
          OpCode.GAMEOVER,
          JSON.stringify({
            winner: state.winner,
            users: Object.values(state.presences),
            round: state.currentRound,
            totalRounds: state.rounds,
            timePerTurn: state.timePerTurn,
          })
        );
      } else {
        state.currentRound++;
        state.newRound = true;
        state.drawers = [];
        state.drawer = EMPTYYPRESENCE;
        state.currentState = GameStateEnum.END_TURN;
        state.deadlineRemainingTicks = tickRate * 5;
        dispatcher.broadcastMessage(
          OpCode.ENDTURN,
          JSON.stringify({
            isGameOver: state.isGameOver,
            guessedUsers: state.guessedUsers,
            users: Object.values(state.presences),
          })
        );
      }
    } else {
      state.newRound = false;
      state.currentState = GameStateEnum.END_TURN;
      state.deadlineRemainingTicks = tickRate * 5;
      dispatcher.broadcastMessage(
        OpCode.ENDTURN,
        JSON.stringify({
          isGameOver: state.isGameOver,
          guessedUsers: state.guessedUsers,
          users: Object.values(state.presences),
        })
      );
    }
  }
  for (var _i = 0, messages_1 = messages; _i < messages_1.length; _i++) {
    var message = messages_1[_i];
    switch (message.opCode) {
      case OpCode.IMAGE:
        var image = {
          data: '',
        };
        try {
          image = JSON.parse(nk.binaryToString(message.data));
        } catch (error) {
          dispatcher.broadcastMessage(OpCode.REJECTED, JSON.stringify({}), [message.sender]);
          continue;
        }
        state.dataImage = image.data;
        break;
      case OpCode.DRAW:
        if (state.drawer.userId === message.sender.userId) {
          var msg = {};
          try {
            msg = JSON.parse(nk.binaryToString(message.data));
          } catch (error) {
            dispatcher.broadcastMessage(OpCode.REJECTED, JSON.stringify({}), [message.sender]);
            continue;
          }
          dispatcher.broadcastMessage(OpCode.DRAW, JSON.stringify(msg));
        }
        break;
      case OpCode.CLEAR:
        if (state.drawer.userId === message.sender.userId) {
          dispatcher.broadcastMessage(OpCode.CLEAR, JSON.stringify({}));
        }
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
          if (messageSender.userId !== state.drawer.userId && !Object.keys(state.guessedUsers).includes(messageSender.userId)) {
            var points = 0;
            // add points based on how many guessed users e.g. 400 points for 1 user, 100 points for 6 users etc.
            points = Math.floor(600 / (Object.keys(state.guessedUsers).length + 1));
            state.presences[messageSender.userId].points += points;
            state.guessedUsers[messageSender.userId] = state.presences[messageSender.userId];
            dispatcher.broadcastMessage(
              OpCode.MESSAGE,
              JSON.stringify({
                sender: messageSender.username,
                content: 'guessed the word!',
                color: '#84CC16',
              })
            );
            //sound effect
            if (Object.keys(state.guessedUsers).length === connectedPlayers(state) - 1) {
              dispatcher.broadcastMessage(
                OpCode.MESSAGE,
                JSON.stringify({
                  sender: 'The word was ',
                  content: '"'.concat(state.selectedWord, '"'),
                  color: '#84CC16',
                })
              );
              state.presences[state.drawer.userId].points += 400;
              if (state.drawers.length === connectedPlayers(state)) {
                if (state.rounds == state.currentRound) {
                  state.playing = false;
                  state.isGameOver = true;
                  state.currentState = GameStateEnum.GAME_OVER;
                  state.deadlineRemainingTicks = tickRate * 5;
                  state.winner = Object.values(state.presences).reduce(function (prev, current) {
                    return prev.points > current.points ? prev : current;
                  }).user;
                  dispatcher.broadcastMessage(
                    OpCode.GAMEOVER,
                    JSON.stringify({
                      winner: state.winner,
                      users: Object.values(state.presences),
                      round: state.currentRound,
                      totalRounds: state.rounds,
                      timePerTurn: state.timePerTurn,
                    })
                  );
                } else {
                  state.currentRound++;
                  state.newRound = true;
                  state.drawers = [];
                  state.drawer = EMPTYYPRESENCE;
                  state.currentState = GameStateEnum.END_TURN;
                  state.deadlineRemainingTicks = tickRate * 5;
                  dispatcher.broadcastMessage(
                    OpCode.ENDTURN,
                    JSON.stringify({
                      isGameOver: state.isGameOver,
                      guessedUsers: state.guessedUsers,
                      users: Object.values(state.presences),
                    })
                  );
                }
              } else {
                state.newRound = false;
                state.currentState = GameStateEnum.END_TURN;
                state.deadlineRemainingTicks = tickRate * 5;
                dispatcher.broadcastMessage(
                  OpCode.ENDTURN,
                  JSON.stringify({
                    isGameOver: state.isGameOver,
                    guessedUsers: state.guessedUsers,
                    users: Object.values(state.presences),
                  })
                );
              }
              state.currentTime = state.timePerTurn;
              state.guessedUsers = {};
            }
          }
        } else {
          dispatcher.broadcastMessage(
            OpCode.MESSAGE,
            JSON.stringify({
              sender: messageSender.username,
              content: chatmesage.content,
              color: 'black',
            })
          );
        }
        break;
    }
  }
  return {
    state: state,
  };
};

var selectWordLoop = function (ctx, logger, nk, dispatcher, tick, state, messages) {
  state.deadlineRemainingTicks--;
  if (state.deadlineRemainingTicks <= 0) {
    var randomWord = state.words[Math.floor(Math.random() * state.words.length)];
    state.selectedWord = randomWord;
    var msg = {
      word: state.selectedWord,
    };
    dispatcher.broadcastMessage(OpCode.WORDIS, JSON.stringify(msg));
    var message = {
      sender: state.drawer.username,
      content: 'is drawing now!',
      color: '#8B5CF6',
    };
    dispatcher.broadcastMessage(OpCode.MESSAGE, JSON.stringify(message));
    state.currentState = GameStateEnum.DRAWING;
    state.deadlineRemainingTicks = 0;
    state.currentTime = state.timePerTurn;
  }
  for (var _i = 0, messages_1 = messages; _i < messages_1.length; _i++) {
    var message = messages_1[_i];
    switch (message.opCode) {
      case OpCode.WORDIS:
        if (state.drawer.userId === message.sender.userId) {
          var wordisMessage = {};
          try {
            wordisMessage = JSON.parse(nk.binaryToString(message.data));
          } catch (error) {
            // Client sent bad data.
            dispatcher.broadcastMessage(OpCode.REJECTED, null, [message.sender]);
            continue;
          }
          state.selectedWord = wordisMessage.word;
          dispatcher.broadcastMessage(
            OpCode.WORDIS,
            JSON.stringify({
              word: state.selectedWord,
            })
          );
          dispatcher.broadcastMessage(
            OpCode.MESSAGE,
            JSON.stringify({
              sender: state.drawer.username,
              content: 'is drawing now!',
              color: '#8B5CF6',
            })
          );
          state.currentState = GameStateEnum.DRAWING;
          state.deadlineRemainingTicks = 0;
          state.currentTime = state.timePerTurn;
          break;
        }
        break;
    }
  }
  return {
    state: state,
  };
};

var endTurnLoop = function (ctx, logger, nk, dispatcher, tick, state, messages, chooseDrawer, getWords) {
  state.deadlineRemainingTicks--;
  if (state.deadlineRemainingTicks <= 0) {
    if (state.newRound) {
      state.currentState = GameStateEnum.NEW_ROUND;
      state.deadlineRemainingTicks = tickRate * 5;
      state.currentTime = state.timePerTurn;
      dispatcher.broadcastMessage(
        OpCode.NEWROUND,
        JSON.stringify({
          round: state.currentRound,
        })
      );
    } else {
      chooseDrawer(state, logger);
      state.words = getWords(3);
      dispatcher.broadcastMessage(OpCode.CLEAR, JSON.stringify({}));
      dispatcher.broadcastMessage(
        OpCode.SELECTWORD,
        JSON.stringify({
          drawer: state.drawer,
          words: state.words,
          newRound: state.newRound,
          round: state.currentRound,
          users: Object.values(state.presences),
        }),
        [state.drawer]
      );
      //get all users in state.presences without drawer
      var users = Object.values(state.presences)
        .filter(function (value) {
          return value.user.userId !== state.drawer.userId;
        })
        .map(function (value) {
          return value.user;
        });
      dispatcher.broadcastMessage(
        OpCode.DRAWERCHOOSING,
        JSON.stringify({
          drawer: state.drawer,
        }),
        users
      );
      state.currentState = GameStateEnum.SELECT_WORD;
      state.deadlineRemainingTicks = tickRate * 10;
    }
  }
  return {
    state: state,
  };
};

var gameOverLoop = function (ctx, logger, nk, dispatcher, tick, state, messages, EMPTYYPRESENCE) {
  state.deadlineRemainingTicks--;
  if (state.deadlineRemainingTicks <= 0) {
    state.currentState = GameStateEnum.LOBBY;
    state.deadlineRemainingTicks = tickRate * 10;
    state.currentRound = 1;
    state.newRound = true;
    state.isGameOver = false;
    state.guessedUsers = {};
    state.currentTime = state.timePerTurn;
    state.drawer = EMPTYYPRESENCE;
    state.drawers = [];
    state.selectedWord = '';
    dispatcher.broadcastMessage(
      OpCode.LOBBY,
      JSON.stringify({
        round: state.currentRound,
        users: Object.values(state.presences),
      })
    );
  }
  return {
    state: state,
  };
};

var newRoundLoop = function (ctx, logger, nk, dispatcher, tick, state, messages, chooseDrawer, getWords) {
  state.deadlineRemainingTicks--;
  if (state.deadlineRemainingTicks <= 0) {
    chooseDrawer(state, logger);
    state.words = getWords(3);
    dispatcher.broadcastMessage(OpCode.CLEAR, JSON.stringify({}));
    dispatcher.broadcastMessage(
      OpCode.SELECTWORD,
      JSON.stringify({
        drawer: state.drawer,
        words: state.words,
        newRound: state.newRound,
        round: state.currentRound,
        users: Object.values(state.presences),
      }),
      [state.drawer]
    );
    //get all users in state.presences without drawer
    var users = Object.values(state.presences)
      .filter(function (value) {
        return value.user.userId !== state.drawer.userId;
      })
      .map(function (value) {
        return value.user;
      });
    dispatcher.broadcastMessage(
      OpCode.DRAWERCHOOSING,
      JSON.stringify({
        drawer: state.drawer,
      }),
      users
    );
    state.currentState = GameStateEnum.SELECT_WORD;
    state.deadlineRemainingTicks = tickRate * 10;
  }
  return {
    state: state,
  };
};

// list of random words object/countries/food to be drawn from
var wordList = [
  'apple',
  'banana',
  'orange',
  'grape',
  'pear',
  'watermelon',
  'pineapple',
  'strawberry',
  'blueberry',
  'raspberry',
  'kiwi',
  'mango',
  'avocado',
  'lemon',
  'lime',
  'coconut',
  'peach',
  'plum',
  'cherry',
  'apricot',
  'pomegranate',
  'cantaloupe',
  'honeydew',
  'cucumber',
  'tomato',
  'potato',
  'carrot',
  'broccoli',
  'cauliflower',
  'spinach',
  'lettuce',
  'cabbage',
  'celery',
  'asparagus',
  'onion',
  'garlic',
  'ginger',
  'pepper',
  'bicycle',
  'car',
  'truck',
  'motorcycle',
  'scooter',
  'train',
  'plane',
  'boat',
  'ship',
  'submarine',
  'rocket',
  'spaceship',
  'helicopter',
  'airplane',
  'bus',
  'taxi',
  'ambulance',
  'firetruck',
];

/* eslint-disable no-case-declarations */
//empty presence
var EMPTYYPRESENCE = {
  userId: '',
  sessionId: '',
  node: '',
  username: '',
};
var matchInit = function (ctx, logger, nk, params) {
  var rounds = parseInt(params.rounds);
  var timeperturn = parseInt(params.timePerTurn);
  logger.info('Match Init with time per turn: ' + timeperturn);
  var maxPlayers = parseInt(params.maxPlayers);
  var open = !!params.open;
  var label = {
    open: open ? 1 : 0,
    maxPlayers: maxPlayers,
    name: params.name,
  };
  var state = {
    currentState: GameStateEnum.LOBBY,
    dataImage: '',
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
    selectedWord: '',
    isChoosingWord: false,
    currentRound: 1,
    currentTime: 0,
    drawer: EMPTYYPRESENCE,
    isDrawing: false,
    maxPlayers: maxPlayers,
    drawers: [],
    guessedUsers: {},
    deadlineRemainingTicks: 0,
    winner: null,
    nextGameRemainingTicks: 0,
  };
  logger.info('Match initialized.');
  return {
    state: state,
    tickRate: tickRate,
    label: JSON.stringify(label),
  };
};
var matchJoinAttempt = function (ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
  // Check if it's a user attempting to rejoin after a disconnect.
  if (presence.userId in state.presences) {
    // User attempting to join from 2 different devices at the same time.
    return {
      state: state,
      accept: false,
      rejectMessage: 'already joined',
    };
  }
  // Check if match is full.
  if (connectedPlayers(state) + state.joinsInProgress >= state.maxPlayers) {
    return {
      state: state,
      accept: false,
      rejectMessage: 'match full',
    };
  }
  // New player attempting to connect.
  state.joinsInProgress++;
  return {
    state: state,
    accept: true,
  };
};
var matchJoin = function (ctx, logger, nk, dispatcher, tick, state, presences) {
  for (var _i = 0, presences_1 = presences; _i < presences_1.length; _i++) {
    var presence = presences_1[_i];
    state.emptyTicks = 0;
    state.presences[presence.userId] = {
      user: presence,
      points: 0,
    };
    dispatcher.broadcastMessage(
      OpCode.PRESENCE,
      JSON.stringify({
        presences: state.presences,
      })
    );
    dispatcher.broadcastMessage(
      OpCode.MESSAGE,
      JSON.stringify({
        sender: presence.username,
        content: 'Joined the game.',
        color: '#26abff',
      })
    );
    state.joinsInProgress--;
    if (state.gameHost === null) {
      state.gameHost = presence;
    }
    dispatcher.broadcastMessage(OpCode.UPDATE, JSON.stringify(state), [presence]);
  }
  // Check if match was open to new players, but should now be closed.
  if (Object.keys(state.presences).length >= state.maxPlayers && state.label.open != 0) {
    state.label.open = 0;
    var labelJSON = JSON.stringify(state.label);
    dispatcher.matchLabelUpdate(labelJSON);
  }
  return {
    state: state,
  };
};
var matchLeave = function (ctx, logger, nk, dispatcher, tick, state, presences) {
  var _a;
  for (var _i = 0, presences_2 = presences; _i < presences_2.length; _i++) {
    var presence = presences_2[_i];
    delete state.presences[presence.userId];
    if (presence.userId === ((_a = state.drawer) === null || _a === void 0 ? void 0 : _a.userId)) {
      state.isDrawing = false;
      chooseDrawer(state, logger);
      if (state.drawers.length === connectedPlayers(state)) {
        if (state.currentRound === state.rounds) {
          state.playing = false;
          state.isGameOver = true;
          state.currentState = GameStateEnum.GAME_OVER;
          state.deadlineRemainingTicks = tickRate * 5;
          state.winner = Object.values(state.presences).reduce(function (prev, current) {
            return prev.points > current.points ? prev : current;
          }).user;
          dispatcher.broadcastMessage(
            OpCode.GAMEOVER,
            JSON.stringify({
              winner: state.winner,
              users: Object.values(state.presences),
              round: state.currentRound,
              totalRounds: state.rounds,
              timePerTurn: state.timePerTurn,
            })
          );
        } else {
          state.currentRound++;
          state.drawers = [];
          state.newRound = true;
          state.drawer = EMPTYYPRESENCE;
          state.currentState = GameStateEnum.END_TURN;
          state.deadlineRemainingTicks = tickRate * 5;
          dispatcher.broadcastMessage(
            OpCode.ENDTURN,
            JSON.stringify({
              isGameOver: state.isGameOver,
              guessedUsers: state.guessedUsers,
              users: Object.values(state.presences),
            })
          );
        }
      } else {
        state.newRound = true;
        state.currentState = GameStateEnum.END_TURN;
        state.deadlineRemainingTicks = tickRate * 5;
        dispatcher.broadcastMessage(
          OpCode.ENDTURN,
          JSON.stringify({
            isGameOver: state.isGameOver,
            guessedUsers: state.guessedUsers,
            users: Object.values(state.presences),
          })
        );
      }
    }
    dispatcher.broadcastMessage(
      OpCode.PRESENCE,
      JSON.stringify({
        presences: state.presences,
      })
    );
    dispatcher.broadcastMessage(
      OpCode.MESSAGE,
      JSON.stringify({
        sender: presence.username,
        content: 'left the game.',
        color: '#EF4444',
      })
    );
  }
  //check if gamehost left and set gamehost to first player in state.presences if there is one
  if (state.gameHost !== null) {
    for (var _b = 0, presences_3 = presences; _b < presences_3.length; _b++) {
      var presence = presences_3[_b];
      if (presence.userId === state.gameHost.userId) {
        state.gameHost = null;
        //get first player in state.presences not equal to null
        for (var _c = 0, _d = Object.keys(state.presences); _c < _d.length; _c++) {
          var userID = _d[_c];
          if (userID !== presence.userId) {
            state.gameHost = state.presences[userID].user;
            dispatcher.broadcastMessage(
              OpCode.GAMEHOST,
              JSON.stringify({
                gameHost: state.gameHost,
              })
            );
            break;
          }
        }
        break;
      }
    }
  }
  //check if non null presences length is less than 2
  if (Object.keys(state.presences).length < 2) {
    state.playing = false;
    state.words = [];
    state.newRound = false;
    state.selectedWord = '';
    state.isChoosingWord = false;
    state.currentRound = 1;
    state.currentTime = 0;
    state.drawer = EMPTYYPRESENCE;
    state.isDrawing = false;
    state.drawers = [];
    state.guessedUsers = {};
    state.deadlineRemainingTicks = 0;
    //get user with highest points
    state.winner = Object.values(state.presences).reduce(function (prev, current) {
      return prev.points > current.points ? prev : current;
    }).user;
    state.currentState = GameStateEnum.GAME_OVER;
    dispatcher.broadcastMessage(
      OpCode.GAMEOVER,
      JSON.stringify({
        winner: state.winner,
        users: Object.values(state.presences),
        round: state.currentRound,
        totalRounds: state.rounds,
        timePerTurn: state.timePerTurn,
      })
    );
  }
  return {
    state: state,
  };
};
var matchLoop = function (ctx, logger, nk, dispatcher, tick, state, messages) {
  if (connectedPlayers(state) + state.joinsInProgress === 0) {
    state.emptyTicks++;
    if (state.emptyTicks >= 10 * tickRate) {
      // Match has been empty for too long, close it.
      logger.info('closing idle match');
      return null;
    }
  }
  switch (state.currentState) {
    case GameStateEnum.LOBBY:
      return lobbyLoop(ctx, logger, nk, dispatcher, tick, state, messages);
    case GameStateEnum.NEW_ROUND:
      return newRoundLoop(ctx, logger, nk, dispatcher, tick, state, messages, chooseDrawer, getWords);
    case GameStateEnum.SELECT_WORD:
      return selectWordLoop(ctx, logger, nk, dispatcher, tick, state, messages);
    case GameStateEnum.DRAWING:
      return drawingLoop(ctx, logger, nk, dispatcher, tick, state, messages, connectedPlayers, EMPTYYPRESENCE);
    case GameStateEnum.END_TURN:
      return endTurnLoop(ctx, logger, nk, dispatcher, tick, state, messages, chooseDrawer, getWords);
    case GameStateEnum.GAME_OVER:
      return gameOverLoop(ctx, logger, nk, dispatcher, tick, state, messages, EMPTYYPRESENCE);
  }
  // // // There's a game in progresstate. Check for input, update match state, and send messages to clientstate.
  // if (state.isChoosingWord) {
  // 	state.deadlineRemainingTicks++;
  // 	if (state.deadlineRemainingTicks >= deadline) {
  // 		//choose random word from state.words
  // 	}
  // }
  // if (state.isDrawing) {
  // 	if (state.currentTime == 0) {
  // 		const message: ChatMessage = {
  // 			sender: "The word was ",
  // 			content: `"${state.selectedWord}"`,
  // 			color: "#84CC16",
  // 		};
  // 		state.selectedWord = "";
  // 		const tmpDrawer = state.drawer;
  // 		if (tmpDrawer) {
  // 			const tmpPr = state.presences[tmpDrawer.userId];
  // 			// give points to drawer based on guessed users e.g 400 points if all users guessed the word and 0 if no one guessed the word
  // 			if (tmpPr)
  // 				tmpPr.points += Math.floor(
  // 					400 *
  // 						(Object.keys(state.guessedUsers).length /
  // 							(connectedPlayers(state) - 1))
  // 				);
  // 		}
  // 		dispatcher.broadcastMessage(OpCode.MESSAGE, JSON.stringify(message));
  // 		state.isDrawing = false;
  // 		if (state.drawers.length == connectedPlayers(state)) {
  // 			if (state.currentRound == state.rounds) {
  // 				state.playing = false;
  // 				state.isGameOver = true;
  // 				dispatcher.broadcastMessage(
  // 					OpCode.GAMEOVER,
  // 					JSON.stringify({
  // 						users: Object.values(state.presences),
  // 						round: state.currentRound,
  // 						totalRounds: state.rounds,
  // 						timePerTurn: state.timePerTurn,
  // 					})
  // 				);
  // 			}
  // 			state.currentRound++;
  // 			state.newRound = true;
  // 			state.guessedUsers = {};
  // 			state.drawers = [];
  // 			state.drawer = null;
  // 			dispatcher.broadcastMessage(
  // 				OpCode.ENDTURN,
  // 				JSON.stringify({
  // 					isGameOver: state.isGameOver,
  // 					guessedUsers: state.guessedUsers,
  // 					users: Object.values(state.presences),
  // 				})
  // 			);
  // 		} else {
  // 			state.newRound = false;
  // 			dispatcher.broadcastMessage(
  // 				OpCode.ENDTURN,
  // 				JSON.stringify({
  // 					isGameOver: state.isGameOver,
  // 					guessedUsers: state.guessedUsers,
  // 					users: Object.values(state.presences),
  // 				})
  // 			);
  // 		}
  // 		state.guessedUsers = {};
  // 		state.isDrawing = false;
  // 		state.currentTime = state.timePerTurn;
  // 	} else {
  // 	}
  // 	//decrement timer every 15 ticks
  // }
  // for (const message of messages) {
  // 	logger.info("Received message: %s", message.opCode);
  // 	switch (message.opCode) {
  // 		case OpCode.START:
  // 			break;
  //
  // 		case OpCode.WORDIS:
  // 			logger.info("hereeeeeeeeeeeeeeeeeeeeeeeeeeeee");
  // 			let wordisMessage = {} as WordMessage;
  // 			try {
  // 				wordisMessage = JSON.parse(nk.binaryToString(message.data));
  // 			} catch (error) {
  // 				// Client sent bad data.
  // 				dispatcher.broadcastMessage(OpCode.REJECTED, null, [message.sender]);
  // 				logger.info("Bad data received: %v", error);
  // 				continue;
  // 			}
  // 			logger.info("word is %s", wordisMessage.word);
  // 			state.isChoosingWord = false;
  // 			state.deadlineRemainingTicks = 0;
  // 			state.selectedWord = wordisMessage.word;
  // 			dispatcher.broadcastMessage(
  // 				OpCode.WORDIS,
  // 				JSON.stringify({
  // 					word: state.selectedWord,
  // 				})
  // 			);
  // 			dispatcher.broadcastMessage(
  // 				OpCode.MESSAGE,
  // 				JSON.stringify({
  // 					sender: state.drawer?.username,
  // 					content: "is drawing now!",
  // 					color: "#8B5CF6",
  // 				})
  // 			);
  // 			state.isDrawing = true;
  // 			state.currentTime = state.timePerTurn;
  // 			logger.info("time is %s", state.currentTime);
  // 			logger.info("timeturn is %s", state.timePerTurn);
  // 			break;
  // 		case OpCode.DRAW:
  // 			let msg = {};
  // 			try {
  // 				msg = JSON.parse(nk.binaryToString(message.data));
  // 			} catch (error) {
  // 				// Client sent bad data.
  // 				dispatcher.broadcastMessage(OpCode.REJECTED, JSON.stringify({}), [
  // 					message.sender,
  // 				]);
  // 				logger.debug("Bad data received: %v", error);
  // 				continue;
  // 			}
  // 			logger.debug("Received update: %v", msg);
  // 			dispatcher.broadcastMessage(message.opCode, JSON.stringify(msg));
  // 			break;
  // 		case OpCode.CLEAR:
  // 			dispatcher.broadcastMessage(message.opCode, JSON.stringify({}));
  // 			break;
  // 		case OpCode.CHANGESETTINGS:
  // 			let msg2 = {} as SettingsMessage;
  // 			try {
  // 				msg2 = JSON.parse(nk.binaryToString(message.data));
  // 			} catch (error) {
  // 				// Client sent bad data.
  // 				dispatcher.broadcastMessage(OpCode.REJECTED, null, [message.sender]);
  // 				logger.debug("Bad data received: %v", error);
  // 				continue;
  // 			}
  // 			// Update rounds,timeperround, and maxplayers
  // 			state.rounds = msg2.rounds;
  // 			state.timePerTurn = msg2.timePerTurn;
  // 			logger.info(
  // 				"Change settings with time per turn: %s",
  // 				state.timePerTurn
  // 			);
  // 			state.maxPlayers = msg2.maxPlayers;
  // 			state.label.open = msg2.open ? 1 : 0;
  // 			state.label.maxPlayers = msg2.maxPlayers;
  // 			state.label.name = msg2.name;
  // 			const labelJSON = JSON.stringify(state.label);
  // 			dispatcher.matchLabelUpdate(labelJSON);
  // 			dispatcher.broadcastMessage(message.opCode, JSON.stringify(msg2));
  // 			break;
  // 		case OpCode.KICK:
  // 			//get the user who sent the message
  // 			const sender = message.sender.userId;
  // 			let msg3 = {} as KickMessage;
  // 			try {
  // 				msg3 = JSON.parse(nk.binaryToString(message.data));
  // 			} catch (error) {
  // 				dispatcher.broadcastMessage(OpCode.REJECTED, null, [message.sender]);
  // 				logger.debug("Bad data received: %v", error);
  // 				continue;
  // 			}
  // 			//check if the user who sent the message is the game host
  // 			if (state.gameHost?.userId === sender) {
  // 				//get presence of user to kick
  // 				const presence = state.presences[msg3.userId];
  // 				if (presence != null) {
  // 					dispatcher.broadcastMessage(
  // 						OpCode.KICKED,
  // 						JSON.stringify({ userId: msg3.userId }),
  // 						[presence.user]
  // 					);
  // 					dispatcher.matchKick([presence.user]);
  // 				}
  // 				//notify the user who was kicked
  // 			}
  // 			break;
  // 		default:
  // 			logger.error("Unexpected opcode received: %d", message.opCode);
  // 	}
  // }
  return {
    state: state,
  };
};
function chooseDrawer(state, logger) {
  var _a;
  var players = Object.keys(state.presences);
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
    state.drawers.push(dr.user);
    state.drawer = dr.user;
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
var matchTerminate = function (ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
  return {
    state: state,
  };
};
var matchSignal = function (ctx, logger, nk, dispatcher, tick, state) {
  return {
    state: state,
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
    matchSignal: matchSignal,
  });
  initializer.registerRpc('creatematch', createMatch);
  initializer.registerRpc('health', healthcheck);
  initializer.registerRpc('listmatches', matchList);
  logger.info('TypeScript modules loadaed.');
}
// Reference InitModule to avoid it getting removed on build
!InitModule && InitModule.bind(null);
