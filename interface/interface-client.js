/* global window, generate */

var underscore = require('underscore'),
	core;
var libsb = {
	user: "",
	rooms: [],
	occupantOf: [],
	memberOf: [],
	isConnected: false,
	isInited: false,
	connect: connect,
	disconnect: disconnect,
	resource: generate.uid(),

	getLoginMenu: getLoginMenu,
	getTexts: getTexts,
	getThreads: getThreads,
	getOccupants: getOccupants,
	getMembers: getMembers,
	getRooms: getRooms,
	getUsers: getUsers,
	enter: enter,
	leave: leave,
	join: join,
	part: part,
	say: say,
	admit: admit,
	expel: expel,

	logout: function () {
		core.emit("logout");
		core.emit("disconnect");
	}
};
module.exports = function (c) {
	core = c;

    for (var i in libsb) {
        if (libsb.hasOwnProperty(i)) core[i] = libsb[i];
    }
    libsb = core;

	window.libsb = libsb;

	core.on('init-dn', recvInit, 1000);
	core.on('back-dn', recvBack, 1000);
	core.on('away-dn', recvAway, 1000);
	core.on('join-dn', recvJoin, 1000);
	core.on('part-dn', recvPart, 1000);
	core.on('admit-dn', recvAdmit, 1000);
	core.on('expel-dn', recvExpel, 1000);
	// core.on('error-dn', recvError);

	core.on('connected', onConnect, 1000);
	core.on('disconnected', onDisconnect, 1000);

	core.on("init-dn", function (init, next) {
		if (!libsb.isInited) {
			libsb.isInited = true;
			core.emit("inited");
		}
		next();
	}, 10);
};

function onConnect(data, next) {
	libsb.isConnected = true;
	next();
}

function onDisconnect(payload, next) {
	libsb.isConnected = false;
	libsb.isInited = false;
	next();
}

function connect() {
	core.emit('connection-requested');
}

function disconnect() {
	core.emit('disconnect');
}

function getLoginMenu(callback) {
	core.emit('auth-menu', callback);
}

function getTexts(query, callback) {
	core.emit('getTexts', query, callback);
}

function getOccupants(roomId, callback) {
	core.emit('getUsers', {
		occupantOf: roomId
	}, callback);
}

function getMembers(roomId, callback) {
	core.emit('getUsers', {
		memberOf: roomId
	}, callback);
}

function getRooms(query, callback) {
	core.emit('getRooms', query, callback);
}

function getThreads(query, callback) {
	core.emit('getThreads', query, callback);
}

function getUsers(query, callback) {
	core.emit('getUsers', query, callback);
}

function enter(roomId, callback) {
	core.emit('back-up', {
		to: roomId
	}, callback);
}

function leave(roomId, callback) {
	core.emit('away-up', {
		to: roomId
	}, callback);
}

function join(roomId, callback) {
	core.emit('join-up', {
		to: roomId
	}, callback);
}

function part(roomId, callback) {
	core.emit('part-up', {
		to: roomId
	}, callback);
}

function say(roomId, text, thread, callback) {
	var obj = {
		to: roomId,
		text: text,
		from: libsb.user.id,
		time: new Date().getTime()
	};
	if (/^\/me /.test(text)) {
		obj.text = text.replace(/^\/me /, "");
		obj.labels = {
			action: 1
		};
	}

	if (thread) obj.threads = [{
		id: thread,
		score: 1
	}];
	core.emit('text-up', obj, callback);
}

function admit(roomId, ref, callback) {
	core.emit('admit-up', {
		to: roomId,
		ref: ref
	}, callback);
}

function expel(roomId, ref, callback) {
	core.emit('expel-up', {
		to: roomId,
		ref: ref
	}, callback);
}

function recvInit(init, next) {

	libsb.session = init.session;
	libsb.memberOf = init.memberOf;
	libsb.occupantOf = init.occupantOf;

	if (init.auth && !init.user.id) {
		core.emit("navigate", {});
	}
	libsb.user = init.user;

	if (underscore.isEqual(libsb.user, init.user)) {
		core.emit('user-update');
	}

	next();
}

function recvBack(back, next) {
	if (back.from !== libsb.user.id) return next();
	/*	if(!libsb.rooms.filter(function(room){ return room.id === back.to; }).length){
		libsb.rooms.push(back.room);
		core.emit('rooms-update');
	}
	if(!libsb.occupantOf.filter(function(room){ return room.id === back.to; }).length){
		libsb.occupantOf.push(back.room);
		core.emit('occupantof-update');
	}*/
	next();
}

function recvAway(away, next) {
	if (away.from !== libsb.user.id) return next();
	/*libsb.rooms = underscore.compact(libsb.rooms.map(function(room){ if(room.id !== away.to) return room; }));
	libsb.occupantOf = underscore.compact(libsb.occupantOf.map(function(room){ if(room.id !== away.to) return room; }));
	core.emit('rooms-update');
	core.emit('occupantof-update');*/
	next();
}

function recvJoin(join, next) {
	if (join.from !== libsb.user.id) return next();
	if (!libsb.memberOf.filter(function (room) {
		return room.id === join.to;
	}).length) {
		libsb.memberOf.push(join.room);
		core.emit('memberof-update');
	}
	next();
}

function recvPart(part, next) {
	if (part.from !== libsb.user.id) return next();
	libsb.memberOf = underscore.compact(libsb.memberOf.map(function (room) {
		if (room.id !== part.to) return room;
	}));
	core.emit('memberof-update');
	next();
}

function recvAdmit(admit, next) {
	if (admit.ref === libsb.user.id) {
		libsb.memberOf.push(admit.room);
	}
	next();
}

function recvExpel(expel, next) {
	if (expel.ref === libsb.user.id) {
		libsb.memberOf = libsb.memberOf.filter(function (room) {
			return room.id !== expel.to;
		});
	}
	next();
}
