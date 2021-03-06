'use strict';

var SockJS = require('sockjs-client');

var defs = {
	server  		: 'http://surge-server.cloudapp.net:8080',
	debug  			: false 
}

module.exports = function Surge(options){

	var events = {};
	var channels = {};
	var socket    = null;
	var rconnect = true;
	var recInterval = null;
	var reconnecting = false;
	var buffer = [];
	
	var o = options || {};

	var url = o.host || defs.server;
	var debug = o.debug || defs.debug;
	var authEndpoint = o.authEndpoint;

	var connection = new Connection();
	connection.host = url;

	//TODO: check if url is ip or not
	connect();

	var api = {
		on 					: on,
		subscribe 	: subscribe,
		unsubscribe : unsubscribe,
		disconnect 	: disconnect,
		connect 		: connect,
		emit 				: emit,
		broadcast		: broadcast,
		connection  : connection,
		channels 		: channels
	};
	return api;


 
	function on(name,callback){
    if(!events[name]) {
    	events[name] = [];
    }
    // Append event
    events[name].push(callback);
  };

	function subscribe(room){
		emit('surge-subscribe',{room:room});
		var channel = new Channel(room);
		channels[room] = channel;
		return channels[room];
	};
	function unsubscribe(room){
		emit('surge-unsubscribe',{room:room});
	};
	function disconnect(rc){
		rconnect = rc || false;
		socket.close();
		buffer = [];
	};

	function connect(){
    socket = _connect();
    _initSocket();
    _surgeEvents();
	}

	function emit(channel,name,message){
		return _emit(arguments);
	}

	function broadcast(channel,name,message){
		return _emit(arguments,true);
	}

	function _emit(args,isBroadcast){
		var data = {};
		if(args.length<2){
			console.error('emit needs at least 2 arguments');
			return false;
		}

		data.name = args[args.length-2];
		data.message = args[args.length-1];
		data.channel = args.length === 3 ? args[0] : undefined;
		data.broadcast = isBroadcast;

		if(socket){
			socket.emit(data);
		}
		else{
			logMessage('Surge : Event buffered : ' + JSON.stringify(data));
			buffer.push(JSON.stringify(data));
		}
	};

	function _connect(){
		if(socket) {
      _catchEvent({name:'surge-error',data:'Socket already connected'});
      return socket;
    }
		connection.state='connecting';
		return new SockJS(url);
	};

	function _catchEvent(response) {
		var name = response.name,
		data = response.data;
		var _events = events[name];
		if(_events) {
			var parsed = (typeof(data) === "object" && data !== null) ? data : data;
			for(var i=0, l=_events.length; i<l; ++i) {
				var fct = _events[i];
				if(typeof(fct) === "function") {
					// Defer call on setTimeout
					(function(f) {
					    setTimeout(function() {f(parsed);}, 0);
					})(fct);
				}
			}
		}
	};
	//Private functions
	function _surgeEvents(){
    on('surge-joined-room',function(data){
    	var room = data.room;
    	var subscribers = data.subscribers;
	  	if(!connection.inRoom(room)){
	  		connection.rooms.push(room);
	  		channels[room].state = 'connected';
	  		channels[room].subscribers = subscribers; 
	  		//TODO: introduce private channels
	  		channels[room].type = 'public';
			}
		});
		on('surge-left-room',function(data){
			var room = data.room;
			if(connection.inRoom(room)){
				connection.rooms.splice(connection.rooms.indexOf(room), 1);
				channels[room].state='disconnected';
				channels[room].unsubscribe = null;
				channels[room].broadcast = null;
				channels[room].emit = null;
				channels[room].subscribers = null;
			}
		});
		on('member-joined',function(data){
			channels[data.room].subscribers = data.subscribers;
		});
		on('member-left',function(data){
			channels[data.room].subscribers = data.subscribers;
		});
		on('open',function(data){
			connection.socket_id = data;
		});
	}
	function _initSocket(){
		socket.onopen = function() {
			connection.state = 'connected';
			//In case of reconnection, resubscribe to rooms
			if(reconnecting){
				reconnecting = false;
				reconnect();
			}
			else{
				flushBuffer();
			}
		};
		socket.onclose = function() {
			socket = null;
			_catchEvent({name:'close',data:{}});
			if(rconnect){
				connection.state='attempting reconnection';
				reconnecting = true;
				recInterval = setInterval(function() {
					connect();
					clearInterval(recInterval);
				}, 2000);
			}
			else{
				connection.state = 'disconnected';
			}
		};
		socket.onmessage = function (e) {
			var data = JSON.parse(e.data);
			logMessage('Surge : Event received : ' + e.data);
			_catchEvent(data);
		};
		socket.emit = function (data){
			if(connection.state==='connected'){
				logMessage('Surge : Event sent : ' + JSON.stringify(data));
				this.send(JSON.stringify(data));
			}
			else{
				logMessage('Surge : Event buffered : ' + JSON.stringify(data));
				buffer.push(JSON.stringify(data));
			}
			
		}
		function reconnect(){
			//resubscribe to rooms
			for (var i = connection.rooms.length - 1; i >= 0; i--) {
				subscribe(connection.rooms[i]);
			};
			//send all events that were buffered
			flushBuffer();
		}
	}
	function flushBuffer(){
		if(buffer.length>0){
			for (var i = 0; i < buffer.length; i++) {
				logMessage('sending message from buffer : '+buffer[i]);
				socket.send(buffer[i]);
			};
			buffer = [];
		}
	}
	function Channel(room){
		this.room = room;
		this.state = 'initializing';
		this.type = 'initializing';//public,private
		this.unsubscribe = function(){
			emit('surge-unsubscribe',{room:this.room});
		}
		this.emit = function(name,message){
			emit(this.room,name,message);
		}
		this.broadcast = function(name,message){
			broadcast(this.room,name,message);
		}
	}

	//Logger function
	function logMessage(string){
		if(debug) console.log(string);
	}
};

//	Connection class
//	Keeps details regarding the connection state,rooms,.etc
function Connection(){
	this.host  	= '';
	this.rooms  = [];
	this.state 	= 'not initialized';
	this.socket_id;
}

Connection.prototype.inRoom = function(room){
	return this.rooms.indexOf(room)>=0 ? true:false;
}