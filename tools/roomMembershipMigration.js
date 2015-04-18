var crypto = require('crypto');
var config = require("../config.js");
var objectlevel = require("objectlevel");
var log = require("../lib/logger.js");

var url = require("url");
var db = require('mysql').createConnection(config.mysql);
var accountConnection = require('mysql').createConnection(config.mysql);
var leveldb, types;
var owners = {};
db.connect();
accountConnection.connect();
function closeConnection(){
	db.end();
	accountConnection.end();
}

function migrateRooms(cb) {
	var stream = db.query("select * from rooms order by rooms.type DESC;");
	stream.on("result", function(room) {
		db.pause();
		accountConnection.query("select * from accounts where room = ?", room.id, function(err, data) {
			if(err) {
				db.resume();
                console.log(err);
                return;
			}
			if(!data.length && room.type == "user") {
				db.resume();
				console.log("USER WITH NO A/C");
				return;
			}
			var newRoom = {
				id: room.id,
				description: room.description,
				createTime: room.createdOn,
				type: room.type,
				picture: "",
				timezone:0,
				identities: [],
                guides: {
                    authorizer: {
                    }
                }
			};

			try{
				newRoom.params = JSON.parse(room.params);
			}
			catch(e){
				newRoom.params = {};
			}
            
			if(data) {
                data.forEach(function(account) {
                    var u;
                    newRoom.identities.push(account.id);
                    if (/^irc/.test(account.id)) {
                        u = url.parse(account.id);
                        newRoom.params.irc = {
                            server: u.host,
                            channel: u.hash,
                            enabled: true,
                            pending: false
                        };
                    }
                });
            }

			if (newRoom.type == "user") {
                newRoom.picture = generatePick(newRoom.identities[0]);
				newRoom.params.email = {
					frequency : "daily",
					notifications : true
				};
				types.users.put(newRoom, function() {
					if(err) console.log(err);

					db.resume();
				});	
			} 
			if (newRoom.type == "room") {
				if (newRoom.params.twitter && newRoom.params.twitter.profile && newRoom.params.twitter.profile.username) {
					newRoom.identities.push("twitter://" + newRoom.id + ":" + newRoom.params.twitter.profile.username);
                    (function() {
                        var twitter = {
                            username: newRoom.params.twitter.id,
                            tags: newRoom.params.twitter.tags,
                            token: newRoom.params.twitter.token,
                            tokenSecret: newRoom.params.twitter.tokenSecret,
                            profile: {
                                screen_name: newRoom.params.twitter.profile.username, user_id: newRoom.params.twitter.profile.id}
                        };
                        newRoom.params.twitter = twitter;
                    })();
				}
                
                newRoom.params.http = {};
                if(typeof newRoom.params.allowSeo !== "undefined") {
                    newRoom.params.http.seo = newRoom.params.allowSeo;
                    delete newRoom.params.allowSeo;
                }else{
                    newRoom.params.http.seo = true;
                }
                
                newRoom.guides.authorizer.readLevel = "guest";
                newRoom.guides.authorizer.openFollow = true;
                if(typeof newRoom.params.loginrequired !== "undefined") {
                    newRoom.guides.authorizer.writeLevel = newRoom.params.loginrequired? "follower" : "guest";
                    delete newRoom.params.loginrequired;
                }
                
				types.rooms.put(newRoom, function(){
					if (err) console.log(err);
					owners[room.id] = room.owner;
					types.rooms.link(room.id, 'hasMember', room.owner, {
						role: "owner",
						time: newRoom.createdOn
					}, function(){
						db.resume();
					});
				});
			}
		});
	});
	stream.on("error", function(err){
		log("Error:", err);
	});
	stream.on("end", function(){
		cb();
	});
}

function migrateMembers(cb){
	var stream = db.query("select * from members;");
	stream.on("result", function(row) {
		if(row.partedOn) return console.log("parted user");
		if(owners[row.room] === row.user) return console.log("owner spotted.");
		types.rooms.link(row.room, 'hasMember', row.user, {
			role: "follower",
			time: row.joinedOn
		});
	});
	stream.on("error", function(err){
		log("Error:", err);
	});
	stream.on("end", function(){
		cb();
	});	
}

(function(){
	var path = process.cwd();
	if(path.split("/")[path.split("/").length-1] !="scrollback"){
		return console.log("execute from the root of scrollback");
	}
	leveldb = new objectlevel(process.cwd()+"/leveldb-storage/"+config.leveldb.path);
	types = require("../leveldb-storage/types/types.js")(leveldb);
	migrateRooms(function(){
		migrateMembers(closeConnection);
	});
})();
function generatePick(id) {
	return 'https://gravatar.com/avatar/' + crypto.createHash('md5').update(id).digest('hex') + '/?d=monsterid';
}
