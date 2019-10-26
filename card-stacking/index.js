var express = require('express')
var app = express()
var path = require('path')
var PORT = process.env.PORT || 5000
var server = require('http').createServer(app);
var io = require('socket.io')(server,{});
var arrDiff = require('array-difference');



app.use(express.static(path.join(__dirname, 'public')))
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'ejs')
app.get('/', (req, res) => res.render('pages/index'))
app.get('/game', (req,res) => res.render('pages/game'))

server.listen(PORT, () => console.log(`Listening on ${ PORT }`))

//START GLOBAL VARIABLES
//this will store arrays of people in different rooms, with room code as the key
rooms = {};

//stores sockets indexed by id
var socket_list = {};

//names of sockets indexed by id
var socket_names = {};

//kind of cards that can show up in the lineup
const lineup_types = ['green arrow', 'bane', 'nth metal', 'fastest man alive'];

const victorypoints = {
  'weakness': -1,
  'vulnerability': 0,
  'punch': 0,
  'kick': 1,
  'bane': 1,
  'nth metal': 1,
  'fastest man alive': 1,
  'green arrow': 1,
  'ras al ghul': 4, 
  'The Joker': 5
}
//END GLOBAL VARIABLES



//START DICTIONARIES CONTAINING DICTIONARIES OR ARRAYS OF INFO USED ON A PER ROOM BASIS

//dictionary containing list of possible heroes for each room (indexed by room name)
room_hero_list = {};//poop

//dictionary containing true or false values for each room name
room_game_is_active = {};

//player order for each room name by player name
room_player_order = {};

//current line up for each room name
room_line_up = {};

//index of current player in player order by room name
room_currPlayer = {};

//socket ids of players in the active game for each room, ordered by player order
room_player_sockets = {};

//super villain lineup the players work through, keyed by room name
room_remainingVillains = {};

room_player_hands = {};
room_player_discards = {};
room_player_decks = {};

//heroes for each socket id in each room
room_socket_heroes= {};

//END DICTIONARIES CONTAINING DICTIONARIES OR ARRAYS OF INFO USED ON A PER ROOM BASIS

//generates a random sub array from arr of length size
function getRandomSubarray(arr, size) {
  var shuffled = arr.slice(0), i = arr.length, temp, index;
  while (i--) {
      index = Math.floor((i + 1) * Math.random());
      temp = shuffled[index];
      shuffled[index] = shuffled[i];
      shuffled[i] = temp;
  }
  return shuffled.slice(0, size);
};

//use to subtract arr2 from arr while removing on a one-to-one basis - takes away first instance it finds
function removeFrom(arr,arr2) {
  var newarr = arr;
  for(var i = 0; i<arr2.length; i++){
    for(var k = 0; k<newarr.length; k++){
      if(arr2[i] == newarr[k]){
        index = newarr.indexOf(newarr[k]);
        newarr.splice(index,1);
        break;
      }
    }
  }
  return newarr;
};

//This is where all of the game logic is placed
io.sockets.on('connection', function(socket){
  //for identifying the socket 
  socket.id = Math.random();

  //stores all socket in array indexed by socket id
  socket_list[socket.id] = socket;

  //for logging info from client to debug to the terminal
  socket.on('log', function(data){
    console.log(data.message);
  });

  //building my own room functionality 
  function JoinRoom(socket, room){
    currentRooms = Object.keys(rooms);

    //if no rooms exist or the room requested does not exist
    if(typeof Object.keys(rooms) == 'undefined' || currentRooms.indexOf(room) == -1){
      rooms[room] = [socket.id];

      //INITIALIZE ALL THE VALUES OF THE ROOM HERE
      room_hero_list[room] = ['Superman', 'Wonderwoman', 'The Flash', 'Cyborg', 'Green Lantern', 'Batman', 'Aquaman']

      //dictionary containing true or false values for each room name
      room_game_is_active[room] = false;

      //player order for each room name by player name
      room_player_order[room] = [];

      //current line up for each room name
      room_line_up[room] = []

      //index of current player in player order by room name
      room_currPlayer[room] = 0;

      //socket ids of players in the active game for each room, ordered by player order
      room_player_sockets[room] = [];

      //super villain lineup the players work through, keyed by room name
      room_remainingVillains[room] = ['ras al ghul', 'The Joker'];

      room_player_hands[room] = {};
      room_player_discards[room] = {};
      room_player_decks[room] = {};

      //heroes for each socket id in the room
      room_socket_heroes[room] = {};
      Broadcast(socket.id, room, 'quantUpdate', true, {
        players: rooms[room].length
      })
    }

    //if room does exist
    else{
      rooms[room].push(socket.id);
      Broadcast(socket.id, room, 'quantUpdate', true, {
        players: rooms[room].length
      })
    }

    //tell the user they joined the room to update room holder at the top
    socket.emit('joinedRoom', {
      room: room
    });

    //for the chat
    socket.emit('newMessage', {
      message: "You joined room " + room
    })
  }

  //build broadcast function to go with custom room functionality
  function Broadcast(senderID, room, emitType, toSender, data){
    for(var i = 0; i<rooms[room].length; i++){
      //skip over the broadcaster
      if(senderID == rooms[room][i] && toSender == false)
        continue;
      socket_list[rooms[room][i]].emit(emitType, data);
    }
  }

  function LeaveRoom(){
    //find the user's room
    currentRooms = Object.keys(rooms);
    
    room = 'null'
    for(var i = 0; i<currentRooms.length; i++){
      if(rooms[currentRooms[i]].indexOf(socket.id) != -1){
        room = currentRooms[i];
      }
    }
    if(room == 'null'){
      socket.emit('newMessage', {
        message: "You have no room to leave"
      })
      return;
    }
    
    //if the room has a game going, reset it 
    if (room_game_is_active[room] == 1) {
      Broadcast(socket.id, room, 'reset', true, {})
      room_game_is_active[room] = 0
      msg = socket_names[socket.id] + " left your room and reset the game!"
    }
    else {
      msg = socket_names[socket.id] + " left your room!"
    }

    socket.emit('leftRoom'); // on client side this will just empty the room paragraph inner html

    index = rooms[room].indexOf(socket.id);
   
    //remove user from the room
    rooms[room].splice(index,1);

    //notify all other room members the person has left the room
    Broadcast(socket.id, room, 'newMessage', false, {
      message: msg
    })

    //tell user they left
    socket.emit('newMessage', {
      message: "You left room " + room
    })
  }

  function GetSocketRoom(){
    currentRooms = Object.keys(rooms)

    for(var i = 0; i<currentRooms.length; i++){
      index = rooms[currentRooms[i]].indexOf(socket.id)
      if(index != -1)
        return currentRooms[i]
    }
    return "null"
  }

  //chat is used for sending messages and for resetting the game
  socket.on('chat', function(data){
    var msg = data.message.toString()
    //room names must be 6 characters
    if(msg.substring(0,10) == "JOIN ROOM " && msg.length == 16){
      currentRooms = Object.keys(rooms);

      //check if user is already in a room (a user should only be in one room at a time)
      for(var i = 0; i<currentRooms.length; i++){
        if(rooms[currentRooms[i]].indexOf(socket.id) != -1){
          socket.emit('newMessage', {
            message: "You must leave your room before joining a new one"
          })
          return;
        }
      }
      room = msg.substring(10,17);
      //join the room
      JoinRoom(socket, room);

      //broadcast to other room members that you joined
      Broadcast(socket.id, room, 'newMessage', false, {
        message: socket_names[socket.id] + " has joined your room!"
      });

      return;
    }

    if(msg == "LEAVE") {
      LeaveRoom();
      return;
    }

    if(msg == 'kick'){
      room_player_decks[GetSocketRoom()][socket.id].unshift('kick');
      return;
    }
    //for debugging purposes
    if(msg == "AQUAMAN"){
      hero = 'Aquaman';
      index = hero_list.indexOf(hero.toString());
      hero_list.splice(index,1);
      socket_heroes[socket.id] = hero;
      socket.emit('setHero', {
        name: hero 
      })
      return;
    }

    if(msg == "LANTERN"){
      hero = 'Green Lantern';
      index = hero_list.indexOf(hero.toString());
      hero_list.splice(index,1);
      socket_heroes[socket.id] = hero;
      socket.emit('setHero', {
        name: hero 
      })
      return;
    }

    if(msg == "WONDER"){
      hero = 'Wonderwoman';
      index = hero_list.indexOf(hero.toString());
      hero_list.splice(index,1);
      socket_heroes[socket.id] = hero;
      socket.emit('setHero', {
        name: hero 
      })
      return;
    }

    if(msg == "CYBORG"){
      hero = 'Cyborg';
      index = hero_list.indexOf(hero.toString());
      hero_list.splice(index,1);
      socket_heroes[socket.id] = hero;
      socket.emit('setHero', {
        name: hero 
      })
      return;
    }

    if(msg == "FLASH"){
      hero = 'The Flash';
      index = hero_list.indexOf(hero.toString());
      hero_list.splice(index,1);
      socket_heroes[socket.id] = hero;
      socket.emit('setHero', {
        name: hero 
      })
      return;
    }

    if(msg == "RESET"){
      //cannot reset if they are not in a game
      room = GetSocketRoom()
      if(room == "null")
        return;

      room_hero_list[room] = ['Superman', 'Wonderwoman', 'The Flash', 'Cyborg', 'Green Lantern', 'Batman', 'Aquaman'];
      room_socket_heroes[room] = {};
      room_player_hands[room] = {};
      room_player_decks[room] = {};
      room_player_discards[room] = {};

      //array with names in order
      room_player_order[room] = [];
      room_player_sockets[room] = [];
      room_currPlayer[room] = 0;
      room_remainingVillains[room] = ['ras al ghul', 'The Joker'];
      room_game_is_active[room] = false;

      Broadcast(socket.id, room, 'newMessage', true, {
        message: "The game has been reset"
      })

      Broadcast(socket.id, room, 'reset', true, {})
      
      return;
    }

    //when player tries to start the game
    if(msg == "START"){
      room = GetSocketRoom();
      //cannot start game if not in a room
      if(room == 'null')
        return;
      //if game has already started
      if(room_game_is_active[room]){
        socket.emit('newMessage', {
          message: "the game has already started"
        })
        return;
      }

      //has to be at least two players with heroes in order to play
      if(Object.keys(room_socket_heroes[room]).length < 2) {
        socket.emit('newMessage', {
          message: "must have at least two players to start game"
        })
        return;
      }

      //standard behavior for starting the game in the player's room
      else {
        //set these variables to make old code usable without having to change very much
        player_decks = room_player_decks[room];
        player_discards = room_player_discards[room];
        player_hands = room_player_hands[room];
        socket_heroes = room_socket_heroes[room];
        player_order = [];
        line_up = []
        //end setting variables - we will reset the room variables at the end of this entire else statement

        room_game_is_active[room] = true;

        Broadcast(socket.id, room, 'newMessage', true, {
          message: "The game has started with " + Object.keys(socket_heroes).length + " players"
        });
        Broadcast(socket.id, room, 'begin', true, {});
        /*
        //send message of game starting
        for(var s in socket_list) {
          socket_list[s].emit('newMessage', {
            message: "The game has started with " + Object.keys(socket_heroes).length + " players"
          }) 
          socket_list[s].emit('begin');
        }*/

        //instantiate decks with starters
        for(var s in socket_heroes) {
          player_decks[s] = ['punch','punch','punch','punch','punch','punch','punch','vulnerability','vulnerability','vulnerability']
        }
        //everyone draw initial hand
        for(var s in socket_heroes) {
          //split the deck in half randomly to create first hands and first decks
          player_hands[s] = getRandomSubarray(player_decks[s],5);
          player_decks[s] = removeFrom(player_decks[s],player_hands[s]);
        }
        //emit hands to each player 
        for(var s in socket_heroes) {
          socket_list[s].emit('newHand', {
            hand: player_hands[s]
          })
        }

        var flash = "";
       
        //pick player order
        for(var s in socket_heroes){
          if(socket_heroes[s] == "The Flash"){
            flash = s.toString();
            break;
          }
        }
        
        //if someone is the flash
        if(flash != ""){
          //only include people who have heroes
          player_sockets = Object.keys(socket_heroes);

          first = [flash]
        
          player_sockets = removeFrom(player_sockets, first);
        
          player_sockets = getRandomSubarray(player_sockets,player_sockets.length);
          
          player_sockets = first.concat(player_sockets);
          

          //for sending the message to players
          for(var i=0; i<player_sockets.length; i++){
            player_order[i] = socket_names[player_sockets[i]];
          }
        }
        else {
          player_sockets = Object.keys(socket_heroes);
          player_sockets = getRandomSubarray(player_sockets,player_sockets.length);
          for(var i=0; i<player_sockets.length; i++){
            player_order[i] = socket_names[player_sockets[i]];
          }
        }
        //end flash handling
        
        //send message to players for player order
        Broadcast(socket.id, room, 'newMessage', true, {
          message: "Player Order: " + player_order.toString()
        });
        
        //initialize the line up 
        for(var i = 0; i<5; i++){
          line_up[i] = getRandomSubarray(lineup_types,1)[0];
        }
        
        firstPlayerID = player_sockets[0]
        //broadcast turn status to everyone else as well as line up updates
        Broadcast(firstPlayerID, room, 'othersTurn', false, {
          other: player_order[0].toString(),
          lineup: line_up
        })
        Broadcast(firstPlayerID, room, 'newMessage', false, {
          message: "It is " + player_order[0] + "'s turn"
        });

        //send your turn status to first player
        socket_list[firstPlayerID].emit('yourTurn', {
            lineup: line_up
        });
        socket_list[firstPlayerID].emit('newMessage', {
            message: "It is your turn!"
        });

        //SET ALL RELEVANT ROOM VARIABLES
        room_player_decks[room] = player_decks
        room_player_discards[room] = player_discards
        room_player_hands[room] = player_hands
        room_socket_heroes[room] = socket_heroes
        room_player_order[room] = player_order;
        room_line_up[room] = line_up; 
        room_player_sockets[room] = player_sockets;
    }
  }

    //default chat behavior for sending messages
    else {
      room = GetSocketRoom();
      if(room == 'null')
        return;
      Broadcast(socket.id, room, 'newMessage', false, {
        message: socket_names[socket.id] + ": " + msg
      })
      socket.emit('newMessage', {
        message: "You: " + msg
      })
    }
  });

  //FOR WHEN THE PLAYER ENDS THEIR TURN
  socket.on('endTurn', function(data){
    bought = data.bought; //the names of the purchased cards
    oldhand = player_hands[socket.id];         //what was in their hand
    replace = data.replace;    //indexes of cards in lineup that have to be replacted
    newlineup = line_up;
    boughtvil = data.boughtvil;

    //to get rid of ras duplication problem
    if(oldhand.indexOf('ras al ghul') != -1){
      oldhand.splice(oldhand.indexOf('ras al ghul'), 1)
    }
    //set these variables now so i dont have to change code
    room = GetSocketRoom();
    player_decks = room_player_decks[room]
    player_discards = room_player_discards[room]
    player_hands = room_player_hands[room]
    currPlayer = room_currPlayer[room]

    player_sockets = room_player_sockets[room]
    //discard hand and bought items
    if(typeof player_discards[socket.id] == 'undefined' || player_discards[socket.id].length == 0)
      player_discards[socket.id] = oldhand.concat(bought);
    else 
      player_discards[socket.id] = player_discards[socket.id].concat(oldhand).concat(bought); //fill up the discard pile with old cards

    player_hands[socket.id] = []
    //if deck big enough to draw 5 cards
    if(player_decks[socket.id].length >= 5){
      for(var i = 0; i < 5; i++){
        //select first five cards from the deck
        player_hands[socket.id][i] = player_decks[socket.id][i]
      }
      //remove selected cards from deck
      player_decks[socket.id] = removeFrom(player_decks[socket.id],player_hands[socket.id])
    }

    else if(player_decks[socket.id].length == 0){
      player_decks[socket.id] = getRandomSubarray(player_discards[socket.id],player_discards[socket.id].length);
      for(var i = 0; i < 5; i++){
        //select first five cards from the deck
        player_hands[socket.id][i] = player_decks[socket.id][i];
      }
      player_discards[socket.id] = [];
      player_decks[socket.id] = removeFrom(player_decks[socket.id],player_hands[socket.id])
    }

    else {
      //for as many cards are left
      
      var j = 0;
      for(var i = 0; i < player_decks[socket.id].length; i++){
        player_hands[socket.id][i] = player_decks[socket.id][i]
        j = i;
      }

      //deck should now be empty
      player_decks[socket.id] = [];

      //randomize the deck
      player_decks[socket.id] = getRandomSubarray(player_discards[socket.id],player_discards[socket.id].length);
      player_discards[socket.id] = []; //empty the discard pile


      //fill the rest of the hand
      var index = 0; //index of cards in deck to draw
      
      added = [];
      for(var i = j+1; i < 5; i++){
        player_hands[socket.id][i] = player_decks[socket.id][index]
        index = index + 1;
        added.push(player_hands[socket.id][i]);
      }

      //remove picked cards from deck
      player_decks[socket.id] = removeFrom(player_decks[socket.id], added);

    }

    //reset the room variables to their proper values
    room_player_decks[room] = player_decks
    room_player_discards[room] = player_discards
    room_player_hands[room] = player_hands

    //for testing
    if(socket_names[socket.id] == 'jakob'){
    console.log("discard");
    console.log(player_discards[socket.id]);

    console.log("deck");
    console.log(player_decks[socket.id]);     

    console.log("hand");
    console.log(player_hands[socket.id]);
    }

    //notify user of new hand
    socket.emit('newHand', {
      hand: player_hands[socket.id],
      respondForSV: boughtvil
    });

    //END HANDLING FOR THE USER WHOSE TURN IT WAS
    //BEGIN THE HANDLING FOR REPLACING CARDS IN THE LINE UP

    //choose random cards
    for(var i = 0; i<replace.length; i++){
      //pick random card from line up types
      newCard = getRandomSubarray(lineup_types,1);
      newCardStr = newCard[0];

      //make the assignment
      newlineup[replace[i]] = newCardStr;
    }

    //keep the old player (player whose turn it was)
    oldPlayer = socket_names[player_sockets[currPlayer]];
    oldInd = currPlayer;

    //increment to the next player
    if(currPlayer == player_sockets.length - 1){
      currPlayer = 0
    }
    else {
      currPlayer = currPlayer + 1;
    }

    //notify the old player of what they bought
    socket_list[player_sockets[oldInd]].emit('newMessage', {
      message: "You bought " + bought.toString()
    })

    playerName = socket_names[player_sockets[oldInd]]; //gets name of player whose turn just ended

    //tell other players what the person bought
    Broadcast(player_sockets[oldInd], room, 'newMessage', false, {
      message: playerName + " has bought " + bought.toString()
    })

    newPlayer = socket_names[player_sockets[currPlayer]]; //name of new guy
    //tell everyone besides curr player it is an OTHERs turn 
    Broadcast(player_sockets[currPlayer], room, 'othersTurn', false, {
      lineup: newlineup,
      other: newPlayer
    })
    Broadcast(player_sockets[currPlayer], room, 'newMessage', false, {
      message: "It is " + newPlayer + "'s turn"
    });
  
    //send stuff to the new current player
    socket_list[player_sockets[currPlayer]].emit('yourTurn',{
      lineup: newlineup
    })
    socket_list[player_sockets[currPlayer]].emit('newMessage', {
        message: "It is your turn"
    });

    //reset the other variables
    room_currPlayer[room] = currPlayer
  });

  //for when a SV attacks
  socket.on('newSV', function(){
     //when player kills a super villain
      room = GetSocketRoom();
      vil = room_remainingVillains[room][0];
      player_sockets = room_player_sockets[room];
      player_decks = room_player_decks[room]
      player_hands = room_player_hands[room]
      player_discards = room_player_discards[room]
      //eliminate the first super villain from the list
      room_remainingVillains[room].splice(0,1);
  
      //if all the villains are dead, GAME OVER and calculate victory points for everyone to display
      if(room_remainingVillains[room].length == 0){
        playervctpts = {}
        //get victory points for all of the players
        for(var j = 0; j<player_sockets.length; j++){
          s = player_sockets[j];
          vctpts = 0;
  
          //victory points in deck
          for(var i = 0; i<player_decks[s].length; i++){
            vctpts = vctpts + victorypoints[player_decks[s][i]];
          }
  
          //victory points in hands
          for(var i = 0; i<player_hands[s].length; i++){
            vctpts = vctpts + victorypoints[player_hands[s][i]];
          }
  
          //victory points in discards
          for(var i = 0; i<player_discards[s].length; i++){
            vctpts = vctpts + victorypoints[player_discards[s][i]];
          }
  
          playervctpts[socket_names[s]] = vctpts;
        }
        Broadcast(socket.id, room, 'GAMEOVER', true, {
          vctpts: playervctpts
        })
      }
  
      //if game isnt over, send next super villain to everyone
      else{
        Broadcast(socket.id, room, 'newVillain', true, {
          villain: room_remainingVillains[room][0]
        })
        superVillainAttack(room_remainingVillains[room][0])
      }
  });

  //newName is used to take in a player's name when they change it and broadcast that new name
  socket.on('newName', function(data){
    var newname = data.newname.toString()
    socket_names[socket.id] = newname;

    room = GetSocketRoom();
    if(room == 'null'){
      socket.emit('newMessage', {
        message: "You changed your name to " + newname
      })
      return;
    }
      
    Broadcast(socket.id, room, 'newMessage', false, {
      message: socket_names[socket.id] + " changed their name to " + newname
    })
    socket.emit('newMessage', {
      message: "You changed your name to " + newname
    })
  });

  //on disconnect we say that a player has left the chat and also erase the player from the game
  socket.on('disconnect', function(){
    //RESET the game if one of the players disconnects
    room = GetSocketRoom();
    //doesnt matter if a user not in a room leaves
    if(room == 'null')
      return;

    //remove the socket from the room if it disconnects
    index = rooms[room].indexOf(socket.id);
    rooms[room].splice(index,1);
    
    var wasaplayer = 0;
    if(room_player_sockets[room].indexOf(socket.id.toString()) != -1){
    room_game_is_active[room] = false;
    room_hero_list[room] = ['Superman', 'Wonderwoman', 'The Flash', 'Cyborg', 'Green Lantern', 'Batman', 'Aquaman'];
    room_socket_heroes[room] = {};
    room_player_hands[room] = {};
    room_player_discards[room] = {};
    room_player_decks[room] = {};
    room_player_order[room] = [];
    room_player_sockets[room] = [];
    room_currPlayer[room] = 0;

    //send messages to remaining players
    Broadcast(socket.id, room, 'newMessage', false, {
      message: socket_names[socket.id] + " left and reset the game"
    })

    //send reset 
    Broadcast(socket.id, room, 'reset', false, {});
    
    wasaplayer = 1;
    } //END of RESET code on disconnect

    var hadHero = 0;
    if(typeof room_socket_heroes[room][socket.id] != 'undefined'){
      var hero = room_socket_heroes[room][socket.id];
      room_hero_list[room].push(hero.toString());
      hadHero = 1;
    } 
    var name = 'undefined';
    if(typeof socket_names[socket.id] != 'undefined') {
      name = socket_names[socket.id].toString();
    }

    delete socket_list[socket.id];
    delete socket_names[socket.id];
    delete room_socket_heroes[room][socket.id];

    Broadcast(socket.id, room, 'quantUpdate', false, {
      players: Object.keys(rooms[room]).length
    })

      if(hadHero === 1 && wasaplayer != 1){ 
        Broadcast(socket.id, room, 'newMessage', false, {
          message: name + " left the super chat and now " + hero + " is available"
        }); 
    }
      else if (wasaplayer != 1){
        Broadcast(socket.id, room, 'newMessage', false, {
          message: name + " left the super chat"
        });
      }
  });

  //pickHero is used to randomly select one of the remaining available heroes
  socket.on('pickHero', function(){
    room = GetSocketRoom()
    //cant pick hero without being in a room
    if(room == 'null')
      return;
    if(room_game_is_active[room]){
      return
    }
    //use to tell a user that the game is full when they try to select a hero
    if(Object.keys(room_socket_heroes[room]).length === 5) {
      socket.emit('newMessage', {
        message: "sorry, the game is already full"
      });
    }

    //otherwise pick a random hero and broadcast the event
    else {
    var hero = room_hero_list[room][Math.floor(Math.random()*room_hero_list[room].length)];
    index = room_hero_list[room].indexOf(hero.toString());
    room_hero_list[room].splice(index,1);
    room_socket_heroes[room][socket.id] = hero;
    socket.emit('setHero', {
      name: hero
    })
    socket.emit('newMessage', {
      message: "You picked " + hero
    });
    Broadcast(socket.id, room, 'newMessage', false, {
      message: socket_names[socket.id] + " picked " + hero.toString()
    })
  }
  });

  //handling when the client requests to see their top card
  socket.on('requestTopCard', function(){
    room = GetSocketRoom();
    player_decks = room_player_decks[room];
    if(player_decks[socket.id].length == 0)
      topCard = "";

    else
      topCard = player_decks[socket.id][0];

    socket.emit('returnTopCard', {
      card: topCard
    })
  });

  //handling when the client requests to destroy their top card
  socket.on('destroyTopCard', function(){
    room = GetSocketRoom();
    room_player_decks[room][socket.id].splice(0,1);
  });

  //for aquaman power
  socket.on('pushToTop', function(data) {
    room = GetSocketRoom();
    cards = data.cards;
    for(var i = 0; i<cards.length; i++){
      room_player_decks[room][socket.id].unshift(cards[i]);
    }
  });

  //for when a player uses an attack prompting the victims to discard a card
  socket.on('discardAttack', function(data){
    num = data.num;
    room = GetSocketRoom();
    //broadcasting is very helpful for attacks
    Broadcast(socket.id, room,'attacked', false, {
      type: 'discard',
      num: num
    })
  });

  //for discarding a card of index i
  socket.on('discard', function(data) {
    room = GetSocketRoom();

    index = data.index;
    hand = data.currHand;

    //cut out the card that used to be there and store it here
    card = hand.splice(index,1);

    //discard the card
    room_player_discards[room][socket.id].push(card[0]);

    //reset player hand variable to reflect change
    room_player_hands[room][socket.id] = hand;

    socket.emit('newHand', {
      hand: room_player_hands[room][socket.id]
    })
  });

  //for drawing a card when prompted to
  socket.on('drawCard', function(data){
    room = GetSocketRoom();
    hand = room_player_hands[room][socket.id];
    //if deck empty, randomize discard into the deck 
    if(room_player_decks[room][socket.id].length == 0){
      room_layer_decks[room][socket.id] = getRandomSubarray(room_player_discards[room][socket.id]);
      room_player_discards[room][socket.id] = [];
    }

    //get top card
    topCard = room_player_decks[room][socket.id][0];
    //remove top card
    room_player_decks[room][socket.id].splice(0,1);

    //extend hand with the topCard from the deck
    hand[hand.length] = topCard;
    console.log('new hand for user is ' + hand)
    console.log('new deck for user is ' + player_decks[socket.id])

    //update the hand on server side
    room_player_hands[room][socket.id] = hand;
    socket.emit('newHand', {
      hand: hand
    })
    
    socket.emit('newMessage', {
      message: data.reason + topCard
    })
  });

  function superVillainAttack(villain){
    if(villain == 'The Joker'){
      Broadcast(socket.id, GetSocketRoom(), 'newMessage', true, {
        message: "The Joker Attacked!!! All players discard a card to the player to their left and gain a weakness if the card they gain is cost 1 or more"
      })
      Broadcast(socket.id, GetSocketRoom(), 'SVattack', true, {
        villain: villain
      });
    }
    return;
  }
  //for the joker's attack - seems to be finished ... finally -_-
  socket.on('discardToLeft', function(data){
    ind = data.index;
    room = GetSocketRoom();

    hand = room_player_hands[room][socket.id];

    starters = ['punch', 'vulnerability']
    //cut out the card that used to be there and store it here
    console.log("in the discard thing the index is " + ind)
    card = hand.splice(ind,1);
    
    //get id of player to the left
    index = room_player_sockets[room].indexOf(socket.id.toString())
    if(index < room_player_sockets[room].length - 1){
      //discard the card to player on left (next person in player_sockets)
      room_player_discards[room][room_player_sockets[room][index + 1]].push(card[0]);
      suffix = ""
      //determine if they should get a weakness
      console.log('starter index' + starters.indexOf(card[0]))
      if(starters.indexOf(card[0]) == -1){
        room_player_discards[room][room_player_sockets[room][index + 1]].push('weakness');
        suffix = " which means you gained a weakness"
      }

      socket_list[room_player_sockets[room][index + 1]].emit('newMessage', {
        message: socket_names[socket.id] + " gave you a " + card + suffix
      });
    }

    //if it is the last player in the order, wrap to the first player
    else {
      //discard
      room_player_discards[room][room_player_sockets[room][0]].push(card[0]);

      suffix = ""
      console.log('starter index' + starters.indexOf(card[0]))
      if(starters.indexOf(card[0]) == -1){
        room_player_discards[room][room_player_sockets[room][0]].push('weakness');
        suffix = " which means you gained a weakness";
      }

      socket_list[room_player_sockets[room][0]].emit('newMessage', {
        message: socket_names[socket.id] + " gave you a " + card + suffix
      })
    }
    
    //reset player hand variable to reflect change
    room_player_hands[room][socket.id] = hand;
    
    socket.emit('newHand', {
        hand: room_player_hands[room][socket.id]
    });
  });

  socket.on('placeBottomOfDeck', function(data){
      room = GetSocketRoom();
      card = data.card;
      index = data.index;
      console.log(room_player_decks[room][socket.id])
      room_player_decks[room][socket.id].push(card);
      console.log(room_player_decks[room][socket.id])
      room_player_hands[room][socket.id].splice(index,1);
    });
});
