var config = require('../config.js');
var log = require("../lib/logger.js");
var send = require('./sendEmail.js');
var fs=require("fs"),jade = require("jade");
var redis = require('../lib/redisProxy.js').select(config.redisDB.email);
var core;
var internalSession = Object.keys(config.whitelists)[0];
var emailConfig = config.email, digestJade;
var waitingTime1 = emailConfig.mentionEmailTimeout || 3 * 60 * 60 * 1000; //mention email timeout
var waitingTime2 = emailConfig.regularEmailTimeout || 12 * 60 * 60 *  1000;//regular email timeout
var timeout = 30 * 1000;//for debuging only
var debug = emailConfig.debug;

module.exports.init = function (coreObj) {
	core = coreObj;
	init();
};
module.exports.initMailSending = initMailSending;
module.exports.trySendingToUsers = trySendingToUsers;
module.exports.sendPeriodicMails = sendPeriodicMails;

/**
 * Read digest,jade
 * And setInterval
 */
function init() {
	fs.readFile(__dirname + "/views/digest.jade", "utf8", function(err, data) {
		if(err) throw err;
		digestJade = jade.compile(data,  {basedir: __dirname + "/views/" });
		//send mails in next hour
		var x = new Date().getUTCMinutes();
		var sub = 90;
		if (x < 30) {
			sub = 30;
		}
		log("Init email will send email after ", (sub - x)* 60000, " ms");
		setTimeout(function(){
			sendPeriodicMails();
			setInterval(sendPeriodicMails, 60*60*1000);//TODO move these numbers to myConfig
		}, (sub-x)*60000);
		setTimeout(function(){
			trySendingToUsers();
			setInterval(trySendingToUsers, 60*60*1000);
		}, (60-x)*60000);
	});
}

/**
 *Try sending mail to waiting users.
 *Reads email:toSend from redis.
 */
function trySendingToUsers() {
	redis.smembers("email:toSend", function(err,usernames) {
		if(!err && usernames) {
			if (emailConfig.debug) log("checking for mentions...", usernames);
			usernames.forEach(function(username) {
				initMailSending(username);
			});
		}
	});
}

/**
 *Init of mail sending to username
 *conditions that can call the function
 *1 - after 24 hours(12 AM in user's timezone)
 *2 - On nick mention
 *3 - Periodic check for mention timeout.
 *@param {string} username username
 */
 function initMailSending(username) {
	log("init mail sending for user  " + username);
	redis.get("email:" + username + ":lastsent", function(err, lastSent) {
		log("data returned form redis", lastSent + " , " , err);
		if (err) return;
		redis.get("email:" + username + ":isMentioned", function(err, data) {
			var ct = new Date().getTime();
			var interval = waitingTime2 ;
			if (data) interval = waitingTime1;
			if (emailConfig.debug) {
				log("username " + username + " is mentioned ", data);
				interval = timeout/2;
				if (data) interval = timeout/8;
				log("interval " , interval);
			}
			if (!lastSent )	lastSent = ct - interval;
			log("time left for user " , (parseInt(lastSent, 10) + interval - ct));
			if (parseInt(lastSent, 10) + interval <= ct) {
				//get rooms that user is following...
				log("getting rooms that user is following....");
				core.emit("getRooms", {hasMember: username, session: internalSession}, function(err, following) {
					log("results:", following);
					if(err || !following) {
						log("error in getting members information" , err);
						return;
					}
					if(!following.results || !following.results.length) {
						log("username ", username ," is not following any rooms ");
						return;
					}
					var rooms = [];
					following.results.forEach(function(r) {
						rooms.push(r.id);
					});
					prepareEmailObject(username, rooms, lastSent, function(err, email) {
						if (!err) sendMail(email);
					});
				});
				redis.srem("email:toSend", username);
			}else {
				log("can not send email to user ", username, " now" );
				redis.sadd("email:toSend", username);
			}
		});

	});
}

/**
 *send mail to user read data from redis and create mail object
 *email: {
 *  username: {string}, //username
	heading : {string},
	count: {number} ,//total count of labels
	emailId: {string},
	rooms: [
		id: {string}, //room name
		totalCount: {number},//total count of labels
		labels: [
			{
				label: {string},
				count: {number},
				interesting: [
					messages objects
				]
			},
			....
		],
		...
	],
 }
 *@param {string} username
 *@param {string} rooms all rooms that user is following
 *@param {function} callback(err, emailObject).
 */
function prepareEmailObject(username ,rooms, lastSent, callback) {
	if (emailConfig.debug) log("send mail to user ", username , rooms);
	var email = {};
	email.username = username;
	email.rooms = [];
	var ct = 0;
	var vq = 0;
	rooms.forEach(function(room) {
		var roomsObj = [];
		var qc = 0;
		var m = "email:mentions:" + room + ":" + username ;
		qc++;
		redis.smembers(m, function(err, mentions) {
			if (!err) {
				mentions.sort(function(a, b) {
					a = JSON.parse(a);
					b = JSON.parse(b);
					return a.time - b.time;
				});
				log("mentions returned from redis ", room ,mentions, lastSent);
				var l = "email:label:" + room + ":labels";

				redis.zrangebyscore(l, lastSent, "+inf",  function(err,labels) {
					if(emailConfig.debug) log("labels returned from redis" , labels);
					roomsObj.labels = [];
					roomsObj.totalCount = labels.length;
					if (!err) {
						var isLabel = false;
						labels.forEach(function(label) {
							isLabel = true;
							var lc = "email:label:" + room + ":" + label + ":count";
							qc++;
							redis.get(lc, function(err,count) {
								if (err) {
									callback(err);
								}else {
									var ll = {
										label: label ,
										count : parseInt(count, 10)
									};
									roomsObj.labels.push(ll);
								}
								done(roomsObj, mentions);
							});
						});
						if (!isLabel) {
							qc++;//if no label never call done() for this room;
							isNoLabel();
							ct++;
						}
					}
					else {
						callback(err);
					}
					done();//members

				});
			}
			else {
				callback(err);
			}
		});
		function isNoLabel() {
			if (++vq >= rooms.length) {
				callback(new Error("NO_DATA"));
			}
		}
		function done( roomObj, mentions) {
			log("room done......" , room , qc);
			if(--qc > 0 ) return;

			sortLabels(room ,roomObj,mentions,function(err,rr) {
				if (err) callback(err);
				else {
					email.rooms.push(rr);
					ct++;
					if (ct >= rooms.length) {
						deleteMentions(username, rooms);
						log("email object creation complete" , JSON.stringify(email));
						callback(null, email);
					}
				}
			});
		}
	});
}

/**
 *create email.rooms element
 *filter out labels and generate labels array for current room
 *Add label.interesting messages.
 */
function sortLabels(room, roomObj, mentions,callback) {
	var maxLabels = 5;
	log("sort labels");
	var r = {};
	var ct = 0;
	r.id = room;
	r.totalCount = roomObj.totalCount;
	r.labels = [];
	roomObj.labels.forEach(function(label) {
		label.interesting = [];
		mentions.forEach(function(m) {//TODO use new schema
			m = JSON.parse(m);
			var id = m.threads[0].id;
			if(id === label.label) {
				label.interesting.push(m);
				label.title = m.threads[0].title;
			}
		});
		ct++;
		redis.get ("email:label:" + room + ":" + label.label + ":title", function(err, title) {
			if (!err && title) {
				label.title = title;
			} else label.title = "Title";
			var pos = r.labels.length;
			for (var i = 0;i < r.labels.length;i++ ) {
				if (r.labels[i].interesting.length < label.interesting.length ) {
					pos = i;
					break;
				}
				else if(r.labels[i].interesting.length === label.interesting.length) {
					if (r.labels[i].count < label.count) {
						pos = i;
						break;
					}
				}
			}
			var rm = -1;
			if (r.labels.length >= maxLabels) {
				rm = r.labels.length;
			}
			r.labels.splice(pos,0,label);
			r.labels.sort(function(l1,l2){
				return l2.count - l1.count;
			});
			if (rm != -1) {
				r.labels.splice(rm,1);
			}
			done();
		});
	});
	function done() {
		if (--ct > 0) {
			return;
		}
		r.labels.sort(function(l1, l2) {
			return l2.count - l1.count;
		});
		var nn = 0;
		r.labels.forEach(function(label) {
			nn++;
			redis.lrange("email:label:" + room + ":" + label.label + ":tail", 0, -1, function(err, lastMsgs) {
				if (lastMsgs ) {
					lastMsgs.reverse();
					lastMsgs.forEach(function(lastMsg) {
						var isP = true;
						var msg = JSON.parse(lastMsg);
						label.interesting.forEach(function(m) {
							if(m.id === msg.id) {
								isP = false;
							}
						});
						if (isP) {
							label.interesting.push(msg);
						}
					});
				}
				complete();
			});
		});
		log("room Obj " , JSON.stringify(r));
		function complete() {
			if (--nn > 0) {
				return;
			}
			r.labels.forEach(function(label) {
				label.interesting.sort(function(m1,m2){
					return m1.time - m2.time;
				});
			});
			callback(null, r);
		}
	}
}

/**
 *delete all mentions of user on rooms from redis
 *@param {string} username.
 * @param rooms
 */
function deleteMentions(username , rooms) {
	rooms.forEach(function(room) {
		var m = "email:mentions:" + room + ":" + username ;
		redis.multi(function(multi) {
			multi.del(m);
			m = "email:" + username + ":isMentioned";
			multi.del(m);
			multi.exec(function(replies) {
				log("mentions deleted" , replies);
			});
		});
	});
}

/**
 *Read data from email Object render HTML from email object using /views/digest.jade
 *and then send mail to email.emailId
 *@param {object} Email Object
 */
function sendMail(email) {
	core.emit("getUsers", {ref: email.username, session: internalSession}, function(err, data) {
		if (err || !data.results) return;
		var user = data.results;
		log("getting email id", data);
		var mailAccount;
		if (user && user[0] && user[0].identities) {
			mailAccount = user[0].identities;

			mailAccount.forEach(function(e) {
				if (e.indexOf("mailto:") === 0) {
					email.emailId = e.substring(7);
					var html;
					try {
						email.heading = getHeading(email);
						log("email object" + JSON.stringify(email));
						html = digestJade(email);
					}catch(err) {
						log("Error while rendering email: ", err);
						//TODO send mail to developer..
						return;
					}
					log(email , "sending email to user " , html );
					send(emailConfig.from, email.emailId, email.heading, html);
					redis.set("email:" + email.username + ":lastsent", new Date().getTime());
					var interval = 2*24*60*60*1000;//TODO move this variable inside myConfig
					if (emailConfig.debug) {
						interval = timeout*2;
					}
					email.rooms.forEach(function(room) {
						redis.zremrangebyscore("email:label:" + room.id + ":labels", 0,
							new Date().getTime() - interval , function(err, data) {
								log("deleted old labels from that room " , err ,data);
							});//ZREMRANGEBYSCORE email:scrollback:labels -1 1389265655284
					});
				}
			});
		}
	});
}
/**
 *Generate Heading from email Object
 *@param {object} email Object
 */
function getHeading(email) {
	var heading = "";
	var bestLabel ;
	var bestMention = {};
	var labelCount = 0;
	var more = 0;
	email.rooms.forEach(function(room) {
		labelCount += room.totalCount;
		more += room.labels.length;
		room.labels.forEach(function(label) {
			if (!bestLabel) {
				bestLabel = {};
				bestLabel.title = formatText(label.title);
				bestLabel.room = room.id;
				bestLabel.count = label.count;
			}
			else if(bestLabel.count < label.count){
				bestLabel.title = formatText(label.title);
				bestLabel.room = room.id;
				bestLabel.count = label.count;
			}
			log("best label", bestLabel);
			label.interesting.forEach(function(m) {
				if (!bestMention.mentions && m.mentions && m.mentions.indexOf(email.username) != -1) {
					bestMention = m;
				}
				else if(m.mentions && m.mentions.indexOf(email.username) != -1 && bestMention.text.length < m.text.length) {
					bestMention = m;
				}
			});
		});
	});
	email.count = labelCount;
	if (bestMention.mentions) {//if mentioned
		heading += "[" + bestMention.from.replace(/guest-/g, "") +  "] " + bestMention.text + " - on " + bestMention.to;
	}
	else {
		var tail = (more > 1 ? " +" + (more - 1) + " more": "");
		heading += "[" + bestLabel.room.substring(0,1).toUpperCase() + bestLabel.room.substring(1) + "] " +
			bestLabel.title + tail;
	}
	email.formatText = formatText;
	return heading;
}
var formatText = function(text) {
	var s  = text.replace(/-/g,' ');
	s = s.trim();
	s = s.substring(0,1).toUpperCase() + s.substring(1);
	return s;
};
/**
 *Send mails to users based on current time.
 *@param {object} Map of room data.
 */
function sendPeriodicMails(){
	var x = new Date().getUTCHours();
	var t;
	var start1 = x >= 12 ? (24 - x)*60 : -x*60;
	var end1 = start1 + 59;
	var start2 = -100*60;//big values
	var end2 = -200*60;
	if (emailConfig.debug) {
		start1=0;//for testing....
		end1=10000000;//for testing...
	}

	if (x >= 9 && x < 12) {
		start2 = 24*60 + start1;//(+12 +14 +13)
		end2 = start2 + 59;//+13
	}
	if (x == 12) {
		start2 = -12*60;
		end2 = start2 + 59;
	}
	log("current time hour:",x+","+start1+","+start2);
	function processResults(err, data) {
		log("err", err, " data: ", data );
		if (err || !data.results) return;
		var users = data.results;
		users.forEach(function(user) {
			log("trying for user", user);
			if (user.params && (!user.params.email || user.params.email.frequency !== "never")) {//TODO write a query based on freq
				initMailSending(user.id);
			}
		});
	}
	if (start1 > end1) {
		t = start1;
		start1 = end1;
		end1 = t;
	}
	if (start2 > end2) {
		t = start2;
		start2 = end2;
		end2 = t;
	}
	core.emit("getUsers", {timezone: {gte: start1, lte: end1}, session: internalSession}, function(err, data) {
		processResults(err, data);
	});
	core.emit("getUsers", {timezone: {gte: start2, lte: end2}, session: internalSession}, function(err, data) {
		processResults(err, data);
	});



}
